/**
 * Customer Service client for a connected project's BACKEND. No dependencies; Node 18+ (or Deno, Bun, Cloudflare Workers). ESM.
 * Copy this one file into the project. There is nothing to `npm install`.
 *
 *   import { createSupportClient, verifyCallback } from './support-client/index.mjs'
 *   const support = createSupportClient({ baseUrl: process.env.CODEX_FUNCTIONS_URL, key: process.env.SUPPORT_KEY })
 *   const { ticket, duplicate } = await support.createTicket({ external_ref: 'ORD-77', subject: 'Cannot log in', description: '…', customer_ref: 'user_9', customer_name: 'Ada', category: 'account', priority: 'high' })
 *   const view = await support.getTicket('ORD-77')       // what the customer may see
 *   await support.reply('ORD-77', 'Still failing.')      // a customer reply
 *   await support.rate('ORD-77', 5, 'Quick!')            // once, when resolved
 *
 * SERVER ONLY. The key lets whoever holds it open tickets and read those tickets' customer-visible content; putting it in a browser bundle
 * publishes it, so this refuses to start in a browser. Never log the key; errors thrown here never contain it.
 */
const KEY = /^ctfs_[0-9a-f]{48}$/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class SupportError extends Error {
  constructor(status, message, extra = {}) { super(message); this.name = 'SupportError'; this.status = status; Object.assign(this, extra) }
}

const isLocal = (u) => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')

export function createSupportClient({ baseUrl, key, fetch: fetchImpl, timeoutMs = 10000, retries = 2, wait = sleep } = {}) {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') throw new Error('The support key must stay on your server. Do not use this client in a browser.')
  if (!KEY.test(key ?? '')) throw new Error('createSupportClient needs a ctfs_… key (Workspace → Support desk → Connected projects). A ctfm_… monitor key does not work here.')
  let base
  try { base = new URL(String(baseUrl).replace(/\/+$/, '')) } catch { throw new Error('createSupportClient needs baseUrl, e.g. https://<project-ref>.supabase.co/functions/v1') }
  if (base.protocol !== 'https:' && !isLocal(base)) throw new Error('baseUrl must be https (http is allowed only for localhost).')
  const doFetch = fetchImpl ?? globalThis.fetch

  /** One POST. `idempotent` calls are retried on network failures and 5xx; the others never are (a retried reply would be sent twice). */
  async function post(fn, body, idempotent) {
    const attempts = idempotent ? retries + 1 : 1
    let last
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await wait(500 * 2 ** (i - 1))
      let res
      try {
        res = await doFetch(`${base.toString().replace(/\/+$/, '')}/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-support-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
      } catch {
        last = new SupportError(0, 'Could not reach the support service.'); continue
      }
      let data = null
      try { data = await res.json() } catch { /* an error page, not JSON */ }
      if (res.status >= 200 && res.status < 300) return { status: res.status, data }
      const retryAfter = Number(res.headers?.get?.('retry-after')) || null
      last = new SupportError(res.status, typeof data?.error === 'string' ? data.error : `The support service answered ${res.status}.`, retryAfter ? { retryAfterSeconds: retryAfter } : {})
      if (res.status < 500) throw last            // a refusal will not change by asking again
    }
    throw last
  }

  const ref = (v) => { if (typeof v !== 'string' || !v.trim()) throw new Error('external_ref is required.'); return v.trim() }
  return {
    /** Safe to retry: the same external_ref never makes a second ticket (`duplicate: true` tells you it already existed). */
    async createTicket(report) {
      const { status, data } = await post('support-intake', { ...report, external_ref: ref(report?.external_ref) }, true)
      return { ticket: data?.ticket ?? null, duplicate: Boolean(data?.duplicate) || status === 200 }
    },
    async getTicket(externalRef) { return (await post('support-ticket', { action: 'status', external_ref: ref(externalRef) }, true)).data },
    async reply(externalRef, body) { await post('support-ticket', { action: 'reply', external_ref: ref(externalRef), body }, false); return { ok: true } },
    async rate(externalRef, rating, note) { await post('support-ticket', { action: 'rating', external_ref: ref(externalRef), rating, ...(note ? { note } : {}) }, false); return { ok: true } },
    /** A link to a file Customer Service shared with the customer. It works for 60 seconds: use it at once. */
    async attachmentLink(externalRef, attachmentId) { return (await post('support-ticket', { action: 'attachment', external_ref: ref(externalRef), attachment_id: attachmentId }, true)).data },
  }
}

const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function hmacHex(secret, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(message)))
}
function same(a, b) { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0 }

/**
 * Checks a callback really came from the workspace. `rawBody` must be the EXACT text received (not re-serialised JSON);
 * `header` is the x-codex-signature header. Rejects a bad signature or a timestamp more than five minutes old.
 *
 *   if (!(await verifyCallback(process.env.SUPPORT_CALLBACK_SECRET, req.headers['x-codex-signature'], rawBody))) return res.status(401).end()
 */
export async function verifyCallback(secret, header, rawBody, { nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = {}) {
  if (typeof rawBody !== 'string') return false
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? '')
  if (!m || Math.abs(nowSeconds - Number(m[1])) > toleranceSeconds) return false
  return same(m[2], await hmacHex(secret, `${m[1]}.${rawBody}`))
}
