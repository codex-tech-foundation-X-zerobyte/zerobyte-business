import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'

type RoadmapItem = { id: string; title: string; description: string; priority: string; target_release: string | null; status: string; created_at: string }
const STATUSES = ['idea', 'planned', 'in_progress', 'beta', 'released', 'deferred']

export function AdminRoadmap() {
  const [rows, setRows] = useState<RoadmapItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', target_release: '' })
  const [busyId, setBusyId] = useState('')

  const load = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true); setError('')
    adminSupabase.from('roadmap_items').select('id,title,description,priority,target_release,status,created_at').order('created_at', { ascending: false }).then(({ data, error: result }) => {
      setLoading(false)
      if (result) setError(result.message)
      else setRows(data ?? [])
    })
  }, [])
  useEffect(() => { load() }, [load])

  async function addItem(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase || !form.title.trim()) return
    const userId = (await adminSupabase.auth.getUser()).data.user?.id
    const { error: result } = await adminSupabase.from('roadmap_items').insert({ title: form.title.trim(), description: form.description.trim(), priority: form.priority, target_release: form.target_release || null, owner_id: userId })
    if (result) setError(result.message)
    else { setForm({ title: '', description: '', priority: 'normal', target_release: '' }); load() }
  }
  async function setStatus(id: string, status: string) {
    if (!adminSupabase) return
    setBusyId(id)
    const { error: result } = await adminSupabase.from('roadmap_items').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (result) setError(result.message)
    else load()
    setBusyId('')
  }

  return <><section className="admin-card wide"><div className="admin-card-header"><div><h2>New roadmap item</h2><p>Internal only — there is no public roadmap page yet.</p></div></div><form className="admin-form" onSubmit={addItem}><label>Title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label>Target release (optional)<input value={form.target_release} onChange={(event) => setForm({ ...form, target_release: event.target.value })} placeholder="e.g. Q1 2027" /></label><label className="form-wide">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><button className="primary" type="submit">Add item</button></form></section><section className="admin-card wide"><div className="admin-card-header"><div><h2>Roadmap</h2><p>{rows.length} item{rows.length === 1 ? '' : 's'}.</p></div><button type="button" className="text-btn" onClick={load}><RefreshCw size={14} /> Refresh</button></div>{error && <div className="form-error" role="alert">{error}</div>}{loading ? <div className="admin-table-skeleton">{[1, 2, 3].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !rows.length ? <div className="admin-empty">No roadmap items yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Title</th><th>Priority</th><th>Target</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong>{row.description && <p className="table-sub">{row.description}</p>}</td><td>{row.priority}</td><td>{row.target_release || '—'}</td><td><select value={row.status} disabled={busyId === row.id} onChange={(event) => void setStatus(row.id, event.target.value)}>{STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></td></tr>)}</tbody></table></div>}</section></>
}
