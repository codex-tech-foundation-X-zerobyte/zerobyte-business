import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// Records how long THIS function took to handle THIS request, from every
// real caller -- not a probe fired from one admin's browser. Call
// startTimer() first thing in the handler, then await recordLatency(...)
// right before returning the response (or in a try/finally so it still
// fires on error paths).
//
// Uses the service-role key so the write bypasses RLS entirely -- the
// browser has no way to insert a fake sample, and a caller who isn't an
// admin still contributes a real, honest latency data point.
export function startTimer() {
  return performance.now()
}

// One client per warm instance instead of one per request.
let cachedClient: ReturnType<typeof createClient> | null = null

function latencyClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return null // not configured in this environment; fail silently, never break the real response
  cachedClient ??= createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedClient
}

export function recordLatency(functionName: string, startedAt: number, statusCode: number): Promise<void> {
  // Rejected and malformed requests are not real usage and anyone can send them: never turn them into database writes.
  if ([400, 401, 403, 404, 405, 429].includes(statusCode)) return Promise.resolve()
  const durationMs = Math.round(performance.now() - startedAt) // measured now, before the write itself
  const write = (async () => {
    try {
      const admin = latencyClient()
      if (!admin) return
      await admin
        .from('backend_request_latency')
        .insert({ function_name: functionName, duration_ms: durationMs, status_code: statusCode })
    } catch {
      // Logging latency must never be the reason a real request fails.
    }
  })()
  // Without waitUntil the platform may stop the instance as soon as the response is sent, and the sample is lost
  // (the dashboard then under-counts). With it the write finishes in the background and the caller is not held up.
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
  if (runtime?.waitUntil) {
    runtime.waitUntil(write)
    return Promise.resolve()
  }
  return write
}
