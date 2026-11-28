// Lightweight client-side error reporting.
//
// Production builds print nothing to the browser console (visitors should not see stack traces or technical wording).
// Every error is instead sent to the platform's own error log, which the admin Health center reads, and to the optional
// VITE_ERROR_REPORT_ENDPOINT (any HTTPS URL that accepts a JSON POST). Development builds still log to the console.

import { monitorError } from './codexMonitor'
import { safeMessage } from './safeErrors'
import { supabase } from './supabase'

const endpoint = (import.meta.env.VITE_ERROR_REPORT_ENDPOINT as string | undefined)?.trim()
const recent = new Map<string, number>()

type ErrorContext = Record<string, string | number | boolean | null | undefined>
type Kind = 'js' | 'promise' | 'render' | 'sync' | 'network'

// Personal details never leave the browser: emails, long numbers, ids and addresses are removed from the message.
export function scrubMessage(value: string) {
  return safeMessage(value, undefined)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/\b\d{5,}\b/g, '[number]')
    .slice(0, 300)
}

function kindOf(source: unknown): Kind {
  if (source === 'unhandledrejection') return 'promise'
  if (source === 'ErrorBoundary') return 'render'
  if (source === 'sync') return 'sync'
  return 'js'
}

function fingerprint(kind: Kind, message: string, route: string) {
  let hash = 5381
  for (const char of `${kind}|${message.slice(0, 120)}|${route}`) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0
  return `e${(hash >>> 0).toString(36)}`
}

const sentPerFingerprint = new Map<string, number>()
let sentThisVisit = 0

/** Sends one scrubbed error to the platform's error log (shown in the admin Health center). Never throws. */
function sendToHealthCenter(err: Error, context: ErrorContext) {
  try {
    if (!import.meta.env.PROD || !supabase || sentThisVisit >= 20) return
    const kind = kindOf(context.source)
    const message = scrubMessage(err.message || err.name)
    const route = window.location.pathname.slice(0, 120)
    const fp = fingerprint(kind, message, route)
    const times = sentPerFingerprint.get(fp) ?? 0
    if (times >= 3) return
    sentPerFingerprint.set(fp, times + 1)
    sentThisVisit += 1
    void Promise.resolve(
      supabase.rpc('record_client_error', {
        p_kind: kind,
        p_message: message,
        p_route: route,
        p_version: __APP_VERSION__,
        p_device: window.matchMedia?.('(max-width: 819px)').matches ? 'mobile' : 'desktop',
        p_fingerprint: fp,
      }),
    ).catch(() => undefined)
  } catch {
    // Reporting must never throw.
  }
}

function cut(value: unknown, max: number) {
  return String(value ?? '').slice(0, max)
}

export function reportClientError(error: unknown, context: ErrorContext = {}) {
  const err = error instanceof Error ? error : new Error(cut(error, 300) || 'Unknown error')
  if (import.meta.env.DEV) console.error('[zerobyte]', err, context)

  // De-duplicate identical errors for 30 seconds so a render loop cannot flood the endpoint.
  const key = `${err.name}:${err.message}`
  const now = Date.now()
  if (now - (recent.get(key) ?? 0) < 30_000) return
  recent.set(key, now)
  if (recent.size > 50) recent.clear()

  sendToHealthCenter(err, context)
  monitorError(err, context.source === 'ErrorBoundary')
  if (!endpoint) return

  const body = JSON.stringify({
    name: cut(err.name, 80),
    message: scrubMessage(err.message),
    stack: cut(err.stack, 4000),
    url: cut(window.location.pathname, 200), // path only: never ship query strings or tokens
    userAgent: cut(navigator.userAgent, 200),
    online: navigator.onLine,
    at: new Date().toISOString(),
    context,
  })
  try {
    if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain' }))) {
      void fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(
        () => undefined,
      )
    }
  } catch {
    // Reporting must never throw.
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    // Ignore benign browser noise that is not an application fault.
    if (/ResizeObserver loop/i.test(event.message)) return
    reportClientError(event.error ?? event.message, { source: 'window.onerror' })
    // Already reported above; keep the browser from also printing it to the console in production.
    if (import.meta.env.PROD) event.preventDefault()
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, { source: 'unhandledrejection' })
    if (import.meta.env.PROD) event.preventDefault()
  })
  // After a new deployment, an open tab may request a JS chunk whose hashed
  // filename no longer exists. Reload once to pick up the new build.
  window.addEventListener('vite:preloadError', () => {
    if (window.sessionStorage.getItem('zb-chunk-reload')) return
    window.sessionStorage.setItem('zb-chunk-reload', '1')
    window.location.reload()
  })
}
