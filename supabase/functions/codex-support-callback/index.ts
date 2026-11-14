// Receives the signed messages the Codex Customer Service desk sends when its staff reply to a ticket or change its status.
// Give the Codex Main Admin this address (Support desk > Connected projects > Callbacks to the project), with
// the secret SUPPORT_CALLBACK_SECRET they generate:
//   https://<this-project-ref>.supabase.co/functions/v1/codex-support-callback
// Deploy with --no-verify-jwt: the signature is the authentication.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { verifyCallback } from '../_shared/codex.ts'

serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('SUPPORT_CALLBACK_SECRET') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !supabaseUrl || !serviceKey) return new Response('Not configured', { status: 503 })

  // The EXACT text received: it is verified before anything is parsed.
  const raw = await request.text()
  if (raw.length > 50_000) return new Response('Too large', { status: 413 })
  if (!(await verifyCallback(secret, request.headers.get('x-codex-signature'), raw))) return new Response('invalid signature', { status: 401 })

  let event: { event?: string; sequence?: number; external_ref?: string; message?: { body?: string }; status?: string }
  try {
    event = JSON.parse(raw)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  // The dedupe key comes from the SIGNED body. The x-codex-event-id header is not covered by the signature, so a captured
  // request could otherwise be replayed with a fresh header value and applied twice.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const eventId = 'body:' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await admin.rpc('apply_codex_support_event', {
    p_event_id: eventId,
    p_event: String(event.event ?? ''),
    p_sequence: Number.isInteger(event.sequence) ? event.sequence : null,
    p_external_ref: String(event.external_ref ?? ''),
    p_body: typeof event.message?.body === 'string' ? event.message.body : null,
    p_status: typeof event.status === 'string' ? event.status : null,
  })
  // A 5xx makes Codex retry later (1 min, 5 min, 30 min...). Everything else, even an event we ignore, is a plain 204.
  if (error) return new Response('Could not apply', { status: 500 })
  return new Response(null, { status: 204 })
})
