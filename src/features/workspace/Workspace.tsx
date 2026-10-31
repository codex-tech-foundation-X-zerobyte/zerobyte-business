import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { WorkspaceSkeleton } from '../../components/ui'
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
import { Branches } from '../people/Branches'
import { UserAccounts, Workforce } from '../people/Workforce'
import { OfflineStatus } from '../pwa/PwaStatus'
import { Receipts } from '../receipts/Receipts'
import { Records } from '../records/Records'
import { Reports } from '../reports/Reports'
import { Sales } from '../sales/Sales'
import { SettingsPage } from '../settings/SettingsPage'
import { SupportChat } from '../support/SupportChat'
import { MoreSheet, MobileTabs } from './MobileNav'
import { OWNER_ONLY_VIEWS, phoneTabs, visibleGroups } from './navigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function Workspace({ email, displayName }: { email: string; displayName: string }) {
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null)
  useStackedTables(contentElement)
  const [view, setView] = useState<View>('Overview')
  const [settingsTab, setSettingsTab] = useState<
    'profile' | 'business' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide'
  >('business')
  const [moreOpen, setMoreOpen] = useState(false)
  const [dark, setDark] = useState(() => window.localStorage.getItem('zerobyte.theme') === 'dark')
  const [search, setSearch] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([])
  const [role, setRole] = useState('member')
  const [loading, setLoading] = useState(true)
  const [identityError, setIdentityError] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)
  useEffect(() => {
    if (orgId) recordActivity(orgId)
  }, [orgId])
  const payment = usePaymentReturn(orgId, () => {
    setSettingsTab('billing')
    setView('Settings')
  })
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
    if (workerMode && OWNER_ONLY_VIEWS.includes(view)) setView('Overview')
  }, [workerMode, view])
  if (loading) return <WorkspaceSkeleton />
  if (identityError)
    return (
      <div className="auth-loading">
        <div className="auth-card">
          <div className="brand-mark">ø</div>
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
    setView('Overview')
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
          setView('Overview')
          if (userId) window.localStorage.setItem(`zerobyte.organization.${userId}`, id)
        }}
      />
    )
  const locked = access?.state === 'locked'
  const openBilling = () => {
    setSettingsTab('billing')
    setView('Settings')
    setMoreOpen(false)
  }
  const selectView = (next: View) => {
    setView(next)
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
    await supabase?.auth.signOut()
  }
  const changeTheme = (nextDark: boolean) => {
    setDark(nextDark)
    window.localStorage.setItem('zerobyte.theme', nextDark ? 'dark' : 'light')
  }
  return (
    <div className={`${dark ? 'app dark' : 'app light'} shell`}>
      <OfflineStatus scope={offlineScope} />
      <OnboardingLayer userId={userId} ready={Boolean(orgId)} workerMode={workerMode} />
      <Sidebar
        groups={groups}
        view={view}
        onSelect={selectView}
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
          onHelp={() => {
            setSettingsTab('guide')
            setView('Settings')
          }}
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
          {locked && view !== 'Overview' && access && <LockedBanner access={access} onChoosePlan={openBilling} />}
          {locked && view === 'Overview' ? (
            <LockedScreen access={access} onChoosePlan={openBilling} onViewRecords={() => selectView('Records')} />
          ) : view === 'Overview' ? (
            <Dashboard
              orgId={orgId}
              scope={offlineScope}
              onNavigate={setView}
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
              />
            </PageSearchContext.Provider>
          )}
        </div>
      </main>
      <MobileTabs
        tabs={tabs}
        view={view}
        moreOpen={moreOpen}
        onSelect={selectView}
        onOpenMore={() => setMoreOpen(true)}
      />
      <MoreSheet
        groups={sheetGroups}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onSelect={selectView}
        onSignOut={() => void signOut()}
      />
      <SupportChat userId={userId!} orgId={orgId!} orgName={orgName} displayName={displayName} email={email} />
    </div>
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
        <div className="brand-mark">ø</div>
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
        <div className="brand-mark">ø</div>
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
}: {
  access?: SubscriptionAccess | null
  billingRefreshKey?: number
  view: View
  orgId: string
  search: string
  scope: OfflineScope | null
  themeDark?: boolean
  onThemeChange?: (dark: boolean) => void
  initialSettingsTab?: 'profile' | 'business' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide'
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
        billingRefreshKey={billingRefreshKey}
        access={access}
      />
    )
  return null
}
