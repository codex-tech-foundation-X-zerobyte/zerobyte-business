import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { recordLatency, startTimer } from '../_shared/latency.ts'
import {
  API_TRAFFIC_WINDOWS,
  overallSql,
  seriesSql,
  servicesSql,
  summarize,
  bucketMinutesFor,
  type ApiTrafficSnapshot,
  type LogRow,
} from '../_shared/apiTraffic.ts'

// Every request that reached this Supabase project through its API gateway (data API, Auth, Storage, Edge Functions,
// Realtime), counted by Supabase itself, not by the browser and not only by our own functions.
//
// It asks the Supabase Management API for the project's gateway logs, so it needs one secret:
//   supabase secrets set LOGS_ACCESS_TOKEN=sbp_...      (a personal access token from supabase.com/dashboard/account/tokens;
//                                                         secret names cannot start with SUPABASE_)
// The token stays on the server. Without it this function answers { configured: false } and the page explains the step.
//
// Supabase limits log queries to 30 per minute, so each window is answered from a 30-second in-memory copy and, if
// Supabase refuses or is slow, the last good copy is served marked stale.
const CACHE_MS = 30_000
const cache = new Map<number, { at: number; body: ApiTrafficSnapshot }>()
const inflight = new Map<number, Promise<ApiTrafficSnapshot>>()

class UpstreamError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function queryLogs(ref: string, token: string, sql: string, startIso: string, endIso: string): Promise<LogRow[]> {
  const params = new URLSearchParams({ sql, iso_timestamp_start: startIso, iso_timestamp_end: endIso })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let response: Response
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch {
    throw new UpstreamError('unreachable', 'Supabase did not answer in time.')
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 401 || response.status === 403)
    throw new UpstreamError(
      'token_rejected',
      'Supabase refused the access token. Create a new one that can read project logs.',
    )
  if (response.status === 402) throw new UpstreamError('plan', 'Log queries are not available on this Supabase plan.')
  if (response.status === 429)
    throw new UpstreamError('rate_limited', 'Supabase is limiting log queries; try again in a minute.')
  if (!response.ok) throw new UpstreamError('upstream', `Supabase answered ${response.status} to the log query.`)
  const body = (await response.json().catch(() => null)) as { result?: LogRow[]; error?: unknown } | null
  if (!body) throw new UpstreamError('upstream', 'Supabase sent an unreadable answer.')
  if (body.error) throw new UpstreamError('query', 'Supabase could not run the log query.')
  return Array.isArray(body.result) ? body.result : []
}

async function load(ref: string, token: string, windowMinutes: number): Promise<ApiTrafficSnapshot> {
  const end = new Date()
  const start = new Date(end.getTime() - windowMinutes * 60_000)
  const [series, services, overall] = await Promise.all([
    queryLogs(ref, token, seriesSql(bucketMinutesFor(windowMinutes)), start.toISOString(), end.toISOString()),
    queryLogs(ref, token, servicesSql(), start.toISOString(), end.toISOString()),
    queryLogs(ref, token, overallSql(), start.toISOString(), end.toISOString()),
  ])
  return summarize(windowMinutes, series, services, overall, end)
}

serve(async (request) => {
  const latencyTimer = startTimer()
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' })
  const json = (body: unknown, status = 200) => {
    void recordLatency('get-api-traffic', latencyTimer, status)
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return new Response('Missing authorization', { status: 401, headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500)

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  // Same people who may see the Live traffic card (Overview, Analytics) plus Monitoring, where the full card lives.
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const [{ data: access }, { data: sections }] = await Promise.all([
    admin
      .from('platform_admin_access')
      .select('role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    caller.rpc('get_my_admin_sections'),
  ])
  if (!access) return new Response('Platform administrator access required', { status: 403, headers: corsHeaders })
  const allowed =
    Array.isArray(sections) && ['Overview', 'Analytics', 'Monitoring'].some((name) => sections.includes(name))
  if (!allowed) return new Response('Your admin role does not include traffic', { status: 403, headers: corsHeaders })

  const token = (Deno.env.get('LOGS_ACCESS_TOKEN') ?? '').trim()
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  if (!token || !ref) return json({ configured: false })

  const requested = Number(new URL(request.url).searchParams.get('window') ?? '60')
  const windowMinutes = (API_TRAFFIC_WINDOWS as readonly number[]).includes(requested) ? requested : 60

  const fresh = cache.get(windowMinutes)
  if (fresh && Date.now() - fresh.at < CACHE_MS) return json({ configured: true, stale: false, snapshot: fresh.body })

  try {
    let pending = inflight.get(windowMinutes)
    if (!pending) {
      pending = load(ref, token, windowMinutes).finally(() => inflight.delete(windowMinutes))
      inflight.set(windowMinutes, pending)
    }
    const snapshot = await pending
    cache.set(windowMinutes, { at: Date.now(), body: snapshot })
    return json({ configured: true, stale: false, snapshot })
  } catch (reason) {
    const failure =
      reason instanceof UpstreamError ? reason : new UpstreamError('upstream', 'Could not read the API logs.')
    // A recent good copy is better than an empty card while Supabase is busy.
    if (fresh) return json({ configured: true, stale: true, snapshot: fresh.body, warning: failure.message })
    return json(
      { configured: true, error: failure.code, message: failure.message },
      failure.code === 'rate_limited' ? 429 : 502,
    )
  }
})
