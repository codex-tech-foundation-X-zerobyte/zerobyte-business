import { Bell } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { type NotificationRow } from '../../lib/types'

export function NotificationCenter({ userId, orgId }: { userId: string; orgId: string }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const unread = rows.filter((row) => !row.read_at).length
  const load = useCallback(async () => {
    const client = supabase
    if (!client || !navigator.onLine) return
    const { data, error: result } = await client.from('notifications').select('id,organization_id,title,body,read_at,created_at').eq('user_id', userId).eq('organization_id', orgId).order('created_at', { ascending: false }).limit(30)
    if (result) setError('Notifications are temporarily unavailable.')
    else setRows((data ?? []) as NotificationRow[])
  }, [orgId, userId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client.channel(`user-notifications-${userId}-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        const incoming = payload.new as NotificationRow
        if (incoming.organization_id && incoming.organization_id !== orgId) return
        setRows((current) => current.some((row) => row.id === incoming.id) ? current : [incoming, ...current].slice(0, 30))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setError('')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError('Live notifications are reconnecting…')
      })
    const refresh = () => { if (document.visibilityState === 'visible' && navigator.onLine) void load() }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); void client.removeChannel(channel) }
  }, [load, orgId, userId])
  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  async function markRead(id: string) {
    if (!supabase) return
    setRows((current) => current.map((row) => row.id === id ? { ...row, read_at: new Date().toISOString() } : row))
    const { error: result } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    if (result) setError('Could not save that notification state.')
  }
  async function markAllRead() {
    if (!supabase || !unread) return
    setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })))
    const { error: result } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)
    if (result) setError('Could not mark notifications as read.')
  }
  return <div className="notification-center" ref={containerRef}><button className="icon-btn notification" onClick={() => setOpen((value) => !value)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}><Bell size={19} />{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}</button>{open && <><button className="notification-backdrop" aria-label="Close notifications" onClick={() => setOpen(false)} /><section className="notification-popover" role="dialog" aria-label="Notifications"><div className="notification-header"><div><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'All caught up'}</span></div><button className="text-btn" onClick={() => void markAllRead()} disabled={!unread}>Mark all read</button></div>{error && <p className="notification-error">{error}</p>}{!navigator.onLine ? <p className="notification-empty">You’re offline. Reconnect to check for new notifications.</p> : !rows.length ? <p className="notification-empty">No notifications yet.</p> : <div className="notification-list">{rows.map((row) => <button className={`notification-item${row.read_at ? '' : ' unread'}`} key={row.id} onClick={() => void markRead(row.id)}><span className="notification-dot" /><span><strong>{row.title}</strong><small>{row.body}</small><time>{new Date(row.created_at).toLocaleString('en-NG')}</time></span></button>)}</div>}</section></>}</div>
}
