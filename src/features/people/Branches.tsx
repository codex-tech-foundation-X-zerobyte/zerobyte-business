import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, PageIntro, TableSkeleton } from '../../components/ui'
import { supabase } from '../../lib/supabase'

export function Branches({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; name: string; code: string; address: string | null; status: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '' }); const [error, setError] = useState('')
  const load = useCallback(() => { supabase?.from('branches').select('id,name,code,address,status').eq('organization_id', orgId).order('created_at', { ascending: false }).then(({ data }) => { setRows(data ?? []); setLoading(false) }) }, [orgId])
  useEffect(() => { load() }, [load])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); const { error: result } = await supabase.from('branches').insert({ organization_id: orgId, ...form }); if (result) setError(result.code === '23505' ? 'That branch code is already in use.' : result.message); else { setForm({ name: '', code: '', address: '', phone: '' }); load() } }
  return <div className="page"><PageIntro label="Branches" title="Know where work happens." description="Create and manage the places your organization operates." /><form className="panel record-form three" onSubmit={add}><label>Branch name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ikeja store" /></label><label>Branch code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="IKE-01" /></label><label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street and city" /></label><label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><button className="primary"><Plus size={16} /> Add branch</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{loading ? <TableSkeleton /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Code</th><th>Address</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td className="mono">{row.code}</td><td>{row.address || '—'}</td><td><span className="status completed">{row.status}</span></td></tr>)}</tbody></table></div> : <EmptyInline title="No branches yet" text="Create the first branch for this organization above." />}</section></div>
}
