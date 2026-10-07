// Gives an approved promoter a way to sign in WITHOUT any email provider and WITHOUT ever creating or
// sending a password. An administrator calls this, receives a one-time password-setup link, and sends it
// to the promoter on WhatsApp. The promoter opens it, chooses their own password, and lands in the
// promoter dashboard.
//
// Why a link and not a password: a password pasted into WhatsApp sits in chat history forever; a
// setup link is single-use, expires, and the promoter picks the real password themselves.
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

  // Same rule as the rest of the promoter admin tools: any active platform administrator.
  const { data: access, error: accessError } = await admin.from('platform_admin_access').select('role').eq('user_id', caller.id).eq('status', 'active').limit(1).maybeSingle()
  if (accessError) return json({ error: 'Could not verify administrator access' }, 500)
  if (!access) return json({ error: 'Platform administrator access required' }, 403)

  let body: { promoterId?: string; linkExisting?: boolean }
  try { body = await request.json() } catch { return json({ error: 'Request body must be valid JSON' }, 400) }
  const promoterId = String(body.promoterId ?? '').trim()
  if (!promoterId) return json({ error: 'promoterId is required' }, 400)

  const { data: promoter, error: promoterError } = await admin.from('promoters').select('id,application_id,user_id,full_name,email,referral_code,status').eq('id', promoterId).maybeSingle()
  if (promoterError) return json({ error: 'Could not load the promoter' }, 500)
  if (!promoter) return json({ error: 'Promoter not found' }, 404)
  if (promoter.status !== 'active') return json({ error: 'This promoter is suspended. Reactivate them first.' }, 409)

  // Where the link should land. SITE_URL wins; otherwise accept the caller's own origin only if it is allow-listed.
  const requestOrigin = request.headers.get('Origin') ?? ''
  const site = siteUrl || (isAllowedOrigin(requestOrigin) ? requestOrigin : '')
  if (!site) return json({ error: 'SITE_URL is not configured. Run: supabase secrets set SITE_URL="https://your-site" and redeploy.' }, 500)

  let userId: string | null = promoter.user_id
  let createdAccount = false
  let linkedExisting = false
  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: promoter.email,
      email_confirm: true, // the administrator is vouching for this address; the setup link proves possession
      password: `${crypto.randomUUID()}${crypto.randomUUID()}`, // never shown to anyone
      user_metadata: { full_name: promoter.full_name },
    })
    if (created?.user) {
      userId = created.user.id
      createdAccount = true
    } else if (/already|registered|exists/i.test(createError?.message ?? '')) {
      // Someone already holds this email. We cannot tell whether it is the applicant or an impostor who
      // registered it first, so never bind it silently: an administrator must confirm identity first.
      if (!body.linkExisting) {
        return json({
          error: 'ACCOUNT_EXISTS',
          message: 'An account with this email already exists. Confirm with the applicant on WhatsApp that it is theirs, then choose "Link existing account".',
        }, 409)
      }
      let page = 1
      while (!userId && page <= 25) {
        const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (listError || !listed.users.length) break
        userId = listed.users.find((entry) => entry.email?.toLowerCase() === promoter.email.toLowerCase())?.id ?? null
        page += 1
      }
      if (!userId) return json({ error: 'Could not find the existing account for that email' }, 404)
      linkedExisting = true
    } else {
      return json({ error: createError?.message ?? 'Could not create the promoter account' }, 502)
    }
    const { error: bindError } = await admin.from('promoters').update({ user_id: userId, updated_at: new Date().toISOString() }).eq('id', promoter.id).is('user_id', null)
    if (bindError) return json({ error: 'Could not attach the account to the promoter' }, 500)
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: promoter.email, options: { redirectTo: `${site}/auth` } })
  const actionLink = link?.properties?.action_link
  if (linkError || !actionLink) return json({ error: linkError?.message ?? 'Could not create the setup link' }, 502)

  const { data: application } = promoter.application_id
    ? await admin.from('promoter_applications').select('phone').eq('id', promoter.application_id).maybeSingle()
    : { data: null }

  await admin.from('admin_audit_logs').insert({
    actor_id: caller.id,
    actor_role: access.role,
    action: 'promoter.access_link_issued',
    target_type: 'promoter',
    target_id: promoter.id,
    metadata: { created_account: createdAccount, linked_existing_account: linkedExisting },
  })

  return json({
    ok: true,
    link: actionLink,
    siteUrl: site,
    createdAccount,
    linkedExisting,
    promoter: { name: promoter.full_name, code: promoter.referral_code, whatsapp: application?.phone ?? null },
  })
})
