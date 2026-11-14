// Calls to the Codex Workspace (Super Monitor and Customer Service), using the Workspace's own client files.
// Keys come from function secrets and are never logged or returned to a browser.
//
//   supabase secrets set CODEX_FUNCTIONS_URL="https://<workspace-ref>.supabase.co/functions/v1"
//   supabase secrets set MONITOR_KEY="ctfm_..."                 (Super Monitor: codex-heartbeat)
//   supabase secrets set SUPPORT_KEY="ctfs_..."                 (Customer Service: codex-support-ticket)
//   supabase secrets set SUPPORT_CALLBACK_SECRET="<64 hex>"     (Customer Service: codex-support-callback)
// @deno-types="./support-client.d.mts"
import { createSupportClient, SupportError, verifyCallback } from './support-client.mjs'

export { verifyCallback, SupportError }

const base = () => (Deno.env.get('CODEX_FUNCTIONS_URL') ?? '').trim().replace(/\/$/, '')

/** The Customer Service client, or null when it is not configured (missing or malformed URL or key). */
export function supportClient() {
  try {
    return createSupportClient({ baseUrl: base(), key: Deno.env.get('SUPPORT_KEY') ?? '' })
  } catch {
    return null
  }
}

/** A sentence a customer can act on, and the HTTP status to answer with. Never contains the key. */
export function describeSupportError(error: unknown): { message: string; status: number } {
  if (error instanceof SupportError) {
    if (error.status === 422)
      return { message: 'The conversation contains a card number, secret key or password. Remove it and try again.', status: 422 }
    if (error.status === 404) return { message: 'Technical support has no ticket for this chat yet.', status: 404 }
    if (error.status === 409) return { message: error.message, status: 409 }
    if (error.status === 429) return { message: 'Too many requests. Wait a minute and try again.', status: 429 }
  }
  return { message: 'Technical support could not be reached. Try again soon.', status: 502 }
}

/** "I am alive" signal for the Super Monitor (server side). A new event_id every time, so nothing is treated as a repeat. */
export async function sendHeartbeat(): Promise<{ ok: boolean; status: number }> {
  const root = base()
  const key = Deno.env.get('MONITOR_KEY') ?? ''
  if (!root || !key) return { ok: false, status: 503 }
  try {
    const response = await fetch(`${root}/monitor-ingest`, {
      method: 'POST',
      headers: { 'x-monitor-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ event_id: `hb-${crypto.randomUUID()}`, kind: 'heartbeat' }] }),
      signal: AbortSignal.timeout(8000),
    })
    return { ok: response.ok, status: response.status }
  } catch {
    return { ok: false, status: 502 }
  }
}
