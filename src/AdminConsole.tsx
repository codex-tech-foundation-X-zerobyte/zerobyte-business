import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Bell, ClipboardList, CreditCard, Gauge, GitBranch, History, LayoutDashboard,
  LogOut, Menu, MessageCircle, Package, PanelLeftClose, PanelLeftOpen, RefreshCw, Send, Settings, ShoppingCart, Users, Wifi, X,
} from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { adminSupabase, supabaseAnonKey, supabaseUrl } from './lib/supabase'
import { computeOverallHealth, evaluateHealth, slowServiceHints, statusLabel, type MonitorStatus } from './lib/monitoring'

// Code-split from App.tsx: this is the admin-only console (monitoring,
// audit log, user management, the support inbox below). It ships in its own
// chunk, loaded only when someone actually reaches the admin route -- see
// the lazy() import in App.tsx for why.

const ADMIN_REQUEST_TIMEOUT_MS = 5000

function adminAuthHeaders(token: string, anonKey: string) {
  return { apikey: anonKey, Authorization: `Bearer ${token}` }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = ADMIN_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function getAdminAccessToken() {
  if (!adminSupabase) return null
  let current
  try {
    current = await adminSupabase.auth.getSession()
  } catch {
    return null
  }
  let session = current.data.session
  if (current.error || !session) return null
  if (session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) {
    const refreshed = await adminSupabase.auth.refreshSession().catch(() => ({ data: { session: null }, error: new Error('Session refresh failed') }))
    if (refreshed.error || !refreshed.data.session) return null
    session = refreshed.data.session
  }
  return session.access_token
}

async function fetchAdminFunction(path: string, init: RequestInit = {}) {
  if (!adminSupabase || !supabaseUrl || !supabaseAnonKey) return { response: null, expired: false, error: 'Admin service is not configured.' }
  const anonKey = supabaseAnonKey
  const request = async (token: string) => fetchWithTimeout(`${supabaseUrl}/functions/v1/${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...adminAuthHeaders(token, anonKey) },
  })
  const token = await getAdminAccessToken()
  if (!token) return { response: null, expired: true }
  let response: Response
  try {
    response = await request(token)
  } catch (reason) {
    return { response: null, expired: false, timedOut: reason instanceof DOMException && reason.name === 'AbortError', error: reason instanceof Error ? reason.message : 'Admin request failed.' }
  }
  if (response.status !== 401) return { response, expired: false }
  const refreshed = await adminSupabase.auth.refreshSession().catch(() => ({ data: { session: null }, error: new Error('Session refresh failed') }))
  if (refreshed.error || !refreshed.data.session) {
    await adminSupabase.auth.signOut()
    return { response, expired: true }
  }
  try {
    response = await request(refreshed.data.session.access_token)
  } catch (reason) {
    return { response: null, expired: false, timedOut: reason instanceof DOMException && reason.name === 'AbortError', error: reason instanceof Error ? reason.message : 'Admin request failed.' }
  }
  if (response.status === 401) {
    await adminSupabase.auth.signOut()
    return { response, expired: true }
  }
  return { response, expired: false }
}
async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = ADMIN_REQUEST_TIMEOUT_MS) {
  let timeout: number | undefined
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs) }),
    ])
  } finally {
    if (timeout) window.clearTimeout(timeout)
  }
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

// Duplicated from App.tsx (also used by the customer-facing SupportChat
// widget there): small, pure, and cheap to keep independent so this chunk
// doesn't need to import from the main app bundle.
type SupportMessage = { id: string; conversation_id: string; sender_id: string; sender_role: 'customer' | 'admin'; body: string; created_at: string; delivery?: 'sending' | 'failed' }

function mergeSupportMessage(current: SupportMessage[], incoming: SupportMessage) {
  const optimistic = current.find((item) => item.id === incoming.id || (
    item.delivery === 'sending' &&
    item.sender_id === incoming.sender_id &&
    item.body === incoming.body &&
    item.conversation_id === incoming.conversation_id
  ))
  if (optimistic) return current.map((item) => item === optimistic ? incoming : item).sort((a, b) => a.created_at.localeCompare(b.created_at))
  return current.some((item) => item.id === incoming.id)
    ? current
    : [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function AdminMessages({ onUnreadChange }: { onUnreadChange: (count: number) => void }) {
  type AdminConversation = { id: string; organization_id: string; organization_name: string; user_id: string; user_name: string; user_email: string | null; status: string; updated_at: string; latest_body: string | null; latest_sender_role: 'customer' | 'admin' | null; latest_created_at: string | null; unread: boolean }
  const [conversations, setConversations] = useState<AdminConversation[]>([])
  const [selected, setSelected] = useState<string | null>(null); const [messages, setMessages] = useState<SupportMessage[]>([]); const [draft, setDraft] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false)
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
  return <section className="admin-card wide messages-page"><div className="admin-card-header"><div><h2>Customer messages</h2><p>Reply to workspace conversations. Access is limited by platform-admin RLS.</p></div><span className="admin-pill success">{loading ? 'Loading' : `${conversations.length} conversations`}</span></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="messages-layout"><aside className="conversation-list" aria-label="Support conversations">{conversations.length ? conversations.map((conversation) => { const initials = conversation.user_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); return <button className={`conversation-row${conversation.id === selected ? ' active' : ''}${conversation.unread ? ' unread' : ''}`} key={conversation.id} onClick={() => void selectConversation(conversation.id)}><span className="conversation-avatar" aria-hidden="true">{initials || '?'}</span><span className="conversation-main"><strong>{conversation.user_name}</strong><small>{conversation.user_email || `User ${conversation.user_id.slice(0, 8)}`} · {conversation.organization_name}</small><span className="conversation-preview">{conversation.latest_body || 'No messages yet.'}</span></span><span className="conversation-side"><time>{new Date(conversation.latest_created_at || conversation.updated_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}</time>{conversation.unread && <b className="conversation-unread">New</b>}<span className={`admin-status ${conversation.status === 'open' ? 'active' : ''}`}>{conversation.status}</span></span></button> }) : <p className="admin-empty">No support conversations yet.</p>}</aside><div className="admin-message-thread">{current ? <><div className="thread-meta"><div className="thread-identity"><span className="conversation-avatar">{current.user_name.slice(0, 2).toUpperCase()}</span><div><strong>{current.user_name}</strong><span>{current.user_email || `User ${current.user_id}`} · {current.organization_name} · {current.status}</span></div></div><button className="secondary thread-close" onClick={() => void closeConversation()} disabled={current.status === 'closed'}><X size={14} />{current.status === 'closed' ? 'Chat closed' : 'Close chat'}</button></div><div className="support-messages">{messages.length ? messages.map((message) => <div className={`support-bubble ${message.sender_role}${message.delivery ? ` ${message.delivery}` : ''}`} key={message.id}><p>{message.body}</p><time>{message.sender_role === 'admin' ? 'You · ' : `${current.user_name} · `}{new Date(message.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}{message.delivery === 'sending' ? ' · Sending' : message.delivery === 'failed' ? ' · Not sent' : ''}</time></div>) : <p className="support-state">No messages in this conversation.</p>}<div ref={messagesEndRef} /></div><form className="support-compose" onSubmit={reply}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Reply to ${current.user_name}…`} aria-label={`Reply to ${current.user_name}`} disabled={sending || current.status === 'closed'} /><button className="primary" disabled={!draft.trim() || sending || current.status === 'closed'}>{sending ? 'Sending…' : <Send size={15} />}</button></form></> : <p className="support-state">Select a conversation to reply.</p>}</div></div></section>
}

