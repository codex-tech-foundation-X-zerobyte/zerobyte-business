import { useEffect, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase'
import { fetchAdminFunction } from './api'
import { formatAdminValue } from './format'
import { type AuditEntry } from './types'

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
      setAuditLoading(true); setAuditError('')
      const { response, expired } = await fetchAdminFunction('list-platform-audit?limit=150')
      if (!response) {
        setAuditLoading(false)
        if (expired) sessionInvalid.current = true
        setAuditError(expired ? 'Your admin session has expired. Sign in again.' : 'The audit service timed out or is temporarily unavailable. Try again.')
        return
      }
      const payload = await response.json().catch(() => null)
      if (cancelled) return
      setAuditLoading(false)
      if (!response.ok) { setAuditError(payload?.message ?? payload ?? `Audit service returned ${response.status}.`); return }
      const normalized = ((payload?.entries ?? []) as Omit<AuditEntry, 'category' | 'severity'>[]).map((entry) => {
        const action = entry.action.toLowerCase()
        const category = entry.source.toLowerCase().includes('github') ? 'Code & delivery' : action.includes('login') || action.includes('auth') || action.includes('password') ? 'Authentication' : action.includes('broadcast') || action.includes('notification') ? 'Communications' : action.includes('role') || action.includes('admin') || action.includes('access') ? 'Access control' : 'Data activity'
        const severity: AuditEntry['severity'] = action.includes('delete') || action.includes('ban') || action.includes('failed') || action.includes('error') ? 'critical' : action.includes('update') || action.includes('change') || action.includes('invite') ? 'warning' : 'info'
        return { ...entry, category, severity }
      })
      setAuditEntries(normalized)
    }
    void loadAudit()
    const refresh = () => { if (!sessionInvalid.current && document.visibilityState === 'visible' && navigator.onLine) void loadAudit() }
    const channel = client.channel(`admin-audit-live-${Date.now()}`)
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

  const filteredAudit = auditEntries.filter((entry) => (!auditCategory || auditCategory === 'all' || entry.category === auditCategory) && (!auditSeverity || auditSeverity === 'all' || entry.severity === auditSeverity) && (!auditSource || auditSource === 'all' || entry.source === auditSource) && (!auditFrom || entry.createdAt.slice(0, 10) >= auditFrom) && (!auditTo || entry.createdAt.slice(0, 10) <= auditTo))
  const normalizeAction = (action: string) => action.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Security &amp; audit center</h2><p>Normalized, organization-aware activity from platform controls, business records, and configured integrations.</p></div><div className="admin-actions-inline"><span className="admin-pill success">{auditLoading ? 'Loading activity' : `${filteredAudit.length} of ${auditEntries.length} events`}</span><span className="admin-live-indicator">{auditLive ? 'Live updates on' : 'Polling every 20s'}</span><button className="secondary" onClick={() => setAuditRefreshToken((value) => value + 1)} disabled={auditLoading}><RefreshCw size={14} className={auditLoading ? 'spin' : ''} />Refresh</button></div></div><div className="audit-filters"><label>Category<select value={auditCategory} onChange={(event) => setAuditCategory(event.target.value)}><option value="all">All categories</option>{Array.from(new Set(auditEntries.map((entry) => entry.category))).map((value) => <option key={value}>{value}</option>)}</select></label><label>Severity<select value={auditSeverity} onChange={(event) => setAuditSeverity(event.target.value)}><option value="all">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label>Source<select value={auditSource} onChange={(event) => setAuditSource(event.target.value)}><option value="all">All sources</option>{Array.from(new Set(auditEntries.map((entry) => entry.source))).map((value) => <option key={value}>{value}</option>)}</select></label><label>From<input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} /></label><label>To<input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} /></label></div>{auditError ? <div className="form-error" role="alert">{auditError}. Deploy list-platform-audit and refresh.</div> : auditLoading ? <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !filteredAudit.length ? <div className="admin-empty">No audit activity matches these filters.</div> : <div className="audit-timeline">{filteredAudit.map((entry) => <article className="audit-event" key={`${entry.source}-${entry.id}`}><div className="audit-event-marker"><History size={15} /></div><div className="audit-event-body"><div className="audit-event-meta"><span className={`audit-source ${entry.source.toLowerCase().replace(/\s+/g, '-')}`}>{entry.source}</span><span className={`audit-severity ${entry.severity}`}>{entry.severity}</span><time>{formatAdminValue('created_at', entry.createdAt)}</time></div><h3>{normalizeAction(entry.action)}</h3><p>{entry.category} · {entry.target}{entry.organizationId ? ` · ${entry.organizationId}` : ''}</p><small>{entry.actor ?? 'System'}</small>{Object.keys(entry.metadata ?? {}).length > 0 && <details className="audit-details"><summary>Event details</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details>}</div></article>)}</div>}</section>
}
