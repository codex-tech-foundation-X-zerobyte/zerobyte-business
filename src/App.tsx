import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronRight, CircleHelp, ClipboardList, FileText, Gauge, GitBranch, History, LayoutDashboard,
  LogOut, Menu, MessageCircle, Package, PanelLeftClose, PanelLeftOpen, Palette, Plus, Receipt, RefreshCw, Search, Send, Settings, ShoppingCart, ShieldCheck, Truck, UserRound, Users, Wallet, Wifi, X,
} from 'lucide-react'
import { adminSupabase, isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from './lib/supabase'
import { getCurrentUserContext } from './lib/identity'
import {
  clearOfflineUserData, discardOfflineUserData, clearSaleDraft, enqueueOfflineOperation, newOfflineOperationId, readSaleDraft,
  readOfflineOperations, readScopedCache, saveSaleDraft, syncOfflineQueue, writeScopedCache,
  type OfflineScope,
} from './lib/offline'
import type { View } from './lib/types'
import { appPath, appRoute, navigateTo } from './lib/routing'
import { buildReceiptPdf, loadImageAsDataUrl, receiptPdfFilename, type ReceiptPdfData } from './lib/receiptPdf'

// Code-split: the admin console (monitoring, audit log, user management,
// support inbox) is mutually exclusive with the business workspace at
// runtime, yet both used to ship in the same bundle regardless of which one
// a visitor actually loaded -- so every business-app visit paid to download
// and parse admin-only code it would never run, and vice versa. Lazy-loading
// it means index.html and admin.html each only fetch what they use.
const AdminConsole = lazy(() => import('./AdminConsole'))

const navGroups = [
  { label: 'Run the business', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Sales', icon: ShoppingCart }, { name: 'Inventory', icon: Package }, { name: 'Purchase Orders', icon: Truck }, { name: 'Customers', icon: Users }] },
  { label: 'Keep records', items: [{ name: 'Receipts', icon: Receipt }, { name: 'Invoices', icon: FileText }, { name: 'Expenses', icon: Wallet }, { name: 'Records', icon: ClipboardList }, { name: 'Reports', icon: BarChart3 }] },
  { label: 'People & places', items: [{ name: 'Branches', icon: LayoutDashboard }, { name: 'Workforce', icon: Users }, { name: 'User Accounts', icon: ShieldCheck }] },
]
type ProductRow = { id: string; name: string; sku: string; stock: number; price: number; cost_price: number; category?: string; reorder_point?: number; branch_id?: string | null }
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
    return <Suspense fallback={<WorkspaceSkeleton />}><AdminConsole email={email} onBack={() => navigate('/')} onLogout={() => { void adminSupabase?.auth.signOut(); window.localStorage.removeItem('zerobyte.admin-access'); navigate('/') }} /></Suspense>
  }
  if (!signedIn && path !== '/auth') return <Landing onStart={() => navigate('/auth')} />
  if (path === '/auth') return <AuthScreen />
  return <Workspace email={email} displayName={displayName} />
}

