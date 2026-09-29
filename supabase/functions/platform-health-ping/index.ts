import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

// A dedicated, minimal health probe for the "Edge Functions" monitoring
// check. The previous check reused get-platform-records (a real, DB-backed
// endpoint), so its latency was Edge Function cold start/runtime PLUS a
// database round trip -- conflating two very different things and making it
// impossible to tell which one was slow. This function does the minimum
// possible amount of work: verify the caller's JWT and return immediately,
// so its latency reflects Edge Function invocation only.
serve(async (request) => {
  const startedAt = Date.now()
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const requestId = crypto.randomUUID()
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method !== 'GET') return json({ status: 'error', requestId, error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return json({ status: 'error', requestId, error: 'Server configuration is incomplete' }, 500)

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await caller.auth.getUser()
  if (authError || !user) return json({ status: 'error', requestId, error: 'Unauthorized' }, 401)

  return json({
    status: 'ok',
    requestId,
    serverTimestamp: new Date().toISOString(),
    // How long this function spent doing its own work, separate from
    // network transit time to/from the browser -- lets a slow browser-
    // measured result be attributed to network vs. the function itself.
    executionMs: Date.now() - startedAt,
  })
})
