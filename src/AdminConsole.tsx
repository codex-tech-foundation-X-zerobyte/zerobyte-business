import { BrandMark } from './components/BrandMark'
import { Suspense, lazy, useEffect, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Bell,
  ClipboardList,
  CreditCard,
  Gauge,
  GitBranch,
  History,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Sun,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Gift,
  ChevronDown,
  ChevronLeft,
  Lock,
  Search,
  Share2,
  Wallet,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Users,
  HeartPulse,
} from 'lucide-react'
import { adminSupabase } from './lib/supabase'
import { AdminCommandPalette } from './admin/AdminCommandPalette'
import { AdminOverview } from './admin/AdminOverview'
import { AdminHealthCenter } from './admin/AdminHealthCenter'
import { ADMIN_START_KEY, AdminSettings } from './admin/AdminSettings'
import { type AdminProfile as AdminProfileSummary, type AdminSection } from './admin/types'
import { applyTheme, initialDark, saveTheme } from './lib/theme'

// Each admin section is its own download, fetched the first time it is opened.
const AdminAccounts = lazy(() => import('./admin/AdminAccounts').then((m) => ({ default: m.AdminAccounts })))
const AdminAuditLog = lazy(() => import('./admin/AdminAuditLog').then((m) => ({ default: m.AdminAuditLog })))
const AdminFeedback = lazy(() => import('./admin/AdminFeedback').then((m) => ({ default: m.AdminFeedback })))
const AdminMessages = lazy(() => import('./admin/AdminMessages').then((m) => ({ default: m.AdminMessages })))
const AdminMonitoring = lazy(() => import('./admin/AdminMonitoring').then((m) => ({ default: m.AdminMonitoring })))
const AdminNotifications = lazy(() => import('./admin/AdminNotifications').then((m) => ({ default: m.AdminNotifications })))
const AdminPlans = lazy(() => import('./admin/AdminPlans').then((m) => ({ default: m.AdminPlans })))
const AdminProfile = lazy(() => import('./admin/AdminProfile').then((m) => ({ default: m.AdminProfile })))
const AdminGifts = lazy(() => import('./admin/AdminGifts').then((m) => ({ default: m.AdminGifts })))
const AdminPayouts = lazy(() => import('./admin/AdminPayouts').then((m) => ({ default: m.AdminPayouts })))
const AdminPromoters = lazy(() => import('./admin/AdminPromoters').then((m) => ({ default: m.AdminPromoters })))
const AdminResourceTable = lazy(() => import('./admin/AdminResourceTable').then((m) => ({ default: m.AdminResourceTable })))
const AdminRevenue = lazy(() => import('./admin/AdminRevenue').then((m) => ({ default: m.AdminRevenue })))
const AdminAnalytics = lazy(() => import('./admin/AdminAnalytics').then((m) => ({ default: m.AdminAnalytics })))
const AdminRoadmap = lazy(() => import('./admin/AdminRoadmap').then((m) => ({ default: m.AdminRoadmap })))
const AdminUsers = lazy(() => import('./admin/AdminUsers').then((m) => ({ default: m.AdminUsers })))

// Code-split from App.tsx: this is the admin-only console. It ships in its
// own chunk, loaded only when someone actually reaches the admin route --
// see the lazy() import in App.tsx for why.
//
// This file is deliberately just layout + navigation + section routing +
// role-based gating. Every section's state, data loading, and rendering
// lives in its own module under src/admin/ -- find a section's logic by
// opening its file, not by searching this one.

