import { useEffect, useState } from 'react'
import { MessageCircle, Search } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { Download } from 'lucide-react'
import { HeaderActions } from './HeaderActions'
import { adminSupabase } from '../lib/supabase'
import { toWhatsAppNumber, whatsappUrl } from '../lib/whatsapp'
import { fetchAdminFunction } from './api'
import { type AdminRow } from './types'

const shortDate = (value: unknown, withTime = false) =>
  value
    ? new Date(String(value)).toLocaleString(
        'en-NG',
        withTime
          ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
          : { day: 'numeric', month: 'short', year: 'numeric' },
      )
    : '—'

export function AdminUsers() {
  const [userRows, setUserRows] = useState<AdminRow[]>([])
  const [userRowsLoading, setUserRowsLoading] = useState(false)
  const [userRowsError, setUserRowsError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [recovery, setRecovery] = useState<{
    name: string
    email: string
    phone: string | null
    link: string
    message: string
  } | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'banned'>('all')

  useEffect(() => {
    if (!adminSupabase) return
    setUserRowsLoading(true)
    setUserRowsError('')
    let cancelled = false
    const sessionInvalid = { current: false }
    const loadUsers = async () => {
      if (sessionInvalid.current) return
      const { response, expired } = await fetchAdminFunction(
        `list-platform-users?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      )
      if (!response) {
        if (!cancelled) {
          setUserRowsLoading(false)
          if (expired) sessionInvalid.current = true
          setUserRowsError(
            expired
              ? 'Your admin session has expired. Sign in again.'
              : 'The admin user service timed out or is temporarily unavailable. Try again.',
          )
        }
        return
      }
      const payload = await response.json().catch(() => null)
      if (cancelled) return
      setUserRowsLoading(false)
      if (!response.ok) {
        setUserRowsError(
          response.status === 401
            ? 'Your admin session was rejected by Supabase. Sign out and sign in again.'
            : (payload?.message ?? payload ?? `User service returned ${response.status}.`),
        )
        return
      }
      setUserRows((payload?.users ?? []) as AdminRow[])
    }
    void loadUsers()
    return () => {
      cancelled = true
    }
  }, [search])

  async function setPlatformUserStatus(userId: string, action: 'ban' | 'unban') {
    if (!adminSupabase || !window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this user account?`)) return
    setUserRowsError('')
    const { error } = await adminSupabase.functions.invoke('manage-platform-user', { body: { userId, action } })
    if (error) {
      setUserRowsError(error.message)
      return
    }
    setUserRows((current) =>
      current.map((row) => (row.id === userId ? { ...row, status: action === 'ban' ? 'banned' : 'active' } : row)),
    )
  }

  async function generateRecoveryLink(userId: string) {
    setUserRowsError('')
    setRecoveryBusy(userId)
    setRecovery(null)
    try {
      const {
        response,
        expired,
        error: failure,
        timedOut,
      } = await fetchAdminFunction('generate-user-recovery-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (expired) {
        setUserRowsError('Your admin session expired. Sign in again.')
        return
      }
      if (!response) {
        setUserRowsError(timedOut ? 'The request timed out. Try again.' : (failure ?? 'Could not reach the server.'))
        return
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.link) {
        setUserRowsError(payload?.error ?? 'Could not create a recovery link.')
        return
      }
      const first = String(payload.name).trim().split(/\s+/)[0]
      setRecovery({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        link: payload.link,
        message: `Hello ${first}, here is your Zerøbyte password-reset link. It works once and expires soon, so open it on your phone now and choose a new password:\n${payload.link}\n\nIf you did not ask for this, ignore this message.`,
      })
    } finally {
      setRecoveryBusy('')
    }
  }

  const shownRows = userRows.filter((row) => filter === 'all' || String(row.status) === filter)
  const countOf = (status: string) => userRows.filter((row) => String(row.status) === status).length

  function exportUsers() {
    const header = ['Name', 'Email', 'Phone', 'Status', 'Created', 'Last sign-in']
    const lines = shownRows.map((row) =>
      [row.name, row.email, row.phone, row.status, row.created_at, row.last_sign_in_at]
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(','),
    )
    const url = URL.createObjectURL(new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `zerobyte-users-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <HeaderActions>
        <button type="button" className="secondary" disabled={!shownRows.length} onClick={exportUsers}>
          <Download size={16} aria-hidden="true" /> Export
        </button>
      </HeaderActions>
      <section className="admin-card wide us-toolbar">
        <form
          className="us-search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(searchInput.trim())
          }}
        >
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search users"
            placeholder="Search by name, email or phone"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setSearchInput('')
                setSearch('')
              }}
            >
              Clear
            </button>
          )}
        </form>
        <div className="ov-tabs" role="tablist" aria-label="Filter users">
          {(
            [
              ['all', 'All', userRows.length],
              ['active', 'Active', countOf('active')],
              ['banned', 'Banned', countOf('banned')],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'on' : ''}
              onClick={() => setFilter(key)}
            >
              {label} <span className="us-count">{count}</span>
            </button>
          ))}
        </div>
      </section>
      {recovery && (
        <section className="admin-card promoter-access-card us-recovery">
          <h3>Recovery link for {recovery.name}</h3>
          <p className="muted">
            {recovery.email}. Send this on WhatsApp. It signs the person in once so they can choose a new password:
            treat it like a password.
          </p>
          <textarea readOnly rows={6} value={recovery.message} onFocus={(event) => event.currentTarget.select()} />
          <div className="promoter-share-row">
            {toWhatsAppNumber(recovery.phone) ? (
              <a
                className="primary promoter-share-button"
                href={whatsappUrl(recovery.message, recovery.phone)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={16} /> Open WhatsApp with this message
              </a>
            ) : (
              <span className="form-error">No phone number on file. Copy the message and send it another way.</span>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => void navigator.clipboard?.writeText(recovery.message)}
            >
              Copy message
            </button>
            <button type="button" className="text-btn" onClick={() => setRecovery(null)}>
              Close
            </button>
          </div>
        </section>
      )}
      <section className="admin-card wide">
        {userRowsLoading ? (
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
        ) : userRowsError ? (
          <div className="form-error" role="alert">
            {userRowsError}. Deploy list-platform-users and manage-platform-user, then refresh.
          </div>
        ) : !shownRows.length ? (
          <div className="admin-empty">{userRows.length ? 'No users match this filter.' : 'No users found.'}</div>
        ) : (
          <div className="table-wrap us-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shownRows.map((row) => {
                  const status = String(row.status ?? '—')
                  const last = row.last_sign_in_at ? new Date(String(row.last_sign_in_at)) : null
                  const days = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null
                  return (
                    <tr key={String(row.id)}>
                      <td data-label="Name">
                        <span className="us-name">
                          <span className="us-avatar" aria-hidden="true">
                            {(String(row.name ?? '') || String(row.email ?? '?')).trim().slice(0, 2).toUpperCase()}
                          </span>
                          <strong>{String(row.name ?? '') || 'No name'}</strong>
                        </span>
                      </td>
                      <td data-label="Email">{String(row.email ?? '—')}</td>
                      <td data-label="Phone">{row.phone ? String(row.phone) : '—'}</td>
                      <td data-label="Status">
                        <span
                          className={`ap-chip ${status === 'active' ? 'good' : status === 'banned' ? 'bad' : 'quiet'}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td data-label="Created">{shortDate(row.created_at)}</td>
                      <td data-label="Last sign-in">
                        {last ? (days === 0 ? 'Today' : shortDate(row.last_sign_in_at, true)) : 'Never'}
                      </td>
                      <td className="us-actions">
                        <button
                          className="secondary"
                          disabled={recoveryBusy === String(row.id)}
                          onClick={() => void generateRecoveryLink(String(row.id))}
                        >
                          Reset link
                        </button>
                        {row.status === 'banned' ? (
                          <button
                            className="secondary"
                            onClick={() => void setPlatformUserStatus(String(row.id), 'unban')}
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            className="secondary danger-text"
                            onClick={() => void setPlatformUserStatus(String(row.id), 'ban')}
                          >
                            Ban
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