function AdminConsole({ email, onBack, onLogout }: { email: string; onBack: () => void; onLogout: () => void }) {
  type AdminSection = 'Overview' | 'Users' | 'Organizations' | 'Subscriptions' | 'Branches' | 'Inventory' | 'Sales' | 'Notifications' | 'Messages' | 'Audit log' | 'Monitoring' | 'Settings'
  type AdminRow = Record<string, string | number | null>
  type AuditEntry = { source: string; id: string; action: string; actor: string | null; target: string; organizationId: string | null; metadata: Record<string, unknown>; createdAt: string; category: string; severity: 'info' | 'warning' | 'critical' }
  type MonitorMetric = { name: string; source: string; latency: number | null; status: MonitorStatus; detail: string; checkType: string; checkedAt: string; failure?: string; httpStatus?: number | null; environment?: string }
  // Shared between runMonitoringChecks (below) and the monitorRealtimeWait
  // ref (which needs the type at component scope, since a ref is declared
  // outside the callback that produces its value).
  type ProbeOutcome = { status: 'success' | 'failed' | 'unhealthy' | 'unavailable' | 'configuration'; detail?: string; httpStatus?: number; errorCode?: string }
  // Vite sets MODE from the actual build/run command ('development' for
  // `vite dev`, whatever --mode says otherwise, 'production' for a normal
  // `vite build') -- this reflects how the app was actually started rather
  // than a hardcoded label, so a staging build run with `--mode staging`
  // is correctly distinguished from production without extra config.
  const currentEnvironment = import.meta.env.MODE || 'production'
  type MonitorSummary = {
    service: string; checks: number; healthy: number; failed: number; unavailable: number; configuration: number
    http_4xx_count: number; http_5xx_count: number; timeout_count: number
    uptime_percent: number | null; average_latency_ms: number | null; min_latency_ms: number | null; max_latency_ms: number | null
    p50_latency_ms: number | null; p95_latency_ms: number | null; p99_latency_ms: number | null
    last_success_at: string | null; last_failure_at: string | null; consecutive_failures: number
  }
  const formatAdminValue = (column: string, value: string | number | null) => {
    if (value == null || value === '') return '—'
    if (['created_at', 'updated_at', 'last_sign_in_at', 'sent_at'].includes(column)) {
      const date = new Date(String(value))
      if (!Number.isNaN(date.getTime())) return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    }
    return String(value)
  }
  const [section, setSection] = useState<AdminSection>('Overview')
  const [overview, setOverview] = useState<Record<string, number> | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [analyticsPeriod, setAnalyticsPeriod] = useState('30d')
  const [analytics, setAnalytics] = useState<{ label: string; users: number; organizations: number; sales: number; revenue: number; expenses: number }[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [rows, setRows] = useState<AdminRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsError, setRowsError] = useState('')
  const [userRows, setUserRows] = useState<AdminRow[]>([])
  const [userRowsLoading, setUserRowsLoading] = useState(false)
  const [userRowsError, setUserRowsError] = useState('')
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [auditCategory, setAuditCategory] = useState('all')
  const [auditSeverity, setAuditSeverity] = useState('all')
  const [auditSource, setAuditSource] = useState('all')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [auditRefreshToken, setAuditRefreshToken] = useState(0)
  const [auditLive, setAuditLive] = useState(false)
  const [notificationTitle, setNotificationTitle] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [version, setVersion] = useState('')
  const [versionMessage, setVersionMessage] = useState('')
  const [versionHistory, setVersionHistory] = useState<{ id: string; version: string; message: string; created_at: string }[]>([])
  const [notificationStatus, setNotificationStatus] = useState('')
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [unreadSupportCount, setUnreadSupportCount] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('zerobyte.admin-sidebar-collapsed') === 'true')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [monitorMetrics, setMonitorMetrics] = useState<MonitorMetric[]>([])
  const [monitorHistory, setMonitorHistory] = useState<MonitorMetric[]>([])
  const [monitorSummary, setMonitorSummary] = useState<MonitorSummary[]>([])
  useEffect(() => {
    if (!adminSupabase) return
    void adminSupabase.rpc('list_support_conversations').then(({ data }) => {
      if (data) setUnreadSupportCount((data as { unread?: boolean }[]).filter((item) => item.unread).length)
    })
  }, [])
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorError, setMonitorError] = useState('')
  const [monitorStorageState, setMonitorStorageState] = useState<'unknown' | 'available' | 'unavailable'>('unknown')
  const [monitorUpdatedAt, setMonitorUpdatedAt] = useState<string | null>(null)
  const [monitorStatusFilter, setMonitorStatusFilter] = useState('all')
  const [monitorRange, setMonitorRange] = useState('all')
  const [monitorEnvironmentFilter, setMonitorEnvironmentFilter] = useState('all')
  const [monitorCustomFrom, setMonitorCustomFrom] = useState('')
  const [monitorCustomTo, setMonitorCustomTo] = useState('')
  const monitorRealtimeChannel = useRef<RealtimeChannel | null>(null)
  const monitorRealtimeStatus = useRef<string | null>(null)
  const monitorRealtimeWait = useRef<Promise<ProbeOutcome> | null>(null)
  const monitorRunInProgress = useRef(false)
  const adminSessionInvalid = useRef(false)
  const monitorStorageStateRef = useRef<'unknown' | 'available' | 'unavailable'>('unknown')
  const markMonitoringStorageUnavailable = useCallback(() => {
    if (monitorStorageStateRef.current === 'unavailable') return
    monitorStorageStateRef.current = 'unavailable'
    setMonitorStorageState('unavailable')
    setMonitorError('Monitoring storage not configured. Local browser checks will continue, but observations will not be persisted.')
  }, [])
  const loadPersistedMonitoring = useCallback(async () => {
    if (!adminSupabase || monitorStorageStateRef.current === 'unavailable') return
    const effectivePeriod = monitorRange === 'all' ? '7d' : monitorRange === 'custom' ? '24h' : monitorRange
    const params: { period_key: string; custom_start?: string; custom_end?: string } = { period_key: effectivePeriod }
    if (monitorRange === 'custom' && monitorCustomFrom && monitorCustomTo) {
      params.custom_start = new Date(monitorCustomFrom).toISOString()
      params.custom_end = new Date(monitorCustomTo).toISOString()
    }
    const { data, error } = await adminSupabase.rpc('get_platform_monitoring', params)
    if (error) {
      if (error.message.includes('does not exist') || error.code === 'PGRST202') {
        markMonitoringStorageUnavailable()
      } else {
        setMonitorError(error.message)
      }
      return
    }
    monitorStorageStateRef.current = 'available'
    setMonitorStorageState('available')
    setMonitorHistory((data?.measurements ?? []).map((metric: { service: string; source: string; status: MonitorMetric['status']; latency_ms: number | null; detail: string; check_type?: string | null; checked_at: string; http_status?: number | null; environment?: string }) => ({
      name: metric.service, source: metric.source, status: metric.status, latency: metric.latency_ms, detail: metric.detail, checkType: metric.check_type ?? 'Unspecified check', checkedAt: metric.checked_at, httpStatus: metric.http_status, environment: metric.environment,
    })))
    setMonitorSummary((data?.summary ?? []) as MonitorSummary[])
  }, [markMonitoringStorageUnavailable, monitorRange, monitorCustomFrom, monitorCustomTo])
  useEffect(() => {
    if (!adminSupabase || section !== 'Monitoring' || monitorStorageState === 'unavailable') return
    if (monitorRange === 'custom' && !(monitorCustomFrom && monitorCustomTo)) return
    if (monitorStorageState === 'unknown') {
      void loadPersistedMonitoring()
      return
    }
    const channel = adminSupabase.channel(`platform-monitoring-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_monitoring_measurements' }, () => void loadPersistedMonitoring())
      .subscribe()
    return () => { void adminSupabase?.removeChannel(channel) }
  }, [loadPersistedMonitoring, monitorRange, monitorCustomFrom, monitorCustomTo, monitorStorageState, section])
  useEffect(() => {
    if (!adminSupabase) return
    adminSupabase.rpc('get_platform_overview').then(({ data, error }) => {
      if (error) {
        setOverviewError(error.message.includes('does not exist') ? 'Apply the platform-admin migration in Supabase, then refresh.' : error.message)
        return
      }
      setOverview((data ?? {}) as Record<string, number>)
    })
  }, [])
  useEffect(() => {
    if (!adminSupabase) return
    setAnalyticsLoading(true)
    adminSupabase.rpc('get_platform_analytics', { period_key: analyticsPeriod }).then(({ data, error }) => {
      setAnalyticsLoading(false)
      if (error) {
        setOverviewError(error.message.includes('does not exist') ? 'Apply the platform analytics migration in Supabase, then refresh.' : error.message)
        return
      }
      setAnalytics((data?.points ?? []) as typeof analytics)
    })
  }, [analyticsPeriod])
  useEffect(() => {
    if (!adminSupabase || section === 'Overview' || section === 'Settings' || section === 'Users' || section === 'Messages' || section === 'Audit log' || section === 'Monitoring') return
    setRowsLoading(true)
    setRowsError('')
    const loadRows = async () => {
      if (adminSessionInvalid.current) {
        setRowsLoading(false)
        return
      }
      const { response, expired } = await fetchAdminFunction(`get-platform-records?resource=${encodeURIComponent(section)}`)
      if (!response) {
        setRowsLoading(false)
        if (expired) adminSessionInvalid.current = true
        setRowsError(expired ? 'Your admin session has expired. Sign in again.' : 'The admin records service timed out or is temporarily unavailable. Try again.')
        return
      }
      const payload = await response.json().catch(() => null)
      setRowsLoading(false)
      if (!response.ok) {
        setRowsError(payload?.error ?? `Platform records returned ${response.status}.`)
        setRows([])
        return
      }
      setRows((payload?.rows ?? []) as unknown as AdminRow[])
    }
    void loadRows()
  }, [section])
  useEffect(() => {
    if (!adminSupabase || section !== 'Notifications') return
    adminSupabase.from('admin_notifications').select('id,title,message,status,created_at,sent_at,category,audience').order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setRowsError(error.message)
        else setRows((data ?? []) as unknown as AdminRow[])
      })
    adminSupabase.from('app_version_announcements').select('id,version,message,created_at').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setVersionHistory((data ?? []) as typeof versionHistory))
  }, [section])
  useEffect(() => {
    if (!adminSupabase || section !== 'Audit log' || !supabaseUrl || !supabaseAnonKey) return
    const client = adminSupabase
    let cancelled = false
    const loadAudit = async () => {
      if (cancelled || adminSessionInvalid.current) return
      setAuditLoading(true); setAuditError('')
      const { response, expired } = await fetchAdminFunction('list-platform-audit?limit=150')
      if (!response) {
        setAuditLoading(false)
        if (expired) adminSessionInvalid.current = true
        setAuditError(expired ? 'Your admin session has expired. Sign in again.' : 'The audit service timed out or is temporarily unavailable. Try again.')
        return
      }
      const payload = await response.json().catch(() => null)
      if (cancelled) return
      setAuditLoading(false)
      if (!response.ok) { setAuditError(payload?.message ?? payload ?? `Audit service returned ${response.status}.`); return }
      const normalized = ((payload?.entries ?? []) as Omit<AuditEntry, 'category' | 'severity'>[]).map((entry) => {
        const action = entry.action.toLowerCase()
        const category = entry.source.toLowerCase().includes('github') ? 'Code & delivery' : action.includes('login') || action.includes('auth') || action.includes('password') ? 'Authentication' : action.includes('broadcast') || action.includes('notification') ? 'Communications' : action.includes('role') || action.includes('admin') || action.includes('access') ? 'Access control' : 'Data activity'
        const severity: AuditEntry['severity'] = action.includes('delete') || action.includes('ban') || action.includes('failed') || action.includes('error') ? 'critical' : action.includes('update') || action.includes('change') || action.includes('invite') ? 'warning' : 'info'
        return { ...entry, category, severity }
      })
      setAuditEntries(normalized)
    }
    void loadAudit()
    const refresh = () => { if (!adminSessionInvalid.current && document.visibilityState === 'visible' && navigator.onLine) void loadAudit() }
    const channel = client.channel(`admin-audit-live-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_audit_logs' }, refresh)
      .subscribe((status) => setAuditLive(status === 'SUBSCRIBED'))
    const poll = window.setInterval(refresh, 20000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', refresh)
      void client.removeChannel(channel)
    }
  }, [section, auditRefreshToken])
  useEffect(() => {
    if (!adminSupabase || section !== 'Users') return
    setUserRowsLoading(true)
    setUserRowsError('')
    let cancelled = false
    const loadUsers = async () => {
      if (adminSessionInvalid.current) {
        setUserRowsLoading(false)
        return
      }
      const { response, expired } = await fetchAdminFunction('list-platform-users?page=1&pageSize=100')
      if (!response) {
        if (!cancelled) {
          setUserRowsLoading(false)
          if (expired) adminSessionInvalid.current = true
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
  }, [section])
  const runMonitoringChecks = useCallback(async () => {
    if (!adminSupabase || !supabaseUrl || !supabaseAnonKey || monitorRunInProgress.current || adminSessionInvalid.current) return
    const client = adminSupabase
    const anonKey = supabaseAnonKey
    monitorRunInProgress.current = true
    setMonitorLoading(true); setMonitorError('')
    // Every operation below returns one of:
    //   'success'        -- request completed; measure() grades the tier by
    //                        latency via evaluateHealth (this is the fix for
    //                        every 2xx being labelled "Healthy" regardless
    //                        of how long it took).
    //   'failed'         -- a definite 4xx/auth/config-shaped error.
    //   'unhealthy'      -- a definite 5xx (server-side error).
    //   'unavailable'    -- the probe itself could not complete (timeout,
    //                        network failure) -- unknown, not confirmed down.
    //   'configuration'  -- the service has not been set up.
    const measure = async (name: string, source: string, checkType: string, operation: () => Promise<ProbeOutcome>): Promise<MonitorMetric> => {
      const started = performance.now()
      try {
        const result = await operation()
        const elapsed = Math.round(performance.now() - started)
        if (result.status === 'success') {
          const evaluated = evaluateHealth(elapsed)
          return { name, source, latency: elapsed, status: evaluated.status, detail: result.detail ?? evaluated.message, checkType, checkedAt: new Date().toISOString(), httpStatus: result.httpStatus ?? null, environment: currentEnvironment }
        }
        if (result.status === 'configuration' || result.status === 'unavailable') {
          return { name, source, latency: null, status: result.status, detail: result.detail ?? 'Not configured', checkType, checkedAt: new Date().toISOString(), environment: currentEnvironment }
        }
        // 'failed' (4xx/auth/config-shaped) or 'unhealthy' (5xx): a definite
        // error graded purely on that error, not on how fast it arrived.
        return { name, source, latency: elapsed, status: result.status, detail: result.detail ?? 'Request failed', checkType, checkedAt: new Date().toISOString(), failure: result.detail, httpStatus: result.httpStatus ?? null, environment: currentEnvironment }
      } catch (reason) {
        const detail = reason instanceof DOMException && reason.name === 'AbortError' ? `Timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` : reason instanceof Error ? reason.message : 'Request failed'
        return { name, source, latency: null, status: 'unavailable', detail: `Probe unavailable: ${detail}`, checkType, checkedAt: new Date().toISOString(), environment: currentEnvironment }
      }
    }
    const fetchProbe = async (url: string, headers: Record<string, string> = {}): Promise<ProbeOutcome> => {
      try {
        const response = await fetchWithTimeout(url, { headers })
        if (response.ok) return { status: 'success', httpStatus: response.status }
        if (response.status >= 500) return { status: 'unhealthy', httpStatus: response.status, detail: `HTTP ${response.status} ${response.statusText}` }
        return { status: 'failed', httpStatus: response.status, detail: `HTTP ${response.status} ${response.statusText}` }
      } catch (reason) {
        const detail = reason instanceof DOMException && reason.name === 'AbortError' ? `Timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` : reason instanceof Error ? reason.message : 'Connection failed'
        return { status: 'unavailable', detail: `Probe unavailable: ${detail}` }
      }
    }
    try {
      const session = (await withTimeout(client.auth.getSession())).data.session
      const token = await getAdminAccessToken()
      const realtime = async (): Promise<ProbeOutcome> => {
        if (monitorRealtimeStatus.current === 'SUBSCRIBED') return { status: 'success' }
        if (monitorRealtimeWait.current) return monitorRealtimeWait.current
        const channel = monitorRealtimeChannel.current ?? client.channel('admin-health')
        monitorRealtimeChannel.current = channel
        let settled = false
        const waitPromise = new Promise<ProbeOutcome>((resolve) => {
          const finish = (result: ProbeOutcome) => {
            if (settled) return
            settled = true
            window.clearTimeout(timeout)
            monitorRealtimeWait.current = null
            if (result.status !== 'success') {
              monitorRealtimeStatus.current = null
              monitorRealtimeChannel.current = null
              void client.removeChannel(channel)
            }
            resolve(result)
          }
          const timeout = window.setTimeout(() => finish({ status: 'unavailable', detail: `Realtime unavailable after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` }), ADMIN_REQUEST_TIMEOUT_MS)
          channel.subscribe((status) => {
            monitorRealtimeStatus.current = status
            if (status === 'SUBSCRIBED') finish({ status: 'success' })
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') finish({ status: 'unavailable', detail: `Realtime unavailable (${status.toLowerCase()})` })
          })
        })
        monitorRealtimeWait.current = settled ? null : waitPromise
        return waitPromise
      }
      const metrics = await Promise.all([
        // Probes an admin-scoped table (governed by is_platform_admin() RLS,
        // same as every other admin RPC on this page) instead of
        // `organizations`, whose only SELECT policy is member-scoped. A
        // platform admin is not necessarily a member of any organization, so
        // the previous probe could -- and did -- come back 401 for a
        // perfectly valid session, and with persisted monitoring now
        // recording every run, that false failure was piling up as fake
        // API downtime in the history/uptime charts below.
        measure('API', 'Supabase REST', 'Authenticated REST request', () => token ? fetchProbe(`${supabaseUrl}/rest/v1/platform_admin_access?select=user_id&limit=1`, adminAuthHeaders(token, anonKey)) : Promise.resolve({ status: 'failed', detail: 'No active admin session' })),
        measure('Database', 'Supabase', 'Protected RPC call (no SELECT *)', async () => { const { error } = await withTimeout(client.rpc('get_platform_overview')); return error ? { status: 'failed', detail: error.message } : { status: 'success', detail: 'Overview RPC completed' } }),
        measure('Auth', 'Supabase Auth', 'Local session read (no network round trip)', async () => session ? { status: 'success', detail: `Session present for ${session.user.email ?? 'signed-in admin'}` } : { status: 'failed', detail: 'No active admin session' }),
        measure('Storage', 'Supabase Storage', 'Bucket listing (metadata only, no file access)', async () => { const { error } = await withTimeout(client.storage.listBuckets()); return error ? { status: 'failed', detail: error.message } : { status: 'success', detail: 'Bucket listing completed' } }),
        measure('Realtime', 'Supabase Realtime', 'Channel subscribe (connection establishment only, not full channel health)', realtime),
        measure('Edge Functions', 'Supabase', 'Dedicated minimal ping function (auth check only, no database work)', async () => {
          const result = await fetchAdminFunction('platform-health-ping')
          if (result.expired) adminSessionInvalid.current = true
          if (!result.response) return { status: 'unavailable', detail: result.expired ? 'No active admin session' : 'Health-ping request timed out or is unavailable' }
          if (!result.response.ok) return result.response.status >= 500 ? { status: 'unhealthy', httpStatus: result.response.status, detail: `HTTP ${result.response.status}` } : { status: 'failed', httpStatus: result.response.status, detail: `HTTP ${result.response.status}` }
          return { status: 'success', httpStatus: result.response.status }
        }),
        measure('Frontend', 'Current browser', 'Browser navigation timing (page load), not a network probe', async () => {
          const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
          if (!entry) return { status: 'unavailable', detail: 'Navigation timing is not available in this browser' }
          const loadMs = Math.round(entry.loadEventEnd || entry.domContentLoadedEventEnd || entry.duration)
          return { status: 'success', detail: `Page finished loading in ${loadMs} ms` }
        }),
        measure('GitHub', 'Server-side GitHub API', 'Server-side repository lookup (token/rate-limit never exposed to the browser)', async () => {
          if (!token) return { status: 'failed', detail: 'No active admin session' }
          const result = await fetchAdminFunction('list-platform-audit?limit=1')
          if (result.expired) adminSessionInvalid.current = true
          if (!result.response) return { status: 'unavailable', detail: result.expired ? 'No active admin session' : 'Audit request timed out or is unavailable' }
          const response = result.response
          const payload = await response.json().catch(() => null)
          if (!response.ok) return { status: response.status >= 500 ? 'unhealthy' : 'failed', httpStatus: response.status, detail: `Audit integration returned HTTP ${response.status}` }
          const github = payload?.github
          if (!github) return { status: 'configuration', detail: 'GITHUB_REPOSITORY is not configured on the Edge Function' }
          if (!github.configured) return { status: github.status === 'failed' ? 'failed' : 'configuration', detail: github.detail ?? 'GitHub repository is not reachable' }
          const rateNote = typeof github.rateLimitRemaining === 'number' ? ` (${github.rateLimitRemaining} requests remaining)` : ''
          return { status: 'success', detail: `${github.detail ?? 'GitHub API connected'}${rateNote}` }
        }),
        measure('Vercel', 'Vercel', 'Deployment URL probe (only runs if a URL is configured)', async () => { const deploymentUrl = import.meta.env.VITE_VERCEL_PROJECT_URL; return deploymentUrl ? fetchProbe(deploymentUrl) : { status: 'configuration', detail: 'Not configured' } }),
      ])
      const checkedAt = new Date().toISOString()
      setMonitorMetrics(metrics)
      if (client && monitorStorageStateRef.current !== 'unavailable') {
        const { error } = await client.rpc('record_platform_monitoring_measurements', {
          measurements: metrics.map((metric) => ({
            service: metric.name, source: metric.source, status: metric.status, latency_ms: metric.latency,
            detail: metric.detail, check_type: metric.checkType, checked_at: metric.checkedAt, http_status: metric.httpStatus ?? null,
            environment: currentEnvironment,
          })),
        })
        if (error && (error.message.includes('does not exist') || error.code === 'PGRST202')) markMonitoringStorageUnavailable()
        else if (error) setMonitorError(`Checks completed but could not be persisted: ${error.message}`)
        else {
          monitorStorageStateRef.current = 'available'
          setMonitorStorageState('available')
          void loadPersistedMonitoring()
        }
      }
      setMonitorUpdatedAt(checkedAt)
    } catch (reason) {
      setMonitorError(reason instanceof Error ? reason.message : 'Monitoring checks could not be completed.')
    } finally {
      monitorRunInProgress.current = false
      setMonitorLoading(false)
    }
  }, [loadPersistedMonitoring, markMonitoringStorageUnavailable, monitorRange])
  useEffect(() => {
    if (section !== 'Monitoring') return
    void runMonitoringChecks()
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void runMonitoringChecks() }, 60000)
    return () => {
      window.clearInterval(interval)
      if (monitorRealtimeChannel.current) void adminSupabase?.removeChannel(monitorRealtimeChannel.current)
      monitorRealtimeChannel.current = null
      monitorRealtimeStatus.current = null
      monitorRealtimeWait.current = null
    }
  }, [runMonitoringChecks, section])
  const adminSectionIcons: Record<AdminSection, typeof LayoutDashboard> = {
    Overview: LayoutDashboard,
    Users,
    Organizations: ClipboardList,
    Subscriptions: CreditCard,
    Branches: GitBranch,
    Inventory: Package,
    Sales: ShoppingCart,
    Notifications: Bell,
    Messages: MessageCircle,
    'Audit log': History,
    Monitoring: Gauge,
    Settings,
  }
  const adminSectionGroups: { label: string; items: AdminSection[] }[] = [
    { label: 'Control room', items: ['Overview', 'Users', 'Organizations', 'Subscriptions'] },
    { label: 'Operations', items: ['Branches', 'Inventory', 'Sales'] },
    { label: 'Governance', items: ['Notifications', 'Messages', 'Audit log', 'Monitoring', 'Settings'] },
  ]
  const stats = [
    { label: 'Registered users', key: 'users', detail: 'Accounts registered in Supabase Auth.' },
    { label: 'Organizations', key: 'organizations', detail: 'Businesses created in the shared backend.' },
    { label: 'Branches', key: 'branches', detail: 'Active and archived branches across organizations.' },
    { label: 'Employees', key: 'employees', detail: 'Employee profiles across the platform.' },
    { label: 'Products', key: 'products', detail: 'Products currently tracked by businesses.' },
    { label: 'Customers', key: 'customers', detail: 'Customer records across organizations.' },
    { label: 'Sales', key: 'sales', detail: 'Recorded business sales transactions.' },
    { label: 'Invoices', key: 'invoices', detail: 'Invoices created by businesses.' },
    { label: 'Expenses', key: 'expenses', detail: 'Recorded business expenses.' },
    { label: 'Platform revenue', key: undefined, value: 'Unavailable', detail: 'Revenue data will appear here once billing is enabled.' },
  ]
  const renderRows = () => {
    if (rowsLoading) return <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div>
    if (rowsError) return <div className="form-error" role="alert">{rowsError}</div>
    if (!rows.length) return <div className="admin-empty">No {section.toLowerCase()} records found.</div>
    const columns = Object.keys(rows[0]).filter((key) => !['metadata', 'features'].includes(key)).slice(0, 7)
    return <div className="table-wrap"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{formatAdminValue(column, row[column])}</td>)}</tr>)}</tbody></table></div>
  }
  const sendNotification = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!adminSupabase || !notificationTitle.trim() || !notificationMessage.trim()) return
    setNotificationBusy(true); setNotificationStatus('Sending…')
    const { error } = await adminSupabase.rpc('send_platform_broadcast', {
      notification_title: notificationTitle.trim(),
      notification_message: notificationMessage.trim(),
      target_audience: 'all_users',
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
    setRows((current) => [{ title: notificationTitle, message: notificationMessage, status: 'sent', created_at: new Date().toISOString() }, ...current])
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
  const setPlatformUserStatus = async (userId: string, action: 'ban' | 'unban') => {
    if (!adminSupabase || !window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this user account?`)) return
    setUserRowsError('')
    const { error } = await adminSupabase.functions.invoke('manage-platform-user', { body: { userId, action } })
    if (error) { setUserRowsError(error.message); return }
    setUserRows((current) => current.map((row) => row.id === userId ? { ...row, status: action === 'ban' ? 'banned' : 'active' } : row))
  }
  const renderSection = () => {
    if (section === 'Overview') {
      const chartItems = stats.filter((stat) => stat.key).slice(0, 7)
      const maxValue = Math.max(...chartItems.map((stat) => overview?.[stat.key ?? ''] ?? 0), 1)
      const maxTrend = Math.max(...analytics.map((point) => Math.max(point.users, point.organizations, point.sales)), 1)
      return <>{overview ? <div className="admin-grid admin-summary-grid">{['users', 'organizations', 'sales', 'products'].map((key) => <article key={key} className="admin-card"><div className="admin-card-label">{key}</div><div className="admin-card-value">{(overview[key] ?? 0).toLocaleString()}</div><p>Current platform total</p></article>)}</div> : <div className="admin-grid admin-summary-grid">{[1, 2, 3, 4].map((item) => <article key={item} className="admin-card admin-card-skeleton"><Skeleton className="skeleton-line short" /><Skeleton className="skeleton-line value" /><Skeleton className="skeleton-line" /></article>)}</div>}<section className="admin-card admin-trend-card"><div className="admin-card-header"><div><h2>Platform growth</h2><p>New users, organizations, and sales recorded over time.</p></div><div className="admin-chart-controls"><select value={analyticsPeriod} onChange={(event) => setAnalyticsPeriod(event.target.value)} aria-label="Analytics period"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="12m">Last 12 months</option><option value="5y">Last 5 years</option></select><span className="admin-pill success">{analyticsLoading ? 'Updating' : 'Live data'}</span></div></div>{analyticsLoading ? <div className="admin-line-skeleton"><Skeleton /><Skeleton /><Skeleton /></div> : <div className="admin-trend-chart"><div className="admin-trend-grid"><i /><i /><i /><i /></div><svg viewBox="0 0 1000 280" preserveAspectRatio="none" aria-label="Platform growth chart"><polyline points={analytics.map((point, index) => `${analytics.length === 1 ? 500 : index / (analytics.length - 1) * 1000},${270 - point.users / maxTrend * 220}`).join(' ')} /><polyline className="org-line" points={analytics.map((point, index) => `${analytics.length === 1 ? 500 : index / (analytics.length - 1) * 1000},${270 - point.organizations / maxTrend * 220}`).join(' ')} /><polyline className="sales-line" points={analytics.map((point, index) => `${analytics.length === 1 ? 500 : index / (analytics.length - 1) * 1000},${270 - point.sales / maxTrend * 220}`).join(' ')} /></svg><div className="admin-trend-labels">{analytics.filter((_, index) => index === 0 || index === analytics.length - 1 || index % Math.max(1, Math.floor(analytics.length / 5)) === 0).map((point) => <span key={point.label}>{point.label}</span>)}</div></div>}<div className="admin-chart-legend"><span><i className="users-dot" /> Users</span><span><i className="org-dot" /> Organizations</span><span><i className="sales-dot" /> Sales</span></div></section><div className="admin-overview-columns"><section className="admin-card admin-chart-card"><div className="admin-card-header"><div><h2>Platform footprint</h2><p>Current records by operational area.</p></div><span className="admin-pill success">{overview ? 'Live data' : 'Connecting'}</span></div>{overview ? <div className="admin-bar-chart">{chartItems.map((stat) => <div className="admin-bar-item" key={stat.label}><div className="admin-bar-track"><i style={{ height: `${Math.max(6, ((overview[stat.key ?? ''] ?? 0) / maxValue) * 100)}%` }} /></div><strong>{(overview[stat.key ?? ''] ?? 0).toLocaleString()}</strong><small>{stat.label}</small></div>)}</div> : <div className="admin-chart-skeleton"><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>}</section><section className="admin-card admin-brief-card"><div className="admin-card-header"><div><h2>Platform monitoring</h2><p>{overview ? 'Live counts from the shared Supabase backend.' : 'Preparing the platform overview.'}</p></div></div><div className="admin-list">{['Users', 'Organizations', 'Branches', 'Inventory', 'Sales', 'Notifications'].map((name) => <div key={name} className="admin-list-item"><div><strong>{name}</strong><p>Open the live administrative view.</p></div><button className="text-btn" onClick={() => setSection(name as AdminSection)}>Open</button></div>)}</div></section></div></>
    }
    if (section === 'Users') return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Users</h2><p>Platform accounts loaded through the protected Auth listing Edge Function.</p></div><span className="admin-pill success">Secure live view</span></div>{userRowsLoading ? <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : userRowsError ? <div className="form-error" role="alert">{userRowsError}. Deploy list-platform-users and manage-platform-user, then refresh.</div> : !userRows.length ? <div className="admin-empty">No users found.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Created</th><th>Last sign in</th><th>Access</th></tr></thead><tbody>{userRows.map((row) => <tr key={String(row.id)}><td>{String(row.name ?? '—')}</td><td>{String(row.email ?? '—')}</td><td>{String(row.phone ?? '—')}</td><td><span className={`admin-status ${row.status === 'active' ? 'active' : ''}`}>{String(row.status ?? '—')}</span></td><td>{formatAdminValue('created_at', row.created_at)}</td><td>{row.last_sign_in_at ? formatAdminValue('last_sign_in_at', row.last_sign_in_at) : 'Never'}</td><td>{row.status === 'banned' ? <button className="text-btn" onClick={() => void setPlatformUserStatus(String(row.id), 'unban')}>Unban</button> : <button className="text-btn danger-text" onClick={() => void setPlatformUserStatus(String(row.id), 'ban')}>Ban</button>}</td></tr>)}</tbody></table></div>}</section>
    if (section === 'Monitoring') {
      const rangeMs: Record<string, number> = { '15m': 900000, '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
      const customRangeReady = monitorRange === 'custom' && monitorCustomFrom && monitorCustomTo
      const rangeStart = customRangeReady ? new Date(monitorCustomFrom).getTime() : rangeMs[monitorRange] ? Date.now() - rangeMs[monitorRange] : 0
      const rangeEnd = customRangeReady ? new Date(monitorCustomTo).getTime() : Date.now()
      const sourceMetrics = rangeStart ? monitorHistory.filter((metric) => { const t = new Date(metric.checkedAt).getTime(); return t >= rangeStart && t <= rangeEnd }).reduce<MonitorMetric[]>((latest, metric) => {
        const index = latest.findIndex((item) => item.name === metric.name)
        if (index === -1) latest.push(metric)
        else if (new Date(metric.checkedAt).getTime() > new Date(latest[index].checkedAt).getTime()) latest[index] = metric
        return latest
      }, []) : monitorMetrics
      const visibleMetrics = sourceMetrics.filter((metric) => (monitorStatusFilter === 'all' || metric.status === monitorStatusFilter) && (monitorEnvironmentFilter === 'all' || metric.environment === monitorEnvironmentFilter))
      const knownEnvironments = Array.from(new Set([currentEnvironment, ...monitorHistory.map((metric) => metric.environment).filter((value): value is string => Boolean(value))]))
      const definiteErrorStatuses: MonitorMetric['status'][] = ['failed', 'unhealthy', 'critical']
      const slowStatuses: MonitorMetric['status'][] = ['degraded', 'slow']
      const failures = monitorMetrics.filter((metric) => definiteErrorStatuses.includes(metric.status))
      const overall = computeOverallHealth(monitorMetrics)
      const historyPoints = monitorHistory.filter((metric) => { if (metric.latency == null) return false; const t = new Date(metric.checkedAt).getTime(); return (!rangeStart || t >= rangeStart) && t <= rangeEnd }).slice(-48)
      const statusTotals = monitorHistory.reduce((totals, metric) => {
        totals[metric.status] = (totals[metric.status] ?? 0) + 1
        return totals
      }, {} as Record<MonitorMetric['status'], number>)
      const okCount = (statusTotals.healthy ?? 0) + (statusTotals.degraded ?? 0) + (statusTotals.slow ?? 0)
      const badCount = (statusTotals.critical ?? 0) + (statusTotals.unhealthy ?? 0) + (statusTotals.failed ?? 0)
      const measuredCount = okCount + badCount
      const availability = measuredCount ? `${Math.round(okCount / measuredCount * 100)}%` : 'Not enough data'
      const statusClass = (status: MonitorMetric['status']) => status === 'healthy' ? 'active' : definiteErrorStatuses.includes(status) ? 'failed' : 'warn'
      return <section className="admin-card wide monitoring-page">
        <div className="admin-card-header">
          <div><h2>Infrastructure &amp; system health</h2><p>Persisted probe observations from this admin browser. Uptime is calculated only from stored outcomes; it is not a provider SLA.</p></div>
          <div className="admin-actions-inline">
            <button className="secondary" onClick={() => void runMonitoringChecks()} disabled={monitorLoading}><RefreshCw size={14} className={monitorLoading ? 'spin' : ''} />{monitorLoading ? 'Checking…' : 'Run checks'}</button>
          </div>
        </div>
        <div className={`monitoring-overall ${overall.tone}`}>
          <strong>{overall.label}</strong>
          <span>{overall.message}</span>
          <small>{monitorUpdatedAt ? `Last checked ${new Date(monitorUpdatedAt).toLocaleTimeString('en-NG')} · auto-refreshes every 60s while this tab is visible` : 'Auto-refreshes every 60s while this tab is visible'}</small>
        </div>
        {monitorStorageState === 'unavailable' && <div className="monitoring-storage-state" role="status"><strong>Monitoring storage not configured</strong><span>Local and browser checks continue on this device. Results are not being persisted until the monitoring migration is deployed.</span></div>}
        {monitorError && monitorStorageState !== 'unavailable' && <div className="form-error" role="alert">{monitorError}</div>}
        <div className="monitoring-filters">
          <label>Status
            <select value={monitorStatusFilter} onChange={(event) => setMonitorStatusFilter(event.target.value)}>
              <option value="all">All states</option>
              <option value="healthy">Healthy</option>
              <option value="degraded">Degraded</option>
              <option value="slow">Slow</option>
              <option value="critical">Critical performance</option>
              <option value="unhealthy">Unhealthy</option>
              <option value="failed">Failed</option>
              <option value="configuration">Configuration needed</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
          <label>Time range
            <select value={monitorRange} onChange={(event) => setMonitorRange(event.target.value)}>
              <option value="all">Current check set</option>
              <option value="15m">Last 15 minutes</option>
              <option value="1h">Last hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range…</option>
            </select>
          </label>
          {monitorRange === 'custom' && <>
            <label>From
              <input type="datetime-local" value={monitorCustomFrom} onChange={(event) => setMonitorCustomFrom(event.target.value)} max={monitorCustomTo || undefined} />
            </label>
            <label>To
              <input type="datetime-local" value={monitorCustomTo} onChange={(event) => setMonitorCustomTo(event.target.value)} min={monitorCustomFrom || undefined} max={new Date().toISOString().slice(0, 16)} />
            </label>
          </>}
          <label>Environment
            <select value={monitorEnvironmentFilter} onChange={(event) => setMonitorEnvironmentFilter(event.target.value)}>
              <option value="all">All environments</option>
              {knownEnvironments.map((env) => <option key={env} value={env}>{env.charAt(0).toUpperCase() + env.slice(1)}</option>)}
            </select>
          </label>
          <span className="monitoring-environment-badge">This device is running: {currentEnvironment.charAt(0).toUpperCase() + currentEnvironment.slice(1)}</span>
        </div>
        <div className="monitoring-summary">
          <article><span>Observed availability</span><strong>{availability}</strong><small>{measuredCount ? `${okCount} healthy or slow / ${badCount} failed` : 'No persisted checks yet'}</small></article>
          <article><span>Persisted observations</span><strong>{monitorHistory.length}</strong><small>Across configured services</small></article>
          <article><span>Current errors</span><strong>{badCount}</strong><small>Definite failures in selected history</small></article>
        </div>
        <div className="admin-monitor-grid">
          {visibleMetrics.map((metric) => {
            const hints = slowServiceHints[metric.name]
            const showHints = (slowStatuses.includes(metric.status) || metric.status === 'critical' || metric.status === 'unhealthy') && hints
            return <article className="admin-monitor-card" key={metric.name}>
              <div className="admin-card-label">{metric.name} <span>· {metric.source}</span></div>
              <strong>{metric.latency == null ? 'Not measured' : `${metric.latency} ms`}</strong>
              <span className={`admin-status ${statusClass(metric.status)}`}>{statusLabel(metric.status)}</span>
              <small>{metric.detail}</small>
              <p className="admin-monitor-checktype">Check type: {metric.checkType}</p>
              {showHints && <div className="admin-monitor-hints"><span>Possible causes include:</span><ul>{hints.map((hint) => <li key={hint}>{hint}</li>)}</ul></div>}
              <time>{new Date(metric.checkedAt).toLocaleString('en-NG')}</time>
            </article>
          })}
        </div>
        {monitorLoading && <div className="admin-line-skeleton"><Skeleton /><Skeleton /><Skeleton /></div>}
        <div className="monitoring-chart-grid">
          <section className="monitoring-history">
            <div className="admin-card-header"><div><h3>Latency history</h3><p>{historyPoints.length ? `${historyPoints.length} persisted response measurements` : 'No persisted measurements yet.'}</p></div></div>
            {historyPoints.length > 1 && <div className="monitor-history-chart" aria-label="Persisted response latency history">{historyPoints.map((point, index) => <i key={`${point.name}-${point.checkedAt}-${index}`} title={`${point.name}: ${point.latency} ms`} style={{ height: `${Math.max(8, Math.min(100, (point.latency ?? 0) / Math.max(...historyPoints.map((item) => item.latency ?? 0), 1) * 100))}%` }} />)}</div>}
          </section>
          <section className="monitoring-availability">
            <div className="admin-card-header"><div><h3>Service availability &amp; latency</h3><p>Observed outcomes and response-time distribution in the selected period. Historical performance data is not available until checks have been persisted for this window.</p></div></div>
            {monitorSummary.length ? monitorSummary.map((item) => <div className="availability-row" key={item.service}>
              <strong>{item.service}</strong>
              <span><i style={{ width: `${item.uptime_percent ?? 0}%` }} /></span>
              <b>{item.uptime_percent == null ? 'No data' : `${item.uptime_percent}%`}</b>
              <small>
                {item.checks} checks · {item.failed} failed
                {item.consecutive_failures > 0 && <> · <strong className="availability-streak">{item.consecutive_failures} in a row failing now</strong></>}
                {item.p95_latency_ms != null && ` · p50 ${item.p50_latency_ms}ms · p95 ${item.p95_latency_ms}ms · p99 ${item.p99_latency_ms}ms`}
                {item.min_latency_ms != null && ` · min ${item.min_latency_ms}ms / max ${item.max_latency_ms}ms`}
              </small>
            </div>) : <p className="monitoring-empty">No persisted service history yet.</p>}
          </section>
        </div>
        <section className="monitoring-failures">
          <h3>Recent failures</h3>
          {failures.length ? failures.map((metric) => <div key={metric.name}><strong>{metric.name}</strong><span>{metric.failure}</span><time>{new Date(metric.checkedAt).toLocaleString('en-NG')}</time></div>) : <p>No failures recorded in the current browser check.</p>}
        </section>
        <div className="monitoring-notes">
          <Wifi size={16} />
          <span>{monitorStorageState === 'unavailable' ? 'Browser checks are local only. Deploy the platform monitoring migration to enable authenticated persistence and historical charts.' : 'Observations are authenticated, bounded, and stored in Supabase. Browser checks describe this admin device and network only; missing checks are unknown, not downtime. GitHub and Vercel remain unmeasured until configured.'}</span>
        </div>
        <div className="monitoring-notes monitoring-explainer">
          <Gauge size={16} />
          <span>A successful request can still be slow, and one measurement does not establish long-term performance — that's what the p50/p95/p99 figures above are for. Edge Function and external checks (GitHub, Vercel) can be slower on a cold start; a response under 1 second is fine for an occasional admin check but would be slow for a frequent user-facing interaction.</span>
        </div>
      </section>
    }
    if (section === 'Settings') return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Admin settings</h2><p>Profile and environment-safe controls for this console.</p></div></div><div className="admin-settings"><div><span className="admin-card-label">Signed-in account</span><strong>{email}</strong></div><div><span className="admin-card-label">Access model</span><strong>Platform admin role + Supabase RLS</strong></div><div><span className="admin-card-label">Revenue</span><strong>Unavailable until billing is implemented</strong></div></div></section>
    if (section === 'Audit log') {
      const filteredAudit = auditEntries.filter((entry) => (!auditCategory || auditCategory === 'all' || entry.category === auditCategory) && (!auditSeverity || auditSeverity === 'all' || entry.severity === auditSeverity) && (!auditSource || auditSource === 'all' || entry.source === auditSource) && (!auditFrom || entry.createdAt.slice(0, 10) >= auditFrom) && (!auditTo || entry.createdAt.slice(0, 10) <= auditTo))
      const normalizeAction = (action: string) => action.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Security &amp; audit center</h2><p>Normalized, organization-aware activity from platform controls, business records, and configured integrations.</p></div><div className="admin-actions-inline"><span className="admin-pill success">{auditLoading ? 'Loading activity' : `${filteredAudit.length} of ${auditEntries.length} events`}</span><span className="admin-live-indicator">{auditLive ? 'Live updates on' : 'Polling every 20s'}</span><button className="secondary" onClick={() => setAuditRefreshToken((value) => value + 1)} disabled={auditLoading}><RefreshCw size={14} className={auditLoading ? 'spin' : ''} />Refresh</button></div></div><div className="audit-filters"><label>Category<select value={auditCategory} onChange={(event) => setAuditCategory(event.target.value)}><option value="all">All categories</option>{Array.from(new Set(auditEntries.map((entry) => entry.category))).map((value) => <option key={value}>{value}</option>)}</select></label><label>Severity<select value={auditSeverity} onChange={(event) => setAuditSeverity(event.target.value)}><option value="all">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label>Source<select value={auditSource} onChange={(event) => setAuditSource(event.target.value)}><option value="all">All sources</option>{Array.from(new Set(auditEntries.map((entry) => entry.source))).map((value) => <option key={value}>{value}</option>)}</select></label><label>From<input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} /></label><label>To<input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} /></label></div>{auditError ? <div className="form-error" role="alert">{auditError}. Deploy list-platform-audit and refresh.</div> : auditLoading ? <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !filteredAudit.length ? <div className="admin-empty">No audit activity matches these filters.</div> : <div className="audit-timeline">{filteredAudit.map((entry) => <article className="audit-event" key={`${entry.source}-${entry.id}`}><div className="audit-event-marker"><History size={15} /></div><div className="audit-event-body"><div className="audit-event-meta"><span className={`audit-source ${entry.source.toLowerCase().replace(/\s+/g, '-')}`}>{entry.source}</span><span className={`audit-severity ${entry.severity}`}>{entry.severity}</span><time>{formatAdminValue('created_at', entry.createdAt)}</time></div><h3>{normalizeAction(entry.action)}</h3><p>{entry.category} · {entry.target}{entry.organizationId ? ` · ${entry.organizationId}` : ''}</p><small>{entry.actor ?? 'System'}</small>{Object.keys(entry.metadata ?? {}).length > 0 && <details className="audit-details"><summary>Event details</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details>}</div></article>)}</div>}</section>
    }
    if (section === 'Messages') return <AdminMessages onUnreadChange={setUnreadSupportCount} />
    if (section === 'Notifications') return <><section className="admin-card wide"><div className="admin-card-header"><div><h2>Send broadcast</h2><p>Broadcasts are authorized, fanned out to user notification centers, and audited by the database.</p></div></div>    <form className="admin-form" onSubmit={sendNotification}><label>Title<input required value={notificationTitle} onChange={(event) => setNotificationTitle(event.target.value)} placeholder="Scheduled maintenance" /></label><label>Message<textarea required value={notificationMessage} onChange={(event) => setNotificationMessage(event.target.value)} placeholder="Write the message users should receive." /></label><button className="primary" type="submit" disabled={notificationBusy}>{notificationBusy ? 'Sending…' : 'Send broadcast'}</button>{notificationStatus && <p className="muted" role="status">{notificationStatus}</p>}    </form></section><section className="admin-card wide"><div className="admin-card-header"><div><h2>Publish a version</h2><p>Version announcements use the same trusted database fan-out as broadcasts.</p></div></div><form className="admin-form" onSubmit={publishVersion}><label>Version<input required value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.1.0" /></label><label>Message<textarea required value={versionMessage} onChange={(event) => setVersionMessage(event.target.value)} placeholder="What changed in this release?" /></label>    <button className="primary" type="submit" disabled={notificationBusy}>{notificationBusy ? 'Publishing…' : 'Publish announcement'}</button></form><div className="admin-version-history">{versionHistory.length ? versionHistory.map((item) => <article className="admin-version-entry" key={item.id}><div><strong>v{item.version}</strong><time>{new Date(item.created_at).toLocaleString('en-NG')}</time></div><p>{item.message}</p></article>) : <p className="admin-empty">No version announcements yet.</p>}</div></section><section className="admin-card wide"><div className="admin-card-header"><div><h2>Notification history</h2><p>Broadcasts recorded in the platform audit trail.</p></div></div>{renderRows()}</section></>
    return <section className="admin-card wide"><div className="admin-card-header"><div><h2>{section}</h2><p>Live records from the shared Supabase backend.</p></div><button className="secondary" onClick={() => setSection('Overview')}>Back to overview</button></div>{renderRows()}</section>
  }
  const toggleSidebar = () => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    window.localStorage.setItem('zerobyte.admin-sidebar-collapsed', String(next))
  }
  const selectSection = (nextSection: AdminSection) => {
    setSection(nextSection)
    setMobileNavOpen(false)
  }
  return <div className={`admin-shell${sidebarCollapsed ? ' admin-sidebar-collapsed' : ''}${mobileNavOpen ? ' admin-mobile-nav-open' : ''}`}><button className="admin-nav-backdrop" aria-label="Close admin navigation" onClick={() => setMobileNavOpen(false)} /><aside className="admin-sidebar"><div className="admin-brand-row"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Admin</small></div><button className="admin-collapse-button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div><div className="admin-role"><span>Signed in as</span><strong>{email}</strong></div><nav className="admin-nav" aria-label="Admin navigation">{adminSectionGroups.map((group) => <div className="admin-nav-group" key={group.label}><span className="admin-nav-label">{group.label}</span>{group.items.map((name) => { const Icon = adminSectionIcons[name]; return <button key={name} className={`admin-nav-item${section === name ? ' active' : ''}`} onClick={() => selectSection(name)} title={sidebarCollapsed ? name : undefined} aria-label={name}><Icon size={16} aria-hidden="true" /><span>{name}</span>{name === 'Messages' && unreadSupportCount > 0 && <b className="admin-nav-badge">{unreadSupportCount > 9 ? '9+' : unreadSupportCount}</b>}</button> })}</div>)}</nav><div className="admin-sidebar-footer"><button className="secondary admin-footer-button" onClick={onBack}><ArrowRight size={15} /><span>Return to app</span></button><button className="text-btn admin-footer-button" onClick={onLogout}><LogOut size={15} /><span>Log out</span></button></div></aside><main className="admin-main"><header className="admin-header"><div className="admin-title-row"><button className="admin-mobile-menu" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label="Open admin navigation"><Menu size={20} /></button><div><span className="section-label">Platform operations</span><h1>{section}</h1></div></div><div className="admin-actions"><button className="secondary" onClick={() => selectSection('Audit log')}>View audit log</button><button className="primary" onClick={() => selectSection('Notifications')}>Send broadcast</button></div></header>{overviewError && <div className="form-error" role="alert">{overviewError}</div>}{renderSection()}</main></div>
}


export default AdminConsole
