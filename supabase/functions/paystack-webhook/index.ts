// Paystack calls this itself (server to server) when a payment succeeds, so a plan still activates if the
// customer closes the tab before coming back. Deploy with --no-verify-jwt: Paystack has no Supabase login.
// Authenticity comes from the x-paystack-signature header: an HMAC-SHA512 of the raw body made with your secret key.
//
// Even with a valid signature we do not act on the webhook's own numbers -- we re-ask Paystack about the
// reference (settleReference) and the database compares the amount against what the server expected.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { hmacSha512Hex, paystackSecret, settleReference, timingSafeEqual } from '../_shared/paystack.ts'

serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = paystackSecret()
  if (!secret) return new Response('Not configured', { status: 503 })

  const rawBody = await request.text()
  const signature = request.headers.get('x-paystack-signature') ?? ''
  const expected = await hmacSha512Hex(secret, rawBody)
  if (!signature || !timingSafeEqual(signature.toLowerCase(), expected)) { console.warn(JSON.stringify({ evt: 'paystack-webhook-bad-signature', hasSignature: Boolean(signature) })); return new Response('Invalid signature', { status: 401 }) }

  let event: { event?: string; data?: { reference?: string } }
  try { event = JSON.parse(rawBody) } catch { return new Response('Bad request', { status: 400 }) }

  // Only payment outcomes matter here; acknowledge everything else so Paystack stops retrying it.
  if (event.event !== 'charge.success') return new Response('ok', { status: 200 })
  const reference = String(event.data?.reference ?? '')
  if (!/^zb_[a-f0-9]{32}$/.test(reference)) return new Response('ok', { status: 200 }) // not one of ours

  try {
    const { outcome } = await settleReference(reference, 'webhook')
    console.log(JSON.stringify({ evt: 'paystack-webhook', reference, outcome }))
    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error(JSON.stringify({ evt: 'paystack-webhook-failed', reference, message: error instanceof Error ? error.message : 'unknown' }))
    // A non-2xx makes Paystack retry later, which is what we want if our side had a temporary problem.
    return new Response('Could not process', { status: 500 })
  }
})
