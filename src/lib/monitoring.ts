// Pure health-evaluation logic for the admin System Monitoring page, kept
// separate from AdminConsole.tsx so it can be unit tested without rendering
// a component. Nothing here talks to Supabase, the DOM, or the network.

export type MonitorStatus = 'healthy' | 'degraded' | 'slow' | 'critical' | 'unhealthy' | 'failed' | 'unavailable' | 'configuration'

export type MonitorMetric = {
  name: string
  source: string
  latency: number | null
  status: MonitorStatus
  detail: string
  checkType: string
  checkedAt: string
  failure?: string
  httpStatus?: number | null
  environment?: string
}

// Central health-status evaluator: a successful response is not
// automatically "Healthy" just because it returned 2xx -- how long it took
// matters too. A genuine error (definiteError=true, e.g. 4xx/5xx) is graded
// purely on that error; everything else is graded on latency.
//
// Thresholds: <=500ms Healthy, <=1000ms Degraded, <=2000ms Slow, >2000ms
// Critical. A null latency (e.g. a local-only check) defaults to Healthy
// since there was nothing to time.
export function evaluateHealth(latencyMs: number | null, options: { definiteError?: boolean } = {}): { status: MonitorStatus; message: string } {
  if (options.definiteError) return { status: 'unhealthy', message: 'The request completed but returned an error response.' }
  if (latencyMs == null) return { status: 'healthy', message: 'The request succeeded.' }
  if (latencyMs <= 500) return { status: 'healthy', message: 'The request succeeded within the expected response time.' }
  if (latencyMs <= 1000) return { status: 'degraded', message: 'The request succeeded, but the response was slower than the recommended target.' }
  if (latencyMs <= 2000) return { status: 'slow', message: 'The request succeeded, but the response time is well above target and worth investigating.' }
  return { status: 'critical', message: 'The request succeeded, but the response time indicates a serious performance problem.' }
}

const STATUS_LABELS: Record<MonitorStatus, string> = {
  healthy: 'Healthy', degraded: 'Degraded', slow: 'Slow', critical: 'Critical performance',
  unhealthy: 'Unhealthy', failed: 'Request failed', unavailable: 'Unavailable', configuration: 'Not configured',
}

export function statusLabel(status: MonitorStatus): string {
  return STATUS_LABELS[status]
}

// Possible (not asserted) causes shown for a service currently running
// slow/degraded/critical/unhealthy, worded as hints rather than diagnoses
// since the browser has no visibility into what's actually happening
// server-side.
export const slowServiceHints: Record<string, string[]> = {
  'API': ['Cold start after a period of inactivity', 'Network distance to the Supabase region', 'Row Level Security evaluation cost on the queried table'],
  'Database': ['Slow RPC or missing index', 'Large response payload', 'Connection or region latency'],
  'Storage': ['Cold start after a period of inactivity', 'Large bucket listing', 'Network distance to the Supabase region'],
  'Realtime': ['Cold start of the realtime service', 'Network distance to the Supabase region'],
  'Edge Functions': ['Cold start (the function had not run recently)', 'Region or network latency', 'Excessive payload size'],
  'GitHub': ['GitHub API rate limiting', 'Missing API token (lower rate limit tier)', 'External network latency to GitHub'],
  'Vercel': ['External network latency', 'Deployment cold start'],
  'Frontend': ['Slow device or browser tab throttling', 'Large page payload'],
}

export type OverallHealth = { label: string; tone: 'success' | 'warn' | 'danger'; message: string }

const DEFINITE_ERROR_STATUSES: MonitorStatus[] = ['failed', 'unhealthy', 'critical']
const SLOW_STATUSES: MonitorStatus[] = ['degraded', 'slow']
// Core services a real outage would show up in first. Any of these failing
// (not just slow) is treated as more serious than a peripheral integration
// like GitHub or Vercel being down.
const CORE_SERVICES = ['API', 'Database', 'Auth']

// Never claims "Operational"/"All Systems Operational" when core checks are
// down, slow, or simply haven't run -- see the spec this was built against.
export function computeOverallHealth(metrics: Pick<MonitorMetric, 'name' | 'status'>[]): OverallHealth {
  if (!metrics.length) return { label: 'Monitoring incomplete', tone: 'warn', message: 'Checks have not run yet on this device.' }
  const coreDown = metrics.some((metric) => CORE_SERVICES.includes(metric.name) && (metric.status === 'failed' || metric.status === 'unhealthy'))
  const downCount = metrics.filter((metric) => metric.status === 'failed' || metric.status === 'unhealthy').length
  const unclearCount = metrics.filter((metric) => metric.status === 'unavailable').length
  const slowCount = metrics.filter((metric) => SLOW_STATUSES.includes(metric.status)).length
  if (coreDown || downCount >= 3) return { label: 'Major outage', tone: 'danger', message: 'One or more core services (API, Database, or Auth) are not responding correctly.' }
  if (downCount > 0) return { label: 'Partial outage', tone: 'danger', message: `${downCount} service${downCount === 1 ? '' : 's'} returned a definite error response.` }
  if (metrics.some((metric) => metric.status === 'critical')) return { label: 'Degraded', tone: 'warn', message: 'At least one service is responding far slower than its target.' }
  if (slowCount > 0 || unclearCount > 0) return { label: 'Operational with warnings', tone: 'warn', message: 'Most services are healthy, but some are slower than target or could not be confirmed from this browser.' }
  return { label: 'Operational', tone: 'success', message: 'All monitored services are responding within their expected latency targets.' }
}

export function definiteErrorStatuses(): MonitorStatus[] {
  return DEFINITE_ERROR_STATUSES
}

export function slowStatuses(): MonitorStatus[] {
  return SLOW_STATUSES
}
