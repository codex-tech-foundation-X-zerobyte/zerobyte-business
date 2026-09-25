import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request)
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

  const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({
    page,
    perPage: pageSize,
  })
  if (usersError) return new Response(usersError.message, { status: 500, headers: corsHeaders })

  const userIds = (users.users ?? []).map((account) => account.id)
  const { data: profiles, error: profilesError } = userIds.length
    ? await adminClient.from('profiles').select('id,full_name,phone').in('id', userIds)
    : { data: [], error: null }
  if (profilesError) return new Response(profilesError.message, { status: 500, headers: corsHeaders })
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

  const filteredUsers = (users.users ?? [])
    .filter((account) => {
      if (!search) return true
      const profile = profileById.get(account.id)
      return [account.email, account.phone, account.user_metadata?.full_name, profile?.full_name, profile?.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    })
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

  return new Response(JSON.stringify({
    users: filteredUsers,
    page,
    pageSize,
    total: users.total ?? filteredUsers.length,
    adminRole: access.role,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
