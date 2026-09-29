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
    if (!organization) return json({ error: 'Invalid worker credentials' }, 401)
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
  if (error || !employees || employees.length !== 1) return json({ error: 'Invalid worker credentials' }, 401)
  const employee = employees[0]
  if (!employee.email) return json({ error: 'Invalid worker credentials' }, 401)
  const { data: membership } = await adminClient
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', employee.organization_id)
    .eq('user_id', employee.user_id)
    .eq('role', 'member')
    .maybeSingle()
  if (!membership) return json({ error: 'Invalid worker credentials' }, 401)
  if (employee.branch_id) {
    const { data: branch } = await adminClient
      .from('branches')
      .select('id')
      .eq('id', employee.branch_id)
      .eq('organization_id', employee.organization_id)
      .eq('status', 'active')
      .maybeSingle()
    if (!branch) return json({ error: 'Invalid worker credentials' }, 401)
  }
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error: signInError } = await authClient.auth.signInWithPassword({ email: employee.email, password })
  if (signInError || !data.session) return json({ error: 'Invalid worker credentials' }, 401)
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in, user: data.user })
})