const adminSectionIcons: Record<AdminSection, typeof LayoutDashboard> = {
  Overview: LayoutDashboard,
  Users,
  Organizations: ClipboardList,
  Subscriptions: CreditCard,
  Plans: Layers,
  Promoters: Share2,
  Payouts: Wallet,
  Gifts: Gift,
  Branches: GitBranch,
  Inventory: Package,
  Sales: ShoppingCart,
  Notifications: Bell,
  Messages: MessageCircle,
  Feedback: MessageCircle,
  Roadmap: Layers,
  'Audit log': History,
  Monitoring: Gauge,
  'Health center': HeartPulse,
  Revenue: CreditCard,
  Analytics: BarChart3,
  Admins: ShieldCheck,
  Profile: UserRound,
  Settings,
}
// Which sections each admin role may open is decided in the database (admin_role_sections) and read through
// get_my_admin_sections(), so the menu and the server always agree.
const adminSectionGroups: { label: string; items: AdminSection[] }[] = [
  {
    label: 'Control room',
    items: [
      'Overview',
      'Analytics',
      'Users',
      'Organizations',
      'Subscriptions',
      'Plans',
      'Promoters',
      'Payouts',
      'Gifts',
      'Revenue',
      'Admins',
    ],
  },
  { label: 'Operations', items: ['Branches', 'Inventory', 'Sales'] },
  { label: 'Governance', items: ['Notifications', 'Messages', 'Feedback', 'Roadmap', 'Audit log', 'Monitoring', 'Health center'] },
  { label: 'Account', items: ['Profile', 'Settings'] },
]
const FINANCE_SECTIONS: AdminSection[] = ['Subscriptions', 'Plans', 'Payouts', 'Gifts', 'Revenue']
const SECTION_TITLES: Partial<Record<AdminSection, string>> = {
  Overview: 'Today at a glance',
  Plans: 'Plans & pricing',
  Admins: 'Admin accounts',
  Messages: 'Customer messages',
  Feedback: 'Customer feedback',
  'Audit log': 'Security & audit center',
  Profile: 'My profile',
}
const SECTION_SUBTITLES: Record<AdminSection, string> = {
  Overview: 'Live counts from the platform.',
  Analytics: 'Growth, traffic and conversion across the platform.',
  Users: 'Everyone registered on the platform.',
  Organizations: 'Live records from the platform.',
  Subscriptions: 'Live records from the platform.',
  Plans: 'Prices and limits for every plan.',
  Promoters: 'Applications, access and referrals.',
  Payouts: 'Review and pay promoter payout requests.',
  Gifts: 'Free plan time and discounts (super admin only).',
  Branches: 'Live records from the platform.',
  Inventory: 'Live records from the platform.',
  Sales: 'Live records from the platform.',
  Notifications: 'Broadcast to users and announce releases.',
  Messages: 'Support conversations with your customers.',
  Feedback: 'Ideas, bugs and requests from businesses.',
  Roadmap: 'What ships next.',
  'Audit log': 'Every important action, in real time.',
  Monitoring: 'Live health of every service.',
  'Health center': 'Payments, plans, capacity, security, data and customers in one check.',
  Revenue: 'Figures from verified payments only.',
  Admins: 'Who can run the platform.',
  Profile: 'Your admin identity.',
  Settings: 'Console preferences.',
}
// Each section has its own address (/admin/users, /admin/audit-log ...) so a refresh stays put and Back/Forward move
// between the sections you opened.
const sectionSlug = (name: AdminSection) => name.toLowerCase().replace(/\s+/g, '-')
const allSections = adminSectionGroups.flatMap((group) => group.items)
const sectionFromPath = (): AdminSection | null => {
  const slug = window.location.pathname.split('/').filter(Boolean).slice(-1)[0] ?? ''
  return allSections.find((name) => sectionSlug(name) === slug) ?? null
}
const adminBasePath = () => window.location.pathname.replace(/\/(admin)(\.html)?(\/.*)?$/, '/$1')
const GENERIC_RESOURCE_SECTIONS: AdminSection[] = ['Organizations', 'Subscriptions', 'Branches', 'Inventory', 'Sales']

