/**
 * Super Monitor client (INTERNAL: for the company's own projects; not the external "Codex Monitor" product).
 * No dependencies. Works in browsers and in Node 18+ (anything with fetch). ESM.
 *
 *   import { createMonitor } from './index.mjs'
 *   const monitor = createMonitor({ endpoint: 'https://<project-ref>.supabase.co/functions/v1/monitor-ingest', key: 'ctfm_…', environment: 'production', release: '1.4.0' })
 *   monitor.start()                                   // heartbeats + global error handlers
 *   monitor.captureError(err, { route: '/checkout' })  // or let the global handlers do it
 *   monitor.latency('/api/users', 120, 200)            // route, milliseconds, status code
 *
 * Safe by design: events carry an id, so a retry is never counted twice; the key is only ever sent as a header, never in the body or a log;
 * the secrets that slip into messages are redacted server-side; a revoked key stops all sending; the queue is bounded.
 */
export const SDK_NAME = 'ctf-super-monitor'
export const SDK_VERSION = '0.1.0'

const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`)

/** Two 32-bit FNV-1a hashes side by side: 16 hex characters, stable for "the same error" (digits in the message are ignored). */
export function fingerprintOf(name, message, topFrame = '') {
  const text = `${name}|${String(message).toLowerCase().replace(/\d+/g, '#')}|${String(topFrame).replace(/:\d+(:\d+)?/g, '')}`
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0; b = Math.imul(b ^ text.charCodeAt(i), 0x811c9dc5) >>> 0 }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

export function createMonitor({ endpoint, key, environment = 'production', release, heartbeatSeconds = 300, flushIntervalMs = 5000, maxBatch = 20, maxQueue = 200, fetch: fetchImpl, onAuthFailure, onDrop } = {}) {
  if (!endpoint || !/^ctfm_[0-9a-f]{48}$/.test(key ?? '')) throw new Error('createMonitor needs an endpoint and a ctfm_… key.')
  const doFetch = fetchImpl ?? globalThis.fetch
  const batchSize = Math.max(1, Math.min(50, maxBatch))
  let queue = []
  let stopped = false
  let flushTimer = null
  let beatTimer = null
  let removeHandlers = () => {}
  let backoffUntil = 0
  let failures = 0

  const base = () => ({ event_id: uuid(), environment, ...(release ? { release } : {}), sdk_name: SDK_NAME, sdk_version: SDK_VERSION, occurred_at: new Date().toISOString() })
  const push = (event) => {
    if (stopped) return
    queue.push({ ...base(), ...event })
    if (queue.length > maxQueue) { const dropped = queue.length - maxQueue; queue = queue.slice(dropped); onDrop?.(dropped) }   // bounded: oldest go first
    if (queue.length >= batchSize) void flush()
  }

  async function flush() {
    if (stopped || queue.length === 0 || Date.now() < backoffUntil) return { sent: 0 }
    const batch = queue.slice(0, batchSize)
    let res
    try {
      res = await doFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-monitor-key': key }, body: JSON.stringify({ events: batch }) })
    } catch {
      failures++; backoffUntil = Date.now() + Math.min(60000, 1000 * 2 ** failures)   // network down: keep the events, try later, same ids
      return { sent: 0, retry: true }
    }
    if (res.status === 401) { stopped = true; queue = []; onAuthFailure?.(); return { sent: 0, revoked: true } }   // the key is gone: stop for good
    if (res.status === 429 || res.status >= 500) {
      failures++
      const wait = Number(res.headers?.get?.('retry-after')) * 1000
      backoffUntil = Date.now() + (wait > 0 ? Math.min(wait, 300000) : Math.min(60000, 1000 * 2 ** failures))
      return { sent: 0, retry: true }
    }
    queue = queue.slice(batch.length)   // accepted, or refused as bad data (400): either way these events are done
    failures = 0
    return { sent: batch.length, ok: res.status < 400 }
  }

  return {
    captureError(error, context = {}) {
      const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown')
      const frame = (e.stack ?? '').split('\n')[1] ?? ''
      push({ kind: 'error', level: context.fatal ? 'fatal' : 'error', message: `${e.name}: ${e.message}`, stack: e.stack, fingerprint: fingerprintOf(e.name, e.message, frame), ...(context.route ? { route: context.route } : {}) })
    },
    message(text, level = 'info', context = {}) { push({ kind: 'message', level, message: String(text), ...(context.route ? { route: context.route } : {}) }) },
    latency(route, ms, statusCode) { push({ kind: 'latency', route, latency_ms: Math.round(ms), ...(statusCode ? { status_code: statusCode } : {}) }) },
    heartbeat() { push({ kind: 'heartbeat' }) },
    flush,
    pending: () => queue.length,
    /**
     * Start heartbeats and (given a window-like target) global error handlers.
     * `heartbeat: false` is for BROWSER apps: nobody may be visiting, and a silent site must not look "down". Server processes keep it on.
     */
    start({ target = globalThis.window, heartbeat = true } = {}) {
      if (heartbeat) { this.heartbeat(); beatTimer = setInterval(() => this.heartbeat(), heartbeatSeconds * 1000) }
      flushTimer = setInterval(() => void flush(), flushIntervalMs)
      for (const t of [beatTimer, flushTimer]) t?.unref?.()
      if (target?.addEventListener) {
        const onError = (ev) => this.captureError(ev.error ?? ev.message ?? 'Script error', { fatal: false })
        const onRejection = (ev) => this.captureError(ev.reason ?? 'Unhandled rejection')
        target.addEventListener('error', onError); target.addEventListener('unhandledrejection', onRejection)
        removeHandlers = () => { target.removeEventListener('error', onError); target.removeEventListener('unhandledrejection', onRejection) }
      }
    },
    stop() { stopped = true; clearInterval(beatTimer); clearInterval(flushTimer); removeHandlers(); queue = [] },
  }
}