function Landing({ onStart }: { onStart: () => void }) {
  return <div className="landing"><header className="landing-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Business</small></div><div className="landing-nav-actions"><span>Built for Nigerian businesses</span><button className="text-btn" onClick={onStart}>Sign in <ArrowRight size={14} /></button></div></header><main className="landing-main"><section className="landing-hero"><div className="hero-copy"><span className="auth-kicker">The calm operating system for your business</span><h1>Run your business<br /><em>from one clear place.</em></h1><p>Sales, stock, customers and expenses — connected around the way Nigerian businesses actually work.</p><div className="hero-actions"><button className="primary hero-button" onClick={onStart}>Start for free <ArrowRight size={17} /></button><span className="hero-note">No payment details · Real records after sign-in</span></div></div><div className="hero-visual"><div className="hero-globe" aria-hidden="true"><svg viewBox="0 0 200 200" className="globe-svg"><circle cx="100" cy="100" r="86" className="globe-sphere" /><ellipse cx="100" cy="100" rx="86" ry="28" className="globe-line" /><ellipse cx="100" cy="100" rx="86" ry="52" className="globe-line" /><ellipse cx="100" cy="100" rx="86" ry="74" className="globe-line" /><ellipse cx="100" cy="100" rx="28" ry="86" className="globe-line globe-meridian" /><ellipse cx="100" cy="100" rx="58" ry="86" className="globe-line globe-meridian" /><circle cx="100" cy="100" r="86" className="globe-outline" /></svg></div><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-console"><div className="console-top"><span>zerøbyte / workspace</span><span className="live-dot">● secure</span></div><div className="console-total"><small>Your business data</small><strong>Connected records</strong><span>Nothing invented before you sign in</span></div><div className="console-bars"><i style={{ height: '34%' }} /><i style={{ height: '54%' }} /><i style={{ height: '43%' }} /><i style={{ height: '72%' }} /><i style={{ height: '62%' }} /><i style={{ height: '88%' }} /></div><div className="console-foot"><span><Package size={13} /> Stock & sales</span><span><Users size={13} /> Your team</span></div></div></div></section><section className="landing-proof"><div><strong>One workspace.</strong><span>Less switching, more knowing.</span></div><div><strong>Real records.</strong><span>Nothing invented for your dashboard.</span></div><div><strong>Made for naira.</strong><span>Prices and expenses in the language of home.</span></div></section><section className="landing-features"><div><span className="section-label">Everything in view</span><h2>Small business deserves<br />serious software.</h2><p className="landing-detail">The daily tools you need, connected around one reliable record of the business.</p></div><div className="feature-list"><div><Package /><strong>Inventory without guesswork</strong><p>Know what you have, what is low, and what needs restocking.</p></div><div><ShoppingCart /><strong>Sales that update stock</strong><p>Complete a sale once. Your records and inventory stay aligned.</p></div><div><Users /><strong>Customers and team</strong><p>Keep customer details, staff access, branches, and roles organized.</p></div><div><Wallet /><strong>Expenses in context</strong><p>Record operating costs and see them alongside the work they support.</p></div><div><Receipt /><strong>Receipts ready to share</strong><p>Find completed sales quickly and give customers a clear record.</p></div><div><BarChart3 /><strong>Reports you can trust</strong><p>See performance from activity your team actually recorded.</p></div></div></section><section className="landing-how"><div><span className="section-label">How it works</span><h2>From first setup<br />to daily clarity.</h2><p className="landing-detail">Zerøbyte follows the rhythm of a real business, so every action leaves the next person with a clearer view.</p><button className="secondary landing-how-button" onClick={onStart}>Create your workspace <ArrowRight size={15} /></button></div><div className="how-steps"><div><span>01</span><div><strong>Set up your workspace</strong><p>Add your business, branches, products, and team permissions.</p></div></div><div><span>02</span><div><strong>Record the work</strong><p>Capture sales, stock intake, customers, expenses, and receipts as they happen.</p></div></div><div><span>03</span><div><strong>Understand what changed</strong><p>Use records and reports to review the day, spot gaps, and plan the next move.</p></div></div></div></section><section className="landing-data"><div><span className="section-label">Clear by default</span><h2>You stay in control of the records.</h2><p>We collect only what the workspace needs to authenticate users, organize business records, and keep actions auditable. No payment details are collected in V1.</p></div><div className="data-points"><span><Check size={16} /> Account identity and authentication details</span><span><Check size={16} /> Business, branch, product, customer and sales records you enter</span><span><Check size={16} /> Security, audit and attendance timestamps</span></div></section><InstallPrompt /></main><footer className="landing-footer"><span>Zerøbyte Business</span><span>Run the work. Keep the signal.</span><div className="legal-links"><a href={appPath('/privacy')}>Privacy</a><a href={appPath('/terms')}>Terms</a><a href={appPath('/cookies')}>Cookies</a></div></footer></div>
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

function SupportChat({ userId, orgId, orgName, displayName, email }: { userId: string; orgId: string; orgName: string; displayName: string; email: string }) {
  const [open, setOpen] = useState(false); const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([]); const [draft, setDraft] = useState(''); const [loading, setLoading] = useState(false); const [sending, setSending] = useState(false); const [error, setError] = useState(''); const [unread, setUnread] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const refreshUnread = async () => {
      const { data: conversation } = await client.from('support_conversations').select('id,customer_read_at').eq('organization_id', orgId).eq('user_id', userId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (!conversation) return setUnread(0)
      const { data: latest } = await client.from('support_messages').select('sender_role,created_at').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      setUnread(latest?.sender_role === 'admin' && (!conversation.customer_read_at || latest.created_at > conversation.customer_read_at) ? 1 : 0)
    }
    void refreshUnread()
    const channel = client.channel(`support-user-unread-${userId}-${orgId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
      if ((payload.new as SupportMessage).sender_role === 'admin') setUnread(1)
    }).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [orgId, userId])
  const load = useCallback(async () => {
    if (!supabase) { setError('Support chat is not configured yet.'); return }
    setLoading(true); setError('')
    const openConversation = await supabase.from('support_conversations').select('id,status').eq('organization_id', orgId).eq('user_id', userId).eq('status', 'open').order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const found = openConversation.data ? openConversation : await supabase.from('support_conversations').select('id,status').eq('organization_id', orgId).eq('user_id', userId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (found.error) { setError(found.error.message.includes('does not exist') ? 'Support chat is not configured yet. Apply the support migration first.' : found.error.message); setLoading(false); return }
    let id = found.data?.id as string | undefined
    if (!id) {
      const created = await supabase.from('support_conversations').insert({ organization_id: orgId, user_id: userId }).select('id').single()
      if (created.error) { setError(created.error.message); setLoading(false); return }
      id = created.data.id
    } else if (found.data?.status === 'closed') {
      const reopened = await supabase.from('support_conversations').update({ status: 'open' }).eq('id', id).eq('user_id', userId).select('id').single()
      if (reopened.error) { setError('We could not reopen this conversation. Please try again.'); setLoading(false); return }
    }
    if (!id) { setError('Could not create a support conversation.'); setLoading(false); return }
    setConversationId(id)
    const result = await supabase.from('support_messages').select('id,conversation_id,sender_id,sender_role,body,created_at').eq('conversation_id', id).order('created_at', { ascending: true })
    if (result.error) setError(result.error.message); else setMessages((result.data ?? []) as SupportMessage[])
    await supabase.from('support_conversations').update({ customer_read_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    setUnread(0)
    setLoading(false)
  }, [orgId, userId])
  useEffect(() => {
    if (!open || !supabase || !conversationId) return
    const channel = supabase.channel(`support-user-${conversationId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const message = payload.new as SupportMessage
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
    }).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [conversationId, open])
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open])
  async function sendMessage(event: React.FormEvent) {
    event.preventDefault(); const body = draft.trim()
    if (!supabase || !conversationId || !body || sending) return
    setSending(true); setError('')
    const optimistic: SupportMessage = { id: `local-${crypto.randomUUID()}`, conversation_id: conversationId, sender_id: userId, sender_role: 'customer', body, created_at: new Date().toISOString(), delivery: 'sending' }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    const result = await supabase.from('support_messages').insert({ conversation_id: conversationId, sender_id: userId, sender_role: 'customer', body }).select('id,conversation_id,sender_id,sender_role,body,created_at').single()
    if (result.error) {
      setMessages((current) => current.map((item) => item.id === optimistic.id ? { ...item, delivery: 'failed' } : item))
      setError(result.error.message || 'Your message could not be sent.')
    } else {
      setMessages((current) => mergeSupportMessage(current, result.data as SupportMessage))
    }
    setSending(false)
  }
  return <div className="support-chat"><button className="support-launcher" onClick={() => { setOpen((value) => !value); if (!open) void load() }} aria-expanded={open}><MessageCircle size={19} /><span>Support</span>{unread > 0 && <b className="support-unread-badge">{unread}</b>}</button>{open && <section className="support-popover" aria-label="Customer support chat"><header><div><strong>{orgName || 'Business support'}</strong><small>{displayName || email || 'Signed-in user'} · Support conversation</small></div><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close support chat"><X size={17} /></button></header><div className="support-messages">{loading ? <p className="support-state">Loading conversation…</p> : error && !messages.length ? <p className="support-state support-error">{error}</p> : !messages.length ? <p className="support-state">Tell us what you need help with.</p> : messages.map((message) => <div className={`support-bubble ${message.sender_role}${message.delivery ? ` ${message.delivery}` : ''}`} key={message.id}><p>{message.body}</p><time>{message.sender_role === 'admin' ? 'Support · ' : 'You · '}{new Date(message.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} {message.delivery === 'sending' ? ' · Sending' : message.delivery === 'failed' ? ' · Not sent' : ''}</time></div>)}<div ref={messagesEndRef} /></div>{error && messages.length > 0 && <p className="support-inline-error" role="alert">{error}</p>}<form className="support-compose" onSubmit={sendMessage}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" aria-label="Support message" disabled={loading || sending || !conversationId} /><button className="primary" disabled={!draft.trim() || sending || loading || !conversationId} aria-label="Send support message">{sending ? 'Sending…' : <Send size={15} />}</button></form></section>}</div>
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
      const selected = available.find((organization) => organization.id === storedId) ?? (available.length === 1 ? available[0] : undefined)
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
  return <div className={`${dark ? 'app' : 'app light'}${collapsed ? ' sidebar-collapsed' : ''}`}><OfflineStatus scope={offlineScope} /><aside className={open ? 'sidebar open' : 'sidebar'}><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>{workerMode ? 'Worker' : 'Business'}</small><button className="close-nav" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div><div className="workspace-select"><div className="workspace-icon">{orgName.slice(0, 2).toUpperCase()}</div><select className="workspace-switcher" aria-label="Select organization" value={orgId} onChange={(event) => switchOrganization(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>{workerMode && <div className="role-badge"><ShieldCheck size={13} /><span>Staff workspace</span></div>}<nav>{visibleGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ name, icon: Icon }) => <button className={view === name ? 'nav-item active' : 'nav-item'} key={name} onClick={() => { setView(name as View); setOpen(false) }}><Icon size={17} /><span>{name}</span></button>)}</div>)}</nav>{!workerMode && <div className="sidebar-bottom"><button className={view === 'Settings' ? 'nav-item active' : 'nav-item'} onClick={() => setView('Settings')}><Settings size={17} /><span>Settings</span></button></div>}<button className="user" onClick={() => void signOut()}><div className="avatar">{(displayName || email).slice(0, 2).toUpperCase()}</div><div><strong>{displayName || email}</strong><span>{displayName ? email : 'Sign out'}</span></div></button><button className="sidebar-collapse" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span>{collapsed ? 'Expand menu' : 'Collapse menu'}</span></button></aside><main className="main"><header className="topbar"><button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={21} /></button><div className="breadcrumb"><span>{orgName}</span><ChevronRight size={14} /><strong>{view}</strong></div><div className="top-actions"><div className="search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your business..." /></div><button className="icon-btn" aria-label="Help"><CircleHelp size={19} /></button>      <NotificationCenter userId={userId!} orgId={orgId!} /><button className="theme-toggle" onClick={() => changeTheme(!dark)}>{dark ? 'Light' : 'Dark'} mode</button></div></header><div className="content">{view === 'Overview' ? <Dashboard orgId={orgId} scope={offlineScope} onNavigate={setView} workerMode={workerMode} displayName={displayName} /> : <FeatureView view={view} orgId={orgId} search={search} scope={offlineScope} themeDark={dark} onThemeChange={changeTheme} />}</div></main>  <SupportChat userId={userId!} orgId={orgId!} orgName={orgName} displayName={displayName} email={email} /></div>
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
      supabase.from('products').select(workerMode ? 'id,name,sku,stock,price' : 'id,name,sku,stock,price,cost_price,reorder_point').eq('organization_id', orgId).order('created_at', { ascending: false }),
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
  const low = products.filter((product) => product.stock <= (product.reorder_point ?? 5))
  const recentSales = sales.slice(0, 6)
  return <div className="page"><div className="welcome-strip"><div><span className="auth-kicker">Last 30 days · {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>{displayName ? `Welcome back, ${displayName}.` : workerMode ? 'Your shift, in view.' : 'Your business, in view.'}</h1><p className="muted">{workerMode ? 'The tasks and sales you need for today.' : 'A clear read on what needs your attention next.'}</p></div><button className="primary" onClick={() => onNavigate('Sales')}><Plus size={17} /> Record a sale</button></div>{dashboardError && !workerMode && <div className="form-error" role="alert">{dashboardError}</div>}<div className="metrics">{!workerMode && <><Metric label="Revenue" value={`₦${Number(metrics?.revenue ?? 0).toLocaleString('en-NG')}`} note={`${metrics?.sales_count ?? 0} completed sales`} /><Metric label="COGS" value={`₦${Number(metrics?.cogs ?? 0).toLocaleString('en-NG')}`} note="Historical cost basis" /><Metric label="Gross profit" value={`₦${Number(metrics?.gross_profit ?? 0).toLocaleString('en-NG')}`} note="Revenue less COGS" /><Metric label="Net profit" value={`₦${Number(metrics?.net_profit ?? 0).toLocaleString('en-NG')}`} note="After operating expenses" /></>}<Metric label="Products" value={products.length.toString()} note={products.length ? `${low.length} need attention` : 'Add your first product'} /><Metric label="Customers" value={customers.length.toString()} note={customers.length ? 'In your records' : 'Add your first customer'} /></div><div className="dashboard-grid"><section className="panel spotlight"><div className="panel-heading"><div><span className="section-label">{workerMode ? 'Staff focus' : 'Next best action'}</span><h2>{workerMode ? 'Serve customers with confidence.' : products.length ? 'Keep your records moving.' : 'Start with your catalog.'}</h2></div><ShieldCheck size={20} color="#06d466" /></div><p>{workerMode ? 'Record sales, select customers, and keep receipts ready. Stock and financial controls stay with managers.' : products.length ? 'Your workspace is connected. Add customers and record sales to make your reports useful.' : 'Add the products you sell so sales, stock and receipts can work from the same source of truth.'}</p><div className="action-row"><button className="secondary" onClick={() => onNavigate('Sales')}><ShoppingCart size={16} /> Record sale</button><button className="secondary" onClick={() => onNavigate('Customers')}><Users size={16} /> Find customer</button></div></section><section className="panel"><div className="panel-heading"><div><span className="section-label">Attention</span><h2>Low stock</h2></div><button className="text-btn" onClick={() => onNavigate('Sales')}>Open sales <ArrowRight size={14} /></button></div>{low.length ? low.slice(0, 4).map((product) => <div className="list-row" key={product.id}><span className="row-icon"><Package size={15} /></span><div><strong>{product.name}</strong><small>{product.sku}</small></div><b className="warning-text">{product.stock} left</b></div>) : <div className="quiet-empty">{workerMode ? 'Stock alerts are managed by your manager.' : <><Check size={16} /> No low-stock products yet.</>}</div>}</section></div><section className="panel activity-panel"><div className="panel-heading"><div><span className="section-label">Live activity</span><h2>Recent sales</h2></div><button className="text-btn" onClick={() => onNavigate('Records')}>View all records <ArrowRight size={14} /></button></div>{recentSales.length ? <><div className="activity-list">{recentSales.map((sale) => <div className="list-row" key={sale.id}><span className="row-icon sale"><ShoppingCart size={15} /></span><div><strong>Completed sale</strong><small>{new Date(sale.created_at).toLocaleString('en-NG')}</small></div><b>{workerMode ? 'Recorded' : `₦${Number(sale.total).toLocaleString('en-NG')}`}</b></div>)}</div>{sales.length > recentSales.length && <p className="activity-footnote">Showing the latest {recentSales.length} sales. Open Records to see the full history.</p>}</> : <div className="quiet-empty">No sales recorded yet. Your first completed sale will appear here.</div>}</section></div>
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div> }

