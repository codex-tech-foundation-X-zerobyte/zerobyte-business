import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronRight, CircleHelp, ClipboardList, FileText, Gauge, GitBranch, History, LayoutDashboard,
  LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, Palette, Plus, Receipt, RefreshCw, Search, Settings, ShoppingCart, ShieldCheck, UserRound, Users, Wallet, Wifi, X,
} from 'lucide-react'
import { adminSupabase, isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from './lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getCurrentUserContext } from './lib/identity'
import {
  clearOfflineUserData, discardOfflineUserData, clearSaleDraft, enqueueOfflineOperation, newOfflineOperationId, readSaleDraft,
  readOfflineOperations, readScopedCache, saveSaleDraft, syncOfflineQueue, writeScopedCache,
  type OfflineScope,
} from './lib/offline'
import type { View } from './lib/types'
import { appPath, appRoute, navigateTo } from './lib/routing'

const navGroups = [
  { label: 'Run the business', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Sales', icon: ShoppingCart }, { name: 'Inventory', icon: Package }, { name: 'Customers', icon: Users }] },
  { label: 'Keep records', items: [{ name: 'Receipts', icon: Receipt }, { name: 'Invoices', icon: FileText }, { name: 'Expenses', icon: Wallet }, { name: 'Records', icon: ClipboardList }, { name: 'Reports', icon: BarChart3 }] },
  { label: 'People & places', items: [{ name: 'Branches', icon: LayoutDashboard }, { name: 'Workforce', icon: Users }, { name: 'User Accounts', icon: ShieldCheck }] },
]
type ProductRow = { id: string; name: string; sku: string; stock: number; price: number; cost_price: number; category?: string }
type CustomerRow = { id: string; name: string; email: string | null; phone: string | null }
type OrganizationRow = { id: string; name: string; role?: string }
type NotificationRow = { id: string; organization_id?: string; title: string; body: string; read_at: string | null; created_at: string }
type RecordRange = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom'

function normalizeLogoUrl(value: string | null | undefined) {
  if (!value) return ''
  return value.replace('/storage/v1/object/business-logos/', '/storage/v1/object/public/business-logos/')
}

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

function recordDates(range: RecordRange, from: string, to: string) {
  if (range === 'all') return { from: '', to: '' }
  if (range === 'custom') return { from, to }
  const end = new Date()
  const start = new Date(end)
  if (range === 'today') start.setHours(0, 0, 0, 0)
  if (range === 'week') start.setDate(end.getDate() - 6)
  if (range === 'month') start.setDate(end.getDate() - 29)
  if (range === 'year') start.setDate(end.getDate() - 364)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function RecordFilters({ storageKey, onChange }: { storageKey: string; onChange: (dates: { from: string; to: string }) => void }) {
  const [range, setRange] = useState<RecordRange>(() => (window.localStorage.getItem(`${storageKey}.range`) as RecordRange) || 'all')
  const [from, setFrom] = useState(() => window.localStorage.getItem(`${storageKey}.from`) || '')
  const [to, setTo] = useState(() => window.localStorage.getItem(`${storageKey}.to`) || '')
  useEffect(() => {
    const dates = recordDates(range, from, to)
    window.localStorage.setItem(`${storageKey}.range`, range); window.localStorage.setItem(`${storageKey}.from`, from); window.localStorage.setItem(`${storageKey}.to`, to)
    onChange(dates)
  }, [from, onChange, range, storageKey, to])
  return <div className="record-filter-bar"><label>Period<select value={range} onChange={(event) => setRange(event.target.value as RecordRange)}><option value="all">All time</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="year">Last 12 months</option><option value="custom">Custom range</option></select></label>{range === 'custom' && <><label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label></>}</div>
}

function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />
}

function WorkspaceSkeleton() {
  return <div className="workspace-skeleton" aria-label="Loading workspace"><aside className="skeleton-sidebar"><Skeleton className="skeleton-logo" /><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /></aside><main className="skeleton-main"><Skeleton className="skeleton-heading" /><div className="skeleton-metrics">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="skeleton-card" />)}</div><Skeleton className="skeleton-chart" /><div className="skeleton-columns"><Skeleton className="skeleton-panel" /><Skeleton className="skeleton-panel" /></div></main></div>
}

function OfflineStatus({ scope }: { scope: OfflineScope | null }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [counts, setCounts] = useState({ pending: 0, conflicts: 0, failed: 0 })
  const refresh = useCallback(async () => {
    if (!scope) return
    const operations = await readOfflineOperations(scope)
    setCounts({
      pending: operations.filter((operation) => operation.status === 'pending' || operation.status === 'in_flight').length,
      conflicts: operations.filter((operation) => operation.status === 'conflict').length,
      failed: operations.filter((operation) => operation.status === 'failed').length,
    })
  }, [scope])
  const sync = useCallback(async () => {
    if (!scope || !supabase || !navigator.onLine) return
    setSyncing(true)
    try {
      await syncOfflineQueue(supabase, scope)
      await refresh()
    } finally {
      setSyncing(false)
    }
  }, [refresh, scope])
  useEffect(() => {
    const onOnline = () => { setOnline(true); void sync() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refresh()
    if (navigator.onLine) void sync()
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [refresh, sync])
  const needsAttention = counts.conflicts + counts.failed > 0
  if (online && !syncing && counts.pending === 0 && !needsAttention) return null
  const message = !online
    ? 'You are offline. Cached products and customers remain available.'
    : syncing
      ? 'Syncing your changes…'
      : needsAttention
        ? `${counts.conflicts + counts.failed} change${counts.conflicts + counts.failed === 1 ? '' : 's'} require attention.`
        : `${counts.pending} offline change${counts.pending === 1 ? '' : 's'} waiting to sync.`
  return <div className={`offline-status ${!online ? 'offline-status-offline' : needsAttention ? 'offline-status-attention' : 'offline-status-pending'}`} role="status" aria-live="polite"><span className="offline-dot" />{message}{online && !syncing && counts.pending > 0 && <button className="text-btn" onClick={() => void sync()}>Sync now</button>}</div>
}

function App() {
  const [sessionReady, setSessionReady] = useState(false); const [signedIn, setSignedIn] = useState(false); const [email, setEmail] = useState(''); const [displayName, setDisplayName] = useState('')
  const [adminAuthorized, setAdminAuthorized] = useState(false)
  const isAdminPath = (pathname: string) => {
    const route = appRoute(pathname)
    return route === '/admin' || route === '/admin.html'
  }
  const adminEntry = document.documentElement.dataset.zerobyteApp === 'admin' || isAdminPath(window.location.pathname)
  const [path, setPath] = useState(adminEntry ? '/admin' : appRoute())

  const navigate = (nextPath: string) => {
    navigateTo(nextPath)
    setPath(nextPath)
  }

  useEffect(() => {
    const onPopState = () => setPath(isAdminPath(window.location.pathname) ? '/admin' : appRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const authClient = adminEntry ? adminSupabase : supabase
    if (!authClient) { setSessionReady(true); return }
    authClient.auth.getSession().then(({ data }) => {
      const hasSession = Boolean(data.session)
      setSignedIn(hasSession); setEmail(data.session?.user.email ?? ''); setDisplayName(data.session?.user.user_metadata?.full_name ?? data.session?.user.user_metadata?.name ?? '')
      if (hasSession && appRoute() === '/auth') {
        navigate('/')
      }
      if (hasSession && adminEntry) void adminSupabase?.rpc('is_platform_admin').then(({ data: allowed }) => setAdminAuthorized(Boolean(allowed)))
      setSessionReady(true)
    })
    const { data } = authClient.auth.onAuthStateChange((_event, session) => {
      const hasSession = Boolean(session)
      setSignedIn(hasSession); setEmail(session?.user.email ?? ''); setDisplayName(session?.user.user_metadata?.full_name ?? session?.user.user_metadata?.name ?? '')
      if (hasSession) {
        if (appRoute() === '/auth') {
          navigate('/')
        }
        if (adminEntry) void adminSupabase?.rpc('is_platform_admin').then(({ data: allowed }) => setAdminAuthorized(Boolean(allowed)))
      }
    })
    return () => data.subscription.unsubscribe()
  }, [adminEntry])

  if (!sessionReady) return <WorkspaceSkeleton />
  if (path === '/terms' || path === '/privacy' || path === '/cookies') return <LegalPage type={path.slice(1) as 'terms' | 'privacy' | 'cookies'} navigate={navigate} />
  if (!isSupabaseConfigured) return <ConfigurationRequired />
  if (path === '/admin') {
    if (!isSupabaseConfigured) return <AdminConsoleUnavailable />
    if (!signedIn) return <AdminLogin />
    if (!adminAuthorized) return <AdminAccessDenied email={email} onBack={() => navigate('/')} />
    return <AdminConsole email={email} onBack={() => navigate('/')} onLogout={() => { void adminSupabase?.auth.signOut(); window.localStorage.removeItem('zerobyte.admin-access'); navigate('/') }} />
  }
  if (!signedIn && path !== '/auth') return <Landing onStart={() => navigate('/auth')} />
  if (path === '/auth') return <AuthScreen />
  return <Workspace email={email} displayName={displayName} />
}

function Landing({ onStart }: { onStart: () => void }) {
  return <div className="landing"><header className="landing-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Business</small></div><div className="landing-nav-actions"><span>Built for Nigerian businesses</span><button className="text-btn" onClick={onStart}>Sign in <ArrowRight size={14} /></button></div></header><main className="landing-main"><section className="landing-hero"><div className="hero-copy"><span className="auth-kicker">The calm operating system for your business</span><h1>Run your business<br /><em>from one clear place.</em></h1><p>Sales, stock, customers and expenses — connected around the way Nigerian businesses actually work.</p><div className="hero-actions"><button className="primary hero-button" onClick={onStart}>Start for free <ArrowRight size={17} /></button><span className="hero-note">No payment details · Real records after sign-in</span></div></div><div className="hero-visual"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-console"><div className="console-top"><span>zerøbyte / workspace</span><span className="live-dot">● secure</span></div><div className="console-total"><small>Your business data</small><strong>Connected records</strong><span>Nothing invented before you sign in</span></div><div className="console-bars"><i style={{ height: '34%' }} /><i style={{ height: '54%' }} /><i style={{ height: '43%' }} /><i style={{ height: '72%' }} /><i style={{ height: '62%' }} /><i style={{ height: '88%' }} /></div><div className="console-foot"><span><Package size={13} /> Stock & sales</span><span><Users size={13} /> Your team</span></div></div></div></section><section className="landing-proof"><div><strong>One workspace.</strong><span>Less switching, more knowing.</span></div><div><strong>Real records.</strong><span>Nothing invented for your dashboard.</span></div><div><strong>Made for naira.</strong><span>Prices and expenses in the language of home.</span></div></section><section className="landing-features"><div><span className="section-label">Everything in view</span><h2>Small business deserves<br />serious software.</h2><p className="landing-detail">The daily tools you need, connected around one reliable record of the business.</p></div><div className="feature-list"><div><Package /><strong>Inventory without guesswork</strong><p>Know what you have, what is low, and what needs restocking.</p></div><div><ShoppingCart /><strong>Sales that update stock</strong><p>Complete a sale once. Your records and inventory stay aligned.</p></div><div><Users /><strong>Customers and team</strong><p>Keep customer details, staff access, branches, and roles organized.</p></div><div><Wallet /><strong>Expenses in context</strong><p>Record operating costs and see them alongside the work they support.</p></div><div><Receipt /><strong>Receipts ready to share</strong><p>Find completed sales quickly and give customers a clear record.</p></div><div><BarChart3 /><strong>Reports you can trust</strong><p>See performance from activity your team actually recorded.</p></div></div></section><section className="landing-how"><div><span className="section-label">How it works</span><h2>From first setup<br />to daily clarity.</h2><p className="landing-detail">Zerøbyte follows the rhythm of a real business, so every action leaves the next person with a clearer view.</p><button className="secondary landing-how-button" onClick={onStart}>Create your workspace <ArrowRight size={15} /></button></div><div className="how-steps"><div><span>01</span><div><strong>Set up your workspace</strong><p>Add your business, branches, products, and team permissions.</p></div></div><div><span>02</span><div><strong>Record the work</strong><p>Capture sales, stock intake, customers, expenses, and receipts as they happen.</p></div></div><div><span>03</span><div><strong>Understand what changed</strong><p>Use records and reports to review the day, spot gaps, and plan the next move.</p></div></div></div></section><section className="landing-data"><div><span className="section-label">Clear by default</span><h2>You stay in control of the records.</h2><p>We collect only what the workspace needs to authenticate users, organize business records, and keep actions auditable. No payment details are collected in V1.</p></div><div className="data-points"><span><Check size={16} /> Account identity and authentication details</span><span><Check size={16} /> Business, branch, product, customer and sales records you enter</span><span><Check size={16} /> Security, audit and attendance timestamps</span></div></section><InstallPrompt /></main><footer className="landing-footer"><span>Zerøbyte Business</span><span>Run the work. Keep the signal.</span><div className="legal-links"><a href={appPath('/privacy')}>Privacy</a><a href={appPath('/terms')}>Terms</a><a href={appPath('/cookies')}>Cookies</a></div></footer></div>
}

function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  if (!installEvent) return null
  return <section className="install-strip"><div><strong>Take Zerøbyte with you</strong><p>Install the workspace on your device for a focused, app-like experience.</p></div><button className="secondary" onClick={async () => { await installEvent.prompt(); setInstallEvent(null) }}>Install app <ArrowRight size={15} /></button></section>
}

function LegalPage({ type, navigate }: { type: 'terms' | 'privacy' | 'cookies'; navigate: (path: string) => void }) {
  const content = {
    terms: { label: 'Terms of service', title: 'A clear agreement for using Zerøbyte.', intro: 'These V1 terms describe the basic rules for using Zerøbyte Business. They should be reviewed by qualified counsel before a public commercial launch.', sections: [['Using the service', 'You may use Zerøbyte to manage lawful business records for an organization you are authorized to represent. Keep your login secure, use accurate information, and do not attempt to access another organization’s data.'], ['Your content and records', 'Your organization retains ownership of the business information you enter. You are responsible for its accuracy, lawful collection, customer permissions, exports, retention, and reconciliation of records.'], ['History and exports', 'Records are stored against your organization in Supabase. The Records workspace lets authorized users filter historical sales, expenses, and stock intake and export the selected view as CSV. CSV files are downloads you control and should be stored securely.'], ['Availability and changes', 'Zerøbyte is evolving. Features may change, and access may be suspended where needed to protect users, the service, or the security of stored records.'], ['Payments', 'Payments and subscription billing are not implemented in this V1. No payment details are requested by the application.']] },
    privacy: { label: 'Privacy policy', title: 'Privacy that is easy to understand.', intro: 'This V1 privacy summary explains the data Zerøbyte is designed to collect, why it is used, and what is intentionally out of scope. It is not legal advice.', sections: [['Data we collect', 'Account data such as email address and authentication metadata; organization data such as business name, branches, roles and permissions; operational records such as products, stock, customers, sales, expenses, invoices and attendance; and security/audit timestamps needed to protect the workspace.'], ['How we use it', 'We use this information to authenticate you, show organization-scoped workspaces, process the records you request, enforce permissions, maintain auditability, support offline drafts and sync, and improve reliability.'], ['Storage and exports', 'Business records are stored in Supabase under organization-scoped access policies. Limited preferences such as record filters may be stored in local storage, while offline drafts and queued operations use IndexedDB. CSV exports are generated in your browser and are not sent to Zerøbyte.'], ['What we do not collect in V1', 'We do not collect card or bank payment details, do not implement payment processing, and do not use business records to create fake dashboard metrics or advertising profiles.'], ['Your choices', 'You can request correction or deletion of records through the organization owner. You can clear local browser storage, sign out, or request account and platform deletion through the service operator.']] },
    cookies: { label: 'Cookie notice', title: 'Small files, clearly explained.', intro: 'Zerøbyte uses the minimum browser storage needed for a reliable signed-in experience.', sections: [['Essential session storage', 'Supabase Auth uses browser storage to keep your signed-in session available between page refreshes. Without it, you would need to sign in again after every refresh.'], ['Organization-scoped offline storage', 'Authorized products, customers, persistent sale drafts, and sync operations are stored in IndexedDB under the signed-in account and organization scope. These are used for offline continuity, not advertising.'], ['Preferences', 'The app may use local storage for interface preferences such as sidebar state, selected organization, theme, and Records period filters.'], ['No advertising cookies', 'The V1 application does not use advertising, cross-site tracking, or analytics cookies.'], ['Managing storage', 'You can clear browser storage from your browser settings. Clearing essential session storage signs you out; clearing IndexedDB removes unsynced offline drafts and queued operations; clearing local storage resets preferences.']] },
  }[type]
  return <div className="legal-shell"><header className="legal-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Business</small></div><button className="text-btn" onClick={() => navigate('/auth')}>Sign in <ArrowRight size={14} /></button></header><main className="legal-content"><span className="section-label">{content.label}</span><h1>{content.title}</h1><p className="legal-intro">{content.intro}</p><div className="legal-updated">V1 draft · Last updated September 2026</div>{content.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}</main><footer className="landing-footer legal-footer"><span>Zerøbyte Business</span><div className="legal-links"><button onClick={() => navigate('/privacy')}>Privacy</button><button onClick={() => navigate('/terms')}>Terms</button><button onClick={() => navigate('/cookies')}>Cookies</button></div></footer></div>
}

function ConfigurationRequired() {
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>Connect your workspace</h1><p>Add your Supabase URL and publishable key to <code>.env.local</code>, then restart the dev server. Zerøbyte never shows invented business data.</p><code>VITE_SUPABASE_URL=…<br />VITE_SUPABASE_ANON_KEY=…</code></div></div>
}

function AdminConsoleUnavailable() {
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>Admin console unavailable</h1><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and define <code>VITE_ADMIN_EMAILS</code> with the approved platform-admin addresses.</p><code>VITE_ADMIN_EMAILS=hello@zerobyte.app,ops@zerobyte.app</code></div></div>
}

function AdminLogin() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!adminSupabase) {
      setError('Supabase is not configured for the admin console.');
      return;
    }
    setLoading(true); setError('');
    const { error: authError } = await adminSupabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    const { data: allowed, error: accessError } = await adminSupabase.rpc('is_platform_admin')
    if (accessError || !allowed) {
      setError('This account does not have platform administrator access.');
      void adminSupabase.auth.signOut();
      return;
    }
    window.localStorage.setItem('zerobyte.admin-access', 'true');
    window.location.href = appPath('/admin.html')
  }

  return <div className="auth-shell"><div className="auth-brand"><div className="brand-mark">ø</div><strong>Zerøbyte</strong><span>Admin Console</span></div><div className="auth-layout"><section className="auth-intro"><span className="auth-kicker">Platform operations</span><h1>Platform access<br /><em>restricted to approved admins.</em></h1><p>Only verified platform administrators can access the admin console. Business ownership, worker roles, and organization membership do not grant platform access.</p></section><form className="auth-card" onSubmit={handleSubmit}><span className="auth-kicker">Secure sign-in</span><h2>Admin login</h2><label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@zerobyte.app" /></label><label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary entry-button" disabled={loading}>{loading ? 'Authenticating…' : 'Enter admin console'}</button></form></div></div>
}

