import { MessageCircle, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { mergeSupportMessage } from '../../lib/supportMessages'
import { type SupportMessage } from '../../lib/types'

export function SupportChat({
  userId,
  orgId,
  orgName,
  displayName,
  email,
}: {
  userId: string
  orgId: string
  orgName: string
  displayName: string
  email: string
}) {
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [unread, setUnread] = useState(0)
  const [queue, setQueue] = useState<{
    waiting: boolean
    position?: number
    ahead?: number
    estimated_minutes?: number
  } | null>(null)
  const [escalation, setEscalation] = useState<{
    state: 'idle' | 'sending' | 'sent'
    ticket?: string
    status?: string | null
    canRate?: boolean
    rated?: boolean
  }>({ state: 'idle' })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Place in line and a time estimate, refreshed while the chat is open and the customer is waiting.
  useEffect(() => {
    if (!supabase || !open || !conversationId) return
    const client = supabase
    let cancelled = false
    const refreshQueue = async () => {
      const { data, error: failure } = await client.rpc('get_my_support_queue', { p_conversation: conversationId })
      if (!cancelled && !failure && data) setQueue(data as NonNullable<typeof queue>)
    }
    void refreshQueue()
    const timer = window.setInterval(() => void refreshQueue(), 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, conversationId, messages.length])
  // Whether this chat already has a technical-support ticket, and where it stands (refreshed when new messages arrive,
  // such as a staff reply or the "resolved" note).
  useEffect(() => {
    if (!supabase || !open || !conversationId) return
    let cancelled = false
    void supabase.functions
      .invoke('codex-support-ticket', { body: { conversationId, action: 'status' } })
      .then(({ data }) => {
        if (cancelled || !data?.exists) return
        setEscalation((current) => ({
          ...current,
          state: 'sent',
          ticket: data.ticket?.ref ?? current.ticket,
          status: data.ticket?.status ?? null,
          canRate: Boolean(data.ticket?.can_rate) && !current.rated,
        }))
      })
    return () => {
      cancelled = true
    }
  }, [open, conversationId, messages.length])
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const refreshUnread = async () => {
      const { data: conversation } = await client
        .from('support_conversations')
        .select('id,customer_read_at')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!conversation) return setUnread(0)
      const { data: latest } = await client
        .from('support_messages')
        .select('sender_role,created_at')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setUnread(
        latest?.sender_role === 'admin' &&
          (!conversation.customer_read_at || latest.created_at > conversation.customer_read_at)
          ? 1
          : 0,
      )
    }
    void refreshUnread()
    const channel = client
      .channel(`support-user-unread-${userId}-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        if ((payload.new as SupportMessage).sender_role === 'admin') setUnread(1)
      })
      .subscribe()
    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [orgId, userId])
  const load = useCallback(async () => {
    if (!supabase) {
      setError('Support chat is not configured yet.')
      return
    }
    setLoading(true)
    setError('')
    const openConversation = await supabase
      .from('support_conversations')
      .select('id,status')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const found = openConversation.data
      ? openConversation
      : await supabase
          .from('support_conversations')
          .select('id,status')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
    if (found.error) {
      setError(
        found.error.message.includes('does not exist')
          ? 'Support chat is not configured yet. Apply the support migration first.'
          : found.error.message,
      )
      setLoading(false)
      return
    }
    let id = found.data?.id as string | undefined
    if (!id) {
      const created = await supabase
        .from('support_conversations')
        .insert({ organization_id: orgId, user_id: userId })
        .select('id')
        .single()
      if (created.error) {
        setError(created.error.message)
        setLoading(false)
        return
      }
      id = created.data.id
    } else if (found.data?.status === 'closed') {
      const reopened = await supabase
        .from('support_conversations')
        .update({ status: 'open' })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
        .single()
      if (reopened.error) {
        setError('We could not reopen this conversation. Please try again.')
        setLoading(false)
        return
      }
    }
    if (!id) {
      setError('Could not create a support conversation.')
      setLoading(false)
      return
    }
    setConversationId(id)
    const result = await supabase
      .from('support_messages')
      .select('id,conversation_id,sender_id,sender_role,body,created_at,source')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    if (result.error) setError(result.error.message)
    else setMessages((result.data ?? []) as SupportMessage[])
    await supabase
      .from('support_conversations')
      .update({ customer_read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
    setUnread(0)
    setLoading(false)
  }, [orgId, userId])
  useEffect(() => {
    if (!open || !supabase || !conversationId) return
    const channel = supabase
      .channel(`support-user-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const message = payload.new as SupportMessage
          setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]))
        },
      )
      .subscribe()
    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [conversationId, open])
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open])
  async function sendMessage(event: React.FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!supabase || !conversationId || !body || sending) return
    setSending(true)
    setError('')
    const optimistic: SupportMessage = {
      id: `local-${crypto.randomUUID()}`,
      conversation_id: conversationId,
      sender_id: userId,
      sender_role: 'customer',
      body,
      created_at: new Date().toISOString(),
      delivery: 'sending',
    }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    const result = await supabase
      .from('support_messages')
      .insert({ conversation_id: conversationId, sender_id: userId, sender_role: 'customer', body })
      .select('id,conversation_id,sender_id,sender_role,body,created_at,source')
      .single()
    if (result.error) {
      setMessages((current) =>
        current.map((item) => (item.id === optimistic.id ? { ...item, delivery: 'failed' } : item)),
      )
      setError(result.error.message || 'Your message could not be sent.')
    } else {
      setMessages((current) => mergeSupportMessage(current, result.data as SupportMessage))
      // Once the chat is with technical support, follow-up messages go to the ticket too (best effort).
      if (escalation.state === 'sent' && escalation.status !== 'closed')
        void supabase.functions.invoke('codex-support-ticket', { body: { conversationId, action: 'reply', body } })
    }
    setSending(false)
  }
  async function rateSupport(rating: number) {
    if (!supabase || !conversationId) return
    const { data, error: failure } = await supabase.functions.invoke('codex-support-ticket', {
      body: { conversationId, action: 'rate', rating },
    })
    if (failure || data?.error) {
      setError((data && typeof data.error === 'string' && data.error) || 'Your rating could not be sent. Try again.')
      return
    }
    setEscalation((current) => ({ ...current, canRate: false, rated: true }))
  }
  // Sends the conversation to the technical support desk as a ticket. Safe to repeat: the same conversation never
  // makes a second ticket.
  async function sendToTechnicalSupport() {
    if (!supabase || !conversationId || escalation.state === 'sending') return
    setEscalation({ state: 'sending' })
    setError('')
    const { data, error: failure } = await supabase.functions.invoke('codex-support-ticket', {
      body: { conversationId },
    })
    if (failure || !data || data.error) {
      setEscalation({ state: 'idle' })
      setError(
        (data && typeof data.error === 'string' && data.error) ||
          'Technical support could not be reached. Try again soon.',
      )
      return
    }
    setEscalation({ state: 'sent', ticket: typeof data.ticket === 'string' ? data.ticket : undefined })
  }
  return (
    <div className="support-chat">
      <button
        className="support-launcher"
        onClick={() => {
          setOpen((value) => !value)
          if (!open) void load()
        }}
        aria-expanded={open}
      >
        <MessageCircle size={19} />
        <span>Support</span>
        {unread > 0 && <b className="support-unread-badge">{unread}</b>}
      </button>
      {open && (
        <section className="support-popover" aria-label="Customer support chat">
          <header>
            <div>
              <strong>{orgName || 'Business support'}</strong>
              <small>{displayName || email || 'Signed-in user'} · Support conversation</small>
            </div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close support chat">
              <X size={17} />
            </button>
          </header>
          {queue?.waiting && queue.position ? (
            <p className="support-queue" role="status">
              {queue.position === 1
                ? 'You are next in line.'
                : `You are number ${queue.position} in line, ${queue.ahead} ${queue.ahead === 1 ? 'person is' : 'people are'} ahead of you.`}{' '}
              Expect a reply in about {queue.estimated_minutes} {queue.estimated_minutes === 1 ? 'minute' : 'minutes'}.
            </p>
          ) : null}
          <div className="support-messages">
            {loading ? (
              <p className="support-state">Loading conversation…</p>
            ) : error && !messages.length ? (
              <p className="support-state support-error">{error}</p>
            ) : !messages.length ? (
              <p className="support-state">Tell us what you need help with. Chats are kept for 24 hours.</p>
            ) : (
              messages.map((message) => (
                <div
                  className={`support-bubble ${message.sender_role}${message.delivery ? ` ${message.delivery}` : ''}`}
                  key={message.id}
                >
                  <p>{message.body}</p>
                  <time>
                    {message.source === 'codex'
                      ? 'Technical support · '
                      : message.sender_role === 'admin'
                        ? 'Support · '
                        : 'You · '}
                    {new Date(message.created_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    {message.delivery === 'sending' ? ' · Sending' : message.delivery === 'failed' ? ' · Not sent' : ''}
                  </time>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          {error && messages.length > 0 && (
            <p className="support-inline-error" role="alert">
              {error}
            </p>
          )}
          {messages.some((message) => message.sender_role === 'customer' && !message.delivery) && (
            <div className="support-escalate">
              {escalation.state === 'sent' ? (
                <small>
                  Sent to technical support{escalation.ticket ? ` as ${escalation.ticket}` : ''}
                  {escalation.status ? ` · ${escalation.status.replace(/_/g, ' ')}` : ''}. Quote the number if you
                  contact us again.
                </small>
              ) : (
                <button
                  type="button"
                  className="text-btn"
                  disabled={escalation.state === 'sending'}
                  onClick={() => void sendToTechnicalSupport()}
                >
                  {escalation.state === 'sending' ? 'Sending…' : 'Send this to technical support'}
                </button>
              )}
            </div>
          )}
          {escalation.canRate && (
            <div className="support-rate" role="group" aria-label="Rate technical support">
              <span>How was technical support?</span>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} star${star === 1 ? '' : 's'}`}
                  onClick={() => void rateSupport(star)}
                >
                  ★
                </button>
              ))}
            </div>
          )}
          {escalation.rated && <p className="support-queue">Thanks for rating technical support.</p>}
          <form className="support-compose" onSubmit={sendMessage}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a message…"
              aria-label="Support message"
              disabled={loading || sending || !conversationId}
            />
            <button
              className="primary"
              disabled={!draft.trim() || sending || loading || !conversationId}
              aria-label="Send support message"
            >
              {sending ? 'Sending…' : <Send size={15} />}
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