function FeatureView({ view, orgId, search, scope, themeDark, onThemeChange }: { view: View; orgId: string; search: string; scope: OfflineScope | null; themeDark?: boolean; onThemeChange?: (dark: boolean) => void }) {
  if (view === 'Inventory') return <Inventory orgId={orgId} search={search} />
  if (view === 'Purchase Orders') return <PurchaseOrders orgId={orgId} />
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
  const [rows, setRows] = useState<{ id: string; employee_id: string; full_name: string; email: string | null; phone: string | null; job_title: string | null; department: string | null; employment_status: string; monthly_salary: number | null; branch_id: string | null; hired_on: string | null; user_id: string | null }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [self, setSelf] = useState<{ id: string; full_name: string; branch_id: string | null } | null>(null)
  const [attendance, setAttendance] = useState<{ id: string; work_date: string; clocked_in_at: string | null; clocked_out_at: string | null } | null>(null)
  const [form, setForm] = useState({ employee_id: '', full_name: '', email: '', phone: '', job_title: '', department: '', hired_on: new Date().toISOString().slice(0, 10), monthly_salary: '', branch_id: '' })
  const [error, setError] = useState(''); const [temporaryPassword, setTemporaryPassword] = useState(''); const [copyState, setCopyState] = useState('')
  const load = useCallback(async () => {
    if (!supabase) return
    try {
      const context = await getCurrentUserContext(supabase)
      const peopleQuery = context.employee
        ? supabase.from('employee_profiles_self').select('id,employee_id,full_name,email,phone,job_title,department,employment_status,branch_id,hired_on,user_id').eq('organization_id', orgId)
        : supabase.from('employee_profiles_manager').select('id,employee_id,full_name,email,phone,job_title,department,employment_status,monthly_salary,branch_id,hired_on,user_id').eq('organization_id', orgId)
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
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); setTemporaryPassword(''); const { data: sessionData } = await supabase.auth.getSession(); if (!sessionData.session) { setError('Your owner session has expired. Sign in again.'); return } const { data: payload, error: invokeError } = await supabase.functions.invoke('provision-worker', { body: { organizationId: orgId, employeeId: form.employee_id.trim(), fullName: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null, jobTitle: form.job_title.trim() || null, department: form.department.trim() || null, hiredOn: form.hired_on || null, monthlySalary: form.monthly_salary || null, branchId: form.branch_id || null } }); if (invokeError) { let detail = invokeError.message; try { const context = (invokeError as { context?: Response }).context; if (context) { const body = await context.clone().json() as { error?: string }; detail = body.error ?? detail } } catch { /* Keep the function error when the response is not JSON. */ } setError(detail || 'Could not create the worker account.'); return } setTemporaryPassword((payload as { temporaryPassword: string }).temporaryPassword); setCopyState(''); setForm({ employee_id: '', full_name: '', email: '', phone: '', job_title: '', department: '', hired_on: new Date().toISOString().slice(0, 10), monthly_salary: '', branch_id: '' }); load() }
  async function setWorkerStatus(id: string, action: 'ban' | 'unban') {
    if (!supabase) return
    if (!window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this staff account?`)) return
    setError('')
    const { error: result } = await supabase.functions.invoke('deactivate-worker', { body: { organizationId: orgId, employeeId: id, action } })
    if (result) setError(result.message)
    else load()
  }
  const [mySchedule, setMySchedule] = useState<{ weekday: number; starts_at: string; ends_at: string }[]>([])
  useEffect(() => { if (!supabase || !self) return; supabase.from('work_schedules').select('weekday,starts_at,ends_at').eq('employee_id', self.id).order('weekday').then(({ data }) => setMySchedule(data ?? [])) }, [self])
  // Routed through clock_in/clock_out RPCs rather than a direct table
  // update -- there is no RLS policy letting a worker UPDATE their own
  // attendance row (only INSERT, for clocking in), so a raw client-side
  // update() call here would have failed for every non-manager worker
  // trying to clock out. The RPCs also compute late/early-departure status
  // against work_schedules server-side, which a client-side computation
  // couldn't be trusted to do honestly.
  async function clock(kind: 'in' | 'out') {
    if (!supabase) return
    setError('')
    const { error: result } = kind === 'in' ? await supabase.rpc('clock_in', { target_org: orgId }) : await supabase.rpc('clock_out', { target_org: orgId })
    if (result) setError(result.message)
    else load()
  }
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (self) return <div className="page"><PageIntro label="Workforce" title={`Your shift, ${self.full_name}.`} description="Attendance is part of your worker profile and stays scoped to your assigned branch." /><section className="panel record-form three"><div><span className="section-label">Today</span><strong>{attendance?.clocked_in_at ? `Clocked in at ${new Date(attendance.clocked_in_at).toLocaleTimeString('en-NG')}` : 'Not clocked in yet'}</strong></div><button className="primary" disabled={Boolean(attendance?.clocked_in_at)} onClick={() => clock('in')}><Check size={16} /> Clock in</button><button className="secondary" disabled={!attendance?.clocked_in_at || Boolean(attendance.clocked_out_at)} onClick={() => clock('out')}>Clock out</button>{error && <div className="form-error">{error}</div>}</section>{mySchedule.length > 0 && <section className="panel table-panel"><div className="panel-heading"><div><span className="section-label">Your weekly schedule</span><h2>Set by your manager</h2></div></div><div className="table-wrap"><table><thead><tr><th>Day</th><th>Starts</th><th>Ends</th></tr></thead><tbody>{mySchedule.map((slot, index) => <tr key={index}><td>{weekdayNames[slot.weekday]}</td><td>{slot.starts_at.slice(0, 5)}</td><td>{slot.ends_at.slice(0, 5)}</td></tr>)}</tbody></table></div></section>}</div>
  return <div className="page"><PageIntro label="Workforce" title="Keep your team in view." description="Create the employee record and secure application account together. The temporary password is shown once." /><form className="panel record-form three" onSubmit={add}><label>Employee ID<input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="EMP-001" /></label><label>Full name<input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Employee name" /></label><label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="worker@business.com" /></label><label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><label>Job role/title<input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Sales associate" /></label><label>Department<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Sales floor" /></label><label>Branch<select required value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Hire date<input required type="date" value={form.hired_on} onChange={(e) => setForm({ ...form, hired_on: e.target.value })} /></label><label>Monthly salary<input type="number" min="0" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} placeholder="Optional" /></label><button className="primary"><Plus size={16} /> Create worker account</button>{error && <div className="form-error">{error}</div>}</form>{temporaryPassword && <section className="panel temporary-password"><h2>Worker account created</h2><p>Copy this temporary password now. It is not stored and will not be shown again.</p><code>{temporaryPassword}</code><button className="secondary" onClick={() => { void navigator.clipboard?.writeText(temporaryPassword); setCopyState('Copied') }}>{copyState || 'Copy temporary password'}</button></section>}<section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Role</th><th>Branch</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.full_name}</strong><small className="table-sub">{row.employee_id}</small></td><td>{row.email || '—'}<small className="table-sub">{row.phone || ''}</small></td><td>{row.job_title || '—'}{row.department && <small className="table-sub">{row.department}</small>}</td><td>{branches.find((branch) => branch.id === row.branch_id)?.name || '—'}</td><td><span className={`status ${row.employment_status === 'archived' ? 'refunded' : 'completed'}`}>{row.employment_status}</span></td><td>{row.employment_status !== 'archived' ? <button className="text-btn danger-text" type="button" onClick={() => void setWorkerStatus(row.id, 'ban')}>Ban</button> : <button className="text-btn" type="button" onClick={() => void setWorkerStatus(row.id, 'unban')}>Unban</button>}</td></tr>)}</tbody></table></div> : <EmptyInline title="No employees yet" text="Create the first worker account above." />}</section><ShiftScheduler orgId={orgId} employees={rows} /></div>
}
function ShiftScheduler({ orgId, employees }: { orgId: string; employees: { id: string; full_name: string; employment_status: string }[] }) {
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const [schedules, setSchedules] = useState<{ id: string; employee_id: string; weekday: number; starts_at: string; ends_at: string }[]>([])
  const [form, setForm] = useState({ employeeId: '', weekday: '1', startsAt: '09:00', endsAt: '17:00' }); const [error, setError] = useState('')
  const activeEmployees = employees.filter((employee) => employee.employment_status === 'active')
  const load = useCallback(() => { if (!supabase) return; supabase.from('work_schedules').select('id,employee_id,weekday,starts_at,ends_at').eq('organization_id', orgId).order('weekday').then(({ data }) => setSchedules(data ?? [])) }, [orgId])
  useEffect(() => { load() }, [load])
  async function addSchedule(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !form.employeeId) return
    // work_schedules already has manager-scoped RLS ("managers manage work
    // schedules"), so this writes directly -- no new RPC needed for a plain
    // metadata table that isn't touching stock, sales, or attendance state.
    const { error: result } = await supabase.from('work_schedules').insert({ organization_id: orgId, employee_id: form.employeeId, weekday: Number(form.weekday), starts_at: form.startsAt, ends_at: form.endsAt })
    if (result) setError(result.message)
    else { setForm({ ...form, employeeId: '' }); load() }
  }
  async function removeSchedule(id: string) { if (!supabase) return; const { error: result } = await supabase.from('work_schedules').delete().eq('id', id); if (result) setError(result.message); else load() }
  return <section className="panel table-panel">
    <div className="panel-heading"><div><span className="section-label">Weekly shift schedule</span><h2>Assign recurring shifts</h2></div></div>
    <form className="record-form three" onSubmit={addSchedule}>
      <label>Worker<select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Choose worker</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
      <label>Day<select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>{weekdayNames.map((name, index) => <option key={index} value={index}>{name}</option>)}</select></label>
      <label>Starts<input required type="time" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
      <label>Ends<input required type="time" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
      <button className="secondary"><Plus size={16} /> Add shift</button>
      {error && <div className="form-error form-wide">{error}</div>}
    </form>
    {schedules.length ? <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Day</th><th>Starts</th><th>Ends</th><th /></tr></thead><tbody>
      {schedules.map((schedule) => <tr key={schedule.id}><td>{employees.find((employee) => employee.id === schedule.employee_id)?.full_name ?? 'Worker'}</td><td>{weekdayNames[schedule.weekday]}</td><td>{schedule.starts_at.slice(0, 5)}</td><td>{schedule.ends_at.slice(0, 5)}</td><td><button type="button" className="text-btn danger-text" onClick={() => removeSchedule(schedule.id)}>Remove</button></td></tr>)}
    </tbody></table></div> : <EmptyInline title="No shifts scheduled yet" text="Assign a worker's recurring weekly shift above. Clocking in will be checked against it." />}
  </section>
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

type ReceiptRow = { id: string; receipt_number: string | null; total: number; tax_amount: number; payment_method: string; created_at: string; customer: { name: string; phone: string | null; email: string | null } | null; sale_items: { id: string; quantity: number; unit_price: number; line_total: number; products: { name: string; sku: string } | null }[] }
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

function Receipts({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [business, setBusiness] = useState<BusinessReceiptProfile>({ name: 'Zerøbyte Business', address: '', phone: '', email: '', website: '', logo_url: '', currency: 'NGN' }); const [preview, setPreview] = useState<ReceiptRow | null>(null); const [error, setError] = useState(''); const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)
  useEffect(() => { if (!supabase) return; Promise.all([supabase.from('sales').select('id,receipt_number,total,tax_amount,payment_method,created_at,customers(name,phone,email),sale_items(id,quantity,unit_price,line_total,products(name,sku))').eq('organization_id', orgId).order('created_at', { ascending: false }), supabase.from('organizations').select('name,address,phone,email,website,logo_url,currency').eq('id', orgId).single()]).then(([salesResult, orgResult]) => { if (salesResult.error) setError(salesResult.error.message); if (orgResult.error) setError(orgResult.error.message); setRows((salesResult.data ?? []) as unknown as ReceiptRow[]); if (orgResult.data) setBusiness({ name: orgResult.data.name, address: orgResult.data.address ?? '', phone: orgResult.data.phone ?? '', email: orgResult.data.email ?? '', website: orgResult.data.website ?? '', logo_url: normalizeLogoUrl(orgResult.data.logo_url), currency: orgResult.data.currency ?? 'NGN' }) }) }, [orgId])
  function toReceiptPdfData(row: ReceiptRow): ReceiptPdfData {
    return {
      receiptNumber: row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`,
      createdAt: row.created_at,
      paymentMethod: row.payment_method,
      subtotal: Number(row.total),
      taxAmount: Number(row.tax_amount),
      taxLabel: 'VAT / tax',
      total: Number(row.total) + Number(row.tax_amount),
      amountInWords: amountInWords(Number(row.total) + Number(row.tax_amount)),
      customer: row.customer,
      items: row.sale_items.map((item) => ({ name: item.products?.name ?? 'Item', sku: item.products?.sku, quantity: item.quantity, unitPrice: Number(item.unit_price), lineTotal: Number(item.line_total) })),
    }
  }
  async function generateReceiptPdfBlob(row: ReceiptRow) {
    const logoDataUrl = business.logo_url ? await loadImageAsDataUrl(business.logo_url) : null
    const doc = buildReceiptPdf(toReceiptPdfData(row), { name: business.name, address: business.address, phone: business.phone, email: business.email, website: business.website, currency: business.currency, logoDataUrl })
    const filename = receiptPdfFilename(row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`)
    return { blob: doc.output('blob') as Blob, filename }
  }
  async function download(row: ReceiptRow) {
    setPdfBusyId(row.id)
    try {
      const { blob, filename } = await generateReceiptPdfBlob(row)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = filename
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not generate the receipt PDF.')
    } finally {
      setPdfBusyId(null)
    }
  }
  async function share(row: ReceiptRow) {
    setPdfBusyId(row.id)
    try {
      const { blob, filename } = await generateReceiptPdfBlob(row)
      const title = `Receipt ${row.receipt_number ?? row.id.slice(0, 8).toUpperCase()}`
      const summary = `Receipt ${row.receipt_number ?? row.id.slice(0, 8).toUpperCase()} from ${business.name}. Total: ${business.currency} ${Number(row.total).toLocaleString('en-NG')}`
      const file = new File([blob], filename, { type: 'application/pdf' })
      // Web Share API Level 2 (file sharing) -- where supported (most
      // mobile browsers), this hands the real PDF straight to WhatsApp,
      // Mail, etc. from the share sheet, not just a text summary.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text: summary, files: [file] })
        return
      }
      if (navigator.share) {
        await navigator.share({ title, text: summary })
        return
      }
      await download(row)
      const phone = window.prompt('Optional WhatsApp number, including country code. The branded PDF has been downloaded for you to attach manually:')
      if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(summary)}`, '_blank', 'noopener,noreferrer')
    } catch (reason) {
      // AbortError just means the person closed the native share sheet --
      // not a real failure worth surfacing.
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Could not share the receipt PDF.')
    } finally {
      setPdfBusyId(null)
    }
  }
  return <div className="page"><PageIntro label="Receipts" title="Every sale, ready to prove." description="Receipt items and totals come from the persisted sale and sale_items records." />{error && <div className="form-error" role="alert">{error}</div>}<section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>Total</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mono">{row.receipt_number ?? `RC-${row.id.slice(0, 8).toUpperCase()}`}</td><td>{row.customer?.name || 'Walk-in customer'}</td><td>{new Date(row.created_at).toLocaleString('en-NG')}</td><td className="amount">₦{(Number(row.total) + Number(row.tax_amount)).toLocaleString('en-NG')}</td><td><button className="text-btn" onClick={() => setPreview(row)}>Preview</button><button className="text-btn" disabled={pdfBusyId === row.id} onClick={() => void download(row)}>{pdfBusyId === row.id ? 'Preparing…' : 'Download PDF'}</button><button className="text-btn" disabled={pdfBusyId === row.id} onClick={() => void share(row)}>Share</button></td></tr>)}</tbody></table></div> : <EmptyInline title="No receipts yet" text="Complete a sale and its receipt will appear here." />}</section>{preview && <div className="receipt-preview-backdrop" onClick={() => setPreview(null)}><article className="receipt-preview" onClick={(event) => event.stopPropagation()}><button className="icon-btn receipt-close" onClick={() => setPreview(null)} aria-label="Close receipt"><X size={16} /></button><header className="receipt-document-header">{business.logo_url ? <img className="receipt-logo" src={business.logo_url} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <div className="receipt-brand-mark">ø</div>}<div><h2>{business.name}</h2><span>INNOVATION · SKILLS · IMPACT</span><small>{[business.address, business.phone, business.email, business.website].filter(Boolean).join('  ·  ')}</small></div></header><div className="receipt-title-row"><div><h1>SALES RECEIPT</h1><p>Thank you for your business!</p></div><div className="receipt-meta-grid"><div><small>Receipt No.</small><strong>{preview.receipt_number ?? `RC-${preview.id.slice(0, 8).toUpperCase()}`}</strong></div><div><small>Date & time</small><strong>{new Date(preview.created_at).toLocaleString('en-NG')}</strong></div></div></div><div className="receipt-customer"><small>CUSTOMER</small><strong>{preview.customer?.name || 'Walk-in Customer'}</strong>{preview.customer?.phone && <span>{preview.customer.phone}</span>}{preview.customer?.email && <span>{preview.customer.email}</span>}</div><div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{preview.sale_items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.products?.name ?? 'Item'}</strong>{item.products?.sku && <small>{item.products.sku}</small>}</td><td>{item.quantity}</td><td>{business.currency} {Number(item.unit_price).toLocaleString('en-NG')}</td><td>{business.currency} {Number(item.line_total).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div><div className="receipt-summary"><div><span>Subtotal</span><strong>{business.currency} {Number(preview.total).toLocaleString('en-NG')}</strong></div><div><span>Discount</span><strong>{business.currency} 0</strong></div><div><span>VAT / tax</span><strong>{business.currency} {Number(preview.tax_amount).toLocaleString('en-NG')}</strong></div><div className="receipt-grand-total"><span>Total</span><strong>{business.currency} {(Number(preview.total) + Number(preview.tax_amount)).toLocaleString('en-NG')}</strong></div></div><div className="receipt-detail-grid"><div className="receipt-payment"><span>Payment method</span><strong>{preview.payment_method}</strong></div><div className="receipt-words"><small>AMOUNT IN WORDS</small><p>{amountInWords(Number(preview.total) + Number(preview.tax_amount))}</p></div></div><footer className="receipt-document-footer"><strong>✓ &nbsp; Thank you for your business.</strong><span>Powered by Zerøbyte</span></footer><div className="action-row receipt-actions"><button className="primary receipt-print" disabled={pdfBusyId === preview.id} onClick={() => void download(preview)}>{pdfBusyId === preview.id ? 'Preparing…' : 'Download PDF'}</button><button className="secondary" disabled={pdfBusyId === preview.id} onClick={() => void share(preview)}>Share / WhatsApp</button></div></article></div>}</div>
}

