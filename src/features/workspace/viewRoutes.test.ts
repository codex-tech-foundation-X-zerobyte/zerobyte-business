import { describe, expect, it } from 'vitest'
import { appViewPath, isAppPath, parseAppPath } from './viewRoutes'

describe('app addresses', () => {
  it('gives every screen its own address', () => {
    expect(appViewPath('Overview')).toBe('/app/overview')
    expect(appViewPath('Purchase Orders')).toBe('/app/purchase-orders')
    expect(appViewPath('User Accounts')).toBe('/app/user-accounts')
    expect(appViewPath('Settings', 'billing')).toBe('/app/settings/billing')
    expect(appViewPath('Sales', 'billing')).toBe('/app/sales')
  })

  it('reads an address back into the same screen', () => {
    expect(parseAppPath('/app/purchase-orders')).toEqual({ view: 'Purchase Orders', settingsTab: undefined })
    expect(parseAppPath('/app/settings/guide')).toEqual({ view: 'Settings', settingsTab: 'guide' })
    expect(parseAppPath('/app')).toEqual({ view: 'Overview', settingsTab: undefined })
    expect(parseAppPath('/app/sales?x=1')?.view).toBe('Sales')
  })

  it('rejects anything that is not an app screen', () => {
    expect(parseAppPath('/')).toBeNull()
    expect(parseAppPath('/auth')).toBeNull()
    expect(parseAppPath('/app/not-a-screen')).toBeNull()
    expect(parseAppPath('/admin/users')).toBeNull()
  })

  it('ignores an unknown settings area', () => {
    expect(parseAppPath('/app/settings/nope')).toEqual({ view: 'Settings', settingsTab: undefined })
  })

  it('round-trips every screen', () => {
    for (const view of ['Overview', 'Sales', 'Inventory', 'Customers', 'Receipts', 'Invoices', 'Expenses', 'Records', 'Reports', 'Branches', 'Workforce'] as const)
      expect(parseAppPath(appViewPath(view))?.view).toBe(view)
  })

  it('knows which addresses belong to the app', () => {
    expect(isAppPath('/app')).toBe(true)
    expect(isAppPath('/app/sales')).toBe(true)
    expect(isAppPath('/apple')).toBe(false)
    expect(isAppPath('/')).toBe(false)
  })
})
