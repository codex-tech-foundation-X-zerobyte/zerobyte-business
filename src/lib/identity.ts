import type { SupabaseClient } from '@supabase/supabase-js'

export type CurrentMembership = {
  organization_id: string
  role: 'owner' | 'admin' | 'member'
  organization: { id: string; name: string } | null
}

export type CurrentEmployee = {
  id: string
  user_id: string
  employee_id: string
  full_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  employment_status: string
  hired_on: string | null
  branch_id: string | null
  must_change_password: boolean
}

export type CurrentUserContext = {
  userId: string
  email: string
  displayName: string
  memberships: CurrentMembership[]
  employee: CurrentEmployee | null
}

export async function getCurrentUserContext(client: SupabaseClient) {
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error('Your session has expired.')
  const user = userData.user
  const [{ data: memberships, error: membershipError }, { data: employee, error: employeeError }] = await Promise.all([
    client
      .from('organization_members')
      .select('organization_id,role,organizations(id,name)')
      .eq('user_id', user.id),
    client
      .from('employee_profiles')
      .select('id,user_id,employee_id,full_name,email,phone,job_title,employment_status,hired_on,branch_id,must_change_password')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (membershipError) throw membershipError
  if (employeeError) throw employeeError
  if (employee && employee.employment_status !== 'active') {
    await client.auth.signOut()
    throw new Error('This worker account is no longer active. Contact an organization administrator.')
  }
  return {
    userId: user.id,
    email: user.email ?? '',
    displayName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? employee?.full_name ?? '',
    memberships: (memberships ?? []).map((membership) => ({
      organization_id: membership.organization_id as string,
      role: membership.role as CurrentMembership['role'],
      organization: Array.isArray(membership.organizations) ? membership.organizations[0] ?? null : membership.organizations as CurrentMembership['organization'],
    })),
    employee: employee as CurrentEmployee | null,
  } satisfies CurrentUserContext
}

export function hasRole(context: CurrentUserContext, roles: CurrentMembership['role'][]) {
  return context.memberships.some((membership) => roles.includes(membership.role))
}

export function hasPermission(context: CurrentUserContext, permission: 'manage_team' | 'manage_inventory' | 'operate_sales') {
  if (permission === 'operate_sales') return context.memberships.length > 0
  if (permission === 'manage_inventory') return hasRole(context, ['owner', 'admin'])
  return hasRole(context, ['owner', 'admin'])
}
