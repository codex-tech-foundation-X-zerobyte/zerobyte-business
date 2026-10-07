import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

export async function recordLatency(functionName: string, startedAt: number, statusCode: number) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return // not configured in this environment; fail silently, never break the real response
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const durationMs = Math.round(performance.now() - startedAt)
    await admin.from('backend_request_latency').insert({ function_name: functionName, duration_ms: durationMs, status_code: statusCode })
  } catch {
    // Logging latency must never be the reason a real request fails.
  }
}