function Invoices({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; invoice_number: string; status: string; total: number; due_date: string | null; created_at: string }[]>([])
  const [form, setForm] = useState({ invoice_number: '', total: '', due_date: '' }); const [error, setError] = useState(''); const [busyId, setBusyId] = useState<string | null>(null)
  const load = useCallback(() => { supabase?.from('invoices').select('id,invoice_number,status,total,due_date,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).then(({ data }) => setRows(data ?? [])) }, [orgId])
  useEffect(() => {
    // Opportunistically flags anything past its due date as OVERDUE each
    // time the page loads (there's no cron job wiring this up). A stale
    // status is only ever "not yet noticed", never wrong the other way --
    // this never marks something overdue before its actual due date.
    if (supabase) supabase.rpc('flag_overdue_invoices', { target_org: orgId }).then(() => load())
    else load()
  }, [orgId, load])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; const { error: result } = await supabase.from('invoices').insert({ organization_id: orgId, invoice_number: form.invoice_number, total: Number(form.total), due_date: form.due_date || null }); if (result) setError(result.code === '23505' ? 'That invoice number already exists.' : result.message); else { setForm({ invoice_number: '', total: '', due_date: '' }); load() } }
  async function setStatus(id: string, status: string) { if (!supabase) return; setBusyId(id); const { error: result } = await supabase.from('invoices').update({ status }).eq('id', id).eq('organization_id', orgId); if (result) setError(result.message); else load(); setBusyId(null) }
  async function remind(id: string) { if (!supabase) return; setBusyId(id); const { error: result } = await supabase.rpc('send_invoice_reminder', { target_org: orgId, target_invoice: id }); if (result) setError(result.message); else setError(''); setBusyId(null) }
  const daysOverdue = (row: { due_date: string | null }) => row.due_date ? Math.floor((Date.now() - new Date(row.due_date).getTime()) / 86400000) : null
  return <div className="page"><PageIntro label="Invoices" title="Keep billing clear." description="Create simple invoice records in naira, track their status, and send a reminder when one is overdue." /><form className="panel record-form three" onSubmit={add}><div><label>Invoice number<input required value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} placeholder="INV-0001" /></label></div><div><label>Total amount<input required type="number" min="0" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="₦0.00" /></label></div><div><label>Due date (optional)<input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label></div><button className="primary"><Plus size={16} /> Create draft</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Status</th><th>Due date</th><th>Date</th><th>Total</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => { const overdue = daysOverdue(row); return <tr key={row.id}><td><strong>{row.invoice_number}</strong></td><td><span className={`status ${row.status === 'PAID' ? 'completed' : row.status === 'OVERDUE' ? 'danger-text' : 'pending'}`}>{row.status}</span></td><td className={row.status === 'OVERDUE' && overdue != null ? 'warning-text' : ''}>{row.due_date ? new Date(row.due_date).toLocaleDateString('en-NG') : '—'}{row.status === 'OVERDUE' && overdue != null && overdue > 0 && <small className="field-help">{overdue} day{overdue === 1 ? '' : 's'} overdue</small>}</td><td>{new Date(row.created_at).toLocaleDateString('en-NG')}</td><td className="amount">₦{Number(row.total).toLocaleString('en-NG')}</td><td>{row.status === 'DRAFT' && <button type="button" className="text-btn" disabled={busyId === row.id} onClick={() => setStatus(row.id, 'SENT')}>Mark sent</button>}{(row.status === 'SENT' || row.status === 'OVERDUE') && <><button type="button" className="text-btn" disabled={busyId === row.id} onClick={() => setStatus(row.id, 'PAID')}>Mark paid</button><button type="button" className="text-btn" disabled={busyId === row.id} onClick={() => remind(row.id)}>Send reminder</button></>}{row.status !== 'PAID' && row.status !== 'CANCELED' && <button type="button" className="text-btn danger-text" disabled={busyId === row.id} onClick={() => setStatus(row.id, 'CANCELED')}>Cancel</button>}</td></tr> })}</tbody></table></div> : <EmptyInline title="No invoices yet" text="Create your first draft invoice above." />}</section></div>
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
  return <div className="page reports-page"><PageIntro label="Reports" title="Understand the signal." description="A server-calculated view of sales performance, cost of goods, and operating expenses." /><section className="panel report-toolbar"><div><span className="section-label">Reporting period</span><strong>{new Date(`${dateFrom}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} — {new Date(`${dateTo}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div><div className="report-presets" aria-label="Quick reporting periods"><button className="text-btn" onClick={() => setPreset(6)}>7 days</button><button className="text-btn" onClick={() => setPreset(29)}>30 days</button><button className="text-btn" onClick={() => setPreset(364)}>12 months</button></div><div className="report-date-fields"><label>From<input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} min={dateFrom} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDateTo(event.target.value)} /></label></div></section>{error && <div className="form-error" role="alert">{error}</div>}<div className="metrics report-metrics"><Metric label="Revenue" value={`₦${revenue.toLocaleString('en-NG')}`} note={`${metrics?.sales_count ?? 0} completed sales`} /><Metric label="COGS" value={`₦${cogs.toLocaleString('en-NG')}`} note="Historical sale costs" /><Metric label="Gross profit" value={`₦${gross.toLocaleString('en-NG')}`} note="Revenue less COGS" /><Metric label="Operating expenses" value={`₦${expenses.toLocaleString('en-NG')}`} note="Recorded expenses" /></div><div className="report-grid"><section className="panel report-breakdown"><div className="panel-heading"><div><span className="section-label">Financial shape</span><h2>Where the money moved</h2></div><BarChart3 size={20} color="#06d466" /></div><div className="report-bars">{[['Revenue', revenue, 'revenue'], ['COGS', cogs, 'cogs'], ['Expenses', expenses, 'expenses'], ['Net profit', net, 'profit']].map(([label, value, tone]) => <div className="report-bar-row" key={label as string}><div><span>{label}</span><strong>₦{Number(value).toLocaleString('en-NG')}</strong></div><div className="report-bar-track"><i className={`report-bar ${tone}`} style={{ width: `${Math.max((Math.abs(Number(value)) / maxValue) * 100, Number(value) > 0 ? 2 : 0)}%` }} /></div></div>)}</div><p className="report-caption">Bars are scaled against the largest value in this period. All figures come from completed records.</p></section><section className="panel report-profit"><span className="section-label">Bottom line</span><h2>Net profit</h2><strong>₦{net.toLocaleString('en-NG')}</strong><p>Revenue minus historical COGS and operating expenses.</p><div className={net >= 0 ? 'profit-status positive' : 'profit-status negative'}>{net >= 0 ? 'Positive result' : 'Needs attention'}</div></section></div></div>
}

