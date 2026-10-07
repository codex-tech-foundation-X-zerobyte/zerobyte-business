import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

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
  const { data: access, error: accessError } = await admin.from('platform_admin_access').select('role').eq('user_id', caller.id).eq('status', 'active').limit(1).maybeSingle()
  if (accessError) return json({ error: 'Could not verify administrator access' }, 500)
  if (!access) return json({ error: 'Platform administrator access required' }, 403)

  let body: { userId?: string; action?: 'ban' | 'unban' }
  try { body = await request.json() } catch { return json({ error: 'Request body must be valid JSON' }, 400) }
  const userId = String(body.userId ?? '').trim()
  const action = body.action === 'unban' ? 'unban' : 'ban'
  if (!userId) return json({ error: 'User is required' }, 400)
  if (userId === caller.id) return json({ error: 'You cannot ban your own administrator account' }, 400)

  if (action === 'ban') {
    const { data: memberships, error: membershipError } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
    if (membershipError) return json({ error: 'Could not load the user organizations' }, 500)
    if (memberships?.length) {
      const { error: notificationError } = await admin.from('notifications').insert(
        memberships.map((membership) => ({
          organization_id: membership.organization_id,
          user_id: userId,
          title: 'Account access suspended',
          body: 'A platform administrator suspended your account. You can no longer sign in until an administrator restores access.',
        })),
      )
      if (notificationError) return json({ error: 'Could not deliver the account status notification' }, 500)
    }
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { ban_duration: action === 'ban' ? '876000h' : 'none' })
  if (updateError) return json({ error: updateError.message }, 502)
  await admin.from('admin_audit_logs').insert({
    actor_id: caller.id,
    actor_role: access.role,
    action: action === 'ban' ? 'user.banned' : 'user.unbanned',
    target_type: 'auth_user',
    target_id: userId,
    metadata: { ban_duration: action === 'ban' ? '876000h' : 'none' },
  })
  return json({ ok: true, action })
})
