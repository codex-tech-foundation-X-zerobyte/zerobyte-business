import { ArrowRight, BarChart3, ChevronRight, CircleHelp, ClipboardList, FileText, LayoutDashboard, Menu, Package, PanelLeftClose, PanelLeftOpen, Receipt, Search, Settings, ShieldCheck, ShoppingCart, Truck, Users, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { WorkspaceSkeleton } from '../../components/ui'
import { getCurrentUserContext } from '../../lib/identity'
import { useStackedTables } from '../../lib/useStackedTables'
import { type OfflineScope, clearOfflineUserData, discardOfflineUserData, readOfflineOperations, syncOfflineQueue } from '../../lib/offline'
import { appPath } from '../../lib/routing'
import { supabase } from '../../lib/supabase'
import { type OrganizationRow, type View } from '../../lib/types'
import { ChangePasswordScreen } from '../auth/AuthScreens'
import { Customers } from '../customers/Customers'
import { Dashboard } from '../dashboard/Dashboard'
import { Expenses } from '../expenses/Expenses'
import { Inventory } from '../inventory/Inventory'
import { PurchaseOrders } from '../inventory/PurchaseOrders'
import { Invoices } from '../invoices/Invoices'
import { NotificationCenter } from '../notifications/NotificationCenter'
import { Branches } from '../people/Branches'
import { UserAccounts, Workforce } from '../people/Workforce'
import { OfflineStatus } from '../pwa/PwaStatus'
import { Receipts } from '../receipts/Receipts'
import { Records } from '../records/Records'
import { Reports } from '../reports/Reports'
import { Sales } from '../sales/Sales'
import { SettingsPage } from '../settings/SettingsPage'
import { SupportChat } from '../support/SupportChat'

const navGroups = [
  { label: 'Run the business', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Sales', icon: ShoppingCart }, { name: 'Inventory', icon: Package }, { name: 'Purchase Orders', icon: Truck }, { name: 'Customers', icon: Users }] },
  { label: 'Keep records', items: [{ name: 'Receipts', icon: Receipt }, { name: 'Invoices', icon: FileText }, { name: 'Expenses', icon: Wallet }, { name: 'Records', icon: ClipboardList }, { name: 'Reports', icon: BarChart3 }] },
  { label: 'People & places', items: [{ name: 'Branches', icon: LayoutDashboard }, { name: 'Workforce', icon: Users }, { name: 'User Accounts', icon: ShieldCheck }] },
]

export function Workspace({ email, displayName }: { email: string; displayName: string }) {
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null)
  useStackedTables(contentElement)
  const [view, setView] = useState<View>('Overview'); const [settingsTab, setSettingsTab] = useState<'profile' | 'business' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide'>('business'); const [open, setOpen] = useState(false); const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('zerobyte.sidebar-collapsed') === 'true'); const [dark, setDark] = useState(() => window.localStorage.getItem('zerobyte.theme') !== 'light'); const [search, setSearch] = useState(''); const [orgId, setOrgId] = useState<string | null>(null); const [orgName, setOrgName] = useState(''); const [userId, setUserId] = useState<string | null>(null); const [organizations, setOrganizations] = useState<OrganizationRow[]>([]); const [role, setRole] = useState('member'); const [loading, setLoading] = useState(true); const [identityError, setIdentityError] = useState(''); const [mustChangePassword, setMustChangePassword] = useState(false)
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
  return <div className={`${dark ? 'app' : 'app light'}${collapsed ? ' sidebar-collapsed' : ''}`}><OfflineStatus scope={offlineScope} /><aside className={open ? 'sidebar open' : 'sidebar'}><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>{workerMode ? 'Worker' : 'Business'}</small><button className="close-nav" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div><div className="workspace-select"><div className="workspace-icon">{orgName.slice(0, 2).toUpperCase()}</div><select className="workspace-switcher" aria-label="Select organization" value={orgId} onChange={(event) => switchOrganization(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>{workerMode && <div className="role-badge"><ShieldCheck size={13} /><span>Staff workspace</span></div>}<nav>{visibleGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ name, icon: Icon }) => <button className={view === name ? 'nav-item active' : 'nav-item'} key={name} onClick={() => { setView(name as View); setOpen(false) }}><Icon size={17} /><span>{name}</span></button>)}</div>)}</nav>{!workerMode && <div className="sidebar-bottom"><button className={view === 'Settings' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('Settings'); setOpen(false) }}><Settings size={17} /><span>Settings</span></button></div>}<button className="user" onClick={() => void signOut()}><div className="avatar">{(displayName || email).slice(0, 2).toUpperCase()}</div><div><strong>{displayName || email}</strong><span>{displayName ? email : 'Sign out'}</span></div></button><button className="sidebar-collapse" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span>{collapsed ? 'Expand menu' : 'Collapse menu'}</span></button></aside><main className="main"><header className="topbar"><button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={21} /></button><div className="breadcrumb"><span>{orgName}</span><ChevronRight size={14} /><strong>{view}</strong></div><div className="top-actions"><div className="search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your business..." /></div><button className="icon-btn" aria-label="Help" onClick={() => { setSettingsTab('guide'); setView('Settings') }}><CircleHelp size={19} /></button>      <NotificationCenter userId={userId!} orgId={orgId!} /><button className="theme-toggle" onClick={() => changeTheme(!dark)}>{dark ? 'Light' : 'Dark'} mode</button></div></header><div className="content" ref={setContentElement}>{view === 'Overview' ? <Dashboard orgId={orgId} scope={offlineScope} onNavigate={setView} workerMode={workerMode} displayName={displayName} /> : <FeatureView view={view} orgId={orgId} search={search} scope={offlineScope} themeDark={dark} onThemeChange={changeTheme} initialSettingsTab={settingsTab} />}</div></main>  <SupportChat userId={userId!} orgId={orgId!} orgName={orgName} displayName={displayName} email={email} /></div>
}

