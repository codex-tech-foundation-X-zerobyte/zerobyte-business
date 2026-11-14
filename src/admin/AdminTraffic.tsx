import { useEffect, useRef, useState } from 'react'
import { Activity, Database, Gauge, TriangleAlert } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'

type TrafficSnapshot = {
  window_minutes: number
  requests_window: number
  rps_now: number
  rps_avg: number
  rps_peak: number
  error_rate: number
  avg_ms: number
  p95_ms: number
  db_connections: number
  db_size_mb: number
  series: { minute: string; requests: number; errors: number }[]
}

const WINDOWS = [
  { value: 15, label: 'Last 15 min' },
  { value: 60, label: 'Last hour' },
  { value: 360, label: 'Last 6 hours' },
  { value: 1440, label: 'Last 24 hours' },
]
const rpsText = (value: number) => (value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2))

// Live platform traffic. Refreshes every 10 seconds while the tab is visible and stops when it is hidden.
export function AdminTraffic({ compact = false }: { compact?: boolean }) {
  const [windowMinutes, setWindowMinutes] = useState(60)
  const [snapshot, setSnapshot] = useState<TrafficSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    if (!adminSupabase) return
    const load = async () => {
      if (document.hidden) return
      const { data, error: result } = await adminSupabase!.rpc('admin_get_traffic_snapshot', {
        window_minutes: windowMinutes,
      })
      if (!alive.current) return
      setLoading(false)
      if (result)
        setError(
          result.code === 'PGRST202' || result.message.includes('does not exist')
            ? 'Apply the latest Supabase migration (admin_traffic_snapshot) to see live traffic.'
            : result.message,
        )
      else {
        setError('')
        setSnapshot(data && Object.keys(data).length ? (data as TrafficSnapshot) : null)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 10000)
    return () => {
      alive.current = false
      window.clearInterval(timer)
    }
  }, [windowMinutes])

  const series = snapshot?.series ?? []
  const maxRequests = Math.max(...series.map((point) => point.requests), 1)
  const width = 600
  const height = 90
  const step = series.length > 1 ? width / (series.length - 1) : width
  const line = series
    .map(
      (point, index) =>
        `${(index * step).toFixed(1)},${(height - 6 - (point.requests / maxRequests) * (height - 16)).toFixed(1)}`,
    )
    .join(' ')
  const errorTone = !snapshot ? '' : snapshot.error_rate >= 5 ? 'bad' : snapshot.error_rate >= 1 ? 'warn' : 'good'
  const latencyTone = !snapshot ? '' : snapshot.p95_ms > 2000 ? 'bad' : snapshot.p95_ms > 1000 ? 'warn' : 'good'

  return (
    <section className="admin-card wide traffic-card">
      <div className="admin-card-header">
        <div>
          <h2>Live traffic</h2>
          <p>Edge Function requests across every business, worker and admin. Updates every 10 seconds.</p>
        </div>
        <div className="admin-actions-inline">
          <span className="admin-pill success">
            <i className="live-dot" /> Live
          </span>
          {!compact && (
            <select
              value={windowMinutes}
              onChange={(event) => {
                setLoading(true)
                setWindowMinutes(Number(event.target.value))
              }}
              aria-label="Traffic window"
            >
              {WINDOWS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="traffic-grid">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <Skeleton key={item} className="skeleton-card" />
          ))}
        </div>
      ) : snapshot ? (
        <>
          <div className="traffic-grid">
            <article className="traffic-stat primary">
              <span>
                <Activity size={14} /> Requests / second
              </span>
              <strong>{rpsText(snapshot.rps_now)}</strong>
              <small>
                last 60 seconds · avg {rpsText(snapshot.rps_avg)} · peak {rpsText(snapshot.rps_peak)}
              </small>
            </article>
            <article className="traffic-stat">
              <span>Requests</span>
              <strong>{snapshot.requests_window.toLocaleString('en-NG')}</strong>
              <small>
                in the last{' '}
                {snapshot.window_minutes >= 60
                  ? `${snapshot.window_minutes / 60} hour${snapshot.window_minutes === 60 ? '' : 's'}`
                  : `${snapshot.window_minutes} minutes`}
              </small>
            </article>
            <article className={`traffic-stat ${errorTone}`}>
              <span>
                <TriangleAlert size={14} /> Server errors
              </span>
              <strong>{snapshot.error_rate}%</strong>
              <small>responses with a 5xx status</small>
            </article>
            <article className={`traffic-stat ${latencyTone}`}>
              <span>
                <Gauge size={14} /> Response time
              </span>
              <strong>{snapshot.p95_ms.toLocaleString('en-NG')} ms</strong>
              <small>95th percentile · avg {snapshot.avg_ms.toLocaleString('en-NG')} ms</small>
            </article>
            <article className="traffic-stat">
              <span>
                <Database size={14} /> Database
              </span>
              <strong>{snapshot.db_size_mb.toLocaleString('en-NG')} MB</strong>
              <small>
                {snapshot.db_connections} open connection{snapshot.db_connections === 1 ? '' : 's'}
              </small>
            </article>
          </div>
          {!compact && (
            <div className="traffic-chart" role="img" aria-label="Requests per minute">
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
                <span>Requests per minute · busiest {maxRequests.toLocaleString('en-NG')}</span>
                <span>now</span>
              </div>
            </div>
          )}
        </>
      ) : (
        !error && (
          <div className="admin-empty">
            No requests recorded in this window yet. This fills in as people use the app.
          </div>
        )
      )}
    </section>
  )
}
