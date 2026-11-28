import { BrandMark } from '../../components/BrandMark'
import { getDeviceId } from '../../lib/device'
import { ArrowRight } from 'lucide-react'
import { Suspense, lazy, useEffect, useState } from 'react'
import { TableSkeleton, WorkspaceSkeleton } from '../../components/ui'
import { getCurrentUserContext } from '../../lib/identity'
import { usePaymentReturn } from './usePaymentReturn'
import { PageSearchContext } from '../../components/pageSearchContext'
import { LockedBanner, LockedScreen, TrialBanner } from '../billing/BillingGate'
import { type SubscriptionAccess, useSubscriptionAccess } from '../billing/subscriptionAccess'
import { OnboardingLayer } from '../onboarding/Onboarding'
import { recordActivity } from '../../lib/analytics'
import { useStackedTables } from '../../lib/useStackedTables'
import {
  type OfflineScope,
  clearOfflineUserData,
  discardOfflineUserData,
  readOfflineOperations,
  syncOfflineQueue,
} from '../../lib/offline'
import { clearDataCache } from '../../lib/dataCache'
import { appPath } from '../../lib/routing'
import { applyTheme, initialDark, saveTheme } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import { type OrganizationRow, type View } from '../../lib/types'
import { ChangePasswordScreen } from '../auth/AuthScreens'
import { Dashboard } from '../dashboard/Dashboard'
import { OfflineStatus } from '../pwa/PwaStatus'
import { SupportChat } from '../support/SupportChat'
import { BranchProvider } from './BranchProvider'
import { BranchSwitcher } from './BranchSwitcher'
import { MoreSheet, MobileTabs } from './MobileNav'
import { OWNER_ONLY_VIEWS, phoneTabs, visibleGroups } from './navigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { APP_HOME, appViewPath, parseAppPath, type SettingsTab } from './viewRoutes'

