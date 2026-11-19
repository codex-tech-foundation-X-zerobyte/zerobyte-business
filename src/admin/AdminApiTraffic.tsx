import { useEffect, useRef, useState } from 'react'
import { Activity, Gauge, Globe2, TriangleAlert } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { fetchAdminFunction } from './api'

type ServiceStats = {
  service: string
  requests: number
  errors_5xx: number
  errors_4xx: number
  avg_ms: number
  p95_ms: number
}
type ApiSnapshot = {
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
type Payload = {
  configured?: boolean
  stale?: boolean
  warning?: string
  snapshot?: ApiSnapshot
  error?: string
  message?: string
}

const SERVICE_LABELS: Record<string, string> = {
  rest: 'Data API (tables)',
  auth: 'Sign-in (Auth)',
  storage: 'File storage',
  functions: 'Edge Functions',
  realtime: 'Realtime',
  other: 'Other',
}
const rpsText = (value: number) => (value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2))
const n = (value: number) => value.toLocaleString('en-NG')

/**
 * Every request that reached the project through Supabase's API gateway, as counted by Supabase itself
 * (the Live traffic card above counts only our own Edge Functions). Read through the get-api-traffic function.
 */
export function AdminApiTraffic({ windowMinutes, compact = false }: { windowMinutes: number; compact?: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    setLoading(true)
    const load = async () => {
      if (document.hidden) return
      const { response, expired, error: failure } = await fetchAdminFunction(`get-api-traffic?window=${windowMinutes}`)
      if (!alive.current) return
      setLoading(false)
      if (!response) {
        setError(
          expired
            ? 'Your admin session has expired. Sign in again.'
            : (failure ?? 'The API traffic service did not answer.'),
        )
        return
      }
      const body = (await response.json().catch(() => null)) as Payload | null
      if (!alive.current) return
      if (response.status === 404) {
        setError('Deploy the get-api-traffic function (npm run supabase:functions:deploy) to see all API traffic.')
        return
      }
      if (!response.ok && !body?.snapshot) {
        setError(body?.message ?? `API traffic returned ${response.status}.`)
        return
      }
      setError('')
      setPayload(body)
    }
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => {
      alive.current = false
      window.clearInterval(timer)
    }
  }, [windowMinutes])

  const snapshot = payload?.snapshot
  const series = snapshot?.series ?? []
  const peak = Math.max(...series.map((point) => point.requests), 1)
  const width = 600
  const height = 90
  const step = series.length > 1 ? width / (series.length - 1) : width
  const line = series
    .map(
      (point, index) =>
        `${(index * step).toFixed(1)},${(height - 6 - (point.requests / peak) * (height - 16)).toFixed(1)}`,
    )
    .join(' ')
  const errorTone = !snapshot ? '' : snapshot.error_rate >= 5 ? 'bad' : snapshot.error_rate >= 1 ? 'warn' : 'good'
  const latencyTone = !snapshot ? '' : snapshot.p95_ms > 2000 ? 'bad' : snapshot.p95_ms > 1000 ? 'warn' : 'good'
  const span = snapshot ? (snapshot.bucket_minutes === 1 ? 'minute' : `${snapshot.bucket_minutes} minutes`) : 'minute'

  return (
    <div className="api-traffic">
      <div className="admin-card-header">
        <div>
          <h3>All API traffic</h3>
          <p>
            Every request that reached your Supabase project (tables, sign-in, storage and functions), counted by
            Supabase itself, not by the browser.
          </p>
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {payload?.configured === false ? (
        <div className="admin-empty">
          To count all API traffic, create a Supabase access token (supabase.com/dashboard/account/tokens) and run{' '}
          <code>supabase secrets set LOGS_ACCESS_TOKEN=your_token</code>, then deploy the get-api-traffic function.
        </div>
      ) : loading ? (
        <div className="traffic-grid">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="skeleton-card" />
          ))}
        </div>
      ) : snapshot ? (
        <>
          {payload?.stale && (
            <div className="form-error" role="status">
              Showing the last good reading. {payload.warning}
            </div>
          )}
          <div className="traffic-grid">
            <article className="traffic-stat primary">
              <span>
                <Activity size={14} /> Requests / second
              </span>
              <strong>{rpsText(snapshot.rps_now)}</strong>
              <small>
                last full {span} · avg {rpsText(snapshot.rps_avg)} · busiest {span} {rpsText(snapshot.rps_peak)}
              </small>
            </article>
            <article className="traffic-stat">
              <span>
                <Globe2 size={14} /> Requests
              </span>
              <strong>{n(snapshot.requests)}</strong>
              <small>in this window, all services</small>
            </article>
            <article className={`traffic-stat ${errorTone}`}>
              <span>
                <TriangleAlert size={14} /> Server errors
              </span>
              <strong>{snapshot.error_rate}%</strong>
              <small>
                {n(snapshot.errors_5xx)} server · {n(snapshot.errors_4xx)} client errors
              </small>
            </article>
            <article className={`traffic-stat ${latencyTone}`}>
              <span>
                <Gauge size={14} /> Response time
              </span>
              <strong>{n(snapshot.p95_ms)} ms</strong>
              <small>95th percentile · avg {n(snapshot.avg_ms)} ms (time spent in Supabase)</small>
            </article>
          </div>
          {!compact && (
            <>
              <div className="traffic-chart" role="img" aria-label="API requests over time">
                <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                  <polyline points={`0,${height} ${line} ${width},${height}`} className="traffic-area" />
                  <polyline points={line} className="traffic-line" />
                </svg>
                <div className="traffic-chart-axis">
                  <span>
                    {series[0]
                      ? new Date(series[0].minute).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                  <span>
                    Requests per {span} · busiest {n(peak)}
                  </span>
                  <span>now</span>
                </div>
              </div>
              {snapshot.services.length > 0 && (
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Requests</th>
                        <th>Server errors</th>
                        <th>Client errors</th>
                        <th>Avg ms</th>
                        <th>p95 ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.services.map((item) => (
                        <tr key={item.service}>
                          <td>
                            <strong>{SERVICE_LABELS[item.service] ?? item.service}</strong>
                          </td>
                          <td>{n(item.requests)}</td>
                          <td>{n(item.errors_5xx)}</td>
                          <td>{n(item.errors_4xx)}</td>
                          <td>{n(item.avg_ms)}</td>
                          <td>{n(item.p95_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted">
                The dashboard&rsquo;s own refresh calls are left out. Supabase keeps logs for a limited time (1 day on
                the free plan), so the longest window is 24 hours.
              </p>
            </>
          )}
        </>
      ) : (
        !error && <div className="admin-empty">No API requests were logged in this window.</div>
      )}
    </div>
  )
}