function AdminAccessDenied({ email, onBack }: { email: string; onBack: () => void }) {
  const safeEmail = email || 'Unknown user';
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>Access denied</h1><p>{safeEmail} is not assigned a platform admin role in this environment.</p><p>The admin URL is intentionally separate from the user application. Business ownership and worker access do not grant platform administration rights.</p><button className="primary" onClick={onBack}>Return to business app</button></div></div>
}

function AdminConsole({ email, onBack, onLogout }: { email: string; onBack: () => void; onLogout: () => void }) {
  type AdminSection = 'Overview' | 'Users' | 'Organizations' | 'Branches' | 'Inventory' | 'Sales' | 'Notifications' | 'Audit log' | 'Monitoring' | 'Settings'
  type AdminRow = Record<string, string | number | null>
  type AuditEntry = { source: string; id: string; action: string; actor: string | null; target: string; organizationId: string | null; metadata: Record<string, unknown>; createdAt: string; category: string; severity: 'info' | 'warning' | 'critical' }
  type MonitorMetric = { name: string; source: string; latency: number | null; status: 'healthy' | 'failed' | 'unavailable' | 'configuration'; detail: string; checkedAt: string; failure?: string; httpStatus?: number | null }
  type MonitorSummary = { service: string; checks: number; healthy: number; failed: number; unavailable: number; configuration: number; uptime_percent: number | null; average_latency_ms: number | null }
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('zerobyte.admin-sidebar-collapsed') === 'true')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [monitorMetrics, setMonitorMetrics] = useState<MonitorMetric[]>([])
  const [monitorHistory, setMonitorHistory] = useState<MonitorMetric[]>([])
  const [monitorSummary, setMonitorSummary] = useState<MonitorSummary[]>([])
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorError, setMonitorError] = useState('')
  const [monitorStorageState, setMonitorStorageState] = useState<'unknown' | 'available' | 'unavailable'>('unknown')
  const [monitorUpdatedAt, setMonitorUpdatedAt] = useState<string | null>(null)
  const [monitorStatusFilter, setMonitorStatusFilter] = useState('all')
  const [monitorRange, setMonitorRange] = useState('all')
  const monitorRealtimeChannel = useRef<RealtimeChannel | null>(null)
  const monitorRealtimeStatus = useRef<string | null>(null)
  const monitorRealtimeWait = useRef<Promise<{ status: MonitorMetric['status']; detail: string }> | null>(null)
  const monitorRunInProgress = useRef(false)
  const monitorStorageStateRef = useRef<'unknown' | 'available' | 'unavailable'>('unknown')
  const markMonitoringStorageUnavailable = useCallback(() => {
    if (monitorStorageStateRef.current === 'unavailable') return
    monitorStorageStateRef.current = 'unavailable'
    setMonitorStorageState('unavailable')
    setMonitorError('Monitoring storage not configured. Local browser checks will continue, but observations will not be persisted.')
  }, [])
  const loadPersistedMonitoring = useCallback(async (period = '7d') => {
    if (!adminSupabase || monitorStorageStateRef.current === 'unavailable') return
    const { data, error } = await adminSupabase.rpc('get_platform_monitoring', { period_key: period })
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
    setMonitorHistory((data?.measurements ?? []).map((metric: { service: string; source: string; status: MonitorMetric['status']; latency_ms: number | null; detail: string; checked_at: string; http_status?: number | null }) => ({
      name: metric.service, source: metric.source, status: metric.status, latency: metric.latency_ms, detail: metric.detail, checkedAt: metric.checked_at, httpStatus: metric.http_status,
    })))
    setMonitorSummary((data?.summary ?? []) as MonitorSummary[])
  }, [markMonitoringStorageUnavailable])
  useEffect(() => {
    if (!adminSupabase || section !== 'Monitoring' || monitorStorageState === 'unavailable') return
    if (monitorStorageState === 'unknown') {
      void loadPersistedMonitoring(monitorRange === 'all' ? '7d' : monitorRange)
      return
    }
    const channel = adminSupabase.channel(`platform-monitoring-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_monitoring_measurements' }, () => void loadPersistedMonitoring(monitorRange === 'all' ? '7d' : monitorRange))
      .subscribe()
    return () => { void adminSupabase?.removeChannel(channel) }
  }, [loadPersistedMonitoring, monitorRange, monitorStorageState, section])
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
    if (!adminSupabase || section === 'Overview' || section === 'Settings' || section === 'Users' || section === 'Audit log' || section === 'Monitoring') return
    const client = adminSupabase
    setRowsLoading(true)
    setRowsError('')
    const loadRows = async () => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (sessionError || !sessionData.session || !supabaseUrl || !supabaseAnonKey) {
        setRowsLoading(false)
        setRowsError('Your admin session has expired. Sign out and sign in again.')
        return
      }
      const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/get-platform-records?resource=${encodeURIComponent(section)}`, {
        headers: adminAuthHeaders(sessionData.session.access_token, supabaseAnonKey),
      })
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
    const anonKey = supabaseAnonKey
    let cancelled = false
    const loadAudit = async () => {
      setAuditLoading(true); setAuditError('')
      const { data: sessionData } = await client.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) { setAuditLoading(false); setAuditError('Your admin session has expired. Sign in again.'); return }
      const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/list-platform-audit?limit=150`, { headers: adminAuthHeaders(token, anonKey) })
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
    const refresh = () => { if (document.visibilityState === 'visible' && navigator.onLine) void loadAudit() }
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
    const client = adminSupabase
    setUserRowsLoading(true)
    setUserRowsError('')
    let cancelled = false
    const loadUsers = async () => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (sessionError || !sessionData.session || !supabaseUrl || !supabaseAnonKey) {
        if (!cancelled) {
          setUserRowsLoading(false)
          setUserRowsError('Your admin session has expired. Sign out and sign in again.')
        }
        return
      }
      const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/list-platform-users?page=1&pageSize=100`, {
        headers: adminAuthHeaders(sessionData.session.access_token, supabaseAnonKey),
      })
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
    if (!adminSupabase || !supabaseUrl || !supabaseAnonKey || monitorRunInProgress.current) return
    const client = adminSupabase
    const anonKey = supabaseAnonKey
    monitorRunInProgress.current = true
    setMonitorLoading(true); setMonitorError('')
    const measure = async (name: string, source: string, operation: () => Promise<{ status: MonitorMetric['status']; detail: string }>): Promise<MonitorMetric> => {
      const started = performance.now()
      try {
        const result = await operation()
        const latency = result.status === 'configuration' || result.status === 'unavailable' ? null : Math.round(performance.now() - started)
        return { name, source, latency, status: result.status, detail: result.detail, checkedAt: new Date().toISOString(), failure: result.status === 'failed' ? result.detail : undefined }
      } catch (reason) {
        const detail = reason instanceof DOMException && reason.name === 'AbortError' ? `Timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` : reason instanceof Error ? reason.message : 'Request failed'
        return { name, source, latency: null, status: 'unavailable', detail: `Probe unavailable: ${detail}`, checkedAt: new Date().toISOString() }
      }
    }
    const fetchProbe = async (url: string, headers: Record<string, string> = {}) => {
      try {
        const response = await fetchWithTimeout(url, { headers })
        return response.ok ? { status: 'healthy' as const, detail: `HTTP ${response.status}` } : { status: 'failed' as const, detail: `HTTP ${response.status} ${response.statusText}` }
      } catch (reason) {
        const detail = reason instanceof DOMException && reason.name === 'AbortError' ? `Timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` : reason instanceof Error ? reason.message : 'Connection failed'
        return { status: 'unavailable' as const, detail: `Probe unavailable: ${detail}` }
      }
    }
    try {
      const session = (await withTimeout(client.auth.getSession())).data.session
      const token = session?.access_token
      const realtime = async () => {
        if (monitorRealtimeStatus.current === 'SUBSCRIBED') return { status: 'healthy' as const, detail: 'Channel subscribed' }
        if (monitorRealtimeWait.current) return monitorRealtimeWait.current
        const channel = monitorRealtimeChannel.current ?? client.channel('admin-health')
        monitorRealtimeChannel.current = channel
        let settled = false
        const waitPromise = new Promise<{ status: MonitorMetric['status']; detail: string }>((resolve) => {
          const finish = (result: { status: MonitorMetric['status']; detail: string }) => {
            if (settled) return
            settled = true
            window.clearTimeout(timeout)
            monitorRealtimeWait.current = null
            if (result.status !== 'healthy') {
              monitorRealtimeStatus.current = null
              monitorRealtimeChannel.current = null
              void client.removeChannel(channel)
            }
            resolve(result)
          }
          const timeout = window.setTimeout(() => finish({ status: 'unavailable', detail: `Realtime unavailable after ${ADMIN_REQUEST_TIMEOUT_MS / 1000}s` }), ADMIN_REQUEST_TIMEOUT_MS)
          channel.subscribe((status) => {
            monitorRealtimeStatus.current = status
            if (status === 'SUBSCRIBED') finish({ status: 'healthy', detail: 'Channel subscribed' })
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') finish({ status: 'unavailable', detail: `Realtime unavailable (${status.toLowerCase()})` })
          })
        })
        monitorRealtimeWait.current = settled ? null : waitPromise
        return waitPromise
      }
      const metrics = await Promise.all([
        measure('API', 'Supabase REST', () => token ? fetchProbe(`${supabaseUrl}/rest/v1/organizations?select=id&limit=1`, adminAuthHeaders(token, anonKey)) : Promise.resolve({ status: 'failed' as const, detail: 'No active admin session' })),
        measure('Database', 'Supabase', async () => { const { error } = await withTimeout(client.rpc('get_platform_overview')); return error ? { status: 'failed', detail: error.message } : { status: 'healthy', detail: 'Overview RPC completed' } }),
        measure('Auth', 'Supabase Auth', async () => session ? { status: 'healthy', detail: `Session for ${session.user.email ?? 'signed-in admin'}` } : { status: 'failed', detail: 'No active admin session' }),
        measure('Storage', 'Supabase Storage', async () => { const { error } = await withTimeout(client.storage.listBuckets()); return error ? { status: 'failed', detail: error.message } : { status: 'healthy', detail: 'Bucket listing completed' } }),
        measure('Realtime', 'Supabase Realtime', realtime),
        measure('Edge Functions', 'Supabase', () => token ? fetchProbe(`${supabaseUrl}/functions/v1/get-platform-records?resource=Notifications`, adminAuthHeaders(token, anonKey)) : Promise.resolve({ status: 'failed' as const, detail: 'No active admin session' })),
        measure('Frontend', 'Current browser', () => fetchProbe(window.location.href)),
        measure('GitHub', 'GitHub API', async () => { const repository = import.meta.env.VITE_GITHUB_REPOSITORY; return repository ? fetchProbe(`https://api.github.com/repos/${repository}`, { Accept: 'application/vnd.github+json' }) : { status: 'configuration', detail: 'Repository is not configured for browser checks' } }),
        measure('Vercel', 'Vercel', async () => { const deploymentUrl = import.meta.env.VITE_VERCEL_PROJECT_URL; return deploymentUrl ? fetchProbe(deploymentUrl) : { status: 'configuration', detail: 'Deployment URL is not configured for browser checks' } }),
      ])
      const checkedAt = new Date().toISOString()
      setMonitorMetrics(metrics)
      if (client && monitorStorageStateRef.current !== 'unavailable') {
        const { error } = await client.rpc('record_platform_monitoring_measurements', {
          measurements: metrics.map((metric) => ({
            service: metric.name, source: metric.source, status: metric.status, latency_ms: metric.latency,
            detail: metric.detail, checked_at: metric.checkedAt, http_status: metric.httpStatus ?? null,
          })),
        })
        if (error && (error.message.includes('does not exist') || error.code === 'PGRST202')) markMonitoringStorageUnavailable()
        else if (error) setMonitorError(`Checks completed but could not be persisted: ${error.message}`)
        else {
          monitorStorageStateRef.current = 'available'
          setMonitorStorageState('available')
          void loadPersistedMonitoring(monitorRange === 'all' ? '7d' : monitorRange)
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
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void runMonitoringChecks() }, 30000)
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
    Branches: GitBranch,
    Inventory: Package,
    Sales: ShoppingCart,
    Notifications: Bell,
    'Audit log': History,
    Monitoring: Gauge,
    Settings,
  }
  const adminSectionGroups: { label: string; items: AdminSection[] }[] = [
    { label: 'Control room', items: ['Overview', 'Users', 'Organizations'] },
    { label: 'Operations', items: ['Branches', 'Inventory', 'Sales'] },
    { label: 'Governance', items: ['Notifications', 'Audit log', 'Monitoring', 'Settings'] },
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
      const rangeStart = monitorRange === '24h' ? Date.now() - 86400000 : monitorRange === '7d' ? Date.now() - 604800000 : 0
      const sourceMetrics = rangeStart ? monitorHistory.filter((metric) => new Date(metric.checkedAt).getTime() >= rangeStart).reduce<MonitorMetric[]>((latest, metric) => {
        const index = latest.findIndex((item) => item.name === metric.name)
        if (index === -1) latest.push(metric)
        else if (new Date(metric.checkedAt).getTime() > new Date(latest[index].checkedAt).getTime()) latest[index] = metric
        return latest
      }, []) : monitorMetrics
      const visibleMetrics = sourceMetrics.filter((metric) => monitorStatusFilter === 'all' || metric.status === monitorStatusFilter)
      const failures = monitorMetrics.filter((metric) => metric.status === 'failed')
      const overall = monitorMetrics.some((metric) => metric.status === 'failed') ? 'Action needed' : monitorMetrics.some((metric) => metric.status === 'configuration' || metric.status === 'unavailable') ? 'Partial coverage' : monitorMetrics.length ? 'Healthy' : 'Waiting for checks'
      const historyPoints = monitorHistory.filter((metric) => metric.latency != null && (!rangeStart || new Date(metric.checkedAt).getTime() >= rangeStart)).slice(-48)
      const statusTotals = monitorHistory.reduce((totals, metric) => { totals[metric.status] += 1; return totals }, { healthy: 0, failed: 0, unavailable: 0, configuration: 0 })
      const measuredCount = statusTotals.healthy + statusTotals.failed
      const availability = measuredCount ? `${Math.round(statusTotals.healthy / measuredCount * 100)}%` : 'Not enough data'
      return <section className="admin-card wide monitoring-page"><div className="admin-card-header"><div><h2>Infrastructure &amp; system health</h2><p>Persisted probe observations from this admin browser. Uptime is calculated only from stored healthy/failed checks; it is not a provider SLA.</p></div><div className="admin-actions-inline"><span className={`admin-pill ${overall === 'Healthy' ? 'success' : ''}`}>{overall}{monitorUpdatedAt ? ` · ${new Date(monitorUpdatedAt).toLocaleTimeString('en-NG')}` : ''}</span><button className="secondary" onClick={() => void runMonitoringChecks()} disabled={monitorLoading}><RefreshCw size={14} className={monitorLoading ? 'spin' : ''} />{monitorLoading ? 'Checking…' : 'Run checks'}</button></div></div>{monitorStorageState === 'unavailable' && <div className="monitoring-storage-state" role="status"><strong>Monitoring storage not configured</strong><span>Local and browser checks continue on this device. Results are not being persisted until the monitoring migration is deployed.</span></div>}{monitorError && monitorStorageState !== 'unavailable' && <div className="form-error" role="alert">{monitorError}</div>}<div className="monitoring-filters"><label>Status<select value={monitorStatusFilter} onChange={(event) => setMonitorStatusFilter(event.target.value)}><option value="all">All states</option><option value="healthy">Healthy</option><option value="failed">Failed</option><option value="configuration">Configuration needed</option><option value="unavailable">Unavailable</option></select></label><label>Time range<select value={monitorRange} onChange={(event) => setMonitorRange(event.target.value)}><option value="all">Current check set</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label></div><div className="monitoring-summary"><article><span>Observed availability</span><strong>{availability}</strong><small>{measuredCount ? `${statusTotals.healthy} healthy / ${statusTotals.failed} failed` : 'No persisted checks yet'}</small></article><article><span>Persisted observations</span><strong>{monitorHistory.length}</strong><small>Across configured services</small></article><article><span>Current errors</span><strong>{statusTotals.failed}</strong><small>Failed probes in selected history</small></article></div><div className="admin-monitor-grid">{visibleMetrics.map((metric) => <article className="admin-monitor-card" key={metric.name}><div className="admin-card-label">{metric.name} <span>· {metric.source}</span></div><strong>{metric.latency == null ? 'Not measured' : `${metric.latency} ms`}</strong><span className={`admin-status ${metric.status === 'healthy' ? 'active' : metric.status === 'failed' ? 'failed' : ''}`}>{metric.status === 'healthy' ? 'Healthy response' : metric.status === 'failed' ? 'Request failed' : metric.status === 'configuration' ? 'Not configured' : 'Unavailable'}</span><small>{metric.detail}</small><time>{new Date(metric.checkedAt).toLocaleString('en-NG')}</time></article>)}</div>{monitorLoading && <div className="admin-line-skeleton"><Skeleton /><Skeleton /><Skeleton /></div>}<div className="monitoring-chart-grid"><section className="monitoring-history"><div className="admin-card-header"><div><h3>Latency history</h3><p>{historyPoints.length ? `${historyPoints.length} persisted response measurements` : 'No persisted measurements yet.'}</p></div></div>{historyPoints.length > 1 && <div className="monitor-history-chart" aria-label="Persisted response latency history">{historyPoints.map((point, index) => <i key={`${point.name}-${point.checkedAt}-${index}`} title={`${point.name}: ${point.latency} ms`} style={{ height: `${Math.max(8, Math.min(100, (point.latency ?? 0) / Math.max(...historyPoints.map((item) => item.latency ?? 0), 1) * 100))}%` }} />)}</div>}</section><section className="monitoring-availability"><div className="admin-card-header"><div><h3>Service availability</h3><p>Observed healthy vs failed checks in the selected period.</p></div></div>{monitorSummary.length ? monitorSummary.map((item) => <div className="availability-row" key={item.service}><strong>{item.service}</strong><span><i style={{ width: `${item.uptime_percent ?? 0}%` }} /></span><b>{item.uptime_percent == null ? 'No data' : `${item.uptime_percent}%`}</b><small>{item.checks} checks · {item.failed} failed</small></div>) : <p className="monitoring-empty">No persisted service history yet.</p>}</section></div><section className="monitoring-failures"><h3>Recent failures</h3>{failures.length ? failures.map((metric) => <div key={metric.name}><strong>{metric.name}</strong><span>{metric.failure}</span><time>{new Date(metric.checkedAt).toLocaleString('en-NG')}</time></div>) : <p>No failures recorded in the current browser check.</p>}</section><div className="monitoring-notes"><Wifi size={16} /><span>{monitorStorageState === 'unavailable' ? 'Browser checks are local only. Deploy the platform monitoring migration to enable authenticated persistence and historical charts.' : 'Observations are authenticated, bounded, and stored in Supabase. Browser checks describe this admin device and network only; missing checks are unknown, not downtime. GitHub and Vercel remain unmeasured until configured.'}</span></div></section>
    }
    if (section === 'Settings') return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Admin settings</h2><p>Profile and environment-safe controls for this console.</p></div></div><div className="admin-settings"><div><span className="admin-card-label">Signed-in account</span><strong>{email}</strong></div><div><span className="admin-card-label">Access model</span><strong>Platform admin role + Supabase RLS</strong></div><div><span className="admin-card-label">Revenue</span><strong>Unavailable until billing is implemented</strong></div></div></section>
    if (section === 'Audit log') {
      const filteredAudit = auditEntries.filter((entry) => (!auditCategory || auditCategory === 'all' || entry.category === auditCategory) && (!auditSeverity || auditSeverity === 'all' || entry.severity === auditSeverity) && (!auditSource || auditSource === 'all' || entry.source === auditSource) && (!auditFrom || entry.createdAt.slice(0, 10) >= auditFrom) && (!auditTo || entry.createdAt.slice(0, 10) <= auditTo))
      const normalizeAction = (action: string) => action.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Security &amp; audit center</h2><p>Normalized, organization-aware activity from platform controls, business records, and configured integrations.</p></div><div className="admin-actions-inline"><span className="admin-pill success">{auditLoading ? 'Loading activity' : `${filteredAudit.length} of ${auditEntries.length} events`}</span><span className="admin-live-indicator">{auditLive ? 'Live updates on' : 'Polling every 20s'}</span><button className="secondary" onClick={() => setAuditRefreshToken((value) => value + 1)} disabled={auditLoading}><RefreshCw size={14} className={auditLoading ? 'spin' : ''} />Refresh</button></div></div><div className="audit-filters"><label>Category<select value={auditCategory} onChange={(event) => setAuditCategory(event.target.value)}><option value="all">All categories</option>{Array.from(new Set(auditEntries.map((entry) => entry.category))).map((value) => <option key={value}>{value}</option>)}</select></label><label>Severity<select value={auditSeverity} onChange={(event) => setAuditSeverity(event.target.value)}><option value="all">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label>Source<select value={auditSource} onChange={(event) => setAuditSource(event.target.value)}><option value="all">All sources</option>{Array.from(new Set(auditEntries.map((entry) => entry.source))).map((value) => <option key={value}>{value}</option>)}</select></label><label>From<input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} /></label><label>To<input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} /></label></div>{auditError ? <div className="form-error" role="alert">{auditError}. Deploy list-platform-audit and refresh.</div> : auditLoading ? <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !filteredAudit.length ? <div className="admin-empty">No audit activity matches these filters.</div> : <div className="audit-timeline">{filteredAudit.map((entry) => <article className="audit-event" key={`${entry.source}-${entry.id}`}><div className="audit-event-marker"><History size={15} /></div><div className="audit-event-body"><div className="audit-event-meta"><span className={`audit-source ${entry.source.toLowerCase().replace(/\s+/g, '-')}`}>{entry.source}</span><span className={`audit-severity ${entry.severity}`}>{entry.severity}</span><time>{formatAdminValue('created_at', entry.createdAt)}</time></div><h3>{normalizeAction(entry.action)}</h3><p>{entry.category} · {entry.target}{entry.organizationId ? ` · ${entry.organizationId}` : ''}</p><small>{entry.actor ?? 'System'}</small>{Object.keys(entry.metadata ?? {}).length > 0 && <details className="audit-details"><summary>Event details</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details>}</div></article>)}</div>}</section>
    }
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
  return <div className={`admin-shell${sidebarCollapsed ? ' admin-sidebar-collapsed' : ''}${mobileNavOpen ? ' admin-mobile-nav-open' : ''}`}><button className="admin-nav-backdrop" aria-label="Close admin navigation" onClick={() => setMobileNavOpen(false)} /><aside className="admin-sidebar"><div className="admin-brand-row"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Admin</small></div><button className="admin-collapse-button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div><div className="admin-role"><span>Signed in as</span><strong>{email}</strong></div><nav className="admin-nav" aria-label="Admin navigation">{adminSectionGroups.map((group) => <div className="admin-nav-group" key={group.label}><span className="admin-nav-label">{group.label}</span>{group.items.map((name) => { const Icon = adminSectionIcons[name]; return <button key={name} className={`admin-nav-item${section === name ? ' active' : ''}`} onClick={() => selectSection(name)} title={sidebarCollapsed ? name : undefined} aria-label={name}><Icon size={16} aria-hidden="true" /><span>{name}</span></button> })}</div>)}</nav><div className="admin-sidebar-footer"><button className="secondary admin-footer-button" onClick={onBack}><ArrowRight size={15} /><span>Return to app</span></button><button className="text-btn admin-footer-button" onClick={onLogout}><LogOut size={15} /><span>Log out</span></button></div></aside><main className="admin-main"><header className="admin-header"><div className="admin-title-row"><button className="admin-mobile-menu" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label="Open admin navigation"><Menu size={20} /></button><div><span className="section-label">Platform operations</span><h1>{section}</h1></div></div><div className="admin-actions"><button className="secondary" onClick={() => selectSection('Audit log')}>View audit log</button><button className="primary" onClick={() => selectSection('Notifications')}>Send broadcast</button></div></header>{overviewError && <div className="form-error" role="alert">{overviewError}</div>}{renderSection()}</main></div>
}

