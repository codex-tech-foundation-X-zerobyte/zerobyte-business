import { BrandMark } from './components/BrandMark'
import { useEffect, useState } from 'react'
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
} from 'lucide-react'
import { adminSupabase } from './lib/supabase'
import { AdminCommandPalette } from './admin/AdminCommandPalette'
import { AdminAccounts } from './admin/AdminAccounts'
import { AdminAuditLog } from './admin/AdminAuditLog'
import { AdminFeedback } from './admin/AdminFeedback'
import { AdminMessages } from './admin/AdminMessages'
import { AdminMonitoring } from './admin/AdminMonitoring'
import { AdminNotifications } from './admin/AdminNotifications'
import { AdminOverview } from './admin/AdminOverview'
import { AdminPlans } from './admin/AdminPlans'
import { AdminProfile } from './admin/AdminProfile'
import { AdminGifts } from './admin/AdminGifts'
import { AdminPayouts } from './admin/AdminPayouts'
import { AdminPromoters } from './admin/AdminPromoters'
import { AdminResourceTable } from './admin/AdminResourceTable'
import { AdminRevenue } from './admin/AdminRevenue'
import { AdminAnalytics } from './admin/AdminAnalytics'
import { AdminRoadmap } from './admin/AdminRoadmap'
import { ADMIN_START_KEY, AdminSettings } from './admin/AdminSettings'
import { AdminUsers } from './admin/AdminUsers'
import { type AdminProfile as AdminProfileSummary, type AdminSection } from './admin/types'

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
  { label: 'Governance', items: ['Notifications', 'Messages', 'Feedback', 'Roadmap', 'Audit log', 'Monitoring'] },
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
  Overview: 'Live counts from the shared Supabase backend.',
  Analytics: 'Growth, traffic and conversion across the platform.',
  Users: 'Everyone registered in Supabase Auth.',
  Organizations: 'Live records from the shared Supabase backend.',
  Subscriptions: 'Live records from the shared Supabase backend.',
  Plans: 'Prices and limits for every plan.',
  Promoters: 'Applications, access and referrals.',
  Payouts: 'Review and pay promoter payout requests.',
  Gifts: 'Free plan time and discounts (super admin only).',
  Branches: 'Live records from the shared Supabase backend.',
  Inventory: 'Live records from the shared Supabase backend.',
  Sales: 'Live records from the shared Supabase backend.',
  Notifications: 'Broadcast to users and announce releases.',
  Messages: 'Support conversations with your customers.',
  Feedback: 'Ideas, bugs and requests from businesses.',
  Roadmap: 'What ships next.',
  'Audit log': 'Every important action, in real time.',
  Monitoring: 'Live health of every service.',
  Revenue: 'Figures from verified payments only.',
  Admins: 'Who can run the platform.',
  Profile: 'Your admin identity.',
  Settings: 'Console preferences.',
}
const GENERIC_RESOURCE_SECTIONS: AdminSection[] = ['Organizations', 'Subscriptions', 'Branches', 'Inventory', 'Sales']

function AdminConsole({ email, onBack, onLogout }: { email: string; onBack: () => void; onLogout: () => void }) {
  const [section, setSection] = useState<AdminSection>('Overview')
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
  const [dark, setDark] = useState(() => {
    const saved = window.localStorage.getItem('zerobyte.admin-theme')
    return saved ? saved === 'dark' : true
  })
  const changeTheme = () => {
    const next = !dark
    setDark(next)
    window.localStorage.setItem('zerobyte.admin-theme', next ? 'dark' : 'light')
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
      const chosen = window.localStorage.getItem(ADMIN_START_KEY)
      const first =
        (chosen && list.includes(chosen)
          ? [chosen as AdminSection]
          : (['Overview', 'Messages'] as AdminSection[])
        ).find((name) => list.includes(name)) ?? ordered.find((name) => list.includes(name))
      setSection((current) => (list.includes(current) ? current : (first ?? current)))
    })
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
            window.localStorage.setItem('zerobyte.admin-theme', next ? 'dark' : 'light')
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
              {profileState === 'missing' ? 'Role not loaded' : 'Live · Supabase'}
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
          {renderSection()}
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
