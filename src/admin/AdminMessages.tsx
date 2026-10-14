import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import { adminSupabase } from '../lib/supabase'
import { type SupportMessage } from '../lib/types'
import { mergeSupportMessage } from '../lib/supportMessages'

export function AdminMessages({ onUnreadChange }: { onUnreadChange: (count: number) => void }) {
  type AdminConversation = { id: string; organization_id: string; organization_name: string; user_id: string; user_name: string; user_email: string | null; status: string; updated_at: string; latest_body: string | null; latest_sender_role: 'customer' | 'admin' | null; latest_created_at: string | null; unread: boolean; priority: 'low' | 'normal' | 'high' | 'urgent'; admin_stage: string; assigned_to: string | null; assigned_to_name: string | null }
  const [conversations, setConversations] = useState<AdminConversation[]>([])
  const [selected, setSelected] = useState<string | null>(null); const [messages, setMessages] = useState<SupportMessage[]>([]); const [draft, setDraft] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false)
  const [admins, setAdmins] = useState<{ user_id: string; name: string; role: string }[]>([])
  const [notes, setNotes] = useState<{ id: string; author_id: string; body: string; created_at: string }[]>([])
  const [noteDraft, setNoteDraft] = useState(''); const [metaBusy, setMetaBusy] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageRequestRef = useRef(0)
  const load = useCallback(async () => {
    if (!adminSupabase) { setError('Admin service is not configured.'); setLoading(false); return }
    const result = await adminSupabase.rpc('list_support_conversations')
    if (result.error) setError(result.error.message.includes('does not exist') ? 'Support messaging is not configured yet. Apply the support migration first.' : result.error.message)
    else {
      const next = (result.data ?? []) as AdminConversation[]
      setConversations(next)
      onUnreadChange(next.filter((item) => item.unread).length)
      setSelected((current) => current && next.some((item) => item.id === current) ? current : (next[0]?.id || null))
    }
    setLoading(false)
  }, [onUnreadChange])
  const loadMessages = useCallback(async (id: string) => {
    if (!adminSupabase) return
    const requestId = ++messageRequestRef.current
    const result = await adminSupabase.from('support_messages').select('id,conversation_id,sender_id,sender_role,body,created_at').eq('conversation_id', id).order('created_at', { ascending: true })
    if (requestId !== messageRequestRef.current) return
    if (result.error) setError(result.error.message); else setMessages((result.data ?? []) as SupportMessage[])
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (adminSupabase) adminSupabase.rpc('list_platform_admins').then(({ data }) => setAdmins((data ?? []) as typeof admins)) }, [])
  const loadNotes = useCallback(async (id: string) => {
    if (!adminSupabase) return
    const result = await adminSupabase.from('support_internal_notes').select('id,author_id,body,created_at').eq('conversation_id', id).order('created_at', { ascending: true })
    setNotes(result.error ? [] : (result.data ?? []))
  }, [])
  useEffect(() => { if (selected) void loadNotes(selected) }, [loadNotes, selected])
  async function updateMeta(patch: { priority?: string; admin_stage?: string; assigned_to?: string; clear_assignee?: boolean }) {
    if (!adminSupabase || !selected) return
    setMetaBusy(true)
    const { error: result } = await adminSupabase.rpc('admin_update_conversation_meta', {
      target_conversation: selected,
      new_priority: patch.priority ?? null,
      new_stage: patch.admin_stage ?? null,
      new_assignee: patch.assigned_to ?? null,
      clear_assignee: patch.clear_assignee ?? false,
    })
    if (result) setError(result.message)
    else void load()
    setMetaBusy(false)
  }
  async function addNote(event: React.FormEvent) {
    event.preventDefault()
    const body = noteDraft.trim()
    if (!adminSupabase || !selected || !body) return
    const authorId = (await adminSupabase.auth.getUser()).data.user?.id
    if (!authorId) return
    const result = await adminSupabase.from('support_internal_notes').insert({ conversation_id: selected, author_id: authorId, body }).select('id,author_id,body,created_at').single()
    if (!result.error) { setNotes((current) => [...current, result.data]); setNoteDraft('') }
  }
  useEffect(() => { if (selected) void loadMessages(selected) }, [loadMessages, selected])
  async function selectConversation(id: string) {
    setSelected(id)
    setConversations((current) => current.map((item) => item.id === id ? { ...item, unread: false } : item))
    onUnreadChange(conversations.filter((item) => item.id !== id && item.unread).length)
    await adminSupabase?.from('support_conversations').update({ admin_read_at: new Date().toISOString() }).eq('id', id)
  }
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, selected])
  useEffect(() => {
    if (!adminSupabase) return
    const channel = adminSupabase.channel('support-admin-live').on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => void load()).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
      const message = payload.new as SupportMessage
      if (message.conversation_id === selected) setMessages((current) => mergeSupportMessage(current, message))
      void load()
    }).subscribe()
    return () => { void adminSupabase?.removeChannel(channel) }
  }, [load, selected])
  async function reply(event: React.FormEvent) {
    event.preventDefault(); const body = draft.trim()
    if (!adminSupabase || !selected || !body || sending) return
    setSending(true); setError('')
    const senderId = (await adminSupabase.auth.getUser()).data.user?.id
    if (!senderId) { setError('Your admin session has expired. Sign in again.'); setSending(false); return }
    const optimistic: SupportMessage = { id: `local-${crypto.randomUUID()}`, conversation_id: selected, sender_id: senderId, sender_role: 'admin', body, created_at: new Date().toISOString(), delivery: 'sending' }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    const result = await adminSupabase.from('support_messages').insert({ conversation_id: selected, sender_id: senderId, sender_role: 'admin', body }).select('id,conversation_id,sender_id,sender_role,body,created_at').single()
    if (result.error) {
      setMessages((current) => current.map((item) => item.id === optimistic.id ? { ...item, delivery: 'failed' } : item))
      setError(result.error.message || 'Your reply could not be sent.')
    } else {
      setMessages((current) => mergeSupportMessage(current, result.data as SupportMessage))
    }
    setSending(false)
  }
  const current = conversations.find((item) => item.id === selected)
  async function closeConversation() {
    if (!adminSupabase || !current || current.status === 'closed') return
    const result = await adminSupabase.from('support_conversations').update({ status: 'closed' }).eq('id', current.id)
    if (result.error) setError(result.error.message)
    else setConversations((items) => items.map((item) => item.id === current.id ? { ...item, status: 'closed' } : item))
  }
  return <section className="admin-card wide messages-page"><div className="admin-card-header"><div><h2>Customer messages</h2><p>Reply to workspace conversations. Access is limited by platform-admin RLS.</p></div><span className="admin-pill success">{loading ? 'Loading' : `${conversations.length} conversations`}</span></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="messages-layout"><aside className="conversation-list" aria-label="Support conversations">{conversations.length ? conversations.map((conversation) => { const initials = conversation.user_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); return <button className={`conversation-row${conversation.id === selected ? ' active' : ''}${conversation.unread ? ' unread' : ''}`} key={conversation.id} onClick={() => void selectConversation(conversation.id)}><span className="conversation-avatar" aria-hidden="true">{initials || '?'}</span><span className="conversation-main"><strong>{conversation.user_name}{(conversation.priority === 'urgent' || conversation.priority === 'high') && <b className={`priority-flag ${conversation.priority}`}>{conversation.priority}</b>}</strong><small>{conversation.user_email || `User ${conversation.user_id.slice(0, 8)}`} · {conversation.organization_name}</small><span className="conversation-preview">{conversation.latest_body || 'No messages yet.'}</span></span><span className="conversation-side"><time>{new Date(conversation.latest_created_at || conversation.updated_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}</time>{conversation.unread && <b className="conversation-unread">New</b>}<span className={`admin-status ${conversation.status === 'open' ? 'active' : ''}`}>{conversation.status}</span></span></button> }) : <p className="admin-empty">No support conversations yet.</p>}</aside><div className="admin-message-thread">{current ? <><div className="thread-meta"><div className="thread-identity"><span className="conversation-avatar">{current.user_name.slice(0, 2).toUpperCase()}</span><div><strong>{current.user_name}</strong><span>{current.user_email || `User ${current.user_id}`} · {current.organization_name} · {current.status}</span></div></div><div className="thread-controls"><label>Priority<select value={current.priority} disabled={metaBusy} onChange={(event) => void updateMeta({ priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Stage<select value={current.admin_stage} disabled={metaBusy} onChange={(event) => void updateMeta({ admin_stage: event.target.value })}><option value="new">New</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="waiting_for_user">Waiting for user</option><option value="escalated">Escalated</option></select></label><label>Assigned to<select value={current.assigned_to ?? ''} disabled={metaBusy} onChange={(event) => void updateMeta(event.target.value ? { assigned_to: event.target.value } : { clear_assignee: true })}><option value="">Unassigned</option>{admins.map((admin) => <option key={admin.user_id} value={admin.user_id}>{admin.name}</option>)}</select></label><button className="secondary thread-close" onClick={() => void closeConversation()} disabled={current.status === 'closed'}><X size={14} />{current.status === 'closed' ? 'Chat closed' : 'Close chat'}</button></div></div><div className="support-messages">{messages.length ? messages.map((message) => <div className={`support-bubble ${message.sender_role}${message.delivery ? ` ${message.delivery}` : ''}`} key={message.id}><p>{message.body}</p><time>{message.sender_role === 'admin' ? 'You · ' : `${current.user_name} · `}{new Date(message.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}{message.delivery === 'sending' ? ' · Sending' : message.delivery === 'failed' ? ' · Not sent' : ''}</time></div>) : <p className="support-state">No messages in this conversation.</p>}<div ref={messagesEndRef} /></div><form className="support-compose" onSubmit={reply}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Reply to ${current.user_name}…`} aria-label={`Reply to ${current.user_name}`} disabled={sending || current.status === 'closed'} /><button className="primary" disabled={!draft.trim() || sending || current.status === 'closed'}>{sending ? 'Sending…' : <Send size={15} />}</button></form><details className="internal-notes"><summary>Internal notes {notes.length ? `(${notes.length})` : ''} — never visible to the customer</summary><div className="internal-notes-list">{notes.length ? notes.map((note) => <div className="internal-note" key={note.id}><p>{note.body}</p><time>{admins.find((admin) => admin.user_id === note.author_id)?.name ?? 'Admin'} · {new Date(note.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>) : <p className="support-state">No internal notes yet.</p>}</div><form className="support-compose" onSubmit={addNote}><input value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a note for other agents…" aria-label="Add internal note" /><button type="submit" className="secondary" disabled={!noteDraft.trim()}>Add note</button></form></details></> : <p className="support-state">Select a conversation to reply.</p>}</div></div></section>
}