function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in'); const [accountMode, setAccountMode] = useState<'owner' | 'worker'>('owner'); const [fullName, setFullName] = useState(''); const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setError(''); setMessage('')
    let result
    if (mode === 'sign-up') {
      result = await supabase.auth.signUp({ email: identifier, password, options: { data: { full_name: fullName.trim() } } })
    } else if (accountMode === 'owner') {
      result = await supabase.auth.signInWithPassword({ email: identifier, password })
    } else if (!supabaseUrl || !supabaseAnonKey) {
      setError('Worker sign-in is not configured.')
      setBusy(false)
      return
    } else {
      const response = await fetch(`${supabaseUrl}/functions/v1/resolve-worker-login`, { method: 'POST', headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
        setError(payload?.error ?? 'Invalid worker credentials')
        setBusy(false)
        return
      }
      result = await supabase.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token })
    }
    setBusy(false)
    if (result.error) {
      const normalized = result.error.message.toLowerCase()
      if (mode === 'sign-in' && normalized.includes('invalid login credentials')) {
        setError('That email and password do not match. Check both values or create an account first.')
      } else if (mode === 'sign-in' && normalized.includes('email not confirmed')) {
        setError('Confirm your email address from the Supabase confirmation email, then sign in again.')
      } else {
        setError(result.error.message)
      }
    } else if (mode === 'sign-up') setMessage('Check your email to confirm your account, then sign in.')
  }
  return <div className="auth-shell"><div className="auth-brand"><div className="brand-mark">ø</div><strong>Zerøbyte</strong><span>Business</span></div><div className="auth-layout"><section className="auth-intro"><span className="auth-kicker">Business OS for Nigeria</span><h1>Know what sold.<br /><em>Know what’s next.</em></h1><p>One calm workspace for stock, customers, sales, receipts and expenses — built around how your business actually runs.</p><div className="auth-trust"><span><Check size={14} /> Naira-first workflows</span><span><Check size={14} /> Your data, your organization</span><span><Check size={14} /> No payment required</span></div></section><form className="auth-card" onSubmit={submit}>  <div className={`auth-mode-switch ${accountMode}`} role="tablist" aria-label="Choose how to sign in"><span className="auth-mode-indicator" aria-hidden="true" /><button type="button" role="tab" aria-selected={accountMode === 'owner'} className={accountMode === 'owner' ? 'active' : ''} onClick={() => { setAccountMode('owner'); setMode('sign-in'); setIdentifier(''); setPassword(''); setError(''); setMessage('') }}>Owner</button><button type="button" role="tab" aria-selected={accountMode === 'worker'} className={accountMode === 'worker' ? 'active' : ''} onClick={() => { setAccountMode('worker'); setMode('sign-in'); setIdentifier(''); setPassword(''); setError(''); setMessage('') }}>Worker</button></div><div className="auth-mode-heading"><span className="auth-kicker">{mode === 'sign-in' ? 'Welcome back' : 'Start your workspace'}</span><span className="auth-mode-context">{accountMode === 'owner' ? 'Business owner access' : 'Team member access'}</span></div><h2>{mode === 'sign-in' ? `Sign in as ${accountMode}` : 'Create your owner account'}</h2><p>{mode === 'sign-in' ? (accountMode === 'worker' ? 'Use your worker email or workspace-scoped employee ID and current password.' : 'Continue where your business left off.') : 'Create an owner account, then set up your business in minutes.'}</p>{mode === 'sign-up' && <label>Full name<input type="text" required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" /></label>}<label>{mode === 'sign-up' || accountMode === 'owner' ? 'Email address' : 'Email or employee ID'}<input type={accountMode === 'owner' || mode === 'sign-up' ? 'email' : 'text'} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={accountMode === 'worker' ? 'workspace-slug:EMP-001 or worker@business.com' : 'you@business.com'} /></label><label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your current password" /></label>{error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success" role="status">{message}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button>{accountMode === 'owner' && <button type="button" className="entry-link" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); setMessage('') }}>{mode === 'sign-in' ? 'New here? Create an account' : 'Already registered? Sign in'}</button>}</form></div></div>
}

function ChangePasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (password.length < 8 || password !== confirmation) {
      setError(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.')
      return
    }

    setBusy(true); setError('')
    const { error: passwordError } = await supabase.auth.updateUser({ password })
    if (!passwordError) {
      const { error: markError } = await supabase.rpc('mark_worker_password_changed')
      if (markError) setError(markError.message)
      else onComplete()
    } else setError(passwordError.message)
    setBusy(false)
  }
  return <div className="auth-loading"><form className="auth-card" onSubmit={submit}><div className="brand-mark">ø</div><span className="auth-kicker">First sign-in</span><h1>Choose a new password</h1><p>Your temporary password has been accepted. Change it before using the workspace.</p><label>New password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><label>Confirm password<input required minLength={8} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Saving…' : 'Save new password'} <ArrowRight size={16} /></button><button type="button" className="entry-link" onClick={() => void supabase?.auth.signOut()}>Sign out</button></form></div>
}