function OrganizationPicker({ organizations, onSelect }: { organizations: OrganizationRow[]; onSelect: (id: string) => void }) {
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><span className="auth-kicker">Choose a workspace</span><h1>Select your organization</h1><p>You belong to more than one organization. Choose the workspace you intend to access before continuing.</p><div className="choice-list">{organizations.map((organization) => <button className="choice" key={organization.id} onClick={() => onSelect(organization.id)}><span>{organization.name}</span><small>{organization.role === 'member' ? 'Staff access' : `${organization.role ?? 'Member'} access`}</small><ArrowRight size={15} /></button>)}</div></div></div>
}

function WorkspaceSetup({ email, onCreated }: { email: string; onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [referralCode, setReferralCode] = useState(() => window.localStorage.getItem('zerobyte.referral_code') ?? '')
  // A promoter's account has no business workspace. Send them to their dashboard instead of asking them to
  // create a business (unless they chose to set one up from the dashboard).
  const [checkingPromoter, setCheckingPromoter] = useState(() => window.sessionStorage.getItem('zb-skip-promoter-redirect') !== '1')
  useEffect(() => {
    if (!checkingPromoter) return
    if (!supabase) { setCheckingPromoter(false); return }
    let active = true
    void supabase.rpc('get_promoter_summary').then(({ data }) => {
      if (!active) return
      if (Array.isArray(data) && data.length) { window.location.replace(appPath('/promoter-dashboard')); return }
      setCheckingPromoter(false)
    })
    return () => { active = false }
  }, [checkingPromoter])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return; setBusy(true)
    const { data, error: result } = await supabase.rpc('create_workspace', { workspace_name: name, referral_code: referralCode.trim() || null })
    setBusy(false)
    if (result) setError(result.message)
    else if (data) { window.localStorage.removeItem('zerobyte.referral_code'); onCreated(data, name.trim()) }
  }
  if (checkingPromoter) return <WorkspaceSkeleton />
  return <div className="auth-loading"><form className="auth-card" onSubmit={submit}><div className="brand-mark">ø</div><span className="auth-kicker">Your first step</span><h1>Name your business</h1><p>Signed in as {email}. This name becomes your shared workspace.</p><label>Business name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Adebayo Foods" /></label><label>Referral code (optional)<input value={referralCode} onChange={(event) => setReferralCode(event.target.value)} placeholder="e.g. ZB-ABC12" /></label>{error && <div className="form-error">{error}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'} <ArrowRight size={16} /></button></form></div>
}

function FeatureView({ view, orgId, search, scope, themeDark, onThemeChange, initialSettingsTab }: { view: View; orgId: string; search: string; scope: OfflineScope | null; themeDark?: boolean; onThemeChange?: (dark: boolean) => void; initialSettingsTab?: 'profile' | 'business' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide' }) {
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
  if (view === 'Settings') return <SettingsPage orgId={orgId} themeDark={themeDark ?? true} onThemeChange={onThemeChange ?? (() => undefined)} initialTab={initialSettingsTab} />
  return null
}
