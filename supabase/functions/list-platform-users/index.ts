import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'
import { recordLatency, startTimer } from '../_shared/latency.ts'

serve(async (request) => {
  const latencyTimer = startTimer()
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return new Response('Missing authorization', { status: 401, headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response('Server configuration is incomplete', { status: 500, headers: corsHeaders })
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await callerClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: access, error: accessError } = await adminClient
    .from('platform_admin_access')
    .select('role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  if (accessError) return new Response(accessError.message, { status: 500, headers: corsHeaders })
  if (!access) return new Response('Platform administrator access required', { status: 403, headers: corsHeaders })

  const url = new URL(request.url)
  const page = Math.max(Number(url.searchParams.get('page') ?? '1') || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? '50') || 50, 1), 100)
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()

  // The Auth admin API can only list in pages and cannot search, so searching used to look at the current
  // page only (a user on page 3 was "not found"). A search now scans up to 10,000 accounts and paginates the
  // matches; an ordinary listing still fetches just the requested page.
  const SCAN_PAGE_SIZE = 1000
  const MAX_SCAN_PAGES = 10
  let allUsers: User[] = []
  let authTotal = 0
  if (search) {
    for (let scanPage = 1; scanPage <= MAX_SCAN_PAGES; scanPage += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page: scanPage, perPage: SCAN_PAGE_SIZE })
      if (error) return new Response(error.message, { status: 500, headers: corsHeaders })
      allUsers = allUsers.concat(data.users ?? [])
      authTotal = data.total ?? allUsers.length
      if ((data.users ?? []).length < SCAN_PAGE_SIZE) break
    }
  } else {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: pageSize })
    if (error) return new Response(error.message, { status: 500, headers: corsHeaders })
    allUsers = data.users ?? []
    authTotal = data.total ?? allUsers.length
  }

  const profileRows: { id: string; full_name: string | null; phone: string | null }[] = []
  for (let index = 0; index < allUsers.length; index += 200) {
    const ids = allUsers.slice(index, index + 200).map((account) => account.id)
    const { data, error } = await adminClient.from('profiles').select('id,full_name,phone').in('id', ids)
    if (error) return new Response(error.message, { status: 500, headers: corsHeaders })
    profileRows.push(...(data ?? []))
  }
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]))

  const matchedUsers = allUsers.filter((account) => {
    if (!search) return true
    const profile = profileById.get(account.id)
    return [account.email, account.phone, account.user_metadata?.full_name, profile?.full_name, profile?.phone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search))
  })
  const pageUsers = search ? matchedUsers.slice((page - 1) * pageSize, page * pageSize) : matchedUsers
  const total = search ? matchedUsers.length : authTotal

  const filteredUsers = pageUsers
    .map((account) => {
      const profile = profileById.get(account.id)
      return {
        id: account.id,
        email: account.email ?? null,
        phone: profile?.phone ?? account.phone ?? null,
        name: profile?.full_name
          || account.user_metadata?.full_name
          || account.user_metadata?.name
          || account.user_metadata?.display_name
          || account.email?.split('@')[0]
          || null,
      created_at: account.created_at,
      last_sign_in_at: account.last_sign_in_at ?? null,
      confirmed_at: account.confirmed_at ?? null,
      status: account.banned_until ? 'banned' : account.confirmed_at ? 'active' : 'pending',
      }
    })

  void recordLatency('list-platform-users', latencyTimer, 200)
  return new Response(JSON.stringify({
    users: filteredUsers,
    page,
    pageSize,
    total,
    adminRole: access.role,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
