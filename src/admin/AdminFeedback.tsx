import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { formatAdminValue } from './format'

type FeedbackRow = { id: string; organization_name: string; user_email: string | null; category: string; severity: string; message: string; status: string; admin_response: string | null; created_at: string }

export function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [responseDraft, setResponseDraft] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true); setError('')
    adminSupabase.rpc('admin_list_feedback').then(({ data, error: result }) => {
      setLoading(false)
      if (result) setError(result.code === 'PGRST202' ? 'Feedback is not set up yet. Apply the latest Supabase migrations, then refresh.' : result.message)
      else setRows((data ?? []) as FeedbackRow[])
    })
  }, [])
  useEffect(() => { load() }, [load])

  async function updateStatus(id: string, status: string) {
    if (!adminSupabase) return
    setBusyId(id)
    const { error: result } = await adminSupabase.rpc('admin_update_feedback', { target_feedback: id, new_status: status, response: responseDraft[id] || null })
    if (result) setError(result.message)
    else load()
    setBusyId('')
  }

  const visible = rows.filter((row) => statusFilter === 'all' || row.status === statusFilter)
  return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Customer feedback</h2><p>Reports and requests submitted from Settings → Feedback across every workspace.</p></div><div className="admin-actions-inline"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="resolved">Resolved</option><option value="declined">Declined</option></select><button type="button" className="text-btn" onClick={load}><RefreshCw size={14} /> Refresh</button></div></div>{error && <div className="form-error" role="alert">{error}</div>}{loading ? <div className="admin-table-skeleton">{[1, 2, 3].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !visible.length ? <div className="admin-empty">No feedback matches this filter.</div> : <div className="promoter-application-list">{visible.map((row) => <div key={row.id} className="promoter-application-card"><div><strong>{row.category.replace(/_/g, ' ')} · <span className={`admin-status ${row.severity === 'critical' || row.severity === 'high' ? 'failed' : ''}`}>{row.severity}</span></strong><small className="table-sub">{row.organization_name} · {row.user_email ?? 'Unknown'} · {formatAdminValue('created_at', row.created_at)}</small><p className="muted">{row.message}</p>{row.admin_response && <p className="field-help">Previous response: {row.admin_response}</p>}</div><div className="promoter-application-actions"><input placeholder="Response (optional)" value={responseDraft[row.id] ?? ''} onChange={(event) => setResponseDraft((current) => ({ ...current, [row.id]: event.target.value }))} /><select value={row.status} disabled={busyId === row.id} onChange={(event) => void updateStatus(row.id, event.target.value)}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="resolved">Resolved</option><option value="declined">Declined</option></select></div></div>)}</div>}</section>
}
