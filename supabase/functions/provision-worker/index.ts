import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

const temporaryPasswordAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'

function temporaryPassword(length = 20) {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => temporaryPasswordAlphabet[value % temporaryPasswordAlphabet.length]).join('')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Missing authorization' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration is incomplete' }, 500)
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user: caller }, error: authError } = await callerClient.auth.getUser()
  if (authError || !caller) return json({ error: 'Unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  // Accept the canonical camelCase contract and the legacy form field names
  // so an older browser bundle cannot silently turn a complete form into an
  // apparently empty request during a rolling deploy.
  const organizationId = String(body.organizationId ?? body.organization_id ?? '').trim()
  const branchId = body.branchId || body.branch_id ? String(body.branchId ?? body.branch_id) : null
  const employeeId = String(body.employeeId ?? body.employee_id ?? '').trim()
  const fullName = String(body.fullName ?? body.full_name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = body.phone ? String(body.phone).trim() : null
  const jobTitle = body.jobTitle || body.job_title ? String(body.jobTitle ?? body.job_title).trim() : null
  const department = body.department ? String(body.department).trim() : null
  const hiredOn = body.hiredOn || body.hired_on ? String(body.hiredOn ?? body.hired_on) : null
  const monthlySalaryValue = body.monthlySalary ?? body.monthly_salary
  const monthlySalary = monthlySalaryValue === '' || monthlySalaryValue == null ? null : Number(monthlySalaryValue)

  if (!organizationId || !employeeId || !fullName || !email) {
    const missing = [
      !organizationId && 'organizationId',
      !employeeId && 'employeeId',
      !fullName && 'fullName',
      !email && 'email',
    ].filter(Boolean)
    return json({ error: `Missing required worker fields: ${missing.join(', ')}` }, 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid worker email is required' }, 400)
  }
  if (hiredOn && !/^\d{4}-\d{2}-\d{2}$/.test(hiredOn)) {
    return json({ error: 'hiredOn must be an ISO date' }, 400)
  }
  if (monthlySalary !== null && (!Number.isFinite(monthlySalary) || monthlySalary < 0)) {
    return json({ error: 'monthlySalary must be a non-negative number' }, 400)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: owner, error: ownerError } = await adminClient
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', caller.id)
    .eq('role', 'owner')
    .maybeSingle()
  if (ownerError) return json({ error: ownerError.message }, 500)
  if (!owner) return json({ error: 'Only an organization owner can provision workers' }, 403)

  if (branchId) {
    const { data: branch, error: branchError } = await adminClient
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .maybeSingle()
    if (branchError) return json({ error: branchError.message }, 500)
    if (!branch) return json({ error: 'Branch does not belong to this organization' }, 400)
  }

  const { data: duplicateEmployee, error: duplicateEmployeeError } = await adminClient
    .from('employee_profiles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (duplicateEmployeeError) return json({ error: duplicateEmployeeError.message }, 500)
  if (duplicateEmployee) return json({ error: 'That employee ID is already in use' }, 409)

  const { data: duplicateEmail, error: duplicateEmailError } = await adminClient
    .from('employee_profiles')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('email', email)
    .maybeSingle()
  if (duplicateEmailError) return json({ error: duplicateEmailError.message }, 500)
  if (duplicateEmail) return json({ error: 'That worker email is already in use' }, 409)

  const password = temporaryPassword()
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    phone: phone || undefined,
    password,
    email_confirm: true,
    phone_confirm: Boolean(phone),
    user_metadata: {
      full_name: fullName,
      worker: true,
      organization_id: organizationId,
    },
  })
  if (createUserError || !createdUser.user) {
    return json({ error: createUserError?.message ?? 'Could not create worker identity' }, 400)
  }

  const userId = createdUser.user.id
  let employeeProfileId: string | null = null
  try {
    const { data: profile, error: profileError } = await adminClient
      .from('employee_profiles')
      .insert({
        organization_id: organizationId,
        user_id: null,
        employee_id: employeeId,
        full_name: fullName,
        email,
        phone,
        job_title: jobTitle,
        department,
        hired_on: hiredOn,
        employment_status: 'active',
        must_change_password: true,
        branch_id: branchId,
        monthly_salary: monthlySalary,
      })
      .select('id')
      .single()
    if (profileError || !profile) throw new Error(profileError?.message ?? 'Could not create employee profile')
    employeeProfileId = profile.id

    const { error: linkError } = await adminClient.rpc('link_provisioned_worker', {
      target_org: organizationId,
      target_employee: employeeProfileId,
      target_user: userId,
    })
    if (linkError) throw new Error(linkError.message)
    if (branchId) {
      const { error: branchMemberError } = await adminClient
        .from('branch_members')
        .insert({ branch_id: branchId, user_id: userId })
      if (branchMemberError) throw new Error(branchMemberError.message)
    }
  } catch (error) {
    if (employeeProfileId) {
      await adminClient.from('employee_profiles').delete().eq('id', employeeProfileId)
    }
    await adminClient.auth.admin.deleteUser(userId)
    return json({ error: errorMessage(error) }, 400)
  }

  // The password is intentionally returned only in this response. It is never
  // written to a table, log, metadata field, or subsequent response.
  return json({
    employeeProfileId,
    userId,
    email,
    mustChangePassword: true,
    temporaryPassword: password,
  }, 201)
})
