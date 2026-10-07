import { useEffect, useState } from 'react'
import {
  ArrowRight, Bell, ClipboardList, CreditCard, Gauge, GitBranch, History, LayoutDashboard,
  Layers, LogOut, Menu, MessageCircle, Package, PanelLeftClose, PanelLeftOpen, Settings, Share2, ShieldCheck, ShoppingCart, UserRound, Users,
} from 'lucide-react'
import { adminSupabase } from './lib/supabase'
import { AdminAccounts } from './admin/AdminAccounts'
import { AdminAuditLog } from './admin/AdminAuditLog'
import { AdminFeedback } from './admin/AdminFeedback'
import { AdminMessages } from './admin/AdminMessages'
import { AdminMonitoring } from './admin/AdminMonitoring'
import { AdminNotifications } from './admin/AdminNotifications'
import { AdminOverview } from './admin/AdminOverview'
import { AdminPlans } from './admin/AdminPlans'
import { AdminProfile } from './admin/AdminProfile'
import { AdminPromoters } from './admin/AdminPromoters'
import { AdminResourceTable } from './admin/AdminResourceTable'
import { AdminRevenue } from './admin/AdminRevenue'
import { AdminRoadmap } from './admin/AdminRoadmap'
import { AdminSettings } from './admin/AdminSettings'
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
  Admins: ShieldCheck,
  Profile: UserRound,
  Settings,
}
// Financial sections (Revenue, Plans & pricing, Subscriptions) are hidden
// from any admin who isn't a super admin or finance admin -- the backend
// (can_view_financial_admin_data()) enforces this regardless, but there's
// no reason to show a nav item that will just fail. Admins is super-admin
// only on both ends for the same reason.
const FINANCIAL_SECTIONS: AdminSection[] = ['Revenue', 'Plans', 'Subscriptions']
const SUPER_ADMIN_ONLY_SECTIONS: AdminSection[] = ['Admins']
const adminSectionGroups: { label: string; items: AdminSection[] }[] = [
  { label: 'Control room', items: ['Overview', 'Users', 'Organizations', 'Subscriptions', 'Plans', 'Promoters', 'Revenue', 'Admins'] },
  { label: 'Operations', items: ['Branches', 'Inventory', 'Sales'] },
  { label: 'Governance', items: ['Notifications', 'Messages', 'Feedback', 'Roadmap', 'Audit log', 'Monitoring'] },
  { label: 'Account', items: ['Profile', 'Settings'] },
]
const GENERIC_RESOURCE_SECTIONS: AdminSection[] = ['Organizations', 'Branches', 'Inventory', 'Sales', 'Subscriptions']

function AdminConsole({ email, onBack, onLogout }: { email: string; onBack: () => void; onLogout: () => void }) {
  const [section, setSection] = useState<AdminSection>('Overview')
  const [unreadSupportCount, setUnreadSupportCount] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('zerobyte.admin-sidebar-collapsed') === 'true')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [profile, setProfile] = useState<AdminProfileSummary | null>(null)

  useEffect(() => {
    if (!adminSupabase) return
    adminSupabase.rpc('get_my_admin_profile').then(({ data }) => {
      const row = (data ?? [])[0]
      if (row) setProfile({ role: row.role, status: row.status, isSuper: row.is_super, canViewFinancials: row.can_view_financials, fullName: row.full_name, email: row.email })
    })
  }, [])

  const canSee = (name: AdminSection) => {
    if (SUPER_ADMIN_ONLY_SECTIONS.includes(name)) return profile?.isSuper ?? false
    if (FINANCIAL_SECTIONS.includes(name)) return profile?.canViewFinancials ?? false
    return true
  }

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
    if (!canSee(section)) return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Restricted</h2><p>Your admin role ({profile?.role ?? 'unknown'}) doesn't include access to this section.</p></div></div></section>
    if (section === 'Overview') return <AdminOverview onOpenSection={selectSection} />
    if (section === 'Users') return <AdminUsers />
    if (section === 'Plans') return <AdminPlans />
    if (section === 'Promoters') return <AdminPromoters />
    if (section === 'Revenue') return <AdminRevenue />
    if (section === 'Admins') return <AdminAccounts />
    if (section === 'Profile') return <AdminProfile />
    if (section === 'Feedback') return <AdminFeedback />
    if (section === 'Roadmap') return <AdminRoadmap />
    if (section === 'Audit log') return <AdminAuditLog />
    if (section === 'Monitoring') return <AdminMonitoring />
    if (section === 'Settings') return <AdminSettings email={email} />
    if (section === 'Messages') return <AdminMessages onUnreadChange={setUnreadSupportCount} />
    if (section === 'Notifications') return <AdminNotifications />
    if (GENERIC_RESOURCE_SECTIONS.includes(section)) return <section className="admin-card wide"><div className="admin-card-header"><div><h2>{section}</h2><p>Live records from the shared Supabase backend.</p></div><button className="secondary" onClick={() => setSection('Overview')}>Back to overview</button></div><AdminResourceTable resource={section} /></section>
    return null
  }

  return <div className={`admin-shell${sidebarCollapsed ? ' admin-sidebar-collapsed' : ''}${mobileNavOpen ? ' admin-mobile-nav-open' : ''}`}><button className="admin-nav-backdrop" aria-label="Close admin navigation" onClick={() => setMobileNavOpen(false)} /><aside className="admin-sidebar"><div className="admin-brand-row"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Admin</small></div><button className="admin-collapse-button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div><button className="admin-role" onClick={() => selectSection('Profile')}><span>Signed in as{profile ? ` · ${profile.role.replace(/_/g, ' ')}` : ''}</span><strong>{profile?.fullName || email}</strong></button><nav className="admin-nav" aria-label="Admin navigation">{adminSectionGroups.map((group) => { const visible = group.items.filter(canSee); if (!visible.length) return null; return <div className="admin-nav-group" key={group.label}><span className="admin-nav-label">{group.label}</span>{visible.map((name) => { const Icon = adminSectionIcons[name]; return <button key={name} className={`admin-nav-item${section === name ? ' active' : ''}`} onClick={() => selectSection(name)} title={sidebarCollapsed ? name : undefined} aria-label={name}><Icon size={16} aria-hidden="true" /><span>{name}</span>{name === 'Messages' && unreadSupportCount > 0 && <b className="admin-nav-badge">{unreadSupportCount > 9 ? '9+' : unreadSupportCount}</b>}</button> })}</div> })}</nav><div className="admin-sidebar-footer"><button className="secondary admin-footer-button" onClick={onBack}><ArrowRight size={15} /><span>Return to app</span></button><button className="text-btn admin-footer-button" onClick={onLogout}><LogOut size={15} /><span>Log out</span></button></div></aside><main className="admin-main"><header className="admin-header"><div className="admin-title-row"><button className="admin-mobile-menu" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label="Open admin navigation"><Menu size={20} /></button><div><span className="section-label">Platform operations</span><h1>{section}</h1></div></div><div className="admin-actions"><button className="secondary" onClick={() => selectSection('Audit log')}>View audit log</button><button className="primary" onClick={() => selectSection('Notifications')}>Send broadcast</button></div></header>{renderSection()}</main></div>
}

export default AdminConsole
