import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { formatAdminValue } from './format'

type AdminAccountRow = { id: string; user_id: string; full_name: string; email: string; role: string; status: string; granted_by_name: string | null; granted_at: string }
const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super admin', note: 'Full access, including granting other admins.' },
  { value: 'PLATFORM_ADMIN', label: 'Platform admin', note: 'General operations: businesses, branches, inventory, sales.' },
  { value: 'FINANCE_ADMIN', label: 'Finance admin', note: 'Revenue, plans & pricing, subscriptions.' },
  { value: 'SUPPORT_ADMIN', label: 'Support admin (customer care)', note: 'Messages, feedback — no financial data.' },
  { value: 'MODERATION_ADMIN', label: 'Moderation admin', note: 'Audit log, promoters, roadmap — no financial data.' },
]

export function AdminAccounts() {
  const [rows, setRows] = useState<AdminAccountRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [form, setForm] = useState({ email: '', role: 'PLATFORM_ADMIN' })
  const [formBusy, setFormBusy] = useState(false)

  const load = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true); setError('')
    adminSupabase.rpc('admin_list_admin_accounts').then(({ data, error: result }) => {
      setLoading(false)
      if (result) setError(result.code === 'PGRST202' ? 'Admin roles are not set up yet. Apply the latest Supabase migrations, then refresh.' : result.message)
      else setRows((data ?? []) as AdminAccountRow[])
    })
  }, [])
  useEffect(() => { load() }, [load])

  async function grantAccess(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase || !form.email.trim()) return
    setFormBusy(true); setError('')
    const { error: result } = await adminSupabase.rpc('admin_grant_admin_access', { target_email: form.email.trim(), new_role: form.role })
    setFormBusy(false)
    if (result) setError(result.message)
    else { setForm({ email: '', role: 'PLATFORM_ADMIN' }); load() }
  }
  async function setStatus(id: string, status: string) {
    if (!adminSupabase) return
    if (status !== 'active' && !window.confirm(`Change this admin's access to "${status}"?`)) return
    setBusyId(id)
    const { error: result } = await adminSupabase.rpc('admin_set_admin_access_status', { target_id: id, new_status: status })
    if (result) setError(result.message)
    else load()
    setBusyId('')
  }

  return <>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Grant admin access</h2><p>Only super admins can do this. The person must already have a Zerøbyte account — this doesn't create one.</p></div></div><form className="admin-form" onSubmit={grantAccess}><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="person@example.com" /></label><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label><button className="primary" type="submit" disabled={formBusy}>{formBusy ? 'Granting…' : 'Grant access'}</button></form><p className="field-help">{ROLES.find((role) => role.value === form.role)?.note}</p></section>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Admin accounts</h2><p>{rows.length} account{rows.length === 1 ? '' : 's'} with platform access.</p></div><button type="button" className="text-btn" onClick={load}><RefreshCw size={14} /> Refresh</button></div>{error && <div className="form-error" role="alert">{error}</div>}{loading ? <div className="admin-table-skeleton">{[1, 2, 3].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !rows.length ? <div className="admin-empty">No admin accounts yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Granted by</th><th>Granted</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.full_name}</td><td>{row.email}</td><td>{ROLES.find((role) => role.value === row.role)?.label ?? row.role}</td><td><span className={`admin-status ${row.status === 'active' ? 'active' : 'failed'}`}>{row.status}</span></td><td>{row.granted_by_name ?? '—'}</td><td>{formatAdminValue('created_at', row.granted_at)}</td><td>{row.status === 'active' ? <button className="text-btn danger-text" disabled={busyId === row.id} onClick={() => void setStatus(row.id, 'revoked')}>Revoke</button> : <button className="text-btn" disabled={busyId === row.id} onClick={() => void setStatus(row.id, 'active')}>Reactivate</button>}</td></tr>)}</tbody></table></div>}</section>
  </>
}
