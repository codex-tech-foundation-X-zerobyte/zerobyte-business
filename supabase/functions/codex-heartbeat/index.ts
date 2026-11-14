// Tells the Codex Super Monitor that Zerøbyte is alive. Call it every 5 minutes from a Supabase schedule
// (pg_cron + pg_net, or the dashboard's cron), sending the header x-heartbeat-secret. "Expected heartbeat" in the
// Super Monitor registration must be 300 seconds (or change the schedule to match it).
//   supabase secrets set CODEX_HEARTBEAT_SECRET="<long random text>"
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { sendHeartbeat } from '../_shared/codex.ts'

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

serve(async (request) => {
  const secret = Deno.env.get('CODEX_HEARTBEAT_SECRET') ?? ''
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!secret || !same(request.headers.get('x-heartbeat-secret') ?? '', secret))
    return new Response('Unauthorized', { status: 401 })
  const result = await sendHeartbeat()
  return new Response(JSON.stringify({ ok: result.ok, status: result.status }), {
    status: result.ok ? 200 : 502,
    headers: { 'content-type': 'application/json' },
  })
})
