import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500)
  let body: { identifier?: string; employeeId?: string; password?: string }
  try { body = await request.json() } catch { return json({ error: 'Request body must be valid JSON' }, 400) }
  const identifier = (body.identifier ?? body.employeeId)?.trim()
  const password = body.password
  if (!identifier || !password) return json({ error: 'Worker identifier and password are required' }, 400)
  const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Brute-force protection. This endpoint is public and turns guesses into sign-ins, so it throttles by
  // the identifier being attacked (8 failures / 15 min) and by the caller's address (40 failures / 15 min).
  const clientIp = (request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim().slice(0, 64)
  const identifierKey = identifier.toLowerCase().slice(0, 120)
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const failuresFor = async (key: string) => (await adminClient.from('auth_throttle').select('id', { count: 'exact', head: true }).eq('bucket', 'worker_login').eq('key', key).gte('created_at', since)).count ?? 0
  const [identifierFailures, ipFailures] = await Promise.all([failuresFor(identifierKey), failuresFor(`ip:${clientIp}`)])
  if (identifierFailures >= 8 || ipFailures >= 40) return json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }, 429)
  const failLogin = async () => {
    await adminClient.from('auth_throttle').insert([{ bucket: 'worker_login', key: identifierKey }, { bucket: 'worker_login', key: `ip:${clientIp}` }])
    await adminClient.from('auth_throttle').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    await new Promise((resolve) => setTimeout(resolve, 300)) // evens out response time between "unknown worker" and "wrong password"
    return json({ error: 'Invalid worker credentials' }, 401)
  }
  const isEmail = identifier.includes('@')
  const separator = identifier.indexOf(':')
  const workspaceSlug = !isEmail && separator > 0 ? identifier.slice(0, separator).trim().toLowerCase() : null
  const employeeIdentifier = workspaceSlug ? identifier.slice(separator + 1).trim() : identifier
  let organizationId: string | null = null
  if (workspaceSlug) {
    const { data: organization } = await adminClient
      .from('organizations')
      .select('id')
      .eq('slug', workspaceSlug)
      .maybeSingle()
    if (!organization) return await failLogin()
    organizationId = organization.id
  }
  let employeeQuery = adminClient
    .from('employee_profiles')
    .select('email,employment_status,user_id,organization_id,branch_id')
    .eq('employment_status', 'active')
    .not('user_id', 'is', null)
  employeeQuery = isEmail
    ? employeeQuery.ilike('email', employeeIdentifier.replace(/[\\%_]/g, '\\$&'))
    : employeeQuery.eq('employee_id', employeeIdentifier)
  if (organizationId) employeeQuery = employeeQuery.eq('organization_id', organizationId)
  const { data: employees, error } = await employeeQuery.limit(2)
  // Deliberately return the same response for missing and ambiguous identities.
  // This prevents employee enumeration and makes per-organization ID collisions
  // harmless until an administrator resolves them.
  if (error || !employees || employees.length !== 1) return await failLogin()
  const employee = employees[0]
  if (!employee.email) return await failLogin()
  const { data: membership } = await adminClient
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', employee.organization_id)
    .eq('user_id', employee.user_id)
    .eq('role', 'member')
    .maybeSingle()
  if (!membership) return await failLogin()
  if (employee.branch_id) {
    const { data: branch } = await adminClient
      .from('branches')
      .select('id')
      .eq('id', employee.branch_id)
      .eq('organization_id', employee.organization_id)
      .eq('status', 'active')
      .maybeSingle()
    if (!branch) return await failLogin()
  }
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error: signInError } = await authClient.auth.signInWithPassword({ email: employee.email, password })
  if (signInError || !data.session) return await failLogin()
  // A successful sign-in clears this worker's recent failures so a few earlier typos never lock them out.
  await adminClient.from('auth_throttle').delete().eq('bucket', 'worker_login').eq('key', identifierKey)
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in, user: data.user })
})