function SettingsPage({ orgId, themeDark, onThemeChange }: { orgId: string; themeDark: boolean; onThemeChange: (dark: boolean) => void }) {
  const [form, setForm] = useState({ name: '', address: '', phone: '', email: '', website: '', logo_url: '', receipt_prefix: '', tax_rate: '0' }); const [saved, setSaved] = useState(false); const [error, setError] = useState('')
  const [announcements, setAnnouncements] = useState<{ id: string; version: string; message: string; created_at: string }[]>([])
  const [activeTab, setActiveTab] = useState<'business' | 'appearance' | 'security' | 'guide'>('business')
  useEffect(() => { supabase?.from('organizations').select('name,address,phone,email,website,logo_url,receipt_prefix,tax_rate').eq('id', orgId).single().then(({ data }) => setForm({ name: data?.name ?? '', address: data?.address ?? '', phone: data?.phone ?? '', email: data?.email ?? '', website: data?.website ?? '', logo_url: normalizeLogoUrl(data?.logo_url), receipt_prefix: data?.receipt_prefix ?? '', tax_rate: String(data?.tax_rate ?? 0) })) }, [orgId])
  useEffect(() => { supabase?.from('app_version_announcements').select('id,version,message,created_at').order('created_at', { ascending: false }).limit(20).then(({ data }) => setAnnouncements((data ?? []) as typeof announcements)) }, [])
  async function save(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); const payload = { ...form, receipt_prefix: form.receipt_prefix.toUpperCase(), tax_rate: Math.min(100, Math.max(0, Number(form.tax_rate) || 0)) }; const { error: result } = await supabase.from('organizations').update(payload).eq('id', orgId); if (result) setError(result.message); else { setForm({ ...form, receipt_prefix: payload.receipt_prefix, tax_rate: String(payload.tax_rate) }); setSaved(true) } }
  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file || !supabase) return; if (!file.type.startsWith('image/')) { setError('Choose a PNG, JPG, WEBP, or SVG image.'); return } if (file.size > 2 * 1024 * 1024) { setError('Logo must be smaller than 2 MB.'); return } setError(''); const path = `${orgId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const { error: uploadError } = await supabase.storage.from('business-logos').upload(path, file, { upsert: true, contentType: file.type }); if (uploadError) { setError(`Logo upload failed: ${uploadError.message}. Confirm the business-logos storage migration is applied.`); return } const { data } = supabase.storage.from('business-logos').getPublicUrl(path); setForm({ ...form, logo_url: normalizeLogoUrl(data.publicUrl) }); setSaved(false) }
  const tabs = [{ id: 'business', label: 'Business profile', icon: Settings }, { id: 'appearance', label: 'Appearance', icon: Palette }, { id: 'security', label: 'Security', icon: ShieldCheck }, { id: 'guide', label: 'Guide & updates', icon: BookOpen }] as const
  return <div className="page settings-page"><PageIntro label="Settings" title="Make it yours." description="Manage your business identity, workspace preferences, account security, and updates." /><nav className="settings-tabs" aria-label="Settings sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`settings-tab ${activeTab === id ? 'active' : ''}`} aria-selected={activeTab === id} onClick={() => setActiveTab(id)}><Icon size={16} />{label}</button>)}</nav>
    {activeTab === 'business' && <form className="panel settings-form" onSubmit={save}><div className="settings-section-heading"><span className="section-label">Business profile</span><p className="muted">Use real contact details. Your optional logo is shown in the receipt header.</p></div><label>Business name<input required minLength={2} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setSaved(false) }} /></label><label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city, state" /></label><label>Phone number<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><label>Business email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hello@business.com" /></label><label>Website<input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://business.com" /></label><label>Receipt prefix<input maxLength={8} pattern="[A-Za-z0-9]{2,8}" value={form.receipt_prefix} onChange={(e) => setForm({ ...form, receipt_prefix: e.target.value.toUpperCase() })} placeholder="ZB" /><small className="field-help">Used for receipt numbers such as ZB-001.</small></label><label>Tax / VAT rate (%)<input type="number" min="0" max="100" step="0.01" value={form.tax_rate} onChange={(e) => { setForm({ ...form, tax_rate: e.target.value }); setSaved(false) }} placeholder="7.5" /><small className="field-help">Applied to new sales going forward. Past receipts keep the rate that applied when they were created.</small></label><label className="settings-wide">Business logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => void uploadLogo(e)} /><small className="field-help">{form.logo_url ? 'Logo uploaded. Save the profile to use it on receipts.' : 'PNG, JPG, WEBP, or SVG up to 2 MB.'}</small></label><div className="settings-actions"><button className="primary">Save business profile</button>{saved && <span className="form-success">Saved to your organization.</span>}{error && <span className="form-error">{error}</span>}</div></form>}
    {activeTab === 'appearance' && <section className="panel settings-preferences"><div><span className="section-label">Preferences</span><h2>Make the workspace comfortable.</h2><p>These settings are saved on this device and do not change your business records.</p></div><label className="settings-toggle-row"><span><strong>Dark mode</strong><small>Use the dark Zerøbyte workspace theme.</small></span><input type="checkbox" role="switch" checked={themeDark} onChange={(event) => onThemeChange(event.target.checked)} /></label></section>}
    {activeTab === 'security' && <><section className="panel settings-security"><span className="section-label">Account security</span><h2>Change your password</h2><p>Choose a unique password you do not reuse elsewhere.</p><PasswordSettings /></section><section className="panel settings-info"><span className="section-label">Data protection</span><h2>Organization-scoped by default.</h2><p>Every product, customer, sale and expense is protected by Supabase Row Level Security and tied to this workspace.</p></section></>}
    {activeTab === 'guide' && <><section className="panel app-version-card"><div><span className="section-label">Application</span><h2>Zerøbyte Business <span className="version-badge">v{import.meta.env.VITE_APP_VERSION ?? '1.0.0'}</span></h2><p className="muted">{announcements[0] ? `Latest release · v${announcements[0].version}: ${announcements[0].message}` : 'You are running the current published workspace.'}</p></div></section>{announcements.length > 0 && <section className="panel changelog-panel"><div className="panel-heading"><div><span className="section-label">Release history</span><h2>Changelog</h2></div><span className="version-badge">{announcements.length} release{announcements.length === 1 ? '' : 's'}</span></div><div className="changelog-list">{announcements.map((item) => <article className="changelog-entry" key={item.id}><div><strong>v{item.version}</strong><time>{new Date(item.created_at).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</time></div><p>{item.message}</p></article>)}</div></section>}<section className="panel settings-info"><span className="section-label">User guide</span><h2>A simple rhythm for clean records.</h2><div className="guide-list"><p><strong>1. Inventory:</strong> add products and receive stock. Stock intake is recorded automatically.</p><p><strong>2. Sales:</strong> choose a customer first, add products, then complete the sale.</p><p><strong>3. Expenses:</strong> record operating costs on the Expenses page.</p><p><strong>4. Records:</strong> choose a period to review history, totals, and export CSV for Excel or Sheets. Records are read-only here.</p><p><strong>5. Offline:</strong> drafts and queued changes stay on this device until you reconnect. Review the sync banner before signing out.</p></div></section></>}
  </div>
}

function Inventory({ orgId, search }: { orgId: string; search: string }) {
  const [rows, setRows] = useState<ProductRow[]>([]); const [form, setForm] = useState({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }); const [receive, setReceive] = useState({ productId: '', quantity: '', cost: '', selling: '' }); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState('')
  const [movements, setMovements] = useState<{ id: string; product_id: string; movement_type: string; quantity: number; created_at: string }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]); const [transferBusyId, setTransferBusyId] = useState<string | null>(null)
  const load = useCallback(() => { if (!supabase) return; Promise.all([supabase.from('products').select('id,name,sku,stock,price,cost_price,category,reorder_point,branch_id').eq('organization_id', orgId).order('created_at', { ascending: false }), supabase.from('stock_movements').select('id,product_id,movement_type,quantity,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20), supabase.from('branches').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name')]).then(([productResult, movementResult, branchResult]) => { setRows((productResult.data ?? []) as ProductRow[]); setMovements(movementResult.data ?? []); setBranches(branchResult.data ?? []) }) }, [orgId])
  useEffect(() => { load() }, [load])
  async function transferBranch(productId: string, destinationBranchId: string) {
    if (!supabase) return
    setTransferBusyId(productId)
    const { error: result } = await supabase.rpc('transfer_product_branch', { target_org: orgId, target_product: productId, destination_branch: destinationBranchId || null })
    if (result) setError(result.message)
    else load()
    setTransferBusyId(null)
  }
  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    const openingStock = Number(form.stock)
    const reorderPoint = Math.max(0, Number(form.reorderPoint) || 0)
    const payload = { name: form.name, sku: form.sku, category: form.category || 'Uncategorized', price: Number(form.price) }
    if (editing) {
      const result = await supabase.rpc('update_product_catalog', {
        target_org: orgId,
        target_product: editing,
        product_name: payload.name,
        product_sku: payload.sku,
        product_category: payload.category,
        selling_price: payload.price,
        target_reorder_point: reorderPoint,
      })
      if (result.error) setError(result.error.code === '23505' ? 'That SKU is already in use in this workspace.' : result.error.message)
      else { setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }); setEditing(null); load() }
      return
    }
    const result = await supabase.from('products').insert({ organization_id: orgId, ...payload, cost_price: Number(form.cost), stock: 0, reorder_point: reorderPoint }).select('id').single()
    if (result.error || !result.data) {
      setError(result.error?.code === '23505' ? 'That SKU is already in use in this workspace.' : result.error?.message ?? 'Could not create the product.')
      return
    }
    if (openingStock > 0) {
      const movement = await supabase.rpc('initialize_stock', { target_org: orgId, target_product: result.data.id, opening_quantity: openingStock })
      if (movement.error) { setError(movement.error.message); return }
    }
    setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }); load()
  }
  async function remove(id: string) { if (!supabase || !window.confirm('Delete this product? This cannot be undone.')) return; const { error: result } = await supabase.from('products').delete().eq('id', id).eq('organization_id', orgId); if (result) setError(result.message); else load() }
  async function receiveStock(event: React.FormEvent) { event.preventDefault(); if (!navigator.onLine) { setError('Inventory receiving is online-only. Reconnect before adding stock.'); return } if (!supabase) return; const { error: result } = await supabase.rpc('receive_stock', { target_org: orgId, target_product: receive.productId, quantity_to_add: Number(receive.quantity), new_cost: receive.cost ? Number(receive.cost) : null, new_selling: receive.selling ? Number(receive.selling) : null, target_branch: null }); if (result) setError(result.message); else { setReceive({ productId: '', quantity: '', cost: '', selling: '' }); load() } }
  function edit(row: ProductRow) { setEditing(row.id); setForm({ name: row.name, sku: row.sku, category: row.category ?? '', price: String(row.price), cost: String(row.cost_price ?? 0), stock: String(row.stock), reorderPoint: String(row.reorder_point ?? 5) }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const filtered = rows.filter((row) => `${row.name} ${row.sku} ${row.category}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page"><PageIntro label="Inventory" title="Know what is in stock." description="Edit product details, receive new stock through a server transaction, and keep a traceable catalog." /><form className="panel record-form inventory-product-form" onSubmit={add}><label>Product name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 5kg Rice" /></label><label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="RICE-005" /></label><label>Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Groceries" /></label><label>Cost price<input required type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="₦0.00" /></label><label>Selling price<input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="₦0.00" /></label><label>{editing ? 'Current stock (read-only)' : 'Opening stock'}<input required type="number" min="0" readOnly={Boolean(editing)} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" /></label><label>Reorder alert level<input required type="number" min="0" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} placeholder="5" /><small className="field-help">You'll be notified when stock falls to or below this level.</small></label><button className="primary"><Plus size={16} /> {editing ? 'Save product' : 'Add product'}</button>{editing && <><small className="field-help form-wide">Cost price changes for existing products are made through Stock receiving so every change is recorded.</small><button type="button" className="secondary" onClick={() => { setEditing(null); setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }) }}>Cancel</button></>}{error && <div className="form-error">{error}</div>}</form><form className="panel receive-form" onSubmit={receiveStock}><div className="receive-heading"><span className="section-label">Stock receiving · Online only</span><h2>Add stock without duplicating the product</h2><p>Stock receiving needs a live server transaction. Reconnect before receiving inventory.</p></div><label>Product<select required value={receive.productId} onChange={(e) => setReceive({ ...receive, productId: e.target.value })}><option value="">Choose product</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.stock} units</option>)}</select></label><label>Quantity<input required type="number" min="1" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} /></label><label>New cost (optional)<input type="number" min="0" step="0.01" value={receive.cost} onChange={(e) => setReceive({ ...receive, cost: e.target.value })} placeholder="Keep current" /></label><label>New selling price (optional)<input type="number" min="0" step="0.01" value={receive.selling} onChange={(e) => setReceive({ ...receive, selling: e.target.value })} placeholder="Keep current" /></label><button className="secondary" disabled={!navigator.onLine}>Receive stock</button></form><section className="panel table-panel catalog-panel"><div className="panel-heading"><div><span className="section-label">Your catalog</span><h2>{rows.length} product{rows.length === 1 ? '' : 's'}</h2></div></div>{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Cost price</th><th>Selling price</th>{branches.length > 0 && <th>Branch</th>}<th>Actions</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td className="mono">{row.sku}</td><td>{row.category}</td><td className={row.stock <= (row.reorder_point ?? 5) ? 'warning-text' : ''}>{row.stock}</td><td className="amount">₦{Number(row.cost_price).toLocaleString('en-NG')}</td><td className="amount">₦{Number(row.price).toLocaleString('en-NG')}</td>{branches.length > 0 && <td><select value={row.branch_id ?? ''} disabled={transferBusyId === row.id} onChange={(e) => transferBranch(row.id, e.target.value)}><option value="">Shared (all branches)</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></td>}<td><button type="button" className="text-btn" onClick={() => edit(row)}>Edit</button><button type="button" className="text-btn danger-text" onClick={() => remove(row.id)}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyInline title="No products yet" text="Add your first product above. It will become available to sales and stock workflows." />}</section><section className="panel table-panel stock-history"><div className="panel-heading"><div><span className="section-label">Stock history</span><h2>Recent movements</h2></div></div>{movements.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Movement</th><th>Quantity</th><th>Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{rows.find((row) => row.id === movement.product_id)?.name || 'Product'}</td><td><span className="status completed">{movement.movement_type}</span></td><td className={movement.quantity < 0 ? 'danger-text' : 'stock-low'}>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td><td>{new Date(movement.created_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No stock movements yet" text="Receiving stock and completing sales will create an auditable history here." />}</section></div>
}