function AdminConsole({ email, onBack, onLogout }: { email: string; onBack: () => void; onLogout: () => void }) {
  const [section, setSection] = useState<AdminSection>(() => sectionFromPath() ?? 'Overview')
  const [openedByAddress] = useState(() => sectionFromPath() !== null)
  const [unreadSupportCount, setUnreadSupportCount] = useState(0)
  const [payoutQueue, setPayoutQueue] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('zerobyte.admin-sidebar-collapsed') === 'true',
  )
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [profile, setProfile] = useState<AdminProfileSummary | null>(null)
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [closedGroups, setClosedGroups] = useState<string[]>([])
  const [dark, setDark] = useState(() => initialDark('admin'))
  useEffect(() => applyTheme(dark), [dark])
  const changeTheme = () => {
    const next = !dark
    setDark(next)
    saveTheme('admin', next)
  }

  useEffect(() => {
    if (!adminSupabase) return
    adminSupabase.rpc('get_my_admin_profile').then(({ data, error }) => {
      const row = (data ?? [])[0]
      setProfileState(row && !error ? 'ready' : 'missing')
      if (row)
        setProfile({
          role: row.role,
          status: row.status,
          isSuper: row.is_super,
          canViewFinancials: row.can_view_financials,
          fullName: row.full_name,
          email: row.email,
        })
    })
  }, [])

  useEffect(() => {
    if (!adminSupabase || !profile?.canViewFinancials) return
    void Promise.resolve(adminSupabase.rpc('admin_payout_queue_count')).then(({ data, error }) => {
      if (!error && typeof data === 'number') setPayoutQueue(data)
    })
  }, [profile?.canViewFinancials])

  useEffect(() => {
    if (!adminSupabase) return
    void Promise.resolve(adminSupabase.rpc('get_my_admin_sections')).then(({ data, error }) => {
      const list = !error && Array.isArray(data) ? (data as string[]) : []
      setAllowedSections(list)
      // Land on the first section this role may use (a support admin opens Messages, not an Overview they cannot see).
      const ordered = adminSectionGroups.flatMap((group) => group.items)
      // An address that names a section wins over the saved start page.
      const chosen = openedByAddress ? null : window.localStorage.getItem(ADMIN_START_KEY)
      const first =
        (chosen && list.includes(chosen)
          ? [chosen as AdminSection]
          : (['Overview', 'Messages'] as AdminSection[])
        ).find((name) => list.includes(name)) ?? ordered.find((name) => list.includes(name))
      setSection((current) => (list.includes(current) ? current : (first ?? current)))
    })
  }, [openedByAddress])

  useEffect(() => {
    const onPop = () => setSection(sectionFromPath() ?? 'Overview')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The super admin has no limits; every other role sees only the sections the database lists for it.
  const canSee = (name: AdminSection) => Boolean(profile?.isSuper) || (allowedSections?.includes(name) ?? false)

  const toggleSidebar = () => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    window.localStorage.setItem('zerobyte.admin-sidebar-collapsed', String(next))
  }
  const selectSection = (nextSection: AdminSection) => {
    if (!canSee(nextSection)) return
    if (nextSection !== section) window.history.pushState({}, '', `${adminBasePath()}/${sectionSlug(nextSection)}`)
    setSection(nextSection)
    setMobileNavOpen(false)
  }

  const renderSection = () => {
    if (allowedSections === null)
      return (
        <section className="admin-card wide" aria-busy="true">
          <div className="admin-empty">Loading your sections…</div>
        </section>
      )
    if (!canSee(section))
      return (
        <section className="admin-card wide av-restricted">
          <span className="adm-role info">{roleLabel}</span>
          <h2>Restricted</h2>
          <p>
            Your admin role ({roleLabel}) doesn&rsquo;t include access to this section.
            <br />
            Ask a Super admin if you need it.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => selectSection(visibleSections[0]?.name ?? 'Profile')}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Back to {visibleSections[0]?.name ?? 'Profile'}
          </button>
        </section>
      )
    if (section === 'Overview') return <AdminOverview onOpenSection={selectSection} />
    if (section === 'Users') return <AdminUsers />
    if (section === 'Plans') return <AdminPlans />
    if (section === 'Promoters') return <AdminPromoters />
    if (section === 'Payouts') return <AdminPayouts onQueueChange={setPayoutQueue} />
    if (section === 'Gifts') return <AdminGifts />
    if (section === 'Analytics') return <AdminAnalytics onOpenSection={(target) => selectSection(target)} />
    if (section === 'Revenue') return <AdminRevenue />
    if (section === 'Admins') return <AdminAccounts />
    if (section === 'Profile')
      return (
        <AdminProfile
          access={[
            ...adminSectionGroups.map((group) => ({ label: group.label, allowed: group.items.some(canSee) })),
            { label: 'Granting admins', allowed: Boolean(profile?.isSuper) },
          ]}
        />
      )
    if (section === 'Feedback') return <AdminFeedback />
    if (section === 'Roadmap') return <AdminRoadmap />
    if (section === 'Audit log') return <AdminAuditLog />
    if (section === 'Monitoring') return <AdminMonitoring />
    if (section === 'Health center') return <AdminHealthCenter />
    if (section === 'Settings')
      return (
        <AdminSettings
          email={email}
          fullName={profile?.fullName ?? ''}
          roleLabel={
            profile
              ? profile.role
                  .replace(/_/g, ' ')
                  .toLowerCase()
                  .replace(/^\w/, (letter) => letter.toUpperCase())
              : 'Loading'
          }
          isSuper={Boolean(profile?.isSuper)}
          sections={allowedSections ?? []}
          dark={dark}
          onTheme={(next) => {
            setDark(next)
            saveTheme('admin', next)
          }}
          onOpen={selectSection}
          onLogout={onLogout}
        />
      )
    if (section === 'Messages') return <AdminMessages onUnreadChange={setUnreadSupportCount} />
    if (section === 'Notifications') return <AdminNotifications />
    if (GENERIC_RESOURCE_SECTIONS.includes(section))
      return (
        <>
          <section className="admin-card wide us-toolbar rec-switch">
            <div className="ov-tabs" role="tablist" aria-label="Platform records">
              {GENERIC_RESOURCE_SECTIONS.filter(canSee).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={section === name}
                  className={section === name ? 'on' : ''}
                  onClick={() => selectSection(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>
          <section className="admin-card wide rec-card">
            <AdminResourceTable resource={section} />
          </section>
        </>
      )
    return null
  }

  const roleLabel = profile
    ? profile.role
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (letter) => letter.toUpperCase())
    : 'Loading'
  const visibleSections = adminSectionGroups.flatMap((group) =>
    group.items.filter(canSee).map((name) => ({ name, group: group.label, Icon: adminSectionIcons[name] })),
  )
  const unreadTotal = unreadSupportCount + payoutQueue
  const quick = (
    [
      'Overview',
      'Analytics',
      'Users',
      'Messages',
      'Payouts',
      'Revenue',
      'Organizations',
      'Notifications',
    ] as AdminSection[]
  )
    .filter(canSee)
    .slice(0, 4)

  return (
    <div
      className={`admin-shell v2${dark ? ' dark' : ''}${sidebarCollapsed ? ' admin-sidebar-collapsed' : ''}${mobileNavOpen ? ' admin-mobile-nav-open' : ''}`}
    >
      <button
        type="button"
        className="av-backdrop"
        aria-label="Close admin navigation"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside className="av-side" aria-label="Admin navigation">
        <div className="av-brand">
          <span className="av-logo">
            <BrandMark />
          </span>
          <span className="av-brand-text">
            <strong>Zerøbyte</strong>
            <small>Admin console</small>
          </span>
          <button
            type="button"
            className="av-collapse"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav className="av-nav" aria-label="Admin sections">
          {adminSectionGroups.map((group) => {
            const visible = group.items.filter(canSee)
            if (!visible.length) return null
            const closed = closedGroups.includes(group.label)
            return (
              <div className={`av-group${closed ? ' closed' : ''}`} key={group.label}>
                <button
                  type="button"
                  className="av-group-label"
                  aria-expanded={!closed}
                  onClick={() =>
                    setClosedGroups((current) =>
                      current.includes(group.label)
                        ? current.filter((label) => label !== group.label)
                        : [...current, group.label],
                    )
                  }
                >
                  <span>{group.label}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {!closed &&
                  visible.map((name) => {
                    const Icon = adminSectionIcons[name]
                    const badge = name === 'Payouts' ? payoutQueue : name === 'Messages' ? unreadSupportCount : 0
                    return (
                      <button
                        key={name}
                        type="button"
                        className={`av-item${section === name ? ' active' : ''}`}
                        onClick={() => selectSection(name)}
                        title={sidebarCollapsed ? name : undefined}
                        aria-label={name}
                        aria-current={section === name ? 'page' : undefined}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span className="av-name">{name}</span>
                        {badge > 0 ? (
                          <b className="av-badge">{badge > 9 ? '9+' : badge}</b>
                        ) : (
                          FINANCE_SECTIONS.includes(name) && (
                            <Lock size={13} className="av-lock" aria-label="Finance and super admin only" />
                          )
                        )}
                      </button>
                    )
                  })}
              </div>
            )
          })}
        </nav>
        {profileState === 'missing' && (
          <p className="av-note warn" role="alert">
            We could not load your admin role, so the menu is hidden. Refresh, or check that your account is active in
            platform_admin_access.
          </p>
        )}
        <div className="av-foot">
          <button type="button" className="av-user" onClick={() => selectSection('Profile')} title="Open your profile">
            <span className="av-avatar" aria-hidden="true">
              {(profile?.fullName || email || '?').trim().slice(0, 2).toUpperCase()}
            </span>
            <span className="av-user-text">
              <strong>{profile?.fullName || email}</strong>
              <small>{roleLabel}</small>
            </span>
          </button>
          <div className="av-foot-row">
            <button type="button" className="av-foot-btn" onClick={onBack} title="Return to app">
              <ArrowRight size={15} />
              <span>Return to app</span>
            </button>
            <button type="button" className="av-foot-btn" onClick={onLogout} title="Log out">
              <LogOut size={15} />
              <span>Log out</span>
            </button>
          </div>
          {profileState === 'ready' && profile && (
            <p className="av-note">
              {profile.isSuper
                ? 'Super admin: full access to every section.'
                : `You see only what your role (${roleLabel.toLowerCase()}) needs.`}
            </p>
          )}
        </div>
      </aside>
      <main className="admin-main">
        <header className="av-top">
          <span className="av-logo av-top-logo">
            <BrandMark />
          </span>
          <h2 className="av-top-title">{section === 'Messages' ? 'Inbox' : section}</h2>
          <button
            type="button"
            className="av-search"
            onClick={() => setPaletteOpen(true)}
            aria-label="Jump to a section or search"
          >
            <Search size={16} aria-hidden="true" />
            <span>Jump to a section or search…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="av-top-right">
            <span className={`av-pill hide-md${profileState === 'missing' ? ' warn' : ''}`}>
              <i className={`av-live${profileState === 'missing' ? ' w' : ''}`} />
              {profileState === 'missing' ? 'Role not loaded' : 'Live'}
            </span>
            {profile && (
              <span
                className={`av-pill hide-md${profile.isSuper ? '' : ' info'}`}
                title={
                  profile.isSuper ? 'Full access to every section' : 'Access limited to the sections this role needs'
                }
              >
                {roleLabel}
              </span>
            )}
            <button
              type="button"
              className="av-ibtn av-theme"
              onClick={changeTheme}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={dark ? 'Light mode' : 'Dark mode'}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              className="av-ibtn"
              aria-label={unreadTotal > 0 ? `Notifications, ${unreadTotal} need attention` : 'Notifications'}
              onClick={() => selectSection(canSee('Notifications') ? 'Notifications' : 'Messages')}
            >
              <Bell size={18} />
              {unreadTotal > 0 && <span className="av-dot" aria-hidden="true" />}
            </button>
          </div>
        </header>
        <div className="av-page" key={section}>
          <div className="admin-header">
            <div className="admin-title-row">
              <span className="av-crumbs">Admin console › {section}</span>
              <h1>{SECTION_TITLES[section] ?? section}</h1>
              <p className="av-sub">{SECTION_SUBTITLES[section]}</p>
            </div>
            <div className="admin-actions" id="av-header-actions" />
          </div>
          <Suspense
            fallback={
              <section className="admin-card wide" aria-busy="true">
                <div className="admin-empty">Loading…</div>
              </section>
            }
          >
            {renderSection()}
          </Suspense>
        </div>
      </main>
      <nav className="av-tabbar" aria-label="Quick navigation">
        {quick.map((name) => {
          const Icon = adminSectionIcons[name]
          const badge = name === 'Payouts' ? payoutQueue : name === 'Messages' ? unreadSupportCount : 0
          return (
            <button
              key={name}
              type="button"
              className={`av-tab${section === name && !mobileNavOpen ? ' active' : ''}`}
              onClick={() => selectSection(name)}
            >
              <span className="av-tab-icon">
                <Icon size={21} aria-hidden="true" />
                {badge > 0 && <b>{badge > 9 ? '9+' : badge}</b>}
              </span>
              <span>{name === 'Messages' ? 'Inbox' : name}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={`av-tab${mobileNavOpen ? ' active' : ''}`}
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label="Open admin navigation"
        >
          <span className="av-tab-icon">
            <Menu size={21} aria-hidden="true" />
          </span>
          <span>More</span>
        </button>
      </nav>
      <AdminCommandPalette
        open={paletteOpen}
        sections={visibleSections}
        onClose={() => setPaletteOpen(false)}
        onPick={(name) => {
          setPaletteOpen(false)
          selectSection(name)
        }}
      />
    </div>
  )
}

export default AdminConsole