// Only the Overview ships with the workspace. Every other screen is its own small download, fetched the first time
// it is opened (or a moment earlier, when the pointer or finger reaches its menu item), so a visitor never pays for
// pages they do not use. The receipt/report PDF code is loaded the same way, only when someone prints one.
const loaders: Partial<Record<View, () => Promise<unknown>>> = {
  Inventory: () => import('../inventory/Inventory'),
  'Purchase Orders': () => import('../inventory/PurchaseOrders'),
  Customers: () => import('../customers/Customers'),
  Expenses: () => import('../expenses/Expenses'),
  Records: () => import('../records/Records'),
  Sales: () => import('../sales/Sales'),
  Receipts: () => import('../receipts/Receipts'),
  Invoices: () => import('../invoices/Invoices'),
  Reports: () => import('../reports/Reports'),
  Branches: () => import('../people/Branches'),
  Workforce: () => import('../people/Workforce'),
  'User Accounts': () => import('../people/Workforce'),
  Settings: () => import('../settings/SettingsPage'),
}
const prefetchView = (view: View) => void loaders[view]?.().catch(() => undefined)
const Inventory = lazy(() => import('../inventory/Inventory').then((m) => ({ default: m.Inventory })))
const PurchaseOrders = lazy(() => import('../inventory/PurchaseOrders').then((m) => ({ default: m.PurchaseOrders })))
const Customers = lazy(() => import('../customers/Customers').then((m) => ({ default: m.Customers })))
const Expenses = lazy(() => import('../expenses/Expenses').then((m) => ({ default: m.Expenses })))
const Records = lazy(() => import('../records/Records').then((m) => ({ default: m.Records })))
const Sales = lazy(() => import('../sales/Sales').then((m) => ({ default: m.Sales })))
const Receipts = lazy(() => import('../receipts/Receipts').then((m) => ({ default: m.Receipts })))
const Invoices = lazy(() => import('../invoices/Invoices').then((m) => ({ default: m.Invoices })))
const Reports = lazy(() => import('../reports/Reports').then((m) => ({ default: m.Reports })))
const Branches = lazy(() => import('../people/Branches').then((m) => ({ default: m.Branches })))
const Workforce = lazy(() => import('../people/Workforce').then((m) => ({ default: m.Workforce })))
const UserAccounts = lazy(() => import('../people/Workforce').then((m) => ({ default: m.UserAccounts })))
const SettingsPage = lazy(() => import('../settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

const BRANCH_VIEWS: View[] = ['Overview', 'Inventory', 'Sales', 'Reports']

export function Workspace({
  email,
  displayName,
  route,
  navigate,
}: {
  email: string
  displayName: string
  route: string
  navigate: (path: string, replace?: boolean) => void
}) {
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null)
  useStackedTables(contentElement)
  // The address says which screen is open (see viewRoutes.ts), so refresh and Back/Forward just work.
  const parsedRoute = parseAppPath(route)
  const view: View = parsedRoute?.view ?? 'Overview'
  const settingsTab = parsedRoute?.settingsTab
  const go = (next: View, tab?: SettingsTab, replace = false) => {
    const target = appViewPath(next, tab)
    if (target !== route) navigate(target, replace)
  }
  // Landing here from "/" or an unknown address: settle on the Overview without adding a history entry.
  useEffect(() => {
    if (!parsedRoute) navigate(APP_HOME, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])
  const [moreOpen, setMoreOpen] = useState(false)
  const [dark, setDark] = useState(() => initialDark('app'))
  const [search, setSearch] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([])
  const [role, setRole] = useState('member')
  const [loading, setLoading] = useState(true)
  const [identityError, setIdentityError] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)
  useEffect(() => applyTheme(dark), [dark])
  useEffect(() => {
    if (orgId) recordActivity(orgId)
  }, [orgId])
  const payment = usePaymentReturn(orgId, () => go('Settings', 'billing', true))
  const { access } = useSubscriptionAccess(orgId, payment.refreshKey)
  useEffect(() => {
    setSearch('')
  }, [view])
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    getCurrentUserContext(supabase)
      .then((context) => {
        if (cancelled) return
        const available = context.memberships.flatMap((membership) =>
          membership.organization
            ? [{ id: membership.organization.id, name: membership.organization.name, role: membership.role }]
            : [],
        )
        const storedId = window.localStorage.getItem(`zerobyte.organization.${context.userId}`)
        // Never silently choose an organization. A user may belong to multiple
        // workspaces and the first row is not a safe authorization context.
        const selected =
          available.find((organization) => organization.id === storedId) ??
          (available.length === 1 ? available[0] : undefined)
        const membership = context.memberships.find((item) => item.organization_id === selected?.id)
        setOrganizations(available)
        setRole(membership?.role ?? 'member')
        setUserId(context.userId)
        setMustChangePassword(Boolean(context.employee?.must_change_password))
        setOrgId(selected?.id ?? null)
        setOrgName(selected?.name ?? '')
        setLoading(false)
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setIdentityError(error.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  const workerMode = role === 'member'
  useEffect(() => {
    // Wait until the account has loaded: `role` starts as 'member', so acting earlier bounced an owner who refreshed
    // on Inventory, Records, Expenses, Invoices, Reports or Settings back to the Overview.
    if (!loading && workerMode && OWNER_ONLY_VIEWS.includes(view)) go('Overview', undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, workerMode, view])
  if (loading) return <WorkspaceSkeleton />
  if (identityError)
    return (
      <div className="auth-loading">
        <div className="auth-card">
          <BrandMark />
          <h1>We could not load your workspace</h1>
          <p>{identityError}</p>
          <button className="primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  if (mustChangePassword) return <ChangePasswordScreen onComplete={() => setMustChangePassword(false)} />
  const switchOrganization = (nextId: string) => {
    const next = organizations.find((organization) => organization.id === nextId)
    if (!next) return
    setOrgId(next.id)
    setOrgName(next.name)
    setRole(next.role ?? 'member')
    go('Overview')
    if (userId) window.localStorage.setItem(`zerobyte.organization.${userId}`, next.id)
  }
  if (!orgId && organizations.length > 1) {
    return <OrganizationPicker organizations={organizations} onSelect={(id) => switchOrganization(id)} />
  }
  if (!orgId)
    return (
      <WorkspaceSetup
        email={email}
        onCreated={(id, name) => {
          setOrganizations([{ id, name, role: 'owner' }])
          setRole('owner')
          setOrgId(id)
          setOrgName(name)
          go('Overview')
          if (userId) window.localStorage.setItem(`zerobyte.organization.${userId}`, id)
        }}
      />
    )
  const locked = access?.state === 'locked'
  const openBilling = () => {
    go('Settings', 'billing')
    setMoreOpen(false)
  }
  const selectView = (next: View) => {
    go(next)
    setMoreOpen(false)
  }
  const groups = visibleGroups(workerMode)
  const tabs = phoneTabs(workerMode)
  const sheetGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !tabs.some((tab) => tab.name === item.name)) }))
    .filter((group) => group.items.length > 0)
  const offlineScope: OfflineScope | null = userId && orgId ? { userId, organizationId: orgId } : null
  const signOut = async () => {
    if (!userId) return
    if (offlineScope) {
      if (navigator.onLine && supabase) await syncOfflineQueue(supabase, offlineScope)
      const pending = await readOfflineOperations(offlineScope)
      if (pending.length) {
        const keep = window.confirm(
          `There are ${pending.length} unsynced change${pending.length === 1 ? '' : 's'} on this device. Press OK to keep them for the next sign-in, or Cancel to choose whether to discard them.`,
        )
        if (!keep && !window.confirm('Discarding these changes is permanent. Confirm discard?')) return
        if (!keep) await discardOfflineUserData(userId)
      }
    }
    await clearOfflineUserData(userId)
    clearDataCache()
    // Tells the app this sign-out was on purpose, so it lands on the home page instead of the sign-in page.
    window.sessionStorage.setItem('zb-signed-out', '1')
    await supabase?.auth.signOut()
  }
  const changeTheme = (nextDark: boolean) => {
    setDark(nextDark)
    saveTheme('app', nextDark)
  }
  return (
    <BranchProvider orgId={orgId ?? ''} canSwitch={!workerMode}>
      <div className={`${dark ? 'app dark' : 'app light'} shell`}>
        <OfflineStatus scope={offlineScope} />
        <OnboardingLayer userId={userId} ready={Boolean(orgId)} workerMode={workerMode} />
        <Sidebar
          groups={groups}
          view={view}
          onSelect={selectView}
          onPrefetch={prefetchView}
          workerMode={workerMode}
          organizations={organizations}
          orgId={orgId}
          orgName={orgName}
          onSwitchOrganization={switchOrganization}
        />
        <main className="sh-main">
          <Topbar
            view={view}
            orgName={orgName}
            orgId={orgId}
            userId={userId!}
            organizations={organizations}
            dark={dark}
            showHelp={!workerMode}
            onToggleTheme={() => changeTheme(!dark)}
            onSwitchOrganization={switchOrganization}
            onSignOut={() => void signOut()}
            onHelp={() => go('Settings', 'guide')}
          />
          <div className="content sh-content" ref={setContentElement}>
            {payment.notice && (
              <div className={`payment-banner ${payment.notice.tone}`} role="status">
                <span>{payment.notice.text}</span>
                <span className="payment-banner-actions">
                  {payment.notice.canRetry && (
                    <button type="button" className="secondary" onClick={payment.retry}>
                      Check again
                    </button>
                  )}
                  <button type="button" className="text-btn" onClick={payment.dismiss}>
                    Dismiss
                  </button>
                </span>
              </div>
            )}
            {access && !locked && <TrialBanner access={access} onChoosePlan={openBilling} />}
            {BRANCH_VIEWS.includes(view) && <BranchSwitcher />}
            {locked && view !== 'Overview' && access && <LockedBanner access={access} onChoosePlan={openBilling} />}
            {locked && view === 'Overview' ? (
              <LockedScreen access={access} onChoosePlan={openBilling} onViewRecords={() => selectView('Records')} />
            ) : view === 'Overview' ? (
              <Dashboard
                orgId={orgId}
                scope={offlineScope}
                onNavigate={(next) => go(next)}
                workerMode={workerMode}
                displayName={displayName}
              />
            ) : (
              <PageSearchContext.Provider
                value={
                  SEARCHABLE_VIEWS.includes(view)
                    ? { value: search, onChange: setSearch, placeholder: `Search ${view.toLowerCase()}…` }
                    : null
                }
              >
                <Suspense
                  fallback={
                    <div className="panel" aria-busy="true">
                      <TableSkeleton rows={6} columns={4} />
                    </div>
                  }
                >
                <FeatureView
                  view={view}
                  orgId={orgId}
                  search={search}
                  scope={offlineScope}
                  themeDark={dark}
                  onThemeChange={changeTheme}
                  initialSettingsTab={settingsTab}
                  billingRefreshKey={payment.refreshKey}
                  access={access}
                  onSettingsTabChange={(tab) => go('Settings', tab ?? undefined)}
                />
                </Suspense>
              </PageSearchContext.Provider>
            )}
          </div>
        </main>
        <MobileTabs
          tabs={tabs}
          view={view}
          moreOpen={moreOpen}
          onSelect={selectView}
          onPrefetch={prefetchView}
          onOpenMore={() => setMoreOpen(true)}
        />
        <MoreSheet
          groups={sheetGroups}
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onSelect={selectView}
          onPrefetch={prefetchView}
          onSignOut={() => void signOut()}
        />
        {view === 'Overview' && (
          <SupportChat userId={userId!} orgId={orgId!} orgName={orgName} displayName={displayName} email={email} />
        )}
      </div>
    </BranchProvider>
  )
}

function OrganizationPicker({
  organizations,
  onSelect,
}: {
  organizations: OrganizationRow[]
  onSelect: (id: string) => void
}) {
  return (
    <div className="auth-loading">
      <div className="auth-card">
        <BrandMark />
        <span className="auth-kicker">Choose a workspace</span>
        <h1>Select your organization</h1>
        <p>You belong to more than one organization. Choose the workspace you intend to access before continuing.</p>
        <div className="choice-list">
          {organizations.map((organization) => (
            <button className="choice" key={organization.id} onClick={() => onSelect(organization.id)}>
              <span>{organization.name}</span>
              <small>
                {organization.role === 'member' ? 'Staff access' : `${organization.role ?? 'Member'} access`}
              </small>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function WorkspaceSetup({ email, onCreated }: { email: string; onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [referralCode, setReferralCode] = useState(() => window.localStorage.getItem('zerobyte.referral_code') ?? '')
  // A promoter's account has no business workspace. Send them to their dashboard instead of asking them to
  // create a business (unless they chose to set one up from the dashboard).
  const [checkingPromoter, setCheckingPromoter] = useState(
    () => window.sessionStorage.getItem('zb-skip-promoter-redirect') !== '1',
  )
  useEffect(() => {
    if (!checkingPromoter) return
    if (!supabase) {
      setCheckingPromoter(false)
      return
    }
    let active = true
    void supabase.rpc('get_promoter_summary').then(({ data }) => {
      if (!active) return
      if (Array.isArray(data) && data.length) {
        window.location.replace(appPath('/promoter-dashboard'))
        return
      }
      setCheckingPromoter(false)
    })
    return () => {
      active = false
    }
  }, [checkingPromoter])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { data, error: result } = await supabase.rpc('create_workspace', {
      workspace_name: name,
      referral_code: referralCode.trim() || null,
      device_id: getDeviceId(),
    })
    setBusy(false)
    if (result) setError(result.message)
    else if (data) {
      window.localStorage.removeItem('zerobyte.referral_code')
      onCreated(data, name.trim())
    }
  }
  if (checkingPromoter) return <WorkspaceSkeleton />
  return (
    <div className="auth-loading">
      <form className="auth-card" onSubmit={submit}>
        <BrandMark />
        <span className="auth-kicker">Your first step</span>
        <h1>Name your business</h1>
        <p>Signed in as {email}. This name becomes your shared workspace.</p>
        <label>
          Business name
          <input
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Adebayo Foods"
          />
        </label>
        <label>
          Referral code (optional)
          <input
            value={referralCode}
            onChange={(event) => setReferralCode(event.target.value)}
            placeholder="e.g. ZB-ABC12"
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary entry-button" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'} <ArrowRight size={16} />
        </button>
      </form>
    </div>
  )
}

// Only these pages have a list to filter; the search box appears on them alone instead of sitting useless in the header.
const SEARCHABLE_VIEWS: View[] = ['Inventory', 'Customers', 'Records']

function FeatureView({
  view,
  orgId,
  search,
  scope,
  themeDark,
  onThemeChange,
  initialSettingsTab,
  billingRefreshKey,
  access,
  onSettingsTabChange,
}: {
  onSettingsTabChange?: (tab: SettingsTab | null) => void
  access?: SubscriptionAccess | null
  billingRefreshKey?: number
  view: View
  orgId: string
  search: string
  scope: OfflineScope | null
  themeDark?: boolean
  onThemeChange?: (dark: boolean) => void
  initialSettingsTab?: SettingsTab
}) {
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
  if (view === 'Settings')
    return (
      <SettingsPage
        orgId={orgId}
        themeDark={themeDark ?? true}
        onThemeChange={onThemeChange ?? (() => undefined)}
        initialTab={initialSettingsTab}
        onTabChange={onSettingsTabChange}
        billingRefreshKey={billingRefreshKey}
        access={access}
      />
    )
  return null
}