type SupplierRow = { id: string; name: string; phone: string | null; email: string | null }
type PurchaseOrderRow = { id: string; status: 'ordered' | 'received' | 'cancelled'; total_cost: number; notes: string | null; created_at: string; received_at: string | null; suppliers: { name: string } | null }
function PurchaseOrders({ orgId }: { orgId: string }) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]); const [orders, setOrders] = useState<PurchaseOrderRow[]>([]); const [products, setProducts] = useState<{ id: string; name: string; cost_price: number }[]>([])
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', email: '' }); const [error, setError] = useState(''); const [busyId, setBusyId] = useState<string | null>(null)
  const [poForm, setPoForm] = useState({ supplierId: '', notes: '' }); const [poItems, setPoItems] = useState<{ product_id: string; quantity: number; unit_cost: number }[]>([]); const [poLine, setPoLine] = useState({ productId: '', quantity: '1', unitCost: '' })
  const load = useCallback(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('suppliers').select('id,name,phone,email').eq('organization_id', orgId).order('name'),
      supabase.from('purchase_orders').select('id,status,total_cost,notes,created_at,received_at,suppliers(name)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
      supabase.from('products').select('id,name,cost_price').eq('organization_id', orgId).order('name'),
    ]).then(([supplierResult, poResult, productResult]) => {
      setSuppliers(supplierResult.data ?? [])
      setOrders((poResult.data ?? []) as unknown as PurchaseOrderRow[])
      setProducts(productResult.data ?? [])
    })
  }, [orgId])
  useEffect(() => { load() }, [load])
  async function addSupplier(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !supplierForm.name.trim()) return
    const { error: result } = await supabase.from('suppliers').insert({ organization_id: orgId, name: supplierForm.name.trim(), phone: supplierForm.phone || null, email: supplierForm.email || null })
    if (result) setError(result.message)
    else { setSupplierForm({ name: '', phone: '', email: '' }); load() }
  }
  function addLine() {
    if (!poLine.productId || Number(poLine.quantity) <= 0 || Number(poLine.unitCost) < 0) return
    setPoItems((current) => [...current, { product_id: poLine.productId, quantity: Number(poLine.quantity), unit_cost: Number(poLine.unitCost) }])
    setPoLine({ productId: '', quantity: '1', unitCost: '' })
  }
  async function createOrder(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !poForm.supplierId || !poItems.length) { setError('Choose a supplier and add at least one line item.'); return }
    const { error: result } = await supabase.rpc('create_purchase_order', { target_org: orgId, target_supplier: poForm.supplierId, target_branch: null, items: poItems, po_notes: poForm.notes || null })
    if (result) setError(result.message)
    else { setPoForm({ supplierId: '', notes: '' }); setPoItems([]); load() }
  }
  async function receiveOrder(id: string) {
    if (!supabase || !window.confirm('Receive this purchase order? Stock and cost prices will update immediately.')) return
    setBusyId(id)
    const { error: result } = await supabase.rpc('receive_purchase_order', { target_org: orgId, target_po: id })
    if (result) setError(result.message)
    else load()
    setBusyId(null)
  }
  async function cancelOrder(id: string) {
    if (!supabase || !window.confirm('Cancel this purchase order?')) return
    setBusyId(id)
    const { error: result } = await supabase.rpc('cancel_purchase_order', { target_org: orgId, target_po: id })
    if (result) setError(result.message)
    else load()
    setBusyId(null)
  }
  const poTotal = poItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  return <div className="page">
    <PageIntro label="Purchase Orders" title="Reorder stock from your suppliers." description="Track who you buy from, place orders, and receive them straight into inventory with the same audit trail as manual stock receiving." />
    <form className="panel record-form" onSubmit={addSupplier}>
      <div className="section-label form-wide">Add a supplier</div>
      <label>Supplier name<input required value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} placeholder="e.g. Lagos Foods Distributors" /></label>
      <label>Phone<input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} placeholder="080..." /></label>
      <label>Email<input type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} placeholder="orders@supplier.com" /></label>
      <button className="secondary"><Plus size={16} /> Add supplier</button>
    </form>
    <form className="panel record-form" onSubmit={createOrder}>
      <div className="section-label form-wide">New purchase order</div>
      <label>Supplier<select required value={poForm.supplierId} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}><option value="">Choose supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
      <label>Notes (optional)<input value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })} placeholder="Delivery week, PO reference…" /></label>
      <div className="form-wide sale-add-row">
        <select value={poLine.productId} onChange={(e) => setPoLine({ ...poLine, productId: e.target.value, unitCost: products.find((p) => p.id === e.target.value)?.cost_price != null ? String(products.find((p) => p.id === e.target.value)?.cost_price) : poLine.unitCost })}>
          <option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <input type="number" min="1" value={poLine.quantity} onChange={(e) => setPoLine({ ...poLine, quantity: e.target.value })} placeholder="Qty" />
        <input type="number" min="0" step="0.01" value={poLine.unitCost} onChange={(e) => setPoLine({ ...poLine, unitCost: e.target.value })} placeholder="Unit cost" />
        <button type="button" className="secondary" onClick={addLine}>Add line</button>
      </div>
      {poItems.length > 0 && <div className="form-wide sale-cart">{poItems.map((item, index) => { const product = products.find((p) => p.id === item.product_id); return <div className="sale-cart-row" key={index}><div><strong>{product?.name}</strong><small>{item.quantity} × ₦{item.unit_cost.toLocaleString('en-NG')}</small></div><strong>₦{(item.quantity * item.unit_cost).toLocaleString('en-NG')}</strong><button type="button" className="text-btn danger-text" onClick={() => setPoItems((current) => current.filter((_, i) => i !== index))}>Remove</button></div> })}<div className="sale-total"><span>Order total</span><strong>₦{poTotal.toLocaleString('en-NG')}</strong></div></div>}
      <button className="primary"><Plus size={16} /> Create purchase order</button>
      {error && <div className="form-error form-wide">{error}</div>}
    </form>
    <section className="panel table-panel">
      <div className="panel-heading"><div><span className="section-label">Purchase orders</span><h2>{orders.length} order{orders.length === 1 ? '' : 's'}</h2></div></div>
      {orders.length ? <div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Status</th><th>Total cost</th><th>Placed</th><th>Actions</th></tr></thead><tbody>
        {orders.map((order) => <tr key={order.id}>
          <td><strong>{order.suppliers?.name ?? 'Supplier'}</strong>{order.notes && <small className="field-help">{order.notes}</small>}</td>
          <td><span className={`status ${order.status === 'received' ? 'completed' : order.status === 'cancelled' ? 'danger-text' : ''}`}>{order.status}</span></td>
          <td className="amount">₦{Number(order.total_cost).toLocaleString('en-NG')}</td>
          <td>{new Date(order.created_at).toLocaleDateString('en-NG')}</td>
          <td>{order.status === 'ordered' && <><button type="button" className="text-btn" disabled={busyId === order.id} onClick={() => receiveOrder(order.id)}>Receive</button><button type="button" className="text-btn danger-text" disabled={busyId === order.id} onClick={() => cancelOrder(order.id)}>Cancel</button></>}</td>
        </tr>)}
      </tbody></table></div> : <EmptyInline title="No purchase orders yet" text="Create your first purchase order above to reorder from a supplier." />}
    </section>
  </div>
}

