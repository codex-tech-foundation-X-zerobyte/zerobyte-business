// Pure helpers for get-api-traffic: build the log queries and turn their rows into the numbers the Traffic page shows.
// No Deno or network calls in here, so the same file is unit-tested from src/admin/apiTraffic.test.ts.

export const API_TRAFFIC_WINDOWS = [15, 60, 360, 1440] as const

export type LogRow = Record<string, unknown>

export type ServiceStats = {
  service: string
  requests: number
  errors_5xx: number
  errors_4xx: number
  avg_ms: number
  p95_ms: number
}

export type ApiTrafficSnapshot = {
  window_minutes: number
  bucket_minutes: number
  requests: number
  errors_5xx: number
  errors_4xx: number
  error_rate: number
  rps_now: number
  rps_avg: number
  rps_peak: number
  avg_ms: number
  p95_ms: number
  services: ServiceStats[]
  series: { minute: string; requests: number; errors: number }[]
}

/** Longer windows use wider buckets so a query never returns more than a few hundred rows. */
export function bucketMinutesFor(windowMinutes: number) {
  if (windowMinutes <= 180) return 1
  if (windowMinutes <= 720) return 5
  return 15
}

// Our own dashboard polling is not user traffic: leave it out so a quiet app does not look busy.
const OWN_PATHS = ["'/functions/v1/get-api-traffic'", "'/rest/v1/rpc/admin_get_traffic_snapshot'"].join(', ')

const SOURCE = `(
  select timestamp,
    log_attributes['request.path'] as path,
    toInt32OrZero(log_attributes['response.status_code']) as status,
    toFloat64OrZero(log_attributes['response.origin_time']) as origin_ms
  from logs
  where source = 'edge_logs'
    and log_attributes['request.path'] not in (${OWN_PATHS})
)`

const SERVICE = `multiIf(
  startsWith(path, '/rest/'), 'rest',
  startsWith(path, '/auth/'), 'auth',
  startsWith(path, '/storage/'), 'storage',
  startsWith(path, '/functions/'), 'functions',
  startsWith(path, '/realtime/'), 'realtime',
  'other')`

/** Requests and errors per time bucket (for the chart and the peak). */
export function seriesSql(bucketMinutes: number) {
  const bucket = Math.max(1, Math.floor(bucketMinutes))
  return `select toStartOfInterval(timestamp, INTERVAL ${bucket} MINUTE) as minute,
  count() as requests,
  countIf(status >= 500) as errors_5xx
from ${SOURCE}
group by minute
order by minute
limit 2000`
}

/** Per-service counts and response times. */
export function servicesSql() {
  return `select ${SERVICE} as service,
  count() as requests,
  countIf(status >= 500) as errors_5xx,
  countIf(status >= 400 and status < 500) as errors_4xx,
  avgIf(origin_ms, origin_ms > 0) as avg_ms,
  quantileIf(0.95)(origin_ms, origin_ms > 0) as p95_ms
from ${SOURCE}
group by service
order by requests desc
limit 20`
}

/** One overall response-time figure (a 95th percentile cannot be rebuilt from per-service ones). */
export function overallSql() {
  return `select count() as requests,
  avgIf(origin_ms, origin_ms > 0) as avg_ms,
  quantileIf(0.95)(origin_ms, origin_ms > 0) as p95_ms
from ${SOURCE}
limit 1`
}

const num = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const round = (value: number, digits = 0) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** ClickHouse answers "2026-11-17 09:30:00" (UTC, no zone). Make it an unambiguous ISO string. */
export function toIsoUtc(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '' : new Date(time).toISOString()
}

export function summarize(
  windowMinutes: number,
  seriesRows: LogRow[],
  serviceRows: LogRow[],
  overallRows: LogRow[],
  now = new Date(),
): ApiTrafficSnapshot {
  const bucket = bucketMinutesFor(windowMinutes)
  const bucketMs = bucket * 60_000
  const counts = new Map<string, { requests: number; errors: number }>()
  for (const row of seriesRows) {
    const minute = toIsoUtc(row.minute)
    if (!minute) continue
    const current = counts.get(minute) ?? { requests: 0, errors: 0 }
    current.requests += num(row.requests)
    current.errors += num(row.errors_5xx)
    counts.set(minute, current)
  }

  // Fill every bucket in the window (quiet minutes are zero, not missing) so the chart is continuous.
  const lastBucket = Math.floor(now.getTime() / bucketMs) * bucketMs
  const firstBucket = Math.floor((now.getTime() - windowMinutes * 60_000) / bucketMs) * bucketMs
  const series: ApiTrafficSnapshot['series'] = []
  for (let time = firstBucket; time <= lastBucket; time += bucketMs) {
    const minute = new Date(time).toISOString()
    const found = counts.get(minute)
    series.push({ minute, requests: found?.requests ?? 0, errors: found?.errors ?? 0 })
  }

  const services: ServiceStats[] = serviceRows.map((row) => ({
    service: String(row.service ?? 'other'),
    requests: num(row.requests),
    errors_5xx: num(row.errors_5xx),
    errors_4xx: num(row.errors_4xx),
    avg_ms: round(num(row.avg_ms)),
    p95_ms: round(num(row.p95_ms)),
  }))
  const requests = services.reduce((sum, item) => sum + item.requests, 0)
  const errors5xx = services.reduce((sum, item) => sum + item.errors_5xx, 0)
  const errors4xx = services.reduce((sum, item) => sum + item.errors_4xx, 0)

  // "Now" is the latest bucket that has finished; the bucket still filling would always look too small.
  const complete = series.filter((point) => Date.parse(point.minute) + bucketMs <= now.getTime())
  const latest = complete[complete.length - 1]
  const peak = series.reduce((max, point) => Math.max(max, point.requests), 0)
  const overall = overallRows[0] ?? {}

  return {
    window_minutes: windowMinutes,
    bucket_minutes: bucket,
    requests,
    errors_5xx: errors5xx,
    errors_4xx: errors4xx,
    error_rate: requests ? round((100 * errors5xx) / requests, 2) : 0,
    rps_now: latest ? round(latest.requests / (bucket * 60), 3) : 0,
    rps_avg: round(requests / (windowMinutes * 60), 3),
    rps_peak: round(peak / (bucket * 60), 3),
    avg_ms: round(num(overall.avg_ms)),
    p95_ms: round(num(overall.p95_ms)),
    services,
    series,
  }
}
