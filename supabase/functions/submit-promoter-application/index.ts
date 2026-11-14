import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { verifyTurnstile } from '../_shared/turnstile.ts'

// The public promoter application form. The database function behind it is no longer callable by the browser:
// it can only be reached through here, after the CAPTCHA is solved, with the real client address.
serve(async (request) => {
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500)

  const raw = await request.text()
  if (raw.length > 20_000) return json({ error: 'Request is too large' }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : null)

  // Cloudflare sets this header itself; it cannot be forged by the caller (unlike X-Forwarded-For).
  const clientIp = (request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? 'unknown').trim().slice(0, 64)

  const captcha = await verifyTurnstile(text(body.captchaToken, 4096), clientIp)
  if (!captcha.ok) {
    if (captcha.reason === 'captcha_not_configured') console.error('submit-promoter-application: TURNSTILE_SECRET_KEY is not set')
    return json({ error: 'Please complete the human check and try again.', code: captcha.reason }, 400)
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await admin.rpc('submit_promoter_application', {
    applicant_name: text(body.name, 300),
    applicant_email: text(body.email, 300),
    applicant_phone: text(body.phone, 60),
    applicant_location: text(body.location, 300),
    applicant_social: text(body.social, 600),
    applicant_experience: text(body.experience, 3000),
    applicant_reason: text(body.reason, 3000),
    terms_agreed: body.agreed === true,
    client_ip_override: clientIp,
  })
  if (error) {
    const message = error.message ?? ''
    if (message.includes('RATE_LIMITED')) return json({ error: message.replace(/^.*RATE_LIMITED: /, '') }, 429)
    if (message.includes('DUPLICATE_APPLICATION')) return json({ error: 'An application from this email is already under review.' }, 409)
    if (message.includes('VALIDATION_ERROR')) return json({ error: message.replace(/^.*VALIDATION_ERROR: /, '') }, 400)
    console.error('submit-promoter-application failed:', message)
    return json({ error: 'Could not submit the application. Please try again.' }, 500)
  }
  return json({ ok: true })
})
