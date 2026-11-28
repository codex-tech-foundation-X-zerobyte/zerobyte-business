import { describe, expect, it } from 'vitest'
import { clip, COMMANDS, type Deps, isAllowed, MAX_MESSAGE, parseCommand, runCommand } from './commands'

const snapshot = {
  generated_at: '2026-11-26T10:05:00Z',
  payments: {
    success_24h: 14, failed_24h: 2, pending_stuck: 1, needs_review: 0, revenue_24h_kobo: 7000000, activation_gap_count: 1,
    webhooks: { total_24h: 31, errors_24h: 2 },
    activation_gaps: [{ business: 'Chukwudi Stores', plan_name: 'Basic', subscription_status: 'trialing' }],
    stuck: [{ business: 'Mama Tola Foods', minutes_pending: 47 }],
  },
  subscriptions: { trialing: 38, active_paid: 64, past_due: 2, trials_ending_48h: 1, conversion_rate: 28.8, trials_ending_list: [{ business: 'Bisi Provisions', hours_left: 6 }] },
  functions: [{ function_name: 'paystack-webhook', requests: 12, errors: 5, error_rate: 41.7 }, { function_name: 'ok-fn', requests: 9, errors: 0, error_rate: 0 }],
  capacity: { db_used_percent: 72.4, db_bytes: 379000000, db_limit_bytes: 524288000, connections: 14, max_connections: 60, storage_bytes: 88000000, hours_since_activity: 0.3, top_tables: [{ table_name: 'sales', bytes: 142000000 }] },
  security: { throttle_total_24h: 63, admins_without_mfa: 1, admin_actions_24h: 27, admin_sensitive_24h: 3, bulk_delete_businesses: [] },
  customers: { total_businesses: 310, silent_7_13: 21, silent_14_29: 17, silent_30_plus: 44, no_products_count: 12, no_sales_count: 19, support_open: 4, support_waiting_24h: 1 },
  app_errors: { errors_24h: 18, errors_prev_24h: 11, affected_users_24h: 9, top: [{ message: "Could not read the name of a product", count: 9 }] },
}
const alerts = [
  { key: 'pay-gap', severity: 'critical', title: 'Paid but plan not active', detail: '1 business paid but is not on its plan.' },
  { key: 'db-high', severity: 'warning', title: 'Database filling up', detail: '72.4% used.' },
]
const calls: string[] = []
const deps: Deps = {
  snapshot: async (force) => {
    calls.push(force ? 'snapshot:force' : 'snapshot')
    return snapshot
  },
  alerts: async () => alerts,
  stats: async () => ({ registered_accounts: 1240, new_accounts_24h: 6, new_accounts_7d: 41, businesses_total: 310, new_businesses_24h: 3, new_businesses_7d: 22, active_businesses_today: 120, sales_today: 212, sales_today_total: 1864000, top_businesses_today: [{ business: 'Adaeze Stores', total: 186400, sales: 14 }] }),
  findBusiness: async (q) => (q === 'ghost' ? [] : [{ business: 'Mama Put Stores', plan: 'Basic', subscription_status: 'trialing', trial_end: '2026-12-01T00:00:00Z', created_at: '2026-11-10T09:00:00Z', products: 40, sales_30d: 120, members: 3, last_sale_at: '2026-11-26T09:00:00Z' }]),
  ping: async () => ({ dbMs: 38, authOk: true, authMs: 112 }),
}

describe('parseCommand', () => {
  it('reads commands, bot suffixes and arguments', () => {
    expect(parseCommand('/health')).toEqual({ name: 'health', arg: '' })
    expect(parseCommand('/Health@zerobyte_bot')).toEqual({ name: 'health', arg: '' })
    expect(parseCommand('  /business   mama put ')).toEqual({ name: 'business', arg: 'mama put' })
  })
  it('ignores ordinary messages and bad input', () => {
    expect(parseCommand('hello')).toBeNull()
    expect(parseCommand('please /health')).toBeNull()
    expect(parseCommand(undefined)).toBeNull()
    expect(parseCommand(42)).toBeNull()
  })
})

describe('isAllowed', () => {
  it('answers only the chats in the secret', () => {
    expect(isAllowed(123456789, '123456789')).toBe(true)
    expect(isAllowed(-100123, '123456789, -100123')).toBe(true)
    expect(isAllowed(555, '123456789')).toBe(false)
  })
  it('denies when nothing is configured or the id is missing', () => {
    expect(isAllowed(123, undefined)).toBe(false)
    expect(isAllowed(123, '')).toBe(false)
    expect(isAllowed(undefined, '123')).toBe(false)
  })
})

describe('runCommand', () => {
  it('stays silent for non-commands', async () => {
    expect(await runCommand('good morning', deps)).toBeNull()
  })
  it('lists every command in /help', async () => {
    const reply = (await runCommand('/help', deps)) as string
    for (const [name] of COMMANDS) expect(reply).toContain(`/${name}`)
  })
  it('reports health with alerts and key numbers', async () => {
    const reply = (await runCommand('/health', deps)) as string
    expect(reply).toContain('2 things need attention')
    expect(reply).toContain('Paid but plan not active')
    expect(reply).toContain('₦70,000')
    expect(reply).toContain('72.4% used')
  })
  it('forces a new scan only for /refresh', async () => {
    calls.length = 0
    await runCommand('/health', deps)
    await runCommand('/refresh', deps)
    expect(calls).toEqual(['snapshot', 'snapshot:force'])
  })
  it('answers every report command without error text', async () => {
    for (const command of ['/alerts', '/ping', '/users', '/payments', '/trials', '/errors', '/capacity', '/security', '/customers']) {
      const reply = (await runCommand(command, deps)) as string
      expect(reply.length).toBeGreaterThan(10)
      expect(reply).not.toMatch(/undefined|NaN|\[object/)
    }
  })
  it('shows the key facts for each report', async () => {
    expect(await runCommand('/ping', deps)).toContain('38 ms')
    expect(await runCommand('/users', deps)).toContain('Adaeze Stores — ₦186,400')
    expect(await runCommand('/payments', deps)).toContain('Chukwudi Stores')
    expect(await runCommand('/trials', deps)).toContain('Bisi Provisions — 6 h left')
    expect(await runCommand('/errors', deps)).toContain('paystack-webhook: 5/12')
    expect(await runCommand('/capacity', deps)).toContain('14/60')
    expect(await runCommand('/security', deps)).toContain('Admins without 2-step: 1')
    expect(await runCommand('/customers', deps)).toContain('Quiet 30+ days: 44')
  })
  it('looks up a business, and asks for a name when none is given', async () => {
    expect(await runCommand('/business mama', deps)).toContain('Mama Put Stores')
    expect(await runCommand('/business ghost', deps)).toContain('No business found')
    expect(await runCommand('/business', deps)).toContain('Tell me which business')
  })
  it('handles unknown commands politely', async () => {
    expect(await runCommand('/deleteeverything', deps)).toContain('/help')
  })
  it('never leaks technical detail when something fails', async () => {
    const broken: Deps = { ...deps, snapshot: async () => { throw new Error('relation "payments" does not exist') } }
    const reply = (await runCommand('/health', broken)) as string
    expect(reply).toBe('Could not get that right now. Please try again in a moment.')
  })
  it('keeps long replies under the Telegram limit', () => {
    expect(clip('x'.repeat(10000)).length).toBeLessThanOrEqual(MAX_MESSAGE)
  })
})
