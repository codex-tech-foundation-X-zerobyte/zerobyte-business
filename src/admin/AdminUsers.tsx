import { useEffect, useState } from 'react'
import { MessageCircle, Search } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { toWhatsAppNumber, whatsappUrl } from '../lib/whatsapp'
import { fetchAdminFunction } from './api'
import { formatAdminValue } from './format'
import { type AdminRow } from './types'

export function AdminUsers() {
  const [userRows, setUserRows] = useState<AdminRow[]>([])
  const [userRowsLoading, setUserRowsLoading] = useState(false)
  const [userRowsError, setUserRowsError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [recovery, setRecovery] = useState<{ name: string; email: string; phone: string | null; link: string; message: string } | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState('')

  useEffect(() => {
    if (!adminSupabase) return
    setUserRowsLoading(true)
    setUserRowsError('')
    let cancelled = false
    const sessionInvalid = { current: false }
    const loadUsers = async () => {
      if (sessionInvalid.current) return
      const { response, expired } = await fetchAdminFunction(`list-platform-users?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`)
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
  }, [search])

  async function setPlatformUserStatus(userId: string, action: 'ban' | 'unban') {
    if (!adminSupabase || !window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this user account?`)) return
    setUserRowsError('')
    const { error } = await adminSupabase.functions.invoke('manage-platform-user', { body: { userId, action } })
    if (error) { setUserRowsError(error.message); return }
    setUserRows((current) => current.map((row) => row.id === userId ? { ...row, status: action === 'ban' ? 'banned' : 'active' } : row))
  }

  async function generateRecoveryLink(userId: string) {
    setUserRowsError(''); setRecoveryBusy(userId); setRecovery(null)
    try {
      const { response, expired, error: failure, timedOut } = await fetchAdminFunction('generate-user-recovery-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
      if (expired) { setUserRowsError('Your admin session expired. Sign in again.'); return }
      if (!response) { setUserRowsError(timedOut ? 'The request timed out. Try again.' : (failure ?? 'Could not reach the server.')); return }
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.link) { setUserRowsError(payload?.error ?? 'Could not create a recovery link.'); return }
      const first = String(payload.name).trim().split(/\s+/)[0]
      setRecovery({ name: payload.name, email: payload.email, phone: payload.phone, link: payload.link, message: `Hello ${first}, here is your Zerøbyte password-reset link. It works once and expires soon, so open it on your phone now and choose a new password:\n${payload.link}\n\nIf you did not ask for this, ignore this message.` })
    } finally {
      setRecoveryBusy('')
    }
  }

  return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Users</h2><p>Platform accounts loaded through the protected Auth listing Edge Function.</p></div><span className="admin-pill success">Secure live view</span></div><form className="admin-search-row" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()) }}><input type="search" aria-label="Search users" placeholder="Search by name, email or phone" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit" className="secondary"><Search size={14} /> Search</button>{search && <button type="button" className="text-btn" onClick={() => { setSearchInput(''); setSearch('') }}>Clear</button>}</form>{recovery && <div className="promoter-access-card"><h3>Recovery link for {recovery.name}</h3><p className="muted">{recovery.email}. Send this on WhatsApp. It signs the person in once so they can choose a new password: treat it like a password.</p><textarea readOnly rows={6} value={recovery.message} onFocus={(event) => event.currentTarget.select()} /><div className="promoter-share-row">{toWhatsAppNumber(recovery.phone) ? <a className="primary promoter-share-button" href={whatsappUrl(recovery.message, recovery.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Open WhatsApp with this message</a> : <span className="form-error">No phone number on file. Copy the message and send it another way.</span>}<button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(recovery.message)}>Copy message</button><button type="button" className="text-btn" onClick={() => setRecovery(null)}>Close</button></div></div>}{userRowsLoading ? <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : userRowsError ? <div className="form-error" role="alert">{userRowsError}. Deploy list-platform-users and manage-platform-user, then refresh.</div> : !userRows.length ? <div className="admin-empty">No users found.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Created</th><th>Last sign in</th><th>Access</th></tr></thead><tbody>{userRows.map((row) => <tr key={String(row.id)}><td>{String(row.name ?? '—')}</td><td>{String(row.email ?? '—')}</td><td>{String(row.phone ?? '—')}</td><td><span className={`admin-status ${row.status === 'active' ? 'active' : ''}`}>{String(row.status ?? '—')}</span></td><td>{formatAdminValue('created_at', row.created_at)}</td><td>{row.last_sign_in_at ? formatAdminValue('last_sign_in_at', row.last_sign_in_at) : 'Never'}</td><td><button className="text-btn" disabled={recoveryBusy === String(row.id)} onClick={() => void generateRecoveryLink(String(row.id))}>Reset link</button>{row.status === 'banned' ? <button className="text-btn" onClick={() => void setPlatformUserStatus(String(row.id), 'unban')}>Unban</button> : <button className="text-btn danger-text" onClick={() => void setPlatformUserStatus(String(row.id), 'ban')}>Ban</button>}</td></tr>)}</tbody></table></div>}</section>
}
