import { useEffect, useState } from 'react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { fetchAdminFunction } from './api'
import { formatAdminValue } from './format'
import { type AdminRow } from './types'

export function AdminUsers() {
  const [userRows, setUserRows] = useState<AdminRow[]>([])
  const [userRowsLoading, setUserRowsLoading] = useState(false)
  const [userRowsError, setUserRowsError] = useState('')

  useEffect(() => {
    if (!adminSupabase) return
    setUserRowsLoading(true)
    setUserRowsError('')
    let cancelled = false
    const sessionInvalid = { current: false }
    const loadUsers = async () => {
      if (sessionInvalid.current) return
      const { response, expired } = await fetchAdminFunction('list-platform-users?page=1&pageSize=100')
      if (!response) {
        if (!cancelled) {
          setUserRowsLoading(false)
          if (expired) sessionInvalid.current = true
          setUserRowsError(expired ? 'Your admin session has expired. Sign in again.' : 'The admin user service timed out or is temporarily unavailable. Try again.')
        }
        return
      }
      const payload = await response.json().catch(() => null)
      if (cancelled) return
      setUserRowsLoading(false)
      if (!response.ok) {
        setUserRowsError(response.status === 401 ? 'Your admin session was rejected by Supabase. Sign out and sign in again.' : payload?.message ?? payload ?? `User service returned ${response.status}.`)
        return
      }
      setUserRows((payload?.users ?? []) as AdminRow[])
    }
    void loadUsers()
    return () => { cancelled = true }
  }, [])

  async function setPlatformUserStatus(userId: string, action: 'ban' | 'unban') {
    if (!adminSupabase || !window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this user account?`)) return
    setUserRowsError('')
    const { error } = await adminSupabase.functions.invoke('manage-platform-user', { body: { userId, action } })
    if (error) { setUserRowsError(error.message); return }
    setUserRows((current) => current.map((row) => row.id === userId ? { ...row, status: action === 'ban' ? 'banned' : 'active' } : row))
  }

  return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Users</h2><p>Platform accounts loaded through the protected Auth listing Edge Function.</p></div><span className="admin-pill success">Secure live view</span></div>{userRowsLoading ? <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : userRowsError ? <div className="form-error" role="alert">{userRowsError}. Deploy list-platform-users and manage-platform-user, then refresh.</div> : !userRows.length ? <div className="admin-empty">No users found.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Created</th><th>Last sign in</th><th>Access</th></tr></thead><tbody>{userRows.map((row) => <tr key={String(row.id)}><td>{String(row.name ?? '—')}</td><td>{String(row.email ?? '—')}</td><td>{String(row.phone ?? '—')}</td><td><span className={`admin-status ${row.status === 'active' ? 'active' : ''}`}>{String(row.status ?? '—')}</span></td><td>{formatAdminValue('created_at', row.created_at)}</td><td>{row.last_sign_in_at ? formatAdminValue('last_sign_in_at', row.last_sign_in_at) : 'Never'}</td><td>{row.status === 'banned' ? <button className="text-btn" onClick={() => void setPlatformUserStatus(String(row.id), 'unban')}>Unban</button> : <button className="text-btn danger-text" onClick={() => void setPlatformUserStatus(String(row.id), 'ban')}>Ban</button>}</td></tr>)}</tbody></table></div>}</section>
}