function PasswordSettings() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    if (!supabase) return
    if (password.length < 8 || password !== confirmation) { setError(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.'); return }
    setBusy(true)
    const { error: result } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (result) setError(result.message)
    else { setPassword(''); setConfirmation(''); setMessage('Password changed successfully.') }
  }
  return <form className="settings-security-form" onSubmit={submit}><label>New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><label>Confirm new password<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repeat your new password" /></label><button className="secondary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>{message && <div className="form-success" role="status">{message}</div>}{error && <div className="form-error" role="alert">{error}</div>}</form>
}

function NotificationCenter({ userId, orgId }: { userId: string; orgId: string }) {
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

function Workspace({ email, displayName }: { email: string; displayName: string }) {
  const [view, setView] = useState<View>('Overview'); const [open, setOpen] = useState(false); const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('zerobyte.sidebar-collapsed') === 'true'); const [dark, setDark] = useState(() => window.localStorage.getItem('zerobyte.theme') !== 'light'); const [search, setSearch] = useState(''); const [orgId, setOrgId] = useState<string | null>(null); const [orgName, setOrgName] = useState(''); const [userId, setUserId] = useState<string | null>(null); const [organizations, setOrganizations] = useState<OrganizationRow[]>([]); const [role, setRole] = useState('member'); const [loading, setLoading] = useState(true); const [identityError, setIdentityError] = useState(''); const [mustChangePassword, setMustChangePassword] = useState(false)
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    getCurrentUserContext(supabase).then((context) => {
      if (cancelled) return
      const available = context.memberships.flatMap((membership) => membership.organization ? [{ id: membership.organization.id, name: membership.organization.name, role: membership.role }] : [])
      const storedId = window.localStorage.getItem(`zerobyte.organization.${context.userId}`)
      // Never silently choose an organization. A user may belong to multiple
      // workspaces and the first row is not a safe authorization context.
      const selected = available.find((organization) => organization.id === storedId)
      const membership = context.memberships.find((item) => item.organization_id === selected?.id)
      setOrganizations(available); setRole(membership?.role ?? 'member'); setUserId(context.userId)
      setMustChangePassword(Boolean(context.employee?.must_change_password))
      setOrgId(selected?.id ?? null); setOrgName(selected?.name ?? ''); setLoading(false)
    }).catch((error: Error) => { if (!cancelled) { setIdentityError(error.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])
  const workerMode = role === 'member'
  useEffect(() => { if (workerMode && ['Inventory', 'Records', 'Expenses', 'Invoices', 'Reports', 'Branches', 'User Accounts', 'Settings'].includes(view)) setView('Overview') }, [workerMode, view])
  if (loading) return <WorkspaceSkeleton />
  if (identityError) return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>We could not load your workspace</h1><p>{identityError}</p><button className="primary" onClick={() => window.location.reload()}>Try again</button></div></div>
  if (mustChangePassword) return <ChangePasswordScreen onComplete={() => setMustChangePassword(false)} />
  const switchOrganization = (nextId: string) => {
    const next = organizations.find((organization) => organization.id === nextId)
    if (!next) return
    setOrgId(next.id); setOrgName(next.name); setRole(next.role ?? 'member'); setView('Overview')
    if (userId) window.localStorage.setItem(`zerobyte.organization.${userId}`, next.id)
  }
  if (!orgId && organizations.length > 1) {
    return <OrganizationPicker organizations={organizations} onSelect={(id) => switchOrganization(id)} />
  }
  if (!orgId) return <WorkspaceSetup email={email} onCreated={(id, name) => { setOrgId(id); setOrgName(name) }} />
  const toggleSidebar = () => { const next = !collapsed; setCollapsed(next); window.localStorage.setItem('zerobyte.sidebar-collapsed', String(next)) }
  const visibleGroups = workerMode ? navGroups.map((group) => ({ ...group, items: group.items.filter((item) => ['Overview', 'Sales', 'Customers', 'Receipts', 'Workforce'].includes(item.name)) })).filter((group) => group.items.length) : navGroups
  const offlineScope: OfflineScope | null = userId && orgId ? { userId, organizationId: orgId } : null
  const signOut = async () => {
    if (!userId) return
    if (offlineScope) {
      if (navigator.onLine && supabase) await syncOfflineQueue(supabase, offlineScope)
      const pending = await readOfflineOperations(offlineScope)
      if (pending.length) {
        const keep = window.confirm(`There are ${pending.length} unsynced change${pending.length === 1 ? '' : 's'} on this device. Press OK to keep them for the next sign-in, or Cancel to choose whether to discard them.`)
        if (!keep && !window.confirm('Discarding these changes is permanent. Confirm discard?')) return
        if (!keep) await discardOfflineUserData(userId)
      }
    }
    await clearOfflineUserData(userId)
    await supabase?.auth.signOut()
  }
  const changeTheme = (nextDark: boolean) => { setDark(nextDark); window.localStorage.setItem('zerobyte.theme', nextDark ? 'dark' : 'light') }
  return <div className={`${dark ? 'app' : 'app light'}${collapsed ? ' sidebar-collapsed' : ''}`}><OfflineStatus scope={offlineScope} /><aside className={open ? 'sidebar open' : 'sidebar'}><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>{workerMode ? 'Worker' : 'Business'}</small><button className="close-nav" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div><div className="workspace-select"><div className="workspace-icon">{orgName.slice(0, 2).toUpperCase()}</div><select className="workspace-switcher" aria-label="Select organization" value={orgId} onChange={(event) => switchOrganization(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>{workerMode && <div className="role-badge"><ShieldCheck size={13} /><span>Staff workspace</span></div>}<nav>{visibleGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ name, icon: Icon }) => <button className={view === name ? 'nav-item active' : 'nav-item'} key={name} onClick={() => { setView(name as View); setOpen(false) }}><Icon size={17} /><span>{name}</span></button>)}</div>)}</nav>{!workerMode && <div className="sidebar-bottom"><button className={view === 'Settings' ? 'nav-item active' : 'nav-item'} onClick={() => setView('Settings')}><Settings size={17} /><span>Settings</span></button></div>}<button className="user" onClick={() => void signOut()}><div className="avatar">{(displayName || email).slice(0, 2).toUpperCase()}</div><div><strong>{displayName || email}</strong><span>{displayName ? email : 'Sign out'}</span></div></button><button className="sidebar-collapse" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span>{collapsed ? 'Expand menu' : 'Collapse menu'}</span></button></aside><main className="main"><header className="topbar"><button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={21} /></button><div className="breadcrumb"><span>{orgName}</span><ChevronRight size={14} /><strong>{view}</strong></div><div className="top-actions"><div className="search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your business..." /></div><button className="icon-btn" aria-label="Help"><CircleHelp size={19} /></button>      <NotificationCenter userId={userId!} orgId={orgId!} /><button className="theme-toggle" onClick={() => changeTheme(!dark)}>{dark ? 'Light' : 'Dark'} mode</button></div></header><div className="content">{view === 'Overview' ? <Dashboard orgId={orgId} scope={offlineScope} onNavigate={setView} workerMode={workerMode} displayName={displayName} /> : <FeatureView view={view} orgId={orgId} search={search} scope={offlineScope} themeDark={dark} onThemeChange={changeTheme} />}</div></main></div>
}

function OrganizationPicker({ organizations, onSelect }: { organizations: OrganizationRow[]; onSelect: (id: string) => void }) {
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><span className="auth-kicker">Choose a workspace</span><h1>Select your organization</h1><p>You belong to more than one organization. Choose the workspace you intend to access before continuing.</p><div className="choice-list">{organizations.map((organization) => <button className="choice" key={organization.id} onClick={() => onSelect(organization.id)}><span>{organization.name}</span><small>{organization.role === 'member' ? 'Staff access' : `${organization.role ?? 'Member'} access`}</small><ArrowRight size={15} /></button>)}</div></div></div>
}

function WorkspaceSetup({ email, onCreated }: { email: string; onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setBusy(true); const { data, error: result } = await supabase.rpc('create_workspace', { workspace_name: name }); setBusy(false); if (result) setError(result.message); else if (data) onCreated(data, name.trim()) }
  return <div className="auth-loading"><form className="auth-card" onSubmit={submit}><div className="brand-mark">ø</div><span className="auth-kicker">Your first step</span><h1>Name your business</h1><p>Signed in as {email}. This name becomes your shared workspace.</p><label>Business name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Adebayo Foods" /></label>{error && <div className="form-error">{error}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'} <ArrowRight size={16} /></button></form></div>
}

function Dashboard({ orgId, scope, onNavigate, workerMode = false, displayName = '' }: { orgId: string; scope: OfflineScope | null; onNavigate: (view: View) => void; workerMode?: boolean; displayName?: string }) {
  const [products, setProducts] = useState<ProductRow[]>([]); const [customers, setCustomers] = useState<CustomerRow[]>([]); const [sales, setSales] = useState<{ id: string; total: number; created_at: string }[]>([]); const [metrics, setMetrics] = useState<{ revenue: number; cogs: number; gross_profit: number; operating_expenses: number; net_profit: number; sales_count: number } | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  useEffect(() => {
    let active = true
    if (scope) void Promise.all([readScopedCache<ProductRow>(scope, 'products'), readScopedCache<CustomerRow>(scope, 'customers'), readScopedCache<{ id: string; total: number; created_at: string }>(scope, 'recent-sales')]).then(([cachedProducts, cachedCustomers, cachedSales]) => { if (active) { setProducts(cachedProducts); setCustomers(cachedCustomers); setSales(cachedSales) } })
    if (!supabase || !navigator.onLine) return () => { active = false }
    const dateTo = new Date().toISOString().slice(0, 10)
    const dateFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
    void Promise.all([
      supabase.from('products').select(workerMode ? 'id,name,sku,stock,price' : 'id,name,sku,stock,price,cost_price').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name,email,phone').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('sales').select(workerMode ? 'id,created_at' : 'id,total,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20),
      workerMode ? Promise.resolve(null) : supabase.rpc('get_dashboard_metrics', { target_org: orgId, date_from: dateFrom, date_to: dateTo, target_branch: null }),
    ]).then(async ([p, c, s, m]) => {
      if (!active) return
      setProducts((p.data ?? []) as unknown as ProductRow[]); setCustomers(c.data ?? []); setSales((s.data ?? []) as unknown as { id: string; total: number; created_at: string }[])
      if (m?.error) {
        setMetrics(null)
        setDashboardError(m.error.code === 'PGRST202' ? 'Dashboard reports are not available yet. Apply the latest Supabase migrations, then try again.' : 'Dashboard metrics are temporarily unavailable.')
      } else {
        setDashboardError('')
        setMetrics((m?.data ?? null) as typeof metrics)
      }
      if (scope) { if (p.data) await writeScopedCache(scope, 'products', p.data as unknown as ProductRow[]); if (c.data) await writeScopedCache(scope, 'customers', c.data); if (s.data) await writeScopedCache(scope, 'recent-sales', s.data as unknown as { id: string; total: number; created_at: string }[]) }
    })
    return () => { active = false }
  }, [orgId, scope, workerMode])
  const low = products.filter((product) => product.stock <= 5)
  const recentSales = sales.slice(0, 6)
  return <div className="page"><div className="welcome-strip"><div><span className="auth-kicker">Last 30 days · {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>{displayName ? `Welcome back, ${displayName}.` : workerMode ? 'Your shift, in view.' : 'Your business, in view.'}</h1><p className="muted">{workerMode ? 'The tasks and sales you need for today.' : 'A clear read on what needs your attention next.'}</p></div><button className="primary" onClick={() => onNavigate('Sales')}><Plus size={17} /> Record a sale</button></div>{dashboardError && !workerMode && <div className="form-error" role="alert">{dashboardError}</div>}<div className="metrics">{!workerMode && <><Metric label="Revenue" value={`₦${Number(metrics?.revenue ?? 0).toLocaleString('en-NG')}`} note={`${metrics?.sales_count ?? 0} completed sales`} /><Metric label="COGS" value={`₦${Number(metrics?.cogs ?? 0).toLocaleString('en-NG')}`} note="Historical cost basis" /><Metric label="Gross profit" value={`₦${Number(metrics?.gross_profit ?? 0).toLocaleString('en-NG')}`} note="Revenue less COGS" /><Metric label="Net profit" value={`₦${Number(metrics?.net_profit ?? 0).toLocaleString('en-NG')}`} note="After operating expenses" /></>}<Metric label="Products" value={products.length.toString()} note={products.length ? `${low.length} need attention` : 'Add your first product'} /><Metric label="Customers" value={customers.length.toString()} note={customers.length ? 'In your records' : 'Add your first customer'} /></div><div className="dashboard-grid"><section className="panel spotlight"><div className="panel-heading"><div><span className="section-label">{workerMode ? 'Staff focus' : 'Next best action'}</span><h2>{workerMode ? 'Serve customers with confidence.' : products.length ? 'Keep your records moving.' : 'Start with your catalog.'}</h2></div><ShieldCheck size={20} color="#06b6d4" /></div><p>{workerMode ? 'Record sales, select customers, and keep receipts ready. Stock and financial controls stay with managers.' : products.length ? 'Your workspace is connected. Add customers and record sales to make your reports useful.' : 'Add the products you sell so sales, stock and receipts can work from the same source of truth.'}</p><div className="action-row"><button className="secondary" onClick={() => onNavigate('Sales')}><ShoppingCart size={16} /> Record sale</button><button className="secondary" onClick={() => onNavigate('Customers')}><Users size={16} /> Find customer</button></div></section><section className="panel"><div className="panel-heading"><div><span className="section-label">Attention</span><h2>Low stock</h2></div><button className="text-btn" onClick={() => onNavigate('Sales')}>Open sales <ArrowRight size={14} /></button></div>{low.length ? low.slice(0, 4).map((product) => <div className="list-row" key={product.id}><span className="row-icon"><Package size={15} /></span><div><strong>{product.name}</strong><small>{product.sku}</small></div><b className="warning-text">{product.stock} left</b></div>) : <div className="quiet-empty">{workerMode ? 'Stock alerts are managed by your manager.' : <><Check size={16} /> No low-stock products yet.</>}</div>}</section></div><section className="panel activity-panel"><div className="panel-heading"><div><span className="section-label">Live activity</span><h2>Recent sales</h2></div><button className="text-btn" onClick={() => onNavigate('Records')}>View all records <ArrowRight size={14} /></button></div>{recentSales.length ? <><div className="activity-list">{recentSales.map((sale) => <div className="list-row" key={sale.id}><span className="row-icon sale"><ShoppingCart size={15} /></span><div><strong>Completed sale</strong><small>{new Date(sale.created_at).toLocaleString('en-NG')}</small></div><b>{workerMode ? 'Recorded' : `₦${Number(sale.total).toLocaleString('en-NG')}`}</b></div>)}</div>{sales.length > recentSales.length && <p className="activity-footnote">Showing the latest {recentSales.length} sales. Open Records to see the full history.</p>}</> : <div className="quiet-empty">No sales recorded yet. Your first completed sale will appear here.</div>}</section></div>
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div> }

