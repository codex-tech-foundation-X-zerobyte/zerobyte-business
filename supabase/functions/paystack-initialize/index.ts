// Starts a plan payment. The browser sends ONLY which organization and which plan it wants -- never an amount.
// The price is read here from plan_price_versions, stored against a fresh server-made reference, and handed to
// Paystack. The browser gets back a Paystack checkout address and nothing else.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, siteUrl } from '../_shared/cors.ts'
import { recordLatency, startTimer } from '../_shared/latency.ts'
import { initializeTransaction, paystackSecret } from '../_shared/paystack.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (request) => {
  const timer = startTimer()
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) => {
    void recordLatency('paystack-initialize', timer, status)
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Unauthorized' }, 401)
  if (!paystackSecret() || !siteUrl) return json({ error: 'Online payments are not configured yet.' }, 503)

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const {
    data: { user },
  } = await caller.auth.getUser()
  if (!user || !user.email) return json({ error: 'Unauthorized' }, 401)

  let body: { organizationId?: string; planId?: string; interval?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }
  const organizationId = String(body.organizationId ?? '')
  const planId = String(body.planId ?? '')
  const interval = body.interval === 'yearly' ? 'yearly' : 'monthly'
  if (!UUID.test(organizationId) || !UUID.test(planId)) return json({ error: 'Choose a plan to continue.' }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Only the business owner may pay for the plan (same rule as changing plans).
  const { data: membership } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (membership?.role !== 'owner') return json({ error: 'Only the business owner can pay for a plan.' }, 403)

  const { data: plan } = await admin.from('plans').select('id,code,name,active').eq('id', planId).maybeSingle()
  if (!plan || !plan.active) return json({ error: 'That plan is not available.' }, 404)
  if (plan.code === 'free' || plan.code === 'enterprise')
    return json({ error: 'This plan is not paid online. Contact support to arrange it.' }, 400)

  // The price comes from the database -- the one place an admin controls it -- never from the request.
  const { data: price } = await admin
    .from('plan_price_versions')
    .select('id,amount,currency')
    .eq('plan_id', planId)
    .eq('billing_interval', interval)
    .eq('status', 'active')
    .maybeSingle()
  const amountKobo = price ? Math.round(Number(price.amount) * 100) : 0
  if (!price || !Number.isFinite(amountKobo) || amountKobo <= 0)
    return json({ error: 'This plan has no online price yet. Contact support.' }, 400)

  // Never silently replace time the customer has already paid for: switching plans mid-period would throw it away.
  const { data: current } = await admin
    .from('subscriptions')
    .select('plan_id,status,provider,current_period_end')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (
    current?.status === 'active' &&
    current.provider === 'paystack' &&
    current.current_period_end &&
    new Date(current.current_period_end) > new Date() &&
    current.plan_id !== planId
  ) {
    return json(
      {
        error: `Your current plan is paid until ${new Date(current.current_period_end).toLocaleDateString('en-NG', { dateStyle: 'long' })}. You can switch plans after that, or contact support to change it sooner.`,
      },
      409,
    )
  }

  // Gentle brake against someone hammering the button: a handful of unfinished checkouts is plenty.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .gte('created_at', since)
  if ((count ?? 0) >= 5)
    return json({ error: 'Several payments were just started. Please wait a few minutes before trying again.' }, 429)

  const reference = `zb_${crypto.randomUUID().replace(/-/g, '')}`
  const { error: insertError } = await admin.from('payments').insert({
    reference,
    organization_id: organizationId,
    plan_id: planId,
    price_version_id: price.id,
    billing_interval: interval,
    amount_kobo: amountKobo,
    currency: price.currency ?? 'NGN',
    initiated_by: user.id,
  })
  if (insertError) return json({ error: 'Could not start the payment. Please try again.' }, 500)

  try {
    const { authorizationUrl } = await initializeTransaction({
      email: user.email,
      amountKobo,
      currency: price.currency ?? 'NGN',
      reference,
      callbackUrl: `${siteUrl}/?payment=return`,
      metadata: { organization_id: organizationId, plan_id: planId, interval },
    })
    return json({ authorizationUrl, reference })
  } catch {
    await admin
      .from('payments')
      .update({ status: 'failed', failure_reason: 'initialize_failed', updated_at: new Date().toISOString() })
      .eq('reference', reference)
    return json({ error: 'The payment provider could not start the payment. Please try again.' }, 502)
  }
})
