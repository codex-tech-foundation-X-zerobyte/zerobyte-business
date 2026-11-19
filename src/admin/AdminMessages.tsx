import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Info, Send, X } from 'lucide-react'
import { adminSupabase } from '../lib/supabase'
import { type SupportMessage } from '../lib/types'
import { mergeSupportMessage } from '../lib/supportMessages'

export function AdminMessages({ onUnreadChange }: { onUnreadChange: (count: number) => void }) {
  type AdminConversation = {
    id: string
    organization_id: string
    organization_name: string
    user_id: string
    user_name: string
    user_email: string | null
    status: string
    updated_at: string
    latest_body: string | null
    latest_sender_role: 'customer' | 'admin' | null
    latest_created_at: string | null
    unread: boolean
    priority: 'low' | 'normal' | 'high' | 'urgent'
    admin_stage: string
    assigned_to: string | null
    assigned_to_name: string | null
    waiting_since: string | null
    queue_position: number | null
  }
  const [conversations, setConversations] = useState<AdminConversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [admins, setAdmins] = useState<{ user_id: string; name: string; role: string }[]>([])
  const [notes, setNotes] = useState<{ id: string; author_id: string; body: string; created_at: string }[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [metaBusy, setMetaBusy] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageRequestRef = useRef(0)
  const load = useCallback(async () => {
    if (!adminSupabase) {
      setError('Admin service is not configured.')
      setLoading(false)
      return
    }
    const result = await adminSupabase.rpc('list_support_conversations')
    if (result.error)
      setError(
        result.error.message.includes('does not exist')
          ? 'Support messaging is not configured yet. Apply the support migration first.'
          : result.error.message,
      )
    else {
      const next = (result.data ?? []) as AdminConversation[]
      setConversations(next)
      onUnreadChange(next.filter((item) => item.unread).length)
      // Like WhatsApp: nothing opens by itself. The agent taps a person to open that chat.
      setSelected((current) => (current && next.some((item) => item.id === current) ? current : null))
    }
    setLoading(false)
  }, [onUnreadChange])
  const loadMessages = useCallback(async (id: string) => {
    if (!adminSupabase) return
    const requestId = ++messageRequestRef.current
    const result = await adminSupabase
      .from('support_messages')
      .select('id,conversation_id,sender_id,sender_role,body,created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    if (requestId !== messageRequestRef.current) return
    if (result.error) setError(result.error.message)
    else setMessages((result.data ?? []) as SupportMessage[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (adminSupabase)
      adminSupabase.rpc('list_platform_admins').then(({ data }) => setAdmins((data ?? []) as typeof admins))
  }, [])
  const loadNotes = useCallback(async (id: string) => {
    if (!adminSupabase) return
    const result = await adminSupabase
      .from('support_internal_notes')
      .select('id,author_id,body,created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    setNotes(result.error ? [] : (result.data ?? []))
  }, [])
  useEffect(() => {
    if (selected) void loadNotes(selected)
  }, [loadNotes, selected])
  async function updateMeta(patch: {
    priority?: string
    admin_stage?: string
    assigned_to?: string
    clear_assignee?: boolean
  }) {
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
    const result = await adminSupabase
      .from('support_internal_notes')
      .insert({ conversation_id: selected, author_id: authorId, body })
      .select('id,author_id,body,created_at')
      .single()
    if (!result.error) {
      setNotes((current) => [...current, result.data])
      setNoteDraft('')
    }
  }
  useEffect(() => {
    if (selected) void loadMessages(selected)
  }, [loadMessages, selected])
  async function selectConversation(id: string) {
    setSelected(id)
    setShowDetails(false)
    setConversations((current) => current.map((item) => (item.id === id ? { ...item, unread: false } : item)))
    onUnreadChange(conversations.filter((item) => item.id !== id && item.unread).length)
    await adminSupabase?.from('support_conversations').update({ admin_read_at: new Date().toISOString() }).eq('id', id)
  }
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, selected])
  useEffect(() => {
    if (!adminSupabase) return
    const channel = adminSupabase
      .channel('support-admin-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        const message = payload.new as SupportMessage
        if (message.conversation_id === selected) setMessages((current) => mergeSupportMessage(current, message))
        void load()
      })
      .subscribe()
    return () => {
      void adminSupabase?.removeChannel(channel)
    }
  }, [load, selected])
  async function reply(event: React.FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!adminSupabase || !selected || !body || sending) return
    setSending(true)
    setError('')
    const senderId = (await adminSupabase.auth.getUser()).data.user?.id
    if (!senderId) {
      setError('Your admin session has expired. Sign in again.')
      setSending(false)
      return
    }
    const optimistic: SupportMessage = {
      id: `local-${crypto.randomUUID()}`,
      conversation_id: selected,
      sender_id: senderId,
      sender_role: 'admin',
      body,
      created_at: new Date().toISOString(),
      delivery: 'sending',
    }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    const result = await adminSupabase
      .from('support_messages')
      .insert({ conversation_id: selected, sender_id: senderId, sender_role: 'admin', body })
      .select('id,conversation_id,sender_id,sender_role,body,created_at')
      .single()
    if (result.error) {
      setMessages((current) =>
        current.map((item) => (item.id === optimistic.id ? { ...item, delivery: 'failed' } : item)),
      )
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
    else
      setConversations((items) => items.map((item) => (item.id === current.id ? { ...item, status: 'closed' } : item)))
  }
  const waitingCount = conversations.filter((item) => item.queue_position).length
  const initialsOf = (name: string) =>
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  const clock = (value: string) => new Date(value).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
  const dayLabel = (value: string) => {
    const date = new Date(value)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)
    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
  }
  const waitedFor = (since: string) => {
    const minutes = Math.max(Math.floor((Date.now() - new Date(since).getTime()) / 60000), 0)
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }
  return (
    <section className={`admin-card wide wa${current ? ' chat-open' : ''}`} aria-label="Customer messages">
      {error && (
        <div className="form-error" role="alert" style={{ margin: 12 }}>
          {error}
        </div>
      )}
      <aside className="wa-list" aria-label="Support conversations">
        <header className="wa-list-head">
          <div>
            <h2>Chats</h2>
            <small>{loading ? 'Loading…' : `${waitingCount} waiting · chats are kept for 24 hours`}</small>
          </div>
        </header>
        <div className="wa-rows">
          {conversations.length
            ? conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`wa-row${conversation.id === selected ? ' active' : ''}${conversation.unread ? ' unread' : ''}`}
                  onClick={() => void selectConversation(conversation.id)}
                >
                  <span className="wa-avatar" aria-hidden="true">
                    {initialsOf(conversation.user_name)}
                  </span>
                  <span className="wa-row-main">
                    <span className="wa-row-top">
                      <strong>{conversation.user_name}</strong>
                      <time>{clock(conversation.latest_created_at || conversation.updated_at)}</time>
                    </span>
                    <span className="wa-row-bottom">
                      <span className="wa-preview">
                        {conversation.latest_sender_role === 'admin' ? 'You: ' : ''}
                        {conversation.latest_body || 'No messages yet.'}
                      </span>
                      {conversation.queue_position ? (
                        <b className="wa-queue" title="Place in the queue">
                          #{conversation.queue_position}
                          {conversation.waiting_since ? ` · ${waitedFor(conversation.waiting_since)}` : ''}
                        </b>
                      ) : null}
                      {conversation.unread && <b className="wa-dot" aria-label="Unread" />}
                    </span>
                    <small className="wa-org">{conversation.organization_name}</small>
                  </span>
                </button>
              ))
            : !loading && <p className="admin-empty">No chats in the last 24 hours.</p>}
        </div>
      </aside>

      <div className="wa-chat">
        {current ? (
          <>
            <header className="wa-chat-head">
              <button
                type="button"
                className="icon-btn wa-back"
                onClick={() => setSelected(null)}
                aria-label="Back to chats"
              >
                <ArrowLeft size={18} />
              </button>
              <span className="wa-avatar" aria-hidden="true">
                {initialsOf(current.user_name)}
              </span>
              <div className="wa-chat-title">
                <strong>{current.user_name}</strong>
                <small>
                  {current.organization_name}
                  {current.queue_position ? ` · #${current.queue_position} in the queue` : ''}
                  {current.status === 'closed' ? ' · closed' : ''}
                </small>
              </div>
              <button
                type="button"
                className="icon-btn wa-info-btn"
                onClick={() => setShowDetails((value) => !value)}
                aria-expanded={showDetails}
                aria-label="Chat details"
                title="Details, priority and notes"
              >
                <Info size={18} />
              </button>
            </header>

            {
              <div className={`wa-details${showDetails ? ' open' : ''}`}>
                <p className="field-help">{current.user_email || `User ${current.user_id}`}</p>
                <div className="thread-controls">
                  <label>
                    Priority
                    <select
                      value={current.priority}
                      disabled={metaBusy}
                      onChange={(event) => void updateMeta({ priority: event.target.value })}
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label>
                    Stage
                    <select
                      value={current.admin_stage}
                      disabled={metaBusy}
                      onChange={(event) => void updateMeta({ admin_stage: event.target.value })}
                    >
                      <option value="new">New</option>
                      <option value="pending">Pending</option>
                      <option value="in_progress">In progress</option>
                      <option value="waiting_for_user">Waiting for user</option>
                      <option value="escalated">Escalated</option>
                    </select>
                  </label>
                  <label>
                    Assigned to
                    <select
                      value={current.assigned_to ?? ''}
                      disabled={metaBusy}
                      onChange={(event) =>
                        void updateMeta(
                          event.target.value ? { assigned_to: event.target.value } : { clear_assignee: true },
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {admins.map((admin) => (
                        <option key={admin.user_id} value={admin.user_id}>
                          {admin.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary thread-close"
                    onClick={() => void closeConversation()}
                    disabled={current.status === 'closed'}
                  >
                    <X size={14} />
                    {current.status === 'closed' ? 'Chat closed' : 'Close chat'}
                  </button>
                </div>
                <details className="internal-notes" open>
                  <summary>
                    Internal notes {notes.length ? `(${notes.length})` : ''} — never visible to the customer
                  </summary>
                  <div className="internal-notes-list">
                    {notes.length ? (
                      notes.map((note) => (
                        <div className="internal-note" key={note.id}>
                          <p>{note.body}</p>
                          <time>
                            {admins.find((admin) => admin.user_id === note.author_id)?.name ?? 'Admin'} ·{' '}
                            {new Date(note.created_at).toLocaleString('en-NG', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </time>
                        </div>
                      ))
                    ) : (
                      <p className="support-state">No internal notes yet.</p>
                    )}
                  </div>
                  <form className="support-compose" onSubmit={addNote}>
                    <input
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder="Add a note for other agents…"
                      aria-label="Add internal note"
                    />
                    <button type="submit" className="secondary" disabled={!noteDraft.trim()}>
                      Add note
                    </button>
                  </form>
                </details>
              </div>
            }

            <div className="wa-messages">
              {messages.length ? (
                messages.map((message, index) => {
                  const newDay =
                    index === 0 ||
                    new Date(messages[index - 1].created_at).toDateString() !==
                      new Date(message.created_at).toDateString()
                  return (
                    <div key={message.id} className="wa-group">
                      {newDay && <span className="wa-day">{dayLabel(message.created_at)}</span>}
                      <div
                        className={`wa-bubble ${message.sender_role === 'admin' ? 'out' : 'in'}${message.delivery ? ` ${message.delivery}` : ''}`}
                      >
                        <p>{message.body}</p>
                        <time>
                          {clock(message.created_at)}
                          {message.delivery === 'sending'
                            ? ' · Sending'
                            : message.delivery === 'failed'
                              ? ' · Not sent'
                              : ''}
                        </time>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="support-state">No messages in the last 24 hours.</p>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="wa-compose" onSubmit={reply}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={current.status === 'closed' ? 'This chat is closed' : 'Type a message'}
                aria-label={`Reply to ${current.user_name}`}
                disabled={sending || current.status === 'closed'}
              />
              <button
                className="primary wa-send"
                disabled={!draft.trim() || sending || current.status === 'closed'}
                aria-label="Send"
              >
                <Send size={17} />
              </button>
            </form>
          </>
        ) : (
          <div className="wa-placeholder">
            <strong>Open a chat</strong>
            <p>Choose a customer on the left to read and reply. People waiting the longest are at the top.</p>
          </div>
        )}
      </div>
    </section>
  )
}
