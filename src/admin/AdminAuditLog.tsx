import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { DonutChart } from '../components/charts'
import { HBars } from './AdminCharts'
import { Skeleton } from '../components/ui'
import { adminSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase'
import { fetchAdminFunction } from './api'
import { formatAdminValue } from './format'
import { type AuditEntry } from './types'
import { HeaderActions } from './HeaderActions'

export function AdminAuditLog() {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [auditCategory, setAuditCategory] = useState('all')
  const [auditSeverity, setAuditSeverity] = useState('all')
  const [auditSource, setAuditSource] = useState('all')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [auditRefreshToken, setAuditRefreshToken] = useState(0)
  const [auditLive, setAuditLive] = useState(false)

  useEffect(() => {
    if (!adminSupabase || !supabaseUrl || !supabaseAnonKey) return
    const client = adminSupabase
    let cancelled = false
    const sessionInvalid = { current: false }
    const loadAudit = async () => {
      if (cancelled || sessionInvalid.current) return
      setAuditLoading(true)
      setAuditError('')
      const { response, expired } = await fetchAdminFunction('list-platform-audit?limit=150')
      if (!response) {
        setAuditLoading(false)
        if (expired) sessionInvalid.current = true
        setAuditError(
          expired
            ? 'Your admin session has expired. Sign in again.'
            : 'The audit service timed out or is temporarily unavailable. Try again.',
        )
        return
      }
      const payload = await response.json().catch(() => null)
      if (cancelled) return
      setAuditLoading(false)
      if (!response.ok) {
        setAuditError(payload?.message ?? payload ?? `Audit service returned ${response.status}.`)
        return
      }
      const normalized = ((payload?.entries ?? []) as Omit<AuditEntry, 'category' | 'severity'>[]).map((entry) => {
        const action = entry.action.toLowerCase()
        const category = entry.source.toLowerCase().includes('github')
          ? 'Code & delivery'
          : action.includes('login') || action.includes('auth') || action.includes('password')
            ? 'Authentication'
            : action.includes('broadcast') || action.includes('notification')
              ? 'Communications'
              : action.includes('role') || action.includes('admin') || action.includes('access')
                ? 'Access control'
                : 'Data activity'
        const severity: AuditEntry['severity'] =
          action.includes('delete') || action.includes('ban') || action.includes('failed') || action.includes('error')
            ? 'critical'
            : action.includes('update') || action.includes('change') || action.includes('invite')
              ? 'warning'
              : 'info'
        return { ...entry, category, severity }
      })
      setAuditEntries(normalized)
    }
    void loadAudit()
    const refresh = () => {
      if (!sessionInvalid.current && document.visibilityState === 'visible' && navigator.onLine) void loadAudit()
    }
    const channel = client
      .channel(`admin-audit-live-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_audit_logs' }, refresh)
      .subscribe((status) => setAuditLive(status === 'SUBSCRIBED'))
    const poll = window.setInterval(refresh, 20000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', refresh)
      void client.removeChannel(channel)
    }
  }, [auditRefreshToken])

  const filteredAudit = auditEntries.filter(
    (entry) =>
      (!auditCategory || auditCategory === 'all' || entry.category === auditCategory) &&
      (!auditSeverity || auditSeverity === 'all' || entry.severity === auditSeverity) &&
      (!auditSource || auditSource === 'all' || entry.source === auditSource) &&
      (!auditFrom || entry.createdAt.slice(0, 10) >= auditFrom) &&
      (!auditTo || entry.createdAt.slice(0, 10) <= auditTo),
  )
  const normalizeAction = (action: string) =>
    action.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const sevCount = (level: AuditEntry['severity']) => filteredAudit.filter((entry) => entry.severity === level).length
  const sourceCounts = Object.entries(
    filteredAudit.reduce<Record<string, number>>(
      (all, entry) => ({ ...all, [entry.category]: (all[entry.category] ?? 0) + 1 }),
      {},
    ),
  ).sort((a, b) => b[1] - a[1])
  // events per hour for the last 24 hours, newest on the right
  const now = Date.now()
  const perHour = Array.from({ length: 24 }, (_, index) => {
    const start = now - (24 - index) * 3_600_000
    return filteredAudit.filter((entry) => {
      const at = new Date(entry.createdAt).getTime()
      return at >= start && at < start + 3_600_000
    }).length
  })
  const peak = Math.max(1, ...perHour)
  const pct = (count: number) => (filteredAudit.length ? Math.round((count / filteredAudit.length) * 100) : 0)

  return (
    <>
      <HeaderActions>
        <button
          className="secondary"
          onClick={() => setAuditRefreshToken((value) => value + 1)}
          disabled={auditLoading}
        >
          <RefreshCw size={15} className={auditLoading ? 'spin' : ''} /> Refresh
        </button>
      </HeaderActions>
      <section className="admin-card wide us-toolbar au-bar">
        <span className="av-pill">
          <i className={`av-live${auditLive ? '' : ' w'}`} />
          {auditLive ? 'Live updates on' : 'Polling every 20s'}
        </span>
        <span className="au-count">
          {auditLoading ? 'Loading activity…' : `${filteredAudit.length} of ${auditEntries.length} events`}
        </span>
      </section>
      <div className="audit-filters au-filters">
        <label>
          Category
          <select value={auditCategory} onChange={(event) => setAuditCategory(event.target.value)}>
            <option value="all">All categories</option>
            {Array.from(new Set(auditEntries.map((entry) => entry.category))).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select value={auditSeverity} onChange={(event) => setAuditSeverity(event.target.value)}>
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Source
          <select value={auditSource} onChange={(event) => setAuditSource(event.target.value)}>
            <option value="all">All sources</option>
            {Array.from(new Set(auditEntries.map((entry) => entry.source))).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} />
        </label>
      </div>
      {!auditError && !auditLoading && filteredAudit.length > 0 && (
        <div className="au-summary">
          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <h2>Events per hour</h2>
                <p>Last 24 hours.</p>
              </div>
            </div>
            <div className="au-bars" role="img" aria-label="Events per hour over the last 24 hours">
              {perHour.map((count, index) => (
                <i
                  key={index}
                  style={{ height: `${Math.max(6, (count / peak) * 100)}%`, animationDelay: `${index * 18}ms` }}
                  title={`${count} event${count === 1 ? '' : 's'}`}
                />
              ))}
            </div>
          </section>
          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <h2>Severity</h2>
              </div>
            </div>
            <div className="au-sev">
              <DonutChart
                size={120}
                thickness={14}
                centerValue={String(filteredAudit.length)}
                centerLabel="events"
                slices={[
                  { label: 'Info', value: sevCount('info'), color: 'var(--chart-1)' },
                  { label: 'Warning', value: sevCount('warning'), color: 'var(--chart-3)' },
                  { label: 'Critical', value: sevCount('critical'), color: 'var(--chart-5)' },
                ]}
              />
              <ul className="ov-legend">
                <li>
                  Info <b>{pct(sevCount('info'))}%</b>
                </li>
                <li>
                  Warning <b>{pct(sevCount('warning'))}%</b>
                </li>
                <li>
                  Critical <b>{pct(sevCount('critical'))}%</b>
                </li>
              </ul>
            </div>
          </section>
          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <h2>Categories</h2>
              </div>
            </div>
            <HBars items={sourceCounts.slice(0, 5).map(([label, value]) => ({ label, value }))} />
          </section>
        </div>
      )}
      <section className="admin-card wide">
        {auditError ? (
          <div className="form-error" role="alert">
            {auditError}. Deploy list-platform-audit and refresh.
          </div>
        ) : auditLoading && !auditEntries.length ? (
          <div className="admin-table-skeleton">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="admin-skeleton-row">
                <Skeleton />
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        ) : !filteredAudit.length ? (
          <div className="admin-empty">No audit activity matches these filters.</div>
        ) : (
          <div className="table-wrap us-table au-table">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Source</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((entry) => (
                  <tr key={`${entry.source}-${entry.id}`}>
                    <td data-label="Time">{formatAdminValue('created_at', entry.createdAt)}</td>
                    <td data-label="Category">{entry.category}</td>
                    <td data-label="Severity">
                      <span className={`audit-severity ${entry.severity}`}>{entry.severity}</span>
                    </td>
                    <td data-label="Source">{entry.source}</td>
                    <td data-label="Event">
                      <strong>{normalizeAction(entry.action)}</strong>
                      <small className="adm-email">
                        {entry.actor ?? 'System'} · {entry.target}
                        {entry.organizationId ? ` · ${entry.organizationId}` : ''}
                      </small>
                      {Object.keys(entry.metadata ?? {}).length > 0 && (
                        <details className="audit-details">
                          <summary>Event details</summary>
                          <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
