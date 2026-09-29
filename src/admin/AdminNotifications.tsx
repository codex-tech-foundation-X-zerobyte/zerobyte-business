import { useEffect, useState } from 'react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { formatAdminValue } from './format'
import { type AdminRow } from './types'

export function AdminNotifications() {
  const [rows, setRows] = useState<AdminRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsError, setRowsError] = useState('')
  const [notificationTitle, setNotificationTitle] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationAudience, setNotificationAudience] = useState('all_users')
  const [audiencePlans, setAudiencePlans] = useState<{ code: string; name: string }[]>([])
  const [version, setVersion] = useState('')
  const [versionMessage, setVersionMessage] = useState('')
  const [versionHistory, setVersionHistory] = useState<{ id: string; version: string; message: string; created_at: string }[]>([])
  const [notificationStatus, setNotificationStatus] = useState('')
  const [notificationBusy, setNotificationBusy] = useState(false)

  const loadHistory = () => {
    if (!adminSupabase) return
    setRowsLoading(true)
    adminSupabase.from('admin_notifications').select('id,title,message,status,created_at,sent_at,category,audience').order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        setRowsLoading(false)
        if (error) setRowsError(error.message)
        else setRows((data ?? []) as unknown as AdminRow[])
      })
    adminSupabase.from('app_version_announcements').select('id,version,message,created_at').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setVersionHistory((data ?? []) as typeof versionHistory))
  }
  useEffect(loadHistory, [])
  useEffect(() => { if (adminSupabase) adminSupabase.rpc('get_plan_catalog').then(({ data }) => setAudiencePlans(((data ?? []) as { code: string; name: string }[]).filter((plan) => plan.code !== 'free'))) }, [])

  const sendNotification = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!adminSupabase || !notificationTitle.trim() || !notificationMessage.trim()) return
    setNotificationBusy(true); setNotificationStatus('Sending…')
    const { error } = await adminSupabase.rpc('send_platform_broadcast', {
      notification_title: notificationTitle.trim(),
      notification_message: notificationMessage.trim(),
      target_audience: notificationAudience,
    })
    if (error) {
      setNotificationBusy(false)
      setNotificationStatus(error.message)
      return
    }
    setNotificationTitle('')
    setNotificationMessage('')
    setNotificationStatus('Broadcast delivered to recipient notification centers and recorded in the audit log.')
    setNotificationBusy(false)
    loadHistory()
  }
  const publishVersion = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!adminSupabase || !version.trim() || !versionMessage.trim()) return
    setNotificationBusy(true); setNotificationStatus('Publishing version announcement…')
    const { error } = await adminSupabase.rpc('publish_version_announcement', { announcement_version: version.trim(), announcement_message: versionMessage.trim() })
    if (error) { setNotificationBusy(false); setNotificationStatus(error.message); return }
    setVersion(''); setVersionMessage(''); setNotificationStatus('Version announcement delivered to user notification centers and recorded in the audit log.')
    setNotificationBusy(false)
  }

  const renderHistory = () => {
    if (rowsLoading) return <div className="admin-table-skeleton">{[1, 2, 3].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div>
    if (rowsError) return <div className="form-error" role="alert">{rowsError}</div>
    if (!rows.length) return <div className="admin-empty">No notification history yet.</div>
    const columns = Object.keys(rows[0]).filter((key) => !['metadata', 'features'].includes(key)).slice(0, 7)
    return <div className="table-wrap"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{formatAdminValue(column, row[column])}</td>)}</tr>)}</tbody></table></div>
  }

  return <>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Send broadcast</h2><p>Broadcasts are authorized, fanned out to user notification centers, and audited by the database.</p></div></div>    <form className="admin-form" onSubmit={sendNotification}><label>Title<input required value={notificationTitle} onChange={(event) => setNotificationTitle(event.target.value)} placeholder="Scheduled maintenance" /></label><label>Message<textarea required value={notificationMessage} onChange={(event) => setNotificationMessage(event.target.value)} placeholder="Write the message users should receive." /></label><label>Audience<select value={notificationAudience} onChange={(event) => setNotificationAudience(event.target.value)}><option value="all_users">All users</option><option value="business_owners">Business owners only</option><option value="trial_users">Owners currently on a trial</option>{audiencePlans.map((plan) => <option key={plan.code} value={`plan:${plan.code}`}>Owners on {plan.name}</option>)}</select></label><button className="primary" type="submit" disabled={notificationBusy}>{notificationBusy ? 'Sending…' : 'Send broadcast'}</button>{notificationStatus && <p className="muted" role="status">{notificationStatus}</p>}    </form></section>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Publish a version</h2><p>Version announcements use the same trusted database fan-out as broadcasts.</p></div></div><form className="admin-form" onSubmit={publishVersion}><label>Version<input required value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.1.0" /></label><label>Message<textarea required value={versionMessage} onChange={(event) => setVersionMessage(event.target.value)} placeholder="What changed in this release?" /></label>    <button className="primary" type="submit" disabled={notificationBusy}>{notificationBusy ? 'Publishing…' : 'Publish announcement'}</button></form><div className="admin-version-history">{versionHistory.length ? versionHistory.map((item) => <article className="admin-version-entry" key={item.id}><div><strong>v{item.version}</strong><time>{new Date(item.created_at).toLocaleString('en-NG')}</time></div><p>{item.message}</p></article>) : <p className="admin-empty">No version announcements yet.</p>}</div></section>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Notification history</h2><p>Broadcasts recorded in the platform audit trail.</p></div></div>{renderHistory()}</section>
  </>
}
