import type { View } from '../../lib/types'

// Every screen in the signed-in app has its own address (/app/sales, /app/settings/billing ...). The address is the
// single source of truth for "where am I", so a refresh stays on the same screen and the browser's Back and Forward
// buttons move between the screens you actually visited instead of leaving the app.

export type SettingsTab = 'profile' | 'business' | 'reports' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide'

const SETTINGS_TABS: SettingsTab[] = ['profile', 'business', 'reports', 'billing', 'appearance', 'security', 'feedback', 'guide']

const VIEWS: View[] = [
  'Overview',
  'Sales',
  'Inventory',
  'Purchase Orders',
  'Customers',
  'Receipts',
  'Invoices',
  'Expenses',
  'Records',
  'Reports',
  'Branches',
  'Workforce',
  'User Accounts',
  'Settings',
]

const slugOf = (view: View) => view.toLowerCase().replace(/\s+/g, '-')
const VIEW_BY_SLUG = new Map(VIEWS.map((view) => [slugOf(view), view]))

export const APP_HOME = '/app/overview'

/** The address of a screen, e.g. ('Settings', 'billing') -> /app/settings/billing. */
export function appViewPath(view: View, settingsTab?: SettingsTab | null) {
  return view === 'Settings' && settingsTab ? `/app/settings/${settingsTab}` : `/app/${slugOf(view)}`
}

/** Reads an address back into a screen. Returns null for anything that is not a signed-in-app address. */
export function parseAppPath(route: string): { view: View; settingsTab?: SettingsTab } | null {
  const parts = route.split('?')[0].split('#')[0].split('/').filter(Boolean)
  if (parts[0] !== 'app') return null
  const view = VIEW_BY_SLUG.get(parts[1] ?? '') ?? (parts.length === 1 ? 'Overview' : undefined)
  if (!view) return null
  const tab = parts[2] as SettingsTab | undefined
  return { view, settingsTab: view === 'Settings' && tab && SETTINGS_TABS.includes(tab) ? tab : undefined }
}

export const isAppPath = (route: string) => route === '/app' || route.startsWith('/app/')

// Where to send someone after signing in: the page they were trying to reach, otherwise the Overview.
const RETURN_KEY = 'zb-return-to'
export function rememberReturnPath(route: string) {
  try {
    if (isAppPath(route)) window.sessionStorage.setItem(RETURN_KEY, route)
  } catch {
    /* storage unavailable */
  }
}
export function takeReturnPath() {
  try {
    const saved = window.sessionStorage.getItem(RETURN_KEY)
    window.sessionStorage.removeItem(RETURN_KEY)
    return saved && parseAppPath(saved) ? saved : APP_HOME
  } catch {
    return APP_HOME
  }
}
