import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { formatAdminValue } from './format'
import { HeaderActions } from './HeaderActions'

type FeedbackRow = {
  id: string
  organization_name: string
  user_email: string | null
  category: string
  severity: string
  message: string
  status: string
  admin_response: string | null
  created_at: string
}

export function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [responseDraft, setResponseDraft] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true)
    setError('')
    adminSupabase.rpc('admin_list_feedback').then(({ data, error: result }) => {
      setLoading(false)
      if (result)
        setError(
          result.code === 'PGRST202'
            ? 'Feedback is not set up yet. Apply the latest Supabase migrations, then refresh.'
            : result.message,
        )
      else setRows((data ?? []) as FeedbackRow[])
    })
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function updateStatus(id: string, status: string) {
    if (!adminSupabase) return
    setBusyId(id)
    const { error: result } = await adminSupabase.rpc('admin_update_feedback', {
      target_feedback: id,
      new_status: status,
      response: responseDraft[id] || null,
    })
    if (result) setError(result.message)
    else load()
    setBusyId('')
  }

  const visible = rows.filter((row) => statusFilter === 'all' || row.status === statusFilter)
  const STATUSES = ['new', 'reviewing', 'planned', 'resolved', 'declined']
  const tone = (status: string) =>
    status === 'new'
      ? 'info'
      : status === 'reviewing' || status === 'planned'
        ? 'warn'
        : status === 'declined'
          ? 'bad'
          : 'quiet'
  return (
    <>
      <HeaderActions>
        <button type="button" className="secondary" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} /> Refresh
        </button>
      </HeaderActions>
      <section className="admin-card wide us-toolbar fb-tabs">
        <div className="ov-tabs" role="tablist" aria-label="Feedback status">
          {[
            ['all', 'All statuses'],
            ...STATUSES.map((status) => [status, status[0].toUpperCase() + status.slice(1)]),
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={statusFilter === key}
              className={statusFilter === key ? 'on' : ''}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {loading && !rows.length ? (
        <div className="fb-grid">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="admin-card fb-card">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ))}
        </div>
      ) : !visible.length ? (
        <section className="admin-card wide">
          <div className="admin-empty">No feedback matches this filter.</div>
        </section>
      ) : (
        <div className="fb-grid">
          {visible.map((row) => (
            <article key={row.id} className="admin-card fb-card">
              <div className="fb-head">
                <strong>{row.category.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())}</strong>
                <span className={`fb-status ${tone(row.status)}`}>
                  {row.status[0].toUpperCase() + row.status.slice(1)}
                </span>
              </div>
              <small className="fb-meta">
                <span className={row.severity === 'critical' || row.severity === 'high' ? 'sev-high' : ''}>
                  Severity {row.severity}
                </span>{' '}
                · {row.organization_name} · {row.user_email ?? 'Unknown'} ·{' '}
                {formatAdminValue('created_at', row.created_at)}
              </small>
              <p className="fb-message">{row.message}</p>
              {row.admin_response && <p className="field-help">Previous response: {row.admin_response}</p>}
              <label className="fb-field">
                Response
                <input
                  placeholder="Response (optional)"
                  value={responseDraft[row.id] ?? ''}
                  onChange={(event) => setResponseDraft((current) => ({ ...current, [row.id]: event.target.value }))}
                />
              </label>
              <div className="fb-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busyId === row.id || !(responseDraft[row.id] ?? '').trim()}
                  onClick={() => void updateStatus(row.id, row.status)}
                >
                  Save response
                </button>
                <select
                  aria-label="Status"
                  value={row.status}
                  disabled={busyId === row.id}
                  onChange={(event) => void updateStatus(row.id, event.target.value)}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status[0].toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
