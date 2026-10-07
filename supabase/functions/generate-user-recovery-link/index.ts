// Password help for users when no email provider is available: a platform administrator generates a
// one-time recovery link and sends it to the person over WhatsApp. The person opens it, chooses a new
// password, and is signed in. Nothing is emailed and no password is ever shown to anyone.
//
// A recovery link is effectively access to the account, so this is deliberately restricted:
//  * only SUPER_ADMIN and SUPPORT_ADMIN may use it, and every use is written to the audit log;
//  * only a SUPER_ADMIN may generate one for another platform administrator (otherwise a support agent
//    could take over the super-admin account).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, isAllowedOrigin, siteUrl } from '../_shared/cors.ts'

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

  const { data: callerAccess, error: accessError } = await admin.from('platform_admin_access').select('role').eq('user_id', caller.id).eq('status', 'active').limit(1).maybeSingle()
  if (accessError) return json({ error: 'Could not verify administrator access' }, 500)
  if (!callerAccess || !['SUPER_ADMIN', 'SUPPORT_ADMIN'].includes(callerAccess.role)) return json({ error: 'Only super admins and support admins can generate recovery links' }, 403)

  let body: { userId?: string }
  try { body = await request.json() } catch { return json({ error: 'Request body must be valid JSON' }, 400) }
  const userId = String(body.userId ?? '').trim()
  if (!userId) return json({ error: 'userId is required' }, 400)

  const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId)
  if (targetError || !target?.user) return json({ error: 'User not found' }, 404)
  if (!target.user.email) return json({ error: 'This account has no email address to recover' }, 409)

  const { data: targetAdmin } = await admin.from('platform_admin_access').select('role').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle()
  if (targetAdmin && callerAccess.role !== 'SUPER_ADMIN') return json({ error: 'Only a super admin can generate a recovery link for another administrator' }, 403)

  const requestOrigin = request.headers.get('Origin') ?? ''
  const site = siteUrl || (isAllowedOrigin(requestOrigin) ? requestOrigin : '')
  if (!site) return json({ error: 'SITE_URL is not configured. Run: supabase secrets set SITE_URL="https://your-site" and redeploy.' }, 500)

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: target.user.email, options: { redirectTo: `${site}/auth` } })
  const actionLink = link?.properties?.action_link
  if (linkError || !actionLink) return json({ error: linkError?.message ?? 'Could not create the recovery link' }, 502)

  const { data: profile } = await admin.from('profiles').select('full_name,phone').eq('id', userId).maybeSingle()
  await admin.from('admin_audit_logs').insert({
    actor_id: caller.id,
    actor_role: callerAccess.role,
    action: 'user.recovery_link_issued',
    target_type: 'user',
    target_id: userId,
    metadata: { target_is_admin: Boolean(targetAdmin) },
  })

  return json({
    ok: true,
    link: actionLink,
    siteUrl: site,
    email: target.user.email,
    name: profile?.full_name || target.user.user_metadata?.full_name || target.user.email.split('@')[0],
    phone: profile?.phone ?? target.user.phone ?? null,
  })
})
