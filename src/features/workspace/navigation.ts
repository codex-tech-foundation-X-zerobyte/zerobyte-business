import {
  BarChart3,
  ClipboardList,
  FileText,
  GitBranch,
  Home,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { View } from '../../lib/types'

export type NavItem = { name: View; icon: LucideIcon }
export type NavGroup = { label: string; items: NavItem[] }

/** The menu, in the order the design shows it. The sidebar and the phone "More" sheet are both built from this. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Daily work',
    items: [
      { name: 'Overview', icon: Home },
      { name: 'Sales', icon: ShoppingCart },
      { name: 'Inventory', icon: Package },
      { name: 'Purchase Orders', icon: Truck },
      { name: 'Customers', icon: Users },
    ],
  },
  {
    label: 'Records',
    items: [
      { name: 'Receipts', icon: Receipt },
      { name: 'Invoices', icon: FileText },
      { name: 'Expenses', icon: Wallet },
      { name: 'Records', icon: ClipboardList },
      { name: 'Reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Team',
    items: [
      { name: 'Branches', icon: GitBranch },
      { name: 'Workforce', icon: User },
      { name: 'User Accounts', icon: ShieldCheck },
    ],
  },
]

export const ACCOUNT_GROUP: NavGroup = { label: 'Account', items: [{ name: 'Settings', icon: Settings }] }

/** What a worker (staff member) is allowed to open. Everything else is hidden from them. */
const WORKER_VIEWS: View[] = ['Overview', 'Sales', 'Customers', 'Receipts', 'Workforce']

/** Pages a worker is bounced away from if they somehow reach them. */
export const OWNER_ONLY_VIEWS: View[] = [
  'Inventory',
  'Records',
  'Expenses',
  'Invoices',
  'Reports',
  'Branches',
  'User Accounts',
  'Settings',
]

/** The four pages with a permanent place on the phone bottom bar (the fifth slot is "More"). */
const OWNER_TABS: View[] = ['Overview', 'Sales', 'Inventory', 'Records']
const WORKER_TABS: View[] = ['Overview', 'Sales', 'Customers', 'Receipts']

export function visibleGroups(workerMode: boolean): NavGroup[] {
  if (!workerMode) return [...NAV_GROUPS, ACCOUNT_GROUP]
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => WORKER_VIEWS.includes(item.name)),
  })).filter((group) => group.items.length > 0)
}

export function phoneTabs(workerMode: boolean): NavItem[] {
  const wanted = workerMode ? WORKER_TABS : OWNER_TABS
  const everything = [...NAV_GROUPS, ACCOUNT_GROUP].flatMap((group) => group.items)
  return wanted.flatMap((name) => everything.filter((item) => item.name === name))
}
