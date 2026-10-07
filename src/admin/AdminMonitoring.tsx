import { useCallback, useEffect, useRef, useState } from 'react'
import { Gauge, RefreshCw, Wifi } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { computeOverallHealth, evaluateHealth, slowServiceHints, statusLabel } from '../lib/monitoring'
import { adminSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase'
import { ADMIN_REQUEST_TIMEOUT_MS, adminAuthHeaders, fetchAdminFunction, fetchWithTimeout, getAdminAccessToken, withTimeout } from './api'
import { type MonitorMetric, type MonitorSummary, type ProbeOutcome } from './types'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Vite sets MODE from the actual build/run command ('development' for
// `vite dev`, whatever --mode says otherwise, 'production' for a normal
// `vite build') -- this reflects how the app was actually started rather
// than a hardcoded label, so a staging build run with `--mode staging` is
// correctly distinguished from production without extra config.
const currentEnvironment = import.meta.env.MODE || 'production'

type BackendLatencyOverview = {
  period_days: number; sample_count: number
  by_function: { function_name: string; requests: number; avg_ms: number; p50_ms: number; p95_ms: number; p99_ms: number; server_errors: number; client_errors: number }[]
  daily_avg: { day: string; avg_ms: number; requests: number }[]
}

export function AdminMonitoring() {
  const [backendLatency, setBackendLatency] = useState<BackendLatencyOverview | null>(null)
  const [backendLatencyPeriod, setBackendLatencyPeriod] = useState(7)
  const [backendLatencyLoading, setBackendLatencyLoading] = useState(true)
  useEffect(() => {
    if (!adminSupabase) return
    setBackendLatencyLoading(true)
    adminSupabase.rpc('admin_get_backend_latency_overview', { period_days: backendLatencyPeriod }).then(({ data }) => {
      setBackendLatencyLoading(false)
      setBackendLatency((data ?? null) as BackendLatencyOverview | null)
    })
  }, [backendLatencyPeriod])

  const [monitorMetrics, setMonitorMetrics] = useState<MonitorMetric[]>([])
  const [monitorHistory, setMonitorHistory] = useState<MonitorMetric[]>([])
  const [monitorSummary, setMonitorSummary] = useState<MonitorSummary[]>([])
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorError, setMonitorError] = useState('')
  const [monitorStorageState, setMonitorStorageState] = useState<'unknown' | 'available' | 'unavailable'>('unknown')
  const [monitorUpdatedAt, setMonitorUpdatedAt] = useState<string | null>(null)
  const [monitorStatusFilter, setMonitorStatusFilter] = useState('all')
  const [monitorRange, setMonitorRange] = useState('all')
  const [monitorEnvironmentFilter, setMonitorEnvironmentFilter] = useState('all')
  const [monitorCustomFrom, setMonitorCustomFrom] = useState('')
  const [monitorCustomTo, setMonitorCustomTo] = useState('')
  const monitorRealtimeChannel = useRef<RealtimeChannel | null>(null)
  const monitorRealtimeStatus = useRef<string | null>(null)
  const monitorRealtimeWait = useRef<Promise<ProbeOutcome> | null>(null)
  const monitorRunInProgress = useRef(false)
  const adminSessionInvalid = useRef(false)
  const monitorStorageStateRef = useRef<'unknown' | 'available' | 'unavailable'>('unknown')

  const markMonitoringStorageUnavailable = useCallback(() => {
    if (monitorStorageStateRef.current === 'unavailable') return
    monitorStorageStateRef.current = 'unavailable'
    setMonitorStorageState('unavailable')
    setMonitorError('Monitoring storage not configured. Local browser checks will continue, but observations will not be persisted.')
  }, [])

  const loadPersistedMonitoring = useCallback(async () => {
    if (!adminSupabase || monitorStorageStateRef.current === 'unavailable') return
    const effectivePeriod = monitorRange === 'all' ? '7d' : monitorRange === 'custom' ? '24h' : monitorRange
    const params: { period_key: string; custom_start?: string; custom_end?: string } = { period_key: effectivePeriod }
    if (monitorRange === 'custom' && monitorCustomFrom && monitorCustomTo) {
      params.custom_start = new Date(monitorCustomFrom).toISOString()
      params.custom_end = new Date(monitorCustomTo).toISOString()
    }
    const { data, error } = await adminSupabase.rpc('get_platform_monitoring', params)
    if (error) {
      if (error.message.includes('does not exist') || error.code === 'PGRST202') {
        markMonitoringStorageUnavailable()
      } else {
        setMonitorError(error.message)
      }
      return
    }
    monitorStorageStateRef.current = 'available'
    setMonitorStorageState('available')
    setMonitorHistory((data?.measurements ?? []).map((metric: { service: string; source: string; status: MonitorMetric['status']; latency_ms: number | null; detail: string; check_type?: string | null; checked_at: string; http_status?: number | null; environment?: string }) => ({
      name: metric.service, source: metric.source, status: metric.status, latency: metric.latency_ms, detail: metric.detail, checkType: metric.check_type ?? 'Unspecified check', checkedAt: metric.checked_at, httpStatus: metric.http_status, environment: metric.environment,
    })))
    setMonitorSummary((data?.summary ?? []) as MonitorSummary[])
  }, [markMonitoringStorageUnavailable, monitorRange, monitorCustomFrom, monitorCustomTo])

  useEffect(() => {
    if (!adminSupabase || monitorStorageState === 'unavailable') return
    if (monitorRange === 'custom' && !(monitorCustomFrom && monitorCustomTo)) return
    if (monitorStorageState === 'unknown') {
      void loadPersistedMonitoring()
      return
    }
    const channel = adminSupabase.channel(`platform-monitoring-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_monitoring_measurements' }, () => void loadPersistedMonitoring())
      .subscribe()
    return () => { void adminSupabase?.removeChannel(channel) }
  }, [loadPersistedMonitoring, monitorRange, monitorCustomFrom, monitorCustomTo, monitorStorageState])

  const runMonitoringChecks = useCallback(async () => {
    if (!adminSupabase || !supabaseUrl || !supabaseAnonKey || monitorRunInProgress.current || adminSessionInvalid.current) return
    const client = adminSupabase
    const anonKey = supabaseAnonKey
    monitorRunInProgress.current = true
    setMonitorLoading(true); setMonitorError('')
    // Every operation below returns one of:
    //   'success'        -- request completed; measure() grades the tier by
    //                        latency via evaluateHealth (this is the fix for
    //                        every 2xx being labelled "Healthy" regardless
    //                        of how long it took).
    //   'failed'         -- a definite 4xx/auth/config-shaped error.
    //   'unhealthy'      -- a definite 5xx (server-side error).
    //   'unavailable'    -- the probe itself could not complete (timeout,
    //                        network failure) -- unknown, not confirmed down.
    //   'configuration'  -- the service has not been set up.
    const measure = async (name: string, source: string, checkType: string, operation: () => Promise<ProbeOutcome>): Promise<MonitorMetric> => {
      const started = performance.now()
      try {
        const result = await operation()
        const elapsed = Math.round(performance.now() - started)
        if (result.status === 'success') {
          const evaluated = evaluateHealth(elapsed)
          return { name, source, latency: elapsed, status: evaluated.status, detail: result.detail ?? evaluated.message, checkType, checkedAt: new Date().toISOString(), httpStatus: result.httpStatus ?? null, environment: currentEnvironment }
        }
        if (result.status === 'configuration' || result.status === 'unavailable') {
          return { name, source, latency: null, status: result.status, detail: result.detail ?? 'Not configured', checkType, checkedAt: new Date().toISOString(), environment: currentEnvironment }
        }
        // 'failed' (4xx/auth/config-shaped) or 'unhealthy' (5xx): a definite
        // error graded purely on that error, not on how fast it arrived.
        return { name, source, latency: elapsed, status: result.status, detail: result.detail ?? 'Request failed', checkType, checkedAt: new Date().toISOString(), failure: result.detail, httpStatus: result.httpStatus ?? null, environment: currentEnvironment }
      } catch (reason) {
        const detail = reason instanceof DOMException && reason.name === 'AbortError' ? `Timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` : reason instanceof Error ? reason.message : 'Request failed'
        return { name, source, latency: null, status: 'unavailable', detail: `Probe unavailable: ${detail}`, checkType, checkedAt: new Date().toISOString(), environment: currentEnvironment }
      }
    }
    const fetchProbe = async (url: string, headers: Record<string, string> = {}): Promise<ProbeOutcome> => {
      try {
        const response = await fetchWithTimeout(url, { headers })
        if (response.ok) return { status: 'success', httpStatus: response.status }
        if (response.status >= 500) return { status: 'unhealthy', httpStatus: response.status, detail: `HTTP ${response.status} ${response.statusText}` }
        return { status: 'failed', httpStatus: response.status, detail: `HTTP ${response.status} ${response.statusText}` }
      } catch (reason) {
        const detail = reason instanceof DOMException && reason.name === 'AbortError' ? `Timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` : reason instanceof Error ? reason.message : 'Connection failed'
        return { status: 'unavailable', detail: `Probe unavailable: ${detail}` }
      }
    }
    try {
      const session = (await withTimeout(client.auth.getSession())).data.session
      const token = await getAdminAccessToken()
      const realtime = async (): Promise<ProbeOutcome> => {
        if (monitorRealtimeStatus.current === 'SUBSCRIBED') return { status: 'success' }
        if (monitorRealtimeWait.current) return monitorRealtimeWait.current
        const channel = monitorRealtimeChannel.current ?? client.channel('admin-health')
        monitorRealtimeChannel.current = channel
        let settled = false
        const waitPromise = new Promise<ProbeOutcome>((resolve) => {
          const finish = (result: ProbeOutcome) => {
            if (settled) return
            settled = true
            window.clearTimeout(timeout)
            monitorRealtimeWait.current = null
            if (result.status !== 'success') {
              monitorRealtimeStatus.current = null
              monitorRealtimeChannel.current = null
              void client.removeChannel(channel)
            }
            resolve(result)
          }
          const timeout = window.setTimeout(() => finish({ status: 'unavailable', detail: `Realtime unavailable after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` }), ADMIN_REQUEST_TIMEOUT_MS)
          channel.subscribe((status) => {
            monitorRealtimeStatus.current = status
            if (status === 'SUBSCRIBED') finish({ status: 'success' })
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') finish({ status: 'unavailable', detail: `Realtime unavailable (${status.toLowerCase()})` })
          })
        })
        monitorRealtimeWait.current = settled ? null : waitPromise
        return waitPromise
      }
      const metrics = await Promise.all([
        // Probes an admin-scoped table (governed by is_platform_admin() RLS,
        // same as every other admin RPC on this page) instead of
        // `organizations`, whose only SELECT policy is member-scoped. A
        // platform admin is not necessarily a member of any organization, so
        // the previous probe could -- and did -- come back 401 for a
        // perfectly valid session, and with persisted monitoring now
        // recording every run, that false failure was piling up as fake
        // API downtime in the history/uptime charts below.
        measure('API', 'Supabase REST', 'Authenticated REST request', () => token ? fetchProbe(`${supabaseUrl}/rest/v1/platform_admin_access?select=user_id&limit=1`, adminAuthHeaders(token, anonKey)) : Promise.resolve({ status: 'failed', detail: 'No active admin session' })),
        measure('Database', 'Supabase', 'Protected RPC call (no SELECT *)', async () => { const { error } = await withTimeout(client.rpc('get_platform_overview')); return error ? { status: 'failed', detail: error.message } : { status: 'success', detail: 'Overview RPC completed' } }),
        measure('Auth', 'Supabase Auth', 'Local session read (no network round trip)', async () => session ? { status: 'success', detail: `Session present for ${session.user.email ?? 'signed-in admin'}` } : { status: 'failed', detail: 'No active admin session' }),
        measure('Storage', 'Supabase Storage', 'Bucket listing (metadata only, no file access)', async () => { const { error } = await withTimeout(client.storage.listBuckets()); return error ? { status: 'failed', detail: error.message } : { status: 'success', detail: 'Bucket listing completed' } }),
        measure('Realtime', 'Supabase Realtime', 'Channel subscribe (connection establishment only, not full channel health)', realtime),
        measure('Edge Functions', 'Supabase', 'Dedicated minimal ping function (auth check only, no database work)', async () => {
          const result = await fetchAdminFunction('platform-health-ping', {}, ADMIN_REQUEST_TIMEOUT_MS)
          if (result.expired) adminSessionInvalid.current = true
          if (!result.response) return { status: 'unavailable', detail: result.expired ? 'No active admin session' : 'Health-ping request timed out or is unavailable' }
          if (!result.response.ok) return result.response.status >= 500 ? { status: 'unhealthy', httpStatus: result.response.status, detail: `HTTP ${result.response.status}` } : { status: 'failed', httpStatus: result.response.status, detail: `HTTP ${result.response.status}` }
          return { status: 'success', httpStatus: result.response.status }
        }),
        measure('Frontend', 'Current browser', 'Browser navigation timing (page load), not a network probe', async () => {
          const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
          if (!entry) return { status: 'unavailable', detail: 'Navigation timing is not available in this browser' }
          const loadMs = Math.round(entry.loadEventEnd || entry.domContentLoadedEventEnd || entry.duration)
          return { status: 'success', detail: `Page finished loading in ${loadMs} ms` }
        }),
        measure('GitHub', 'Server-side GitHub API', 'Server-side repository lookup (token/rate-limit never exposed to the browser)', async () => {
          if (!token) return { status: 'failed', detail: 'No active admin session' }
          const result = await fetchAdminFunction('list-platform-audit?limit=1', {}, ADMIN_REQUEST_TIMEOUT_MS)
          if (result.expired) adminSessionInvalid.current = true
          if (!result.response) return { status: 'unavailable', detail: result.expired ? 'No active admin session' : 'Audit request timed out or is unavailable' }
          const response = result.response
          const payload = await response.json().catch(() => null)
          if (!response.ok) return { status: response.status >= 500 ? 'unhealthy' : 'failed', httpStatus: response.status, detail: `Audit integration returned HTTP ${response.status}` }
          const github = payload?.github
          if (!github) return { status: 'configuration', detail: 'GITHUB_REPOSITORY is not configured on the Edge Function' }
          if (!github.configured) return { status: github.status === 'failed' ? 'failed' : 'configuration', detail: github.detail ?? 'GitHub repository is not reachable' }
          const rateNote = typeof github.rateLimitRemaining === 'number' ? ` (${github.rateLimitRemaining} requests remaining)` : ''
          return { status: 'success', detail: `${github.detail ?? 'GitHub API connected'}${rateNote}` }
        }),
        measure('Vercel', 'Vercel', 'Deployment URL probe (only runs if a URL is configured)', async () => { const deploymentUrl = import.meta.env.VITE_VERCEL_PROJECT_URL; return deploymentUrl ? fetchProbe(deploymentUrl) : { status: 'configuration', detail: 'Not configured' } }),
      ])
      const checkedAt = new Date().toISOString()
      setMonitorMetrics(metrics)
      if (client && monitorStorageStateRef.current !== 'unavailable') {
        const { error } = await client.rpc('record_platform_monitoring_measurements', {
          measurements: metrics.map((metric) => ({
            service: metric.name, source: metric.source, status: metric.status, latency_ms: metric.latency,
            detail: metric.detail, check_type: metric.checkType, checked_at: metric.checkedAt, http_status: metric.httpStatus ?? null,
            environment: currentEnvironment,
          })),
        })
        if (error && (error.message.includes('does not exist') || error.code === 'PGRST202')) markMonitoringStorageUnavailable()
        else if (error) setMonitorError(`Checks completed but could not be persisted: ${error.message}`)
        else {
          monitorStorageStateRef.current = 'available'
          setMonitorStorageState('available')
          void loadPersistedMonitoring()
        }
      }
      setMonitorUpdatedAt(checkedAt)
    } catch (reason) {
      setMonitorError(reason instanceof Error ? reason.message : 'Monitoring checks could not be completed.')
    } finally {
      monitorRunInProgress.current = false
      setMonitorLoading(false)
    }
  }, [loadPersistedMonitoring, markMonitoringStorageUnavailable])

  useEffect(() => {
    void runMonitoringChecks()
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void runMonitoringChecks() }, 60000)
    return () => {
      window.clearInterval(interval)
      if (monitorRealtimeChannel.current) void adminSupabase?.removeChannel(monitorRealtimeChannel.current)
      monitorRealtimeChannel.current = null
      monitorRealtimeStatus.current = null
      monitorRealtimeWait.current = null
    }
  }, [runMonitoringChecks])

  const rangeMs: Record<string, number> = { '15m': 900000, '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
  const customRangeReady = monitorRange === 'custom' && monitorCustomFrom && monitorCustomTo
  const rangeStart = customRangeReady ? new Date(monitorCustomFrom).getTime() : rangeMs[monitorRange] ? Date.now() - rangeMs[monitorRange] : 0
  const rangeEnd = customRangeReady ? new Date(monitorCustomTo).getTime() : Date.now()
  const sourceMetrics = rangeStart ? monitorHistory.filter((metric) => { const t = new Date(metric.checkedAt).getTime(); return t >= rangeStart && t <= rangeEnd }).reduce<MonitorMetric[]>((latest, metric) => {
    const index = latest.findIndex((item) => item.name === metric.name)
    if (index === -1) latest.push(metric)
    else if (new Date(metric.checkedAt).getTime() > new Date(latest[index].checkedAt).getTime()) latest[index] = metric
    return latest
  }, []) : monitorMetrics
  const visibleMetrics = sourceMetrics.filter((metric) => (monitorStatusFilter === 'all' || metric.status === monitorStatusFilter) && (monitorEnvironmentFilter === 'all' || metric.environment === monitorEnvironmentFilter))
  const knownEnvironments = Array.from(new Set([currentEnvironment, ...monitorHistory.map((metric) => metric.environment).filter((value): value is string => Boolean(value))]))
  const definiteErrorStatuses: MonitorMetric['status'][] = ['failed', 'unhealthy', 'critical']
  const slowStatuses: MonitorMetric['status'][] = ['degraded', 'slow']
  const failures = monitorMetrics.filter((metric) => definiteErrorStatuses.includes(metric.status))
  const overall = computeOverallHealth(monitorMetrics)
  const historyPoints = monitorHistory.filter((metric) => { if (metric.latency == null) return false; const t = new Date(metric.checkedAt).getTime(); return (!rangeStart || t >= rangeStart) && t <= rangeEnd }).slice(-48)
  const statusTotals = monitorHistory.reduce((totals, metric) => {
    totals[metric.status] = (totals[metric.status] ?? 0) + 1
    return totals
  }, {} as Record<MonitorMetric['status'], number>)
  const okCount = (statusTotals.healthy ?? 0) + (statusTotals.degraded ?? 0) + (statusTotals.slow ?? 0)
  const badCount = (statusTotals.critical ?? 0) + (statusTotals.unhealthy ?? 0) + (statusTotals.failed ?? 0)
  const measuredCount = okCount + badCount
  const availability = measuredCount ? `${Math.round(okCount / measuredCount * 100)}%` : 'Not enough data'
  const statusClass = (status: MonitorMetric['status']) => status === 'healthy' ? 'active' : definiteErrorStatuses.includes(status) ? 'failed' : 'warn'

  const maxDailyBackendMs = Math.max(...(backendLatency?.daily_avg.map((point) => point.avg_ms) ?? [1]), 1)
  return <>
  <section className="admin-card wide">
    <div className="admin-card-header">
      <div><h2>Backend latency — general, all traffic</h2><p>Measured server-side inside each function, for every real request from every user. This is what "general latency" means: it does not depend on your browser, location, or network.</p></div>
      <div className="admin-actions-inline">
        <select value={backendLatencyPeriod} onChange={(event) => setBackendLatencyPeriod(Number(event.target.value))}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select>
      </div>
    </div>
    {backendLatencyLoading ? <div className="admin-line-skeleton"><Skeleton /><Skeleton /><Skeleton /></div> : !backendLatency || backendLatency.sample_count === 0 ? <div className="admin-empty">No backend-recorded requests yet in this period. This fills in automatically as the app is used — nothing to configure.</div> : <>
      <div className="monitoring-summary">
        <article><span>Requests measured</span><strong>{backendLatency.sample_count.toLocaleString()}</strong><small>Over {backendLatency.period_days} day{backendLatency.period_days === 1 ? '' : 's'}</small></article>
      </div>
      <div className="table-wrap"><table className="admin-table"><thead><tr><th>Function</th><th>Requests</th><th>Avg</th><th>p50</th><th>p95</th><th>p99</th><th>Errors</th></tr></thead><tbody>{backendLatency.by_function.map((row) => <tr key={row.function_name}><td className="mono">{row.function_name}</td><td>{row.requests.toLocaleString()}</td><td>{row.avg_ms} ms</td><td>{row.p50_ms} ms</td><td>{row.p95_ms} ms</td><td>{row.p99_ms} ms</td><td>{row.server_errors + row.client_errors > 0 ? <span className="admin-status failed">{row.server_errors + row.client_errors}</span> : '—'}</td></tr>)}</tbody></table></div>
      {backendLatency.daily_avg.length > 1 && <div className="admin-bar-chart" style={{ marginTop: 16 }}>{backendLatency.daily_avg.map((point) => <div className="admin-bar-item" key={point.day}><div className="admin-bar-track"><i style={{ height: `${Math.max(2, (point.avg_ms / maxDailyBackendMs) * 100)}%` }} /></div><small title={`${point.avg_ms} ms avg, ${point.requests} requests`}>{new Date(point.day).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</small></div>)}</div>}
    </>}
  </section>
  <section className="admin-card wide monitoring-page">
    <div className="admin-card-header">
      <div><h2>This browser's connection check</h2><p>Probes fired from your current admin session only — useful for "is my connection to Supabase working right now", not for general platform latency (see above).</p></div>
      <div className="admin-actions-inline">
        <button className="secondary" onClick={() => void runMonitoringChecks()} disabled={monitorLoading}><RefreshCw size={14} className={monitorLoading ? 'spin' : ''} />{monitorLoading ? 'Checking…' : 'Run checks'}</button>
      </div>
    </div>
    <div className={`monitoring-overall ${overall.tone}`}>
      <strong>{overall.label}</strong>
      <span>{overall.message}</span>
      <small>{monitorUpdatedAt ? `Last checked ${new Date(monitorUpdatedAt).toLocaleTimeString('en-NG')} · auto-refreshes every 60s while this tab is visible` : 'Auto-refreshes every 60s while this tab is visible'}</small>
    </div>
    {monitorStorageState === 'unavailable' && <div className="monitoring-storage-state" role="status"><strong>Monitoring storage not configured</strong><span>Local and browser checks continue on this device. Results are not being persisted until the monitoring migration is deployed.</span></div>}
    {monitorError && monitorStorageState !== 'unavailable' && <div className="form-error" role="alert">{monitorError}</div>}
    <div className="monitoring-filters">
      <label>Status
        <select value={monitorStatusFilter} onChange={(event) => setMonitorStatusFilter(event.target.value)}>
          <option value="all">All states</option>
          <option value="healthy">Healthy</option>
          <option value="degraded">Degraded</option>
          <option value="slow">Slow</option>
          <option value="critical">Critical performance</option>
          <option value="unhealthy">Unhealthy</option>
          <option value="failed">Failed</option>
          <option value="configuration">Configuration needed</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </label>
      <label>Time range
        <select value={monitorRange} onChange={(event) => setMonitorRange(event.target.value)}>
          <option value="all">Current check set</option>
          <option value="15m">Last 15 minutes</option>
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range…</option>
        </select>
      </label>
      {monitorRange === 'custom' && <>
        <label>From
          <input type="datetime-local" value={monitorCustomFrom} onChange={(event) => setMonitorCustomFrom(event.target.value)} max={monitorCustomTo || undefined} />
        </label>
        <label>To
          <input type="datetime-local" value={monitorCustomTo} onChange={(event) => setMonitorCustomTo(event.target.value)} min={monitorCustomFrom || undefined} max={new Date().toISOString().slice(0, 16)} />
        </label>
      </>}
      <label>Environment
        <select value={monitorEnvironmentFilter} onChange={(event) => setMonitorEnvironmentFilter(event.target.value)}>
          <option value="all">All environments</option>
          {knownEnvironments.map((env) => <option key={env} value={env}>{env.charAt(0).toUpperCase() + env.slice(1)}</option>)}
        </select>
      </label>
      <span className="monitoring-environment-badge">This device is running: {currentEnvironment.charAt(0).toUpperCase() + currentEnvironment.slice(1)}</span>
    </div>
    <div className="monitoring-summary">
      <article><span>Observed availability</span><strong>{availability}</strong><small>{measuredCount ? `${okCount} healthy or slow / ${badCount} failed` : 'No persisted checks yet'}</small></article>
      <article><span>Persisted observations</span><strong>{monitorHistory.length}</strong><small>Across configured services</small></article>
      <article><span>Current errors</span><strong>{badCount}</strong><small>Definite failures in selected history</small></article>
    </div>
    <div className="admin-monitor-grid">
      {visibleMetrics.map((metric) => {
        const hints = slowServiceHints[metric.name]
        const showHints = (slowStatuses.includes(metric.status) || metric.status === 'critical' || metric.status === 'unhealthy') && hints
        return <article className="admin-monitor-card" key={metric.name}>
          <div className="admin-card-label">{metric.name} <span>· {metric.source}</span></div>
          <strong>{metric.latency == null ? 'Not measured' : `${metric.latency} ms`}</strong>
          <span className={`admin-status ${statusClass(metric.status)}`}>{statusLabel(metric.status)}</span>
          <small>{metric.detail}</small>
          <p className="admin-monitor-checktype">Check type: {metric.checkType}</p>
          {showHints && <div className="admin-monitor-hints"><span>Possible causes include:</span><ul>{hints.map((hint) => <li key={hint}>{hint}</li>)}</ul></div>}
          <time>{new Date(metric.checkedAt).toLocaleString('en-NG')}</time>
        </article>
      })}
    </div>
    {monitorLoading && <div className="admin-line-skeleton"><Skeleton /><Skeleton /><Skeleton /></div>}
    <div className="monitoring-chart-grid">
      <section className="monitoring-history">
        <div className="admin-card-header"><div><h3>Latency history</h3><p>{historyPoints.length ? `${historyPoints.length} persisted response measurements` : 'No persisted measurements yet.'}</p></div></div>
        {historyPoints.length > 1 && <div className="monitor-history-chart" aria-label="Persisted response latency history">{historyPoints.map((point, index) => <i key={`${point.name}-${point.checkedAt}-${index}`} title={`${point.name}: ${point.latency} ms`} style={{ height: `${Math.max(8, Math.min(100, (point.latency ?? 0) / Math.max(...historyPoints.map((item) => item.latency ?? 0), 1) * 100))}%` }} />)}</div>}
      </section>
      <section className="monitoring-availability">
        <div className="admin-card-header"><div><h3>Service availability &amp; latency</h3><p>Observed outcomes and response-time distribution in the selected period. Historical performance data is not available until checks have been persisted for this window.</p></div></div>
        {monitorSummary.length ? monitorSummary.map((item) => <div className="availability-row" key={item.service}>
          <strong>{item.service}</strong>
          <span><i style={{ width: `${item.uptime_percent ?? 0}%` }} /></span>
          <b>{item.uptime_percent == null ? 'No data' : `${item.uptime_percent}%`}</b>
          <small>
            {item.checks} checks · {item.failed} failed
            {item.consecutive_failures > 0 && <> · <strong className="availability-streak">{item.consecutive_failures} in a row failing now</strong></>}
            {item.p95_latency_ms != null && ` · p50 ${item.p50_latency_ms}ms · p95 ${item.p95_latency_ms}ms · p99 ${item.p99_latency_ms}ms`}
            {item.min_latency_ms != null && ` · min ${item.min_latency_ms}ms / max ${item.max_latency_ms}ms`}
          </small>
        </div>) : <p className="monitoring-empty">No persisted service history yet.</p>}
      </section>
    </div>
    <section className="monitoring-failures">
      <h3>Recent failures</h3>
      {failures.length ? failures.map((metric) => <div key={metric.name}><strong>{metric.name}</strong><span>{metric.failure}</span><time>{new Date(metric.checkedAt).toLocaleString('en-NG')}</time></div>) : <p>No failures recorded in the current browser check.</p>}
    </section>
    <div className="monitoring-notes">
      <Wifi size={16} />
      <span>{monitorStorageState === 'unavailable' ? 'Browser checks are local only. Deploy the platform monitoring migration to enable authenticated persistence and historical charts.' : 'Observations are authenticated, bounded, and stored in Supabase. Browser checks describe this admin device and network only; missing checks are unknown, not downtime. GitHub and Vercel remain unmeasured until configured.'}</span>
    </div>
    <div className="monitoring-notes monitoring-explainer">
      <Gauge size={16} />
      <span>A successful request can still be slow, and one measurement does not establish long-term performance — that's what the p50/p95/p99 figures above are for. Edge Function and external checks (GitHub, Vercel) can be slower on a cold start; a response under 1 second is fine for an occasional admin check but would be slow for a frequent user-facing interaction.</span>
    </div>
  </section>
  </>
}