function FeatureView({ view, orgId, search, scope, themeDark, onThemeChange }: { view: View; orgId: string; search: string; scope: OfflineScope | null; themeDark?: boolean; onThemeChange?: (dark: boolean) => void }) {
  if (view === 'Inventory') return <Inventory orgId={orgId} search={search} />
  if (view === 'Customers') return <Customers orgId={orgId} search={search} scope={scope} />
  if (view === 'Expenses') return <Expenses orgId={orgId} />
  if (view === 'Records') return <Records orgId={orgId} search={search} />
  if (view === 'Sales') return <Sales orgId={orgId} scope={scope} />
  if (view === 'Receipts') return <Receipts orgId={orgId} />
  if (view === 'Invoices') return <Invoices orgId={orgId} />
  if (view === 'Reports') return <Reports orgId={orgId} />
  if (view === 'Branches') return <Branches orgId={orgId} />
  if (view === 'Workforce') return <Workforce orgId={orgId} />
  if (view === 'User Accounts') return <UserAccounts orgId={orgId} />
  if (view === 'Settings') return <SettingsPage orgId={orgId} themeDark={themeDark ?? true} onThemeChange={onThemeChange ?? (() => undefined)} />
  return null
}

function Branches({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; name: string; code: string; address: string | null; status: string }[]>([])
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '' }); const [error, setError] = useState('')
  const load = useCallback(() => { supabase?.from('branches').select('id,name,code,address,status').eq('organization_id', orgId).order('created_at', { ascending: false }).then(({ data }) => setRows(data ?? [])) }, [orgId])
  useEffect(() => { load() }, [load])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); const { error: result } = await supabase.from('branches').insert({ organization_id: orgId, ...form }); if (result) setError(result.code === '23505' ? 'That branch code is already in use.' : result.message); else { setForm({ name: '', code: '', address: '', phone: '' }); load() } }
  return <div className="page"><PageIntro label="Branches" title="Know where work happens." description="Create and manage the places your organization operates." /><form className="panel record-form three" onSubmit={add}><label>Branch name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ikeja store" /></label><label>Branch code<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="IKE-01" /></label><label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street and city" /></label><label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><button className="primary"><Plus size={16} /> Add branch</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Code</th><th>Address</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td className="mono">{row.code}</td><td>{row.address || '—'}</td><td><span className="status completed">{row.status}</span></td></tr>)}</tbody></table></div> : <EmptyInline title="No branches yet" text="Create the first branch for this organization above." />}</section></div>
}

function Workforce({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; employee_id: string; full_name: string; email: string | null; phone: string | null; job_title: string | null; employment_status: string; monthly_salary: number | null; branch_id: string | null; hired_on: string | null; user_id: string | null }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [self, setSelf] = useState<{ id: string; full_name: string; branch_id: string | null } | null>(null)
  const [attendance, setAttendance] = useState<{ id: string; work_date: string; clocked_in_at: string | null; clocked_out_at: string | null } | null>(null)
  const [form, setForm] = useState({ employee_id: '', full_name: '', email: '', phone: '', job_title: '', hired_on: new Date().toISOString().slice(0, 10), monthly_salary: '', branch_id: '' })
  const [error, setError] = useState(''); const [temporaryPassword, setTemporaryPassword] = useState(''); const [copyState, setCopyState] = useState('')
  const load = useCallback(async () => {
    if (!supabase) return
    try {
      const context = await getCurrentUserContext(supabase)
      const peopleQuery = context.employee
        ? supabase.from('employee_profiles_self').select('id,employee_id,full_name,email,phone,job_title,employment_status,branch_id,hired_on,user_id').eq('organization_id', orgId)
        : supabase.from('employee_profiles_manager').select('id,employee_id,full_name,email,phone,job_title,employment_status,monthly_salary,branch_id,hired_on,user_id').eq('organization_id', orgId)
      const [people, branchResult] = await Promise.all([
        peopleQuery.order('created_at', { ascending: false }),
        supabase.from('branches').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name'),
      ])
      if (people.error) throw people.error
      const rowsWithSafeSalary = (people.data ?? []).map((person) => ({
        ...person,
        monthly_salary: Number((person as { monthly_salary?: number | null }).monthly_salary ?? 0) || null,
      }))
      setRows(rowsWithSafeSalary as typeof rows)
      setBranches(branchResult.data ?? [])
      const own = rowsWithSafeSalary.find((person) => person.user_id === context.userId)
      setSelf(own ? { id: own.id, full_name: own.full_name, branch_id: own.branch_id } : null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load workforce records.')
    }
  }, [orgId])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!supabase || !self) return; supabase.from('attendance').select('id,work_date,clocked_in_at,clocked_out_at').eq('employee_id', self.id).eq('work_date', new Date().toISOString().slice(0, 10)).maybeSingle().then(({ data }) => setAttendance(data)) }, [self])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); setTemporaryPassword(''); const { data: sessionData } = await supabase.auth.getSession(); if (!sessionData.session) { setError('Your owner session has expired. Sign in again.'); return } const { data: payload, error: invokeError } = await supabase.functions.invoke('provision-worker', { body: { organizationId: orgId, employeeId: form.employee_id.trim(), fullName: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null, jobTitle: form.job_title.trim() || null, hiredOn: form.hired_on || null, monthlySalary: form.monthly_salary || null, branchId: form.branch_id || null } }); if (invokeError) { let detail = invokeError.message; try { const context = (invokeError as { context?: Response }).context; if (context) { const body = await context.clone().json() as { error?: string }; detail = body.error ?? detail } } catch { /* Keep the function error when the response is not JSON. */ } setError(detail || 'Could not create the worker account.'); return } setTemporaryPassword((payload as { temporaryPassword: string }).temporaryPassword); setCopyState(''); setForm({ employee_id: '', full_name: '', email: '', phone: '', job_title: '', hired_on: new Date().toISOString().slice(0, 10), monthly_salary: '', branch_id: '' }); load() }
  async function setWorkerStatus(id: string, action: 'ban' | 'unban') {
    if (!supabase) return
    if (!window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this staff account?`)) return
    setError('')
    const { error: result } = await supabase.functions.invoke('deactivate-worker', { body: { organizationId: orgId, employeeId: id, action } })
    if (result) setError(result.message)
    else load()
  }
  async function clock(kind: 'in' | 'out') { if (!supabase || !self) return; const result = kind === 'in' ? await supabase.from('attendance').insert({ organization_id: orgId, employee_id: self.id, branch_id: self.branch_id, work_date: new Date().toISOString().slice(0, 10), clocked_in_at: new Date().toISOString(), status: 'present' }) : await supabase.from('attendance').update({ clocked_out_at: new Date().toISOString() }).eq('id', attendance?.id ?? ''); if (result.error) setError(result.error.message); else load() }
  if (self) return <div className="page"><PageIntro label="Workforce" title={`Your shift, ${self.full_name}.`} description="Attendance is part of your worker profile and stays scoped to your assigned branch." /><section className="panel record-form three"><div><span className="section-label">Today</span><strong>{attendance?.clocked_in_at ? `Clocked in at ${new Date(attendance.clocked_in_at).toLocaleTimeString('en-NG')}` : 'Not clocked in yet'}</strong></div><button className="primary" disabled={Boolean(attendance?.clocked_in_at)} onClick={() => clock('in')}><Check size={16} /> Clock in</button><button className="secondary" disabled={!attendance?.clocked_in_at || Boolean(attendance.clocked_out_at)} onClick={() => clock('out')}>Clock out</button>{error && <div className="form-error">{error}</div>}</section></div>
  return <div className="page"><PageIntro label="Workforce" title="Keep your team in view." description="Create the employee record and secure application account together. The temporary password is shown once." /><form className="panel record-form three" onSubmit={add}><label>Employee ID<input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="EMP-001" /></label><label>Full name<input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Employee name" /></label><label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="worker@business.com" /></label><label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><label>Job role/title<input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Sales associate" /></label><label>Branch<select required value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Hire date<input required type="date" value={form.hired_on} onChange={(e) => setForm({ ...form, hired_on: e.target.value })} /></label><label>Monthly salary<input type="number" min="0" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} placeholder="Optional" /></label><button className="primary"><Plus size={16} /> Create worker account</button>{error && <div className="form-error">{error}</div>}</form>{temporaryPassword && <section className="panel temporary-password"><h2>Worker account created</h2><p>Copy this temporary password now. It is not stored and will not be shown again.</p><code>{temporaryPassword}</code><button className="secondary" onClick={() => { void navigator.clipboard?.writeText(temporaryPassword); setCopyState('Copied') }}>{copyState || 'Copy temporary password'}</button></section>}<section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Role</th><th>Branch</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.full_name}</strong><small className="table-sub">{row.employee_id}</small></td><td>{row.email || '—'}<small className="table-sub">{row.phone || ''}</small></td><td>{row.job_title || '—'}</td><td>{branches.find((branch) => branch.id === row.branch_id)?.name || '—'}</td><td><span className={`status ${row.employment_status === 'archived' ? 'refunded' : 'completed'}`}>{row.employment_status}</span></td><td>{row.employment_status !== 'archived' ? <button className="text-btn danger-text" type="button" onClick={() => void setWorkerStatus(row.id, 'ban')}>Ban</button> : <button className="text-btn" type="button" onClick={() => void setWorkerStatus(row.id, 'unban')}>Unban</button>}</td></tr>)}</tbody></table></div> : <EmptyInline title="No employees yet" text="Create the first worker account above." />}</section></div>
}

function UserAccounts({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; employee_id: string; full_name: string; email: string | null; job_title: string | null; employment_status: string; branch_id: string | null; created_at: string; user_id: string | null }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  async function setStatus(id: string, action: 'ban' | 'unban') {
    if (!supabase || !window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this staff account?`)) return
    const { error: result } = await supabase.functions.invoke('deactivate-worker', { body: { organizationId: orgId, employeeId: id, action } })
    if (result) setError(result.message)
    else setRows((current) => current.map((row) => row.id === id ? { ...row, employment_status: action === 'ban' ? 'archived' : 'active' } : row))
  }
  useEffect(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('employee_profiles').select('id,employee_id,full_name,email,job_title,employment_status,branch_id,created_at,user_id').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('branches').select('id,name').eq('organization_id', orgId),
    ]).then(([accounts, branchResult]) => { if (accounts.error) setError(accounts.error.message); setRows(accounts.data ?? []); setBranches(branchResult.data ?? []) })
  }, [orgId])
  return <div className="page"><PageIntro label="User accounts" title="Know who can sign in." description="Organization accounts are linked to employee records. Platform administrator accounts remain separate and are never managed here." />{error && <div className="form-error" role="alert">{error}</div>}<section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Employee ID</th><th>Role</th><th>Branch</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.full_name}</strong></td><td>{row.email || '—'}</td><td className="mono">{row.employee_id}</td><td>{row.job_title || 'Worker'}</td><td>{branches.find((branch) => branch.id === row.branch_id)?.name || '—'}</td><td><span className={`status ${row.employment_status === 'active' ? 'completed' : 'refunded'}`}>{row.employment_status}</span></td><td>{new Date(row.created_at).toLocaleDateString('en-NG')}</td><td>{row.employment_status === 'active' ? <button className="text-btn danger-text" onClick={() => void setStatus(row.id, 'ban')}>Ban</button> : <button className="text-btn" onClick={() => void setStatus(row.id, 'unban')}>Unban</button>}</td></tr>)}</tbody></table></div> : <EmptyInline title="No linked accounts yet" text="Create a worker from Workforce to provision an account safely." />}</section></div>
}

type ReceiptRow = { id: string; receipt_number: string | null; total: number; payment_method: string; created_at: string; customer: { name: string; phone: string | null; email: string | null } | null; sale_items: { id: string; quantity: number; unit_price: number; line_total: number; products: { name: string; sku: string } | null }[] }
type BusinessReceiptProfile = { name: string; address: string; phone: string; email: string; website: string; logo_url: string; currency: string }