function Customers({ orgId, search, scope }: { orgId: string; search: string; scope: OfflineScope | null }) {
  const [rows, setRows] = useState<(CustomerRow & { pending?: boolean })[]>([]); const [form, setForm] = useState({ name: '', email: '', phone: '' }); const [error, setError] = useState('')
  const [balances, setBalances] = useState<Record<string, number>>({}); const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (scope) setRows(await readScopedCache<CustomerRow & { pending?: boolean }>(scope, 'customers'))
    if (!supabase || !navigator.onLine) return
    const { data, error: result } = await supabase.from('customers').select('id,name,email,phone').eq('organization_id', orgId).order('created_at', { ascending: false })
    if (!result && data && scope) await writeScopedCache(scope, 'customers', data)
    if (!result) setRows(data ?? [])
    const { data: balanceData } = await supabase.rpc('get_customer_balances', { target_org: orgId })
    setBalances(Object.fromEntries((balanceData ?? []).map((row: { customer_id: string; balance: number }) => [row.customer_id, Number(row.balance)])))
  }, [orgId, scope])
  useEffect(() => { void load() }, [load])
  async function recordPayment(customerId: string, customerName: string) {
    if (!supabase) return
    const outstanding = balances[customerId] ?? 0
    const input = window.prompt(`Record a payment from ${customerName}. Outstanding balance: ₦${outstanding.toLocaleString('en-NG')}`, outstanding > 0 ? String(outstanding) : '')
    if (!input) return
    const amount = Number(input)
    if (!(amount > 0)) { setError('Enter a payment amount greater than zero.'); return }
    setPaymentBusyId(customerId)
    const { error: result } = await supabase.rpc('record_customer_payment', { target_org: orgId, target_customer: customerId, amount, payment_note: null })
    if (result) setError(result.message)
    else void load()
    setPaymentBusyId(null)
  }
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
  return <div className="page"><PageIntro label="Customers" title="Keep people close." description="A clean customer book for repeat business and better follow-up. Sales marked 'On credit' add to a customer's running balance here." /><form className="panel record-form three" onSubmit={add}><div><label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer name" /></label></div><div><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="customer@email.com" /></label></div><div><label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label></div><button className="primary"><Plus size={16} /> Add customer</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Balance owed</th><th>Actions</th></tr></thead><tbody>{filtered.map((row) => { const balance = balances[row.id] ?? 0; return <tr key={row.id}><td><strong>{row.name}</strong>{row.pending && <small className="field-help">Pending sync</small>}</td><td>{row.email || '—'}</td><td>{row.phone || '—'}</td><td className={balance > 0 ? 'warning-text' : ''}>₦{balance.toLocaleString('en-NG')}</td><td>{balance > 0 && <button type="button" className="text-btn" disabled={paymentBusyId === row.id || row.pending} onClick={() => recordPayment(row.id, row.name)}>Record payment</button>}</td></tr> })}</tbody></table></div> : <EmptyInline title="No customers yet" text="Your customer records will appear here as you add them." />}</section></div>
}

