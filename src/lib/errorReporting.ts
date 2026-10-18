// Lightweight client-side error reporting.
//
// Set VITE_ERROR_REPORT_ENDPOINT to any HTTPS URL that accepts a JSON POST
// (a Sentry "envelope relay", a logging webhook, a Supabase edge function...).
// With no endpoint configured, errors are still logged to the console so
// they are visible in browser dev tools and remote-debugging sessions.

const endpoint = (import.meta.env.VITE_ERROR_REPORT_ENDPOINT as string | undefined)?.trim()
const recent = new Map<string, number>()

type ErrorContext = Record<string, string | number | boolean | null | undefined>

function cut(value: unknown, max: number) {
  return String(value ?? '').slice(0, max)
}

export function reportClientError(error: unknown, context: ErrorContext = {}) {
  const err = error instanceof Error ? error : new Error(cut(error, 300) || 'Unknown error')
  console.error('[zerobyte]', err, context)
  if (!endpoint) return

  // De-duplicate identical errors for 30 seconds so a render loop cannot flood the endpoint.
  const key = `${err.name}:${err.message}`
  const now = Date.now()
  if (now - (recent.get(key) ?? 0) < 30_000) return
  recent.set(key, now)
  if (recent.size > 50) recent.clear()

  const body = JSON.stringify({
    name: cut(err.name, 80),
    message: cut(err.message, 500),
    stack: cut(err.stack, 4000),
    url: cut(window.location.pathname, 200), // path only: never ship query strings or tokens
    userAgent: cut(navigator.userAgent, 200),
    online: navigator.onLine,
    at: new Date().toISOString(),
    context,
  })
  try {
    if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain' }))) {
      void fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined)
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
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, { source: 'unhandledrejection' })
  })
  // After a new deployment, an open tab may request a JS chunk whose hashed
  // filename no longer exists. Reload once to pick up the new build.
  window.addEventListener('vite:preloadError', () => {
    if (window.sessionStorage.getItem('zb-chunk-reload')) return
    window.sessionStorage.setItem('zb-chunk-reload', '1')
    window.location.reload()
  })
}
