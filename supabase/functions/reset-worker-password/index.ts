// Lets a business OWNER reset a worker's password without any email provider. A new temporary password is
// generated (same rules as when the worker was first added), the worker is forced to choose their own at
// next sign-in, and the owner is shown the temporary password once so they can pass it on.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
function temporaryPassword(length = 20) {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500)

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } })
  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) return json({ error: 'Unauthorized' }, 401)
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

  let body: { employeeProfileId?: string }
  try { body = await request.json() } catch { return json({ error: 'Request body must be valid JSON' }, 400) }
  const employeeProfileId = String(body.employeeProfileId ?? '').trim()
  if (!employeeProfileId) return json({ error: 'employeeProfileId is required' }, 400)

  const { data: employee, error: employeeError } = await admin.from('employee_profiles').select('id,organization_id,user_id,employee_id,full_name,phone,employment_status').eq('id', employeeProfileId).maybeSingle()
  if (employeeError) return json({ error: 'Could not load the worker' }, 500)
  // Same response for "no such worker" and "a worker in someone else's business": never confirm other tenants' records exist.
  if (!employee) return json({ error: 'Worker not found' }, 404)

  const { data: owner, error: ownerError } = await admin.from('organization_members').select('role').eq('organization_id', employee.organization_id).eq('user_id', caller.id).eq('role', 'owner').maybeSingle()
  if (ownerError) return json({ error: 'Could not verify ownership' }, 500)
  if (!owner) return json({ error: 'Worker not found' }, 404)
  if (!employee.user_id) return json({ error: 'This worker has no sign-in account yet' }, 409)
  if (employee.employment_status !== 'active') return json({ error: 'Only active workers can have their password reset' }, 409)

  const { data: membership } = await admin.from('organization_members').select('role').eq('organization_id', employee.organization_id).eq('user_id', employee.user_id).maybeSingle()
  if (membership?.role !== 'member') return json({ error: 'Only worker accounts can be reset here' }, 409)

  const password = temporaryPassword()
  const { error: passwordError } = await admin.auth.admin.updateUserById(employee.user_id, { password })
  if (passwordError) return json({ error: passwordError.message }, 502)
  const { error: flagError } = await admin.from('employee_profiles').update({ must_change_password: true }).eq('id', employee.id)
  if (flagError) return json({ error: 'Password was reset but the change-on-first-login flag could not be set. Reset again.' }, 500)

  return json({ ok: true, temporaryPassword: password, employeeId: employee.employee_id, fullName: employee.full_name, phone: employee.phone })
})
