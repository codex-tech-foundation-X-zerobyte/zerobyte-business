import { createMonitor, type Monitor } from './superMonitor/index.mjs'

// Reports this app's errors to the Codex Workspace "Super Monitor". It is the browser pattern from the connection contract:
//   - the monitor key (ctfm_...) can only WRITE telemetry within a quota and can be revoked, so it is safe in the browser;
//   - heartbeats are OFF here (nobody may be visiting, and a quiet site must not look "down"); the server side heartbeat
//     comes from the Edge Function `codex-heartbeat`;
//   - only the page path is sent as the route, never a query string, and the app's own error text goes through the
//     Workspace's redaction. Never put a ctfs_ support key in any VITE_ variable.
// Set VITE_CODEX_FUNCTIONS_URL (https://<workspace-ref>.supabase.co/functions/v1) and VITE_MONITOR_KEY at build time.
const base = (import.meta.env.VITE_CODEX_FUNCTIONS_URL as string | undefined)?.trim().replace(/\/+$/, '')
const key = (import.meta.env.VITE_MONITOR_KEY as string | undefined)?.trim()

let monitor: Monitor | null = null

export function startCodexMonitor() {
  if (monitor || !import.meta.env.PROD || !base || !key) return
  if (!/^https:\/\//.test(base) || !/^ctfm_[0-9a-f]{48}$/.test(key)) {
    console.warn(
      '[zerobyte] Codex monitor not started: check VITE_CODEX_FUNCTIONS_URL (https) and VITE_MONITOR_KEY (ctfm_ + 48 characters).',
    )
    return
  }
  monitor = createMonitor({
    endpoint: `${base}/monitor-ingest`,
    key,
    environment: 'production',
    release: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '7.0.0',
    // A revoked or expired key stops all sending by itself; nothing else to do.
    onAuthFailure: () =>
      console.warn('[zerobyte] Codex monitor key was refused (revoked or expired). Reporting stopped.'),
  })
  monitor.start({ target: null, heartbeat: false })
}

/** Sends one error to the monitor (does nothing when it is not configured). Never throws. */
export function monitorError(error: Error, fatal = false) {
  try {
    monitor?.captureError(error, { route: window.location.pathname.slice(0, 200), fatal })
  } catch {
    // Monitoring must never break the app.
  }
}

/** For the admin Settings page: is error reporting to the Codex Super Monitor running? */
export function codexMonitorStatus(): 'on' | 'off' | 'development' {
  if (!import.meta.env.PROD) return 'development'
  return monitor ? 'on' : 'off'
}