const numberWords = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const tensWords = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function wordsUnderThousand(value: number): string {
  if (value < 20) return numberWords[value]
  if (value < 100) return `${tensWords[Math.floor(value / 10)]}${value % 10 ? `-${numberWords[value % 10].toLowerCase()}` : ''}`
  return `${numberWords[Math.floor(value / 100)]} Hundred${value % 100 ? ` and ${wordsUnderThousand(value % 100)}` : ''}`
}
function amountInWords(value: number) {
  const whole = Math.floor(Math.abs(value)); const kobo = Math.round((Math.abs(value) - whole) * 100)
  if (whole === 0 && kobo === 0) return 'Zero Naira Only'
  const groups = [{ value: 1_000_000_000, label: 'Billion' }, { value: 1_000_000, label: 'Million' }, { value: 1_000, label: 'Thousand' }]
  let remaining = whole; const parts: string[] = []
  groups.forEach((group) => { if (remaining >= group.value) { const count = Math.floor(remaining / group.value); parts.push(`${wordsUnderThousand(count)} ${group.label}`); remaining %= group.value } })
  if (remaining) parts.push(wordsUnderThousand(remaining))
  return `${parts.join(' ')} Naira${kobo ? ` and ${wordsUnderThousand(kobo)} Kobo` : ''} Only`
}
function receiptText(row: ReceiptRow, business: BusinessReceiptProfile) {
  const lines = row.sale_items.map((item, index) => `ITEM ${index + 1}. ${item.products?.name ?? 'Item'} | Qty ${item.quantity} | Unit NGN ${Number(item.unit_price).toLocaleString('en-NG')} | Total NGN ${Number(item.line_total).toLocaleString('en-NG')}`)
  return [business.name, business.address, business.phone, business.email, business.website, 'SALES RECEIPT', `Receipt No: ${row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`}`, `Date: ${new Date(row.created_at).toLocaleDateString('en-NG', { dateStyle: 'long' })}`, `Time: ${new Date(row.created_at).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}`, row.customer ? `Customer: ${row.customer.name}${row.customer.phone ? ` | ${row.customer.phone}` : ''}` : 'Customer: Walk-in Customer', ...lines, `Subtotal: ${business.currency} ${Number(row.total).toLocaleString('en-NG')}`, `Payment method: ${row.payment_method}`, `Total: ${business.currency} ${Number(row.total).toLocaleString('en-NG')}`, `Amount in words: ${amountInWords(Number(row.total))}`].filter(Boolean).join('\n')
}

function Receipts({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [business, setBusiness] = useState<BusinessReceiptProfile>({ name: 'Zerøbyte Business', address: '', phone: '', email: '', website: '', logo_url: '', currency: 'NGN' }); const [preview, setPreview] = useState<ReceiptRow | null>(null); const [error, setError] = useState('')
  useEffect(() => { if (!supabase) return; Promise.all([supabase.from('sales').select('id,receipt_number,total,payment_method,created_at,customers(name,phone,email),sale_items(id,quantity,unit_price,line_total,products(name,sku))').eq('organization_id', orgId).order('created_at', { ascending: false }), supabase.from('organizations').select('name,address,phone,email,website,logo_url,currency').eq('id', orgId).single()]).then(([salesResult, orgResult]) => { if (salesResult.error) setError(salesResult.error.message); if (orgResult.error) setError(orgResult.error.message); setRows((salesResult.data ?? []) as unknown as ReceiptRow[]); if (orgResult.data) setBusiness({ name: orgResult.data.name, address: orgResult.data.address ?? '', phone: orgResult.data.phone ?? '', email: orgResult.data.email ?? '', website: orgResult.data.website ?? '', logo_url: normalizeLogoUrl(orgResult.data.logo_url), currency: orgResult.data.currency ?? 'NGN' }) }) }, [orgId])
  function printReceipt(row: ReceiptRow) { setPreview(row); window.setTimeout(() => window.print(), 250) }
  function download(row: ReceiptRow) { printReceipt(row) }
  async function share(row: ReceiptRow) {
    const text = receiptText(row, business)
    if (navigator.share) {
      await navigator.share({ title: `Receipt ${row.receipt_number ?? row.id.slice(0, 8).toUpperCase()}`, text })
      return
    }
    download(row)
    const phone = window.prompt('Optional WhatsApp number, including country code. The branded PDF has been opened for you to save or attach manually:')
    if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Receipt ${row.receipt_number ?? row.id.slice(0, 8).toUpperCase()} from ${business.name}. Total: ${business.currency} ${Number(row.total).toLocaleString('en-NG')}`)}`, '_blank', 'noopener,noreferrer')
  }
  return <div className="page"><PageIntro label="Receipts" title="Every sale, ready to prove." description="Receipt items and totals come from the persisted sale and sale_items records." />{error && <div className="form-error" role="alert">{error}</div>}<section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>Total</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mono">{row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`}</td><td>{row.customer?.name || 'Walk-in customer'}</td><td>{new Date(row.created_at).toLocaleString('en-NG')}</td><td className="amount">₦{Number(row.total).toLocaleString('en-NG')}</td><td><button className="text-btn" onClick={() => setPreview(row)}>Preview</button><button className="text-btn" onClick={() => download(row)}>Print / PDF</button><button className="text-btn" onClick={() => void share(row)}>Share</button></td></tr>)}</tbody></table></div> : <EmptyInline title="No receipts yet" text="Complete a sale and its receipt will appear here." />}</section>{preview && <div className="receipt-preview-backdrop" onClick={() => setPreview(null)}><article className="receipt-preview" onClick={(event) => event.stopPropagation()}><button className="icon-btn receipt-close" onClick={() => setPreview(null)} aria-label="Close receipt"><X size={16} /></button><header className="receipt-document-header">{business.logo_url ? <img className="receipt-logo" src={business.logo_url} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <div className="receipt-brand-mark">ø</div>}<div><h2>{business.name}</h2><span>INNOVATION · SKILLS · IMPACT</span><small>{[business.address, business.phone, business.email, business.website].filter(Boolean).join('  ·  ')}</small></div></header><div className="receipt-title-row"><div><h1>SALES RECEIPT</h1><p>Thank you for your business!</p></div><div className="receipt-meta-grid"><div><small>Receipt No.</small><strong>{preview.receipt_number ?? `RC-${preview.id.slice(0, 8).toUpperCase()}`}</strong></div><div><small>Date & time</small><strong>{new Date(preview.created_at).toLocaleString('en-NG')}</strong></div></div></div><div className="receipt-customer"><small>CUSTOMER</small><strong>{preview.customer?.name || 'Walk-in Customer'}</strong>{preview.customer?.phone && <span>{preview.customer.phone}</span>}{preview.customer?.email && <span>{preview.customer.email}</span>}</div><div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{preview.sale_items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.products?.name ?? 'Item'}</strong>{item.products?.sku && <small>{item.products.sku}</small>}</td><td>{item.quantity}</td><td>{business.currency} {Number(item.unit_price).toLocaleString('en-NG')}</td><td>{business.currency} {Number(item.line_total).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div><div className="receipt-summary"><div><span>Subtotal</span><strong>{business.currency} {Number(preview.total).toLocaleString('en-NG')}</strong></div><div><span>Discount</span><strong>{business.currency} 0</strong></div><div><span>VAT / tax</span><strong>{business.currency} 0</strong></div><div className="receipt-grand-total"><span>Total</span><strong>{business.currency} {Number(preview.total).toLocaleString('en-NG')}</strong></div></div><div className="receipt-detail-grid"><div className="receipt-payment"><span>Payment method</span><strong>{preview.payment_method}</strong></div><div className="receipt-words"><small>AMOUNT IN WORDS</small><p>{amountInWords(Number(preview.total))}</p></div></div><footer className="receipt-document-footer"><strong>✓ &nbsp; Thank you for your business.</strong><span>Powered by Zerøbyte</span></footer><div className="action-row receipt-actions"><button className="primary receipt-print" onClick={() => printReceipt(preview)}>Print / save PDF</button><button className="secondary" onClick={() => void share(preview)}>Share / WhatsApp</button></div></article></div>}</div>
}

