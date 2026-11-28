import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { HeaderActions } from './HeaderActions'

type RoadmapItem = {
  id: string
  title: string
  description: string
  priority: string
  target_release: string | null
  status: string
  created_at: string
}
const STATUSES = ['idea', 'planned', 'in_progress', 'beta', 'released', 'deferred']

export function AdminRoadmap() {
  const [rows, setRows] = useState<RoadmapItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', target_release: '' })
  const [busyId, setBusyId] = useState('')

  const load = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true)
    setError('')
    adminSupabase
      .from('roadmap_items')
      .select('id,title,description,priority,target_release,status,created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: result }) => {
        setLoading(false)
        if (result) setError(result.message)
        else setRows(data ?? [])
      })
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function addItem(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase || !form.title.trim()) return
    const userId = (await adminSupabase.auth.getUser()).data.user?.id
    const { error: result } = await adminSupabase.from('roadmap_items').insert({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      target_release: form.target_release || null,
      owner_id: userId,
    })
    if (result) setError(result.message)
    else {
      setForm({ title: '', description: '', priority: 'normal', target_release: '' })
      load()
    }
  }
  async function setStatus(id: string, status: string) {
    if (!adminSupabase) return
    setBusyId(id)
    const { error: result } = await adminSupabase
      .from('roadmap_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (result) setError(result.message)
    else load()
    setBusyId('')
  }

  const COLUMNS: { status: string; label: string; always?: boolean }[] = [
    { status: 'idea', label: 'Ideas' },
    { status: 'planned', label: 'Planned', always: true },
    { status: 'in_progress', label: 'In progress', always: true },
    { status: 'beta', label: 'Beta' },
    { status: 'released', label: 'Shipped', always: true },
    { status: 'deferred', label: 'Deferred' },
  ]
  const columns = COLUMNS.filter((column) => column.always || rows.some((row) => row.status === column.status))

  return (
    <>
      <HeaderActions>
        <button type="button" className="secondary" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} /> Refresh
        </button>
      </HeaderActions>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="rm-board">
        <section className="admin-card rm-new">
          <div className="admin-card-header">
            <div>
              <h2>New roadmap item</h2>
              <p>Internal only: there is no public roadmap page yet.</p>
            </div>
          </div>
          <form className="admin-form" onSubmit={addItem}>
            <label>
              Title
              <input
                required
                placeholder="Item title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Priority
              <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Target release (optional)
              <input
                value={form.target_release}
                onChange={(event) => setForm({ ...form, target_release: event.target.value })}
                placeholder="e.g. Q1 2027"
              />
            </label>
            <label className="form-wide">
              Description
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <button className="primary" type="submit">
              Add item
            </button>
          </form>
        </section>
        {loading && !rows.length
          ? [1, 2, 3].map((item) => (
              <section key={item} className="admin-card rm-col">
                <Skeleton />
                <Skeleton />
              </section>
            ))
          : columns.map((column) => {
              const items = rows.filter((row) => row.status === column.status)
              return (
                <section key={column.status} className="admin-card rm-col">
                  <header>
                    <h3>{column.label}</h3>
                    <span className="rm-count">{items.length}</span>
                  </header>
                  {!items.length && <p className="rm-empty">Nothing here yet.</p>}
                  {items.map((row) => (
                    <article key={row.id} className="rm-item">
                      <strong>{row.title}</strong>
                      {row.description && <p>{row.description}</p>}
                      <div className="rm-meta">
                        <span>{row.target_release || 'No target'}</span>
                        <span className={`rm-prio ${row.priority}`}>
                          {row.priority[0].toUpperCase() + row.priority.slice(1)}
                        </span>
                      </div>
                      <select
                        aria-label={`Move ${row.title}`}
                        value={row.status}
                        disabled={busyId === row.id}
                        onChange={(event) => void setStatus(row.id, event.target.value)}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status === 'released'
                              ? 'Shipped'
                              : status.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))}
                </section>
              )
            })}
      </div>
    </>
  )
}
