// Called when the browser comes back from Paystack with ?reference=... It does NOT trust the browser: it asks
// Paystack what happened to that reference, lets the database settle it, and reports the result. The browser
// only displays what this returns.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'
import { recordLatency, startTimer } from '../_shared/latency.ts'
import { paystackSecret, settleReference } from '../_shared/paystack.ts'

serve(async (request) => {
  const timer = startTimer()
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) => {
    void recordLatency('paystack-verify', timer, status)
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
  if (!paystackSecret()) return json({ error: 'Online payments are not configured yet.' }, 503)

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const {
    data: { user },
  } = await caller.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)

  let body: { reference?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }
  const reference = String(body.reference ?? '').trim()
  if (!/^zb_[a-f0-9]{32}$/.test(reference)) return json({ error: 'Unknown payment reference.' }, 400)

  // The payment must belong to a business this person owns; otherwise treat it as unknown.
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: payment } = await admin
    .from('payments')
    .select('organization_id')
    .eq('reference', reference)
    .maybeSingle()
  if (!payment) return json({ error: 'Unknown payment reference.' }, 404)
  const { data: membership } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', payment.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (membership?.role !== 'owner') return json({ error: 'Unknown payment reference.' }, 404)

  try {
    const { outcome } = await settleReference(reference, 'return')
    // Safe diagnostics: reference, outcome and caller only. No keys, no card or customer details.
    console.log(
      JSON.stringify({
        evt: 'paystack-verify',
        reference,
        outcome,
        organizationId: payment.organization_id,
        userId: user.id,
      }),
    )
    return json({ outcome, organizationId: payment.organization_id })
  } catch (error) {
    console.error(
      JSON.stringify({
        evt: 'paystack-verify-failed',
        reference,
        organizationId: payment.organization_id,
        message: error instanceof Error ? error.message : 'unknown',
      }),
    )
    return json(
      {
        error:
          'We could not confirm the payment right now. If you were charged, your plan will update automatically within a few minutes.',
        code: 'settle_failed',
      },
      502,
    )
  }
})