function Expenses({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; title: string; category: string; amount: number; expense_date: string; payment_method: string | null; description: string | null }[]>([]); const [form, setForm] = useState({ title: '', category: 'General', amount: '', expense_date: new Date().toISOString().slice(0, 10), payment_method: 'cash', description: '' }); const [error, setError] = useState('')
  const load = useCallback(() => { supabase?.from('expenses').select('id,title,category,amount,expense_date,payment_method,description').eq('organization_id', orgId).order('expense_date', { ascending: false }).then(({ data }) => setRows(data ?? [])) }, [orgId])
  useEffect(() => { load() }, [load])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; const { error: result } = await supabase.from('expenses').insert({ organization_id: orgId, title: form.title, category: form.category, amount: Number(form.amount), expense_date: form.expense_date, payment_method: form.payment_method, description: form.description || null }); if (result) setError(result.message); else { setForm({ ...form, title: '', amount: '', description: '' }); load() } }
  return <div className="page"><PageIntro label="Expenses" title="See where money goes." description="Record operating costs in naira and keep your picture honest." /><form className="panel record-form three" onSubmit={add}><div><label>Expense title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Shop rent" /></label></div><div><label>Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Operations" /></label></div><div><label>Amount<input required type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="₦0.00" /></label></div><div><label>Date<input required type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></label></div><div><label>Paid via<select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}><option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="other">Other</option></select></label></div><div className="form-wide"><label>Notes (optional)<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this was for" /></label></div><button className="primary"><Plus size={16} /> Add expense</button>{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Paid via</th><th>Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong>{row.description && <small className="field-help">{row.description}</small>}</td><td>{row.category}</td><td>{row.expense_date}</td><td>{row.payment_method || '—'}</td><td className="amount">₦{Number(row.amount).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No expenses yet" text="Record your first operating expense above." />}</section></div>
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
  const [products, setProducts] = useState<ProductRow[]>([]); const [customers, setCustomers] = useState<(CustomerRow & { pending?: boolean })[]>([]); const [selected, setSelected] = useState(''); const [customer, setCustomer] = useState(''); const [quantity, setQuantity] = useState('1'); const [cart, setCart] = useState<{ product_id: string; quantity: number }[]>([]); const [message, setMessage] = useState(''); const [draftLoaded, setDraftLoaded] = useState(false); const [paymentMethod, setPaymentMethod] = useState('cash'); const [discount, setDiscount] = useState('')
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
    setPaymentMethod('cash'); setDiscount('')
    setMessage('Sale cleared. Choose a customer to begin again.')
  }
  async function complete(event: React.FormEvent) {
    event.preventDefault()
    if (!customerReady) { setMessage('Choose a customer before completing the sale.'); return }
    if (!supabase || !scope || !cart.length) return
    if (!navigator.onLine) {
      await enqueueOfflineOperation(scope, 'sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: paymentMethod })
      setMessage('Sale saved offline. It will sync when you reconnect and the server will re-check stock and totals.')
      const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product })
      setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts)
      setCart([]); setCustomer(''); setPaymentMethod('cash'); setDiscount(''); await clearSaleDraft(scope); return
    }
    const { error } = await supabase.rpc('create_sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: paymentMethod, discount_amount: Number(discount) || 0 })
    if (error) {
      if (/network|fetch|offline|failed to send/i.test(error.message)) {
        await enqueueOfflineOperation(scope, 'sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: paymentMethod })
        setMessage('Connection lost. Sale saved offline and will sync automatically.')
        const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product })
        setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts); setCart([]); setCustomer(''); setPaymentMethod('cash'); setDiscount(''); await clearSaleDraft(scope)
      } else setMessage(error.message)
    } else { setMessage('Sale completed and stock updated.'); const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product }); setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts); setCart([]); setCustomer(''); setPaymentMethod('cash'); setDiscount(''); await clearSaleDraft(scope) }
  }
  const total = cart.reduce((sum, line) => sum + (products.find((product) => product.id === line.product_id)?.price ?? 0) * line.quantity, 0)
  const netTotal = Math.max(0, total - (Number(discount) || 0))
  return <div className="page"><PageIntro label="Sales" title="Build the sale, then confirm." description="Choose the customer once, add as many products as you need, and keep the draft safe until you submit." /><section className="sales-layout"><form className="panel sale-form" onSubmit={complete}><section className="sale-customer-step" aria-labelledby="sale-customer-heading"><div className="sale-step-heading"><span className="sale-step-badge">1</span><div><span className="section-label">Customer first</span><h2 id="sale-customer-heading">Who is this sale for?</h2></div></div>{!customer ? <><label htmlFor="sale-customer">Customer (required)<select id="sale-customer" required value={customer} onChange={(e) => chooseCustomer(e.target.value)}><option value="">Choose a customer</option>{customers.filter((row) => !row.pending).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><p className="field-help">Select the customer once. Their name stays attached while you add multiple products.</p>{cart.length > 0 && <div className="sale-draft-note"><UserRound size={15} /><span>This saved draft has {cart.length} item{cart.length === 1 ? '' : 's'}. Choose a customer to continue.</span></div>}</> : <div className="sale-customer-lock"><div className="sale-customer-identity"><span className="sale-step-badge sale-step-badge-complete"><Check size={14} /></span><div><strong>{customerName}</strong><small>{selectedCustomer?.pending ? 'Still syncing — choose another customer' : 'Selected for this sale'}</small></div></div><button type="button" className="secondary" onClick={changeCustomer}><Users size={16} /> Change customer</button></div>}</section>{customer && <section className={`sale-items-step ${!customerReady ? 'sale-items-step-disabled' : ''}`} aria-labelledby="sale-items-heading"><div className="sale-step-heading"><span className="sale-step-badge">2</span><div><span className="section-label">Item cart</span><h2 id="sale-items-heading">Add products for {customerName}</h2></div></div><div className="sale-add-row"><label>Product<select value={selected} disabled={!customerReady} onChange={(e) => setSelected(e.target.value)}><option value="">Choose a product</option>{products.filter((product) => product.stock > 0).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock} available</option>)}</select></label><label>Quantity<input type="number" min="1" value={quantity} disabled={!customerReady} onChange={(e) => setQuantity(e.target.value)} /></label><button type="button" className="secondary" disabled={!selected || !customerReady} onClick={addToCart}><Plus size={16} /> Add item</button></div>{cart.length > 0 && <div className="sale-cart"><div className="section-label">Items in this sale</div>{cart.map((line) => { const product = products.find((entry) => entry.id === line.product_id); return <div className="sale-cart-row" key={line.product_id}><div><strong>{product?.name}</strong><small>{line.quantity} × ₦{Number(product?.price ?? 0).toLocaleString('en-NG')}</small></div><strong>₦{Number((product?.price ?? 0) * line.quantity).toLocaleString('en-NG')}</strong><button type="button" className="text-btn danger-text" onClick={() => setCart((current) => current.filter((entry) => entry.product_id !== line.product_id))}>Remove</button></div>})}</div>}<label htmlFor="sale-payment-method">Payment method<select id="sale-payment-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="mixed">Mixed / split payment</option><option value="credit">On credit (pay later)</option><option value="other">Other</option></select></label>{paymentMethod === 'credit' && <small className="field-help form-wide">This sale will be added to the customer's running balance on the Customers page.</small>}<label htmlFor="sale-discount">Discount (optional)<input id="sale-discount" type="number" min="0" max={total} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="₦0.00" /></label><div className="sale-total"><span>Subtotal</span><strong>₦{total.toLocaleString('en-NG')}</strong></div>{Number(discount) > 0 && <div className="sale-total"><span>Discount</span><strong>-₦{Math.min(Number(discount), total).toLocaleString('en-NG')}</strong></div>}<div className="sale-total sale-total-grand"><span>Total</span><strong>₦{netTotal.toLocaleString('en-NG')}</strong></div>{message && <div className="form-success" role="status" aria-live="polite">{message}</div>}<button className="primary" disabled={!cart.length || !customerReady}>Complete sale <ArrowRight size={16} /></button></section>}{!customer && message && <div className="form-success" role="status" aria-live="polite">{message}</div>}</form><section className="panel sale-note"><span className="section-label">Trusted calculation</span><h2>Stock changes on the server.</h2><p>Your browser never decides the final total or bypasses inventory checks. Online sales use the secure Supabase RPC; queued offline sales use an idempotent server operation when connectivity returns.</p></section></section></div>
}

function PageIntro({ label, title, description }: { label: string; title: string; description: string }) { return <div className="page-heading"><div><span className="section-label">{label}</span><h1>{title}</h1><p className="muted">{description}</p></div></div> }
function EmptyInline({ title, text }: { title: string; text: string }) { return <div className="empty-inline"><strong>{title}</strong><span>{text}</span></div> }

export default App