function Invoices({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; invoice_number: string; status: string; total: number; created_at: string }[]>([])
  const [form, setForm] = useState({ invoice_number: '', total: '' }); const [error, setError] = useState('')
  const load = useCallback(() => { supabase?.from('invoices').select('id,invoice_number,status,total,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).then(({ data }) => setRows(data ?? [])) }, [orgId])
  useEffect(() => { load() }, [load])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; const { error: result } = await supabase.from('invoices').insert({ organization_id: orgId, invoice_number: form.invoice_number, total: Number(form.total) }); if (result) setError(result.code === '23505' ? 'That invoice number already exists.' : result.message); else { setForm({ invoice_number: '', total: '' }); load() } }
  return <div className="page"><PageIntro label="Invoices" title="Keep billing clear." description="Create simple invoice records in naira and track their status." /><form className="panel record-form three" onSubmit={add}><div><label>Invoice number<input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} placeholder="INV-0001" /></label></div><div><label>Total amount<input required type="number" min="0" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="₦0.00" /></label></div><button className="primary"><Plus size={16} /> Create draft</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Status</th><th>Date</th><th>Total</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.invoice_number}</strong></td><td><span className="status pending">{row.status}</span></td><td>{new Date(row.created_at).toLocaleDateString('en-NG')}</td><td className="amount">₦{Number(row.total).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No invoices yet" text="Create your first draft invoice above." />}</section></div>
}

function Reports({ orgId }: { orgId: string }) {
  const [metrics, setMetrics] = useState<{ revenue: number; cogs: number; gross_profit: number; operating_expenses: number; net_profit: number; sales_count: number } | null>(null)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  useEffect(() => {
    if (!supabase) return
    setError('')
    supabase.rpc('get_dashboard_metrics', { target_org: orgId, date_from: dateFrom, date_to: dateTo, target_branch: null }).then(({ data, error: result }) => {
      if (result) {
        setMetrics(null)
        setError(result.code === 'PGRST202' ? 'Reports are not available yet. Apply the latest Supabase migrations, then try again.' : 'Reports are temporarily unavailable.')
      } else {
        setMetrics(data as typeof metrics)
      }
    })
  }, [dateFrom, dateTo, orgId])
  const revenue = Number(metrics?.revenue ?? 0)
  const cogs = Number(metrics?.cogs ?? 0)
  const expenses = Number(metrics?.operating_expenses ?? 0)
  const gross = Number(metrics?.gross_profit ?? 0)
  const net = Number(metrics?.net_profit ?? 0)
  const maxValue = Math.max(revenue, cogs, expenses, gross, net, 1)
  const setPreset = (days: number) => { const end = new Date(); setDateTo(end.toISOString().slice(0, 10)); setDateFrom(new Date(end.getTime() - days * 86400000).toISOString().slice(0, 10)) }
  return <div className="page reports-page"><PageIntro label="Reports" title="Understand the signal." description="A server-calculated view of sales performance, cost of goods, and operating expenses." /><section className="panel report-toolbar"><div><span className="section-label">Reporting period</span><strong>{new Date(`${dateFrom}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} — {new Date(`${dateTo}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div><div className="report-presets" aria-label="Quick reporting periods"><button className="text-btn" onClick={() => setPreset(6)}>7 days</button><button className="text-btn" onClick={() => setPreset(29)}>30 days</button><button className="text-btn" onClick={() => setPreset(364)}>12 months</button></div><div className="report-date-fields"><label>From<input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} min={dateFrom} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDateTo(event.target.value)} /></label></div></section>{error && <div className="form-error" role="alert">{error}</div>}<div className="metrics report-metrics"><Metric label="Revenue" value={`₦${revenue.toLocaleString('en-NG')}`} note={`${metrics?.sales_count ?? 0} completed sales`} /><Metric label="COGS" value={`₦${cogs.toLocaleString('en-NG')}`} note="Historical sale costs" /><Metric label="Gross profit" value={`₦${gross.toLocaleString('en-NG')}`} note="Revenue less COGS" /><Metric label="Operating expenses" value={`₦${expenses.toLocaleString('en-NG')}`} note="Recorded expenses" /></div><div className="report-grid"><section className="panel report-breakdown"><div className="panel-heading"><div><span className="section-label">Financial shape</span><h2>Where the money moved</h2></div><BarChart3 size={20} color="#06b6d4" /></div><div className="report-bars">{[['Revenue', revenue, 'revenue'], ['COGS', cogs, 'cogs'], ['Expenses', expenses, 'expenses'], ['Net profit', net, 'profit']].map(([label, value, tone]) => <div className="report-bar-row" key={label as string}><div><span>{label}</span><strong>₦{Number(value).toLocaleString('en-NG')}</strong></div><div className="report-bar-track"><i className={`report-bar ${tone}`} style={{ width: `${Math.max((Math.abs(Number(value)) / maxValue) * 100, Number(value) > 0 ? 2 : 0)}%` }} /></div></div>)}</div><p className="report-caption">Bars are scaled against the largest value in this period. All figures come from completed records.</p></section><section className="panel report-profit"><span className="section-label">Bottom line</span><h2>Net profit</h2><strong>₦{net.toLocaleString('en-NG')}</strong><p>Revenue minus historical COGS and operating expenses.</p><div className={net >= 0 ? 'profit-status positive' : 'profit-status negative'}>{net >= 0 ? 'Positive result' : 'Needs attention'}</div></section></div></div>
}

function SettingsPage({ orgId, themeDark, onThemeChange }: { orgId: string; themeDark: boolean; onThemeChange: (dark: boolean) => void }) {
  const [form, setForm] = useState({ name: '', address: '', phone: '', email: '', website: '', logo_url: '', receipt_prefix: '' }); const [saved, setSaved] = useState(false); const [error, setError] = useState('')
  const [announcements, setAnnouncements] = useState<{ id: string; version: string; message: string; created_at: string }[]>([])
  const [activeTab, setActiveTab] = useState<'business' | 'appearance' | 'security' | 'guide'>('business')
  useEffect(() => { supabase?.from('organizations').select('name,address,phone,email,website,logo_url,receipt_prefix').eq('id', orgId).single().then(({ data }) => setForm({ name: data?.name ?? '', address: data?.address ?? '', phone: data?.phone ?? '', email: data?.email ?? '', website: data?.website ?? '', logo_url: normalizeLogoUrl(data?.logo_url), receipt_prefix: data?.receipt_prefix ?? '' })) }, [orgId])
  useEffect(() => { supabase?.from('app_version_announcements').select('id,version,message,created_at').order('created_at', { ascending: false }).limit(20).then(({ data }) => setAnnouncements((data ?? []) as typeof announcements)) }, [])
  async function save(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); const payload = { ...form, receipt_prefix: form.receipt_prefix.toUpperCase() }; const { error: result } = await supabase.from('organizations').update(payload).eq('id', orgId); if (result) setError(result.message); else { setForm({ ...form, receipt_prefix: payload.receipt_prefix }); setSaved(true) } }
  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file || !supabase) return; if (!file.type.startsWith('image/')) { setError('Choose a PNG, JPG, WEBP, or SVG image.'); return } if (file.size > 2 * 1024 * 1024) { setError('Logo must be smaller than 2 MB.'); return } setError(''); const path = `${orgId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const { error: uploadError } = await supabase.storage.from('business-logos').upload(path, file, { upsert: true, contentType: file.type }); if (uploadError) { setError(`Logo upload failed: ${uploadError.message}. Confirm the business-logos storage migration is applied.`); return } const { data } = supabase.storage.from('business-logos').getPublicUrl(path); setForm({ ...form, logo_url: normalizeLogoUrl(data.publicUrl) }); setSaved(false) }
  const tabs = [{ id: 'business', label: 'Business profile', icon: Settings }, { id: 'appearance', label: 'Appearance', icon: Palette }, { id: 'security', label: 'Security', icon: ShieldCheck }, { id: 'guide', label: 'Guide & updates', icon: BookOpen }] as const
  return <div className="page settings-page"><PageIntro label="Settings" title="Make it yours." description="Manage your business identity, workspace preferences, account security, and updates." /><nav className="settings-tabs" aria-label="Settings sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`settings-tab ${activeTab === id ? 'active' : ''}`} aria-selected={activeTab === id} onClick={() => setActiveTab(id)}><Icon size={16} />{label}</button>)}</nav>
    {activeTab === 'business' && <form className="panel settings-form" onSubmit={save}><div className="settings-section-heading"><span className="section-label">Business profile</span><p className="muted">Use real contact details. Your optional logo is shown in the receipt header.</p></div><label>Business name<input required minLength={2} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setSaved(false) }} /></label><label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city, state" /></label><label>Phone number<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><label>Business email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hello@business.com" /></label><label>Website<input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://business.com" /></label><label>Receipt prefix<input maxLength={8} pattern="[A-Za-z0-9]{2,8}" value={form.receipt_prefix} onChange={(e) => setForm({ ...form, receipt_prefix: e.target.value.toUpperCase() })} placeholder="ZB" /><small className="field-help">Used for receipt numbers such as ZB-001.</small></label><label className="settings-wide">Business logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => void uploadLogo(e)} /><small className="field-help">{form.logo_url ? 'Logo uploaded. Save the profile to use it on receipts.' : 'PNG, JPG, WEBP, or SVG up to 2 MB.'}</small></label><div className="settings-actions"><button className="primary">Save business profile</button>{saved && <span className="form-success">Saved to your organization.</span>}{error && <span className="form-error">{error}</span>}</div></form>}
    {activeTab === 'appearance' && <section className="panel settings-preferences"><div><span className="section-label">Preferences</span><h2>Make the workspace comfortable.</h2><p>These settings are saved on this device and do not change your business records.</p></div><label className="settings-toggle-row"><span><strong>Dark mode</strong><small>Use the dark Zerøbyte workspace theme.</small></span><input type="checkbox" role="switch" checked={themeDark} onChange={(event) => onThemeChange(event.target.checked)} /></label></section>}
    {activeTab === 'security' && <><section className="panel settings-security"><span className="section-label">Account security</span><h2>Change your password</h2><p>Choose a unique password you do not reuse elsewhere.</p><PasswordSettings /></section><section className="panel settings-info"><span className="section-label">Data protection</span><h2>Organization-scoped by default.</h2><p>Every product, customer, sale and expense is protected by Supabase Row Level Security and tied to this workspace.</p></section></>}
    {activeTab === 'guide' && <><section className="panel app-version-card"><div><span className="section-label">Application</span><h2>Zerøbyte Business <span className="version-badge">v{import.meta.env.VITE_APP_VERSION ?? '1.0.0'}</span></h2><p className="muted">{announcements[0] ? `Latest release · v${announcements[0].version}: ${announcements[0].message}` : 'You are running the current published workspace.'}</p></div></section>{announcements.length > 0 && <section className="panel changelog-panel"><div className="panel-heading"><div><span className="section-label">Release history</span><h2>Changelog</h2></div><span className="version-badge">{announcements.length} release{announcements.length === 1 ? '' : 's'}</span></div><div className="changelog-list">{announcements.map((item) => <article className="changelog-entry" key={item.id}><div><strong>v{item.version}</strong><time>{new Date(item.created_at).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</time></div><p>{item.message}</p></article>)}</div></section>}<section className="panel settings-info"><span className="section-label">User guide</span><h2>A simple rhythm for clean records.</h2><div className="guide-list"><p><strong>1. Inventory:</strong> add products and receive stock. Stock intake is recorded automatically.</p><p><strong>2. Sales:</strong> choose a customer first, add products, then complete the sale.</p><p><strong>3. Expenses:</strong> record operating costs on the Expenses page.</p><p><strong>4. Records:</strong> choose a period to review history, totals, and export CSV for Excel or Sheets. Records are read-only here.</p><p><strong>5. Offline:</strong> drafts and queued changes stay on this device until you reconnect. Review the sync banner before signing out.</p></div></section></>}
  </div>
}

function Inventory({ orgId, search }: { orgId: string; search: string }) {
  const [rows, setRows] = useState<ProductRow[]>([]); const [form, setForm] = useState({ name: '', sku: '', category: '', price: '', cost: '', stock: '' }); const [receive, setReceive] = useState({ productId: '', quantity: '', cost: '', selling: '' }); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState('')
  const [movements, setMovements] = useState<{ id: string; product_id: string; movement_type: string; quantity: number; created_at: string }[]>([])
  const load = useCallback(() => { if (!supabase) return; Promise.all([supabase.from('products').select('id,name,sku,stock,price,cost_price,category').eq('organization_id', orgId).order('created_at', { ascending: false }), supabase.from('stock_movements').select('id,product_id,movement_type,quantity,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20)]).then(([productResult, movementResult]) => { setRows((productResult.data ?? []) as ProductRow[]); setMovements(movementResult.data ?? []) }) }, [orgId])
  useEffect(() => { load() }, [load])
  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    const openingStock = Number(form.stock)
    const payload = { name: form.name, sku: form.sku, category: form.category || 'Uncategorized', price: Number(form.price) }
    if (editing) {
      const result = await supabase.rpc('update_product_catalog', {
        target_org: orgId,
        target_product: editing,
        product_name: payload.name,
        product_sku: payload.sku,
        product_category: payload.category,
        selling_price: payload.price,
      })
      if (result.error) setError(result.error.code === '23505' ? 'That SKU is already in use in this workspace.' : result.error.message)
      else { setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '' }); setEditing(null); load() }
      return
    }
    const result = await supabase.from('products').insert({ organization_id: orgId, ...payload, cost_price: Number(form.cost), stock: 0 }).select('id').single()
    if (result.error || !result.data) {
      setError(result.error?.code === '23505' ? 'That SKU is already in use in this workspace.' : result.error?.message ?? 'Could not create the product.')
      return
    }
    if (openingStock > 0) {
      const movement = await supabase.rpc('initialize_stock', { target_org: orgId, target_product: result.data.id, opening_quantity: openingStock })
      if (movement.error) { setError(movement.error.message); return }
    }
    setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '' }); load()
  }
  async function remove(id: string) { if (!supabase || !window.confirm('Delete this product? This cannot be undone.')) return; const { error: result } = await supabase.from('products').delete().eq('id', id).eq('organization_id', orgId); if (result) setError(result.message); else load() }
  async function receiveStock(event: React.FormEvent) { event.preventDefault(); if (!navigator.onLine) { setError('Inventory receiving is online-only. Reconnect before adding stock.'); return } if (!supabase) return; const { error: result } = await supabase.rpc('receive_stock', { target_org: orgId, target_product: receive.productId, quantity_to_add: Number(receive.quantity), new_cost: receive.cost ? Number(receive.cost) : null, new_selling: receive.selling ? Number(receive.selling) : null, target_branch: null }); if (result) setError(result.message); else { setReceive({ productId: '', quantity: '', cost: '', selling: '' }); load() } }
  function edit(row: ProductRow) { setEditing(row.id); setForm({ name: row.name, sku: row.sku, category: row.category ?? '', price: String(row.price), cost: String(row.cost_price ?? 0), stock: String(row.stock) }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const filtered = rows.filter((row) => `${row.name} ${row.sku} ${row.category}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page"><PageIntro label="Inventory" title="Know what is in stock." description="Edit product details, receive new stock through a server transaction, and keep a traceable catalog." /><form className="panel record-form inventory-product-form" onSubmit={add}><label>Product name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 5kg Rice" /></label><label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="RICE-005" /></label><label>Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Groceries" /></label><label>Cost price<input required type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="₦0.00" /></label><label>Selling price<input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="₦0.00" /></label><label>{editing ? 'Current stock (read-only)' : 'Opening stock'}<input required type="number" min="0" readOnly={Boolean(editing)} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" /></label><button className="primary"><Plus size={16} /> {editing ? 'Save product' : 'Add product'}</button>{editing && <><small className="field-help form-wide">Cost price changes for existing products are made through Stock receiving so every change is recorded.</small><button type="button" className="secondary" onClick={() => { setEditing(null); setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '' }) }}>Cancel</button></>}{error && <div className="form-error">{error}</div>}</form><form className="panel receive-form" onSubmit={receiveStock}><div className="receive-heading"><span className="section-label">Stock receiving · Online only</span><h2>Add stock without duplicating the product</h2><p>Stock receiving needs a live server transaction. Reconnect before receiving inventory.</p></div><label>Product<select required value={receive.productId} onChange={(e) => setReceive({ ...receive, productId: e.target.value })}><option value="">Choose product</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.stock} units</option>)}</select></label><label>Quantity<input required type="number" min="1" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} /></label><label>New cost (optional)<input type="number" min="0" step="0.01" value={receive.cost} onChange={(e) => setReceive({ ...receive, cost: e.target.value })} placeholder="Keep current" /></label><label>New selling price (optional)<input type="number" min="0" step="0.01" value={receive.selling} onChange={(e) => setReceive({ ...receive, selling: e.target.value })} placeholder="Keep current" /></label><button className="secondary" disabled={!navigator.onLine}>Receive stock</button></form><section className="panel table-panel catalog-panel"><div className="panel-heading"><div><span className="section-label">Your catalog</span><h2>{rows.length} product{rows.length === 1 ? '' : 's'}</h2></div></div>{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Cost price</th><th>Selling price</th><th>Actions</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td className="mono">{row.sku}</td><td>{row.category}</td><td className={row.stock <= 5 ? 'warning-text' : ''}>{row.stock}</td><td className="amount">₦{Number(row.cost_price).toLocaleString('en-NG')}</td><td className="amount">₦{Number(row.price).toLocaleString('en-NG')}</td><td><button type="button" className="text-btn" onClick={() => edit(row)}>Edit</button><button type="button" className="text-btn danger-text" onClick={() => remove(row.id)}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyInline title="No products yet" text="Add your first product above. It will become available to sales and stock workflows." />}</section><section className="panel table-panel stock-history"><div className="panel-heading"><div><span className="section-label">Stock history</span><h2>Recent movements</h2></div></div>{movements.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Movement</th><th>Quantity</th><th>Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{rows.find((row) => row.id === movement.product_id)?.name || 'Product'}</td><td><span className="status completed">{movement.movement_type}</span></td><td className={movement.quantity < 0 ? 'danger-text' : 'stock-low'}>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td><td>{new Date(movement.created_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No stock movements yet" text="Receiving stock and completing sales will create an auditable history here." />}</section></div>
}

function Customers({ orgId, search, scope }: { orgId: string; search: string; scope: OfflineScope | null }) {
  const [rows, setRows] = useState<(CustomerRow & { pending?: boolean })[]>([]); const [form, setForm] = useState({ name: '', email: '', phone: '' }); const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (scope) setRows(await readScopedCache<CustomerRow & { pending?: boolean }>(scope, 'customers'))
    if (!supabase || !navigator.onLine) return
    const { data, error: result } = await supabase.from('customers').select('id,name,email,phone').eq('organization_id', orgId).order('created_at', { ascending: false })
    if (!result && data && scope) await writeScopedCache(scope, 'customers', data)
    if (!result) setRows(data ?? [])
  }, [orgId, scope])
  useEffect(() => { void load() }, [load])
  async function add(event: React.FormEvent) {
    event.preventDefault(); if (!supabase || !scope) return
    if (!navigator.onLine) {
      const clientId = newOfflineOperationId()
      await enqueueOfflineOperation(scope, 'customer', { target_org: orgId, target_branch: null, customer_name: form.name, customer_email: form.email || null, customer_phone: form.phone || null, client_id: clientId })
      const next = [...rows, { id: clientId, name: form.name.trim(), email: form.email || null, phone: form.phone || null, pending: true }]
      setRows(next); await writeScopedCache(scope, 'customers', next); setForm({ name: '', email: '', phone: '' }); setError('Customer saved on this device and will sync when you reconnect.')
      return
    }
    const { error: result } = await supabase.rpc('create_customer', { target_org: orgId, target_branch: null, customer_name: form.name, customer_email: form.email || null, customer_phone: form.phone || null }); if (result) setError(result.message); else { setForm({ name: '', email: '', phone: '' }); void load() }
  }
  const filtered = rows.filter((row) => `${row.name} ${row.email ?? ''} ${row.phone ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page"><PageIntro label="Customers" title="Keep people close." description="A clean customer book for repeat business and better follow-up. New customer records can be captured offline and sync securely later." /><form className="panel record-form three" onSubmit={add}><div><label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer name" /></label></div><div><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="customer@email.com" /></label></div><div><label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label></div><button className="primary"><Plus size={16} /> Add customer</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.name}</strong>{row.pending && <small className="field-help">Pending sync</small>}</td><td>{row.email || '—'}</td><td>{row.phone || '—'}</td></tr>)}</tbody></table></div> : <EmptyInline title="No customers yet" text="Your customer records will appear here as you add them." />}</section></div>
}

function Expenses({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; title: string; category: string; amount: number; expense_date: string }[]>([]); const [form, setForm] = useState({ title: '', category: 'General', amount: '', expense_date: new Date().toISOString().slice(0, 10) }); const [error, setError] = useState('')
  const load = useCallback(() => { supabase?.from('expenses').select('id,title,category,amount,expense_date').eq('organization_id', orgId).order('expense_date', { ascending: false }).then(({ data }) => setRows(data ?? [])) }, [orgId])
  useEffect(() => { load() }, [load])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; const { error: result } = await supabase.from('expenses').insert({ organization_id: orgId, ...form, amount: Number(form.amount) }); if (result) setError(result.message); else { setForm({ ...form, title: '', amount: '' }); load() } }
  return <div className="page"><PageIntro label="Expenses" title="See where money goes." description="Record operating costs in naira and keep your picture honest." /><form className="panel record-form three" onSubmit={add}><div><label>Expense title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Shop rent" /></label></div><div><label>Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Operations" /></label></div><div><label>Amount<input required type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="₦0.00" /></label></div><div><label>Date<input required type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></label></div><button className="primary"><Plus size={16} /> Add expense</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong></td><td>{row.category}</td><td>{row.expense_date}</td><td className="amount">₦{Number(row.amount).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No expenses yet" text="Record your first operating expense above." />}</section></div>
}

type RecordTab = 'sales' | 'expenses' | 'stock'

function Records({ orgId, search }: { orgId: string; search: string }) {
  const [tab, setTab] = useState<RecordTab>('sales')
  const tabs: { id: RecordTab; label: string; icon: typeof ShoppingCart }[] = [
    { id: 'sales', label: 'Sales records', icon: ShoppingCart },
    { id: 'expenses', label: 'Expenses', icon: Wallet },
    { id: 'stock', label: 'Stock intake', icon: Package },
  ]
  return <div className="page"><PageIntro label="Records" title="Keep the paper trail together." description="Review completed sales, operating expenses, and stock received from one focused workspace. Use Sales, Expenses, or Inventory when you need to add a new record." /><div className="record-tabs" role="tablist" aria-label="Business records">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'record-tab active' : 'record-tab'} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</div>{tab === 'sales' ? <SalesRecords orgId={orgId} search={search} /> : tab === 'expenses' ? <ExpenseRecords orgId={orgId} /> : <StockRecords orgId={orgId} />}</div>
}

function SalesRecords({ orgId, search }: { orgId: string; search: string }) {
  const [rows, setRows] = useState<{ id: string; customer_id: string | null; total: number; status: string; created_at: string; customer?: { name: string }[] | null; items?: { quantity: number; unit_price: number; products?: { name: string; sku: string } | { name: string; sku: string }[] | null }[] }[]>([])
  const [error, setError] = useState(''); const [dates, setDates] = useState({ from: '', to: '' })
  const applyDates = useCallback((next: { from: string; to: string }) => setDates(next), [])
  const load = useCallback(async () => {
    if (!supabase) return
    let query = supabase.from('sales').select('id,customer_id,total,status,created_at,customer:customers(name),items:sale_items(quantity,unit_price,products(name,sku))').eq('organization_id', orgId).order('created_at', { ascending: false })
    if (dates.from) query = query.gte('created_at', `${dates.from}T00:00:00.000Z`)
    if (dates.to) query = query.lte('created_at', `${dates.to}T23:59:59.999Z`)
    const { data, error: result } = await query
    if (result) setError('Sales records are temporarily unavailable.')
    else setRows((data ?? []) as typeof rows)
  }, [dates, orgId])
  useEffect(() => { void load() }, [load])
  const customerName = (row: typeof rows[number]) => row.customer?.[0]?.name ?? 'Walk-in customer'
  const productName = (item: NonNullable<typeof rows[number]['items']>[number]) => Array.isArray(item.products) ? item.products[0]?.name ?? 'Product' : item.products?.name ?? 'Product'
  const itemSummary = (row: typeof rows[number]) => row.items?.length ? row.items.map((item) => `${productName(item)} × ${item.quantity}`).join(', ') : 'Item details unavailable'
  const filtered = rows.filter((row) => `${customerName(row)} ${itemSummary(row)} ${row.status} ${row.id}`.toLowerCase().includes(search.toLowerCase()))
  const total = filtered.reduce((sum, row) => sum + Number(row.total), 0)
  return <section className="panel table-panel records-panel"><RecordFilters storageKey="zerobyte.records.sales" onChange={applyDates} /><div className="panel-heading"><div><span className="section-label">Completed activity</span><h2>{filtered.length} sale{filtered.length === 1 ? '' : 's'}</h2></div><div className="record-actions"><span className="record-count">Total ₦{total.toLocaleString('en-NG')}</span><button className="secondary" onClick={() => downloadCsv('zerobyte-sales.csv', ['Sale', 'Customer', 'Items sold', 'Status', 'Date', 'Total'], filtered.map((row) => [row.id, customerName(row), itemSummary(row), row.status, row.created_at, row.total]))} disabled={!filtered.length}>Export CSV</button></div></div>{error && <div className="form-error">{error}</div>}{filtered.length ? <div className="table-wrap"><table><thead><tr><th>What was sold</th><th>Customer</th><th>Status</th><th>Date</th><th>Total</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong className="sale-record-items">{itemSummary(row)}</strong><small className="table-sub mono">Sale #{row.id.slice(0, 8)}</small></td><td>{customerName(row)}</td><td><span className="status completed">{row.status}</span></td><td>{new Date(row.created_at).toLocaleString('en-NG')}</td><td className="amount">₦{Number(row.total).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No sales records yet" text="Completed sales will appear here after you record them." />}</section>
}

function ExpenseRecords({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; title: string; category: string; amount: number; expense_date: string }[]>([])
  const [error, setError] = useState(''); const [dates, setDates] = useState({ from: '', to: '' })
  const applyDates = useCallback((next: { from: string; to: string }) => setDates(next), [])
  const load = useCallback(async () => {
    if (!supabase) return
    let query = supabase.from('expenses').select('id,title,category,amount,expense_date').eq('organization_id', orgId).order('expense_date', { ascending: false })
    if (dates.from) query = query.gte('expense_date', dates.from)
    if (dates.to) query = query.lte('expense_date', dates.to)
    const { data, error: result } = await query
    if (result) setError('Expense records are temporarily unavailable.')
    else setRows(data ?? [])
  }, [dates, orgId])
  useEffect(() => { void load() }, [load])
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0)
  return <section className="panel table-panel records-panel"><RecordFilters storageKey="zerobyte.records.expenses" onChange={applyDates} /><div className="panel-heading"><div><span className="section-label">Operating history</span><h2>{rows.length} expense{rows.length === 1 ? '' : 's'}</h2></div><div className="record-actions"><span className="record-count">Total ₦{total.toLocaleString('en-NG')}</span><button className="secondary" onClick={() => downloadCsv('zerobyte-expenses.csv', ['Expense', 'Category', 'Date', 'Amount'], rows.map((row) => [row.title, row.category, row.expense_date, row.amount]))} disabled={!rows.length}>Export CSV</button></div></div>{error && <div className="form-error">{error}</div>}{rows.length ? <div className="table-wrap"><table><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong></td><td>{row.category}</td><td>{row.expense_date}</td><td className="amount">₦{Number(row.amount).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No expense records yet" text="Expenses you add from the Expenses page will appear here." />}</section>
}

function StockRecords({ orgId }: { orgId: string }) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [movements, setMovements] = useState<{ id: string; product_id: string; quantity: number; movement_type: string; created_at: string }[]>([])
  const [error, setError] = useState(''); const [dates, setDates] = useState({ from: '', to: '' })
  const applyDates = useCallback((next: { from: string; to: string }) => setDates(next), [])
  const load = useCallback(async () => {
    if (!supabase) return
    const [productResult, movementResult] = await Promise.all([
      supabase.from('products').select('id,name,sku,stock,price,cost_price').eq('organization_id', orgId).order('name'),
      (() => { let query = supabase.from('stock_movements').select('id,product_id,quantity,movement_type,created_at').eq('organization_id', orgId).gt('quantity', 0).order('created_at', { ascending: false }); if (dates.from) query = query.gte('created_at', `${dates.from}T00:00:00.000Z`); if (dates.to) query = query.lte('created_at', `${dates.to}T23:59:59.999Z`); return query })(),
    ])
    if (productResult.error || movementResult.error) setError('Stock records are temporarily unavailable.')
    setProducts(productResult.data ?? []); setMovements(movementResult.data ?? [])
  }, [dates, orgId])
  useEffect(() => { void load() }, [load])
  const total = movements.reduce((sum, movement) => sum + Number(movement.quantity), 0)
  return <section className="panel table-panel records-panel"><RecordFilters storageKey="zerobyte.records.stock" onChange={applyDates} /><div className="panel-heading"><div><span className="section-label">Inventory history</span><h2>{movements.length} intake record{movements.length === 1 ? '' : 's'}</h2></div><div className="record-actions"><span className="record-count">{total} units received</span><button className="secondary" onClick={() => downloadCsv('zerobyte-stock-intake.csv', ['Product', 'Movement', 'Quantity', 'Date'], movements.map((movement) => [products.find((product) => product.id === movement.product_id)?.name || 'Product', movement.movement_type, movement.quantity, movement.created_at]))} disabled={!movements.length}>Export CSV</button></div></div>{error && <div className="form-error">{error}</div>}{movements.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Movement</th><th>Quantity</th><th>Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{products.find((product) => product.id === movement.product_id)?.name || 'Product'}</td><td><span className="status completed">{movement.movement_type}</span></td><td className="stock-low">+{movement.quantity}</td><td>{new Date(movement.created_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No stock-intake records yet" text="Stock you receive from the Inventory page will appear here." />}</section>
}

function Sales({ orgId, scope }: { orgId: string; scope: OfflineScope | null }) {
  const [products, setProducts] = useState<ProductRow[]>([]); const [customers, setCustomers] = useState<(CustomerRow & { pending?: boolean })[]>([]); const [selected, setSelected] = useState(''); const [customer, setCustomer] = useState(''); const [quantity, setQuantity] = useState('1'); const [cart, setCart] = useState<{ product_id: string; quantity: number }[]>([]); const [message, setMessage] = useState(''); const [draftLoaded, setDraftLoaded] = useState(false)
  useEffect(() => {
    if (!scope) return
    setDraftLoaded(false)
    let active = true
    void Promise.all([readScopedCache<ProductRow>(scope, 'products'), readScopedCache<CustomerRow & { pending?: boolean }>(scope, 'customers'), readSaleDraft(scope)]).then(([cachedProducts, cachedCustomers, draft]) => {
      if (!active) return
      setProducts(cachedProducts); setCustomers(cachedCustomers); if (draft) { setCart(draft.cart); setCustomer(draft.customer) }; setDraftLoaded(true)
    })
    if (!supabase || !navigator.onLine) return () => { active = false }
    void Promise.all([supabase.from('products').select('id,name,sku,stock,price,cost_price').eq('organization_id', orgId).gt('stock', 0).order('name'), supabase.from('customers').select('id,name,email,phone').eq('organization_id', orgId).order('name')]).then(async ([productResult, customerResult]) => {
      if (!active) return
      if (!productResult.error && productResult.data) { setProducts(productResult.data); await writeScopedCache(scope, 'products', productResult.data) }
      if (!customerResult.error && customerResult.data) { setCustomers(customerResult.data); await writeScopedCache(scope, 'customers', customerResult.data) }
    })
    return () => { active = false }
  }, [orgId, scope])
  useEffect(() => { if (scope && draftLoaded) void saveSaleDraft(scope, { cart, customer }) }, [cart, customer, draftLoaded, scope])
  const selectedCustomer = customers.find((row) => row.id === customer)
  const customerReady = Boolean(customer) && !selectedCustomer?.pending
  const customerName = selectedCustomer?.name ?? 'Selected customer'
  function addToCart() {
    if (!customerReady) {
      setMessage('Choose a customer before adding items.')
      return
    }
    const item = products.find((product) => product.id === selected && product.stock > 0)
    const count = Number(quantity)
    if (!item) return
    if (count < 1 || count > item.stock) { setMessage(`Only ${item.stock} units are available.`); return }
    setCart((current) => {
      const existing = current.find((line) => line.product_id === item.id)
      return existing ? current.map((line) => line.product_id === item.id ? { ...line, quantity: Math.min(item.stock, line.quantity + count) } : line) : [...current, { product_id: item.id, quantity: count }]
    })
    setSelected('')
    setQuantity('1')
    setMessage('Item added to sale.')
  }
  function chooseCustomer(value: string) {
    setCustomer(value)
    setMessage(value ? 'Customer selected. Add products to this sale.' : '')
  }
  function changeCustomer() {
    if (cart.length && !window.confirm('Changing the customer will clear every item in this sale. Continue?')) return
    setCustomer('')
    setSelected('')
    setQuantity('1')
    setCart([])
    setMessage('Sale cleared. Choose a customer to begin again.')
  }
  async function complete(event: React.FormEvent) {
    event.preventDefault()
    if (!customerReady) { setMessage('Choose a customer before completing the sale.'); return }
    if (!supabase || !scope || !cart.length) return
    if (!navigator.onLine) {
      await enqueueOfflineOperation(scope, 'sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: 'cash' })
      setMessage('Sale saved offline. It will sync when you reconnect and the server will re-check stock and totals.')
      const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product })
      setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts)
      setCart([]); setCustomer(''); await clearSaleDraft(scope); return
    }
    const { error } = await supabase.rpc('create_sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: 'cash' })
    if (error) {
      if (/network|fetch|offline|failed to send/i.test(error.message)) {
        await enqueueOfflineOperation(scope, 'sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: 'cash' })
        setMessage('Connection lost. Sale saved offline and will sync automatically.')
        const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product })
        setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts); setCart([]); setCustomer(''); await clearSaleDraft(scope)
      } else setMessage(error.message)
    } else { setMessage('Sale completed and stock updated.'); const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product }); setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts); setCart([]); setCustomer(''); await clearSaleDraft(scope) }
  }
  const total = cart.reduce((sum, line) => sum + (products.find((product) => product.id === line.product_id)?.price ?? 0) * line.quantity, 0)
  return <div className="page"><PageIntro label="Sales" title="Build the sale, then confirm." description="Choose the customer once, add as many products as you need, and keep the draft safe until you submit." /><section className="sales-layout"><form className="panel sale-form" onSubmit={complete}><section className="sale-customer-step" aria-labelledby="sale-customer-heading"><div className="sale-step-heading"><span className="sale-step-badge">1</span><div><span className="section-label">Customer first</span><h2 id="sale-customer-heading">Who is this sale for?</h2></div></div>{!customer ? <><label htmlFor="sale-customer">Customer (required)<select id="sale-customer" required value={customer} onChange={(e) => chooseCustomer(e.target.value)}><option value="">Choose a customer</option>{customers.filter((row) => !row.pending).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><p className="field-help">Select the customer once. Their name stays attached while you add multiple products.</p>{cart.length > 0 && <div className="sale-draft-note"><UserRound size={15} /><span>This saved draft has {cart.length} item{cart.length === 1 ? '' : 's'}. Choose a customer to continue.</span></div>}</> : <div className="sale-customer-lock"><div className="sale-customer-identity"><span className="sale-step-badge sale-step-badge-complete"><Check size={14} /></span><div><strong>{customerName}</strong><small>{selectedCustomer?.pending ? 'Still syncing — choose another customer' : 'Selected for this sale'}</small></div></div><button type="button" className="secondary" onClick={changeCustomer}><Users size={16} /> Change customer</button></div>}</section>{customer && <section className={`sale-items-step ${!customerReady ? 'sale-items-step-disabled' : ''}`} aria-labelledby="sale-items-heading"><div className="sale-step-heading"><span className="sale-step-badge">2</span><div><span className="section-label">Item cart</span><h2 id="sale-items-heading">Add products for {customerName}</h2></div></div><div className="sale-add-row"><label>Product<select value={selected} disabled={!customerReady} onChange={(e) => setSelected(e.target.value)}><option value="">Choose a product</option>{products.filter((product) => product.stock > 0).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock} available</option>)}</select></label><label>Quantity<input type="number" min="1" value={quantity} disabled={!customerReady} onChange={(e) => setQuantity(e.target.value)} /></label><button type="button" className="secondary" disabled={!selected || !customerReady} onClick={addToCart}><Plus size={16} /> Add item</button></div>{cart.length > 0 && <div className="sale-cart"><div className="section-label">Items in this sale</div>{cart.map((line) => { const product = products.find((entry) => entry.id === line.product_id); return <div className="sale-cart-row" key={line.product_id}><div><strong>{product?.name}</strong><small>{line.quantity} × ₦{Number(product?.price ?? 0).toLocaleString('en-NG')}</small></div><strong>₦{Number((product?.price ?? 0) * line.quantity).toLocaleString('en-NG')}</strong><button type="button" className="text-btn danger-text" onClick={() => setCart((current) => current.filter((entry) => entry.product_id !== line.product_id))}>Remove</button></div>})}</div>}<div className="sale-total"><span>Total</span><strong>₦{total.toLocaleString('en-NG')}</strong></div>{message && <div className="form-success" role="status" aria-live="polite">{message}</div>}<button className="primary" disabled={!cart.length || !customerReady}>Complete sale <ArrowRight size={16} /></button></section>}{!customer && message && <div className="form-success" role="status" aria-live="polite">{message}</div>}</form><section className="panel sale-note"><span className="section-label">Trusted calculation</span><h2>Stock changes on the server.</h2><p>Your browser never decides the final total or bypasses inventory checks. Online sales use the secure Supabase RPC; queued offline sales use an idempotent server operation when connectivity returns.</p></section></section></div>
}

function PageIntro({ label, title, description }: { label: string; title: string; description: string }) { return <div className="page-heading"><div><span className="section-label">{label}</span><h1>{title}</h1><p className="muted">{description}</p></div></div> }
function EmptyInline({ title, text }: { title: string; text: string }) { return <div className="empty-inline"><strong>{title}</strong><span>{text}</span></div> }

export default App
