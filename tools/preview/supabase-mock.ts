// Preview-only stand-in for src/lib/supabase.ts: answers the admin RPCs with sample data so screens can be rendered without a backend.
const day = (n: number) => `D${n}`
const points = (len: number) => Array.from({ length: len }, (_, i) => ({ label: day(i + 1), users: Math.round(8 + i * 0.6 + Math.sin(i) * 4), organizations: Math.round(3 + i * 0.3 + Math.cos(i) * 2), sales: Math.round(20 + i * 2 + Math.sin(i / 2) * 9), revenue: 0, expenses: 0 }))
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const names = ['Ada Okafor', 'Tunde Bello', 'Ngozi Eze', 'Ibrahim Musa', 'Chiamaka Obi', 'Segun Adeyemi']
const answers: Record<string, unknown> = {
  admin_get_plans: [
    { plan_id: 'p1', code: 'free', name: 'Free', description: 'For trying Zerøbyte', active: true, sort_order: 1, trial_days: 0, monthly_amount: 0, currency: 'NGN', limits: { branches: 1, employees: 3, products: 100 }, subscriber_count: 210 },
    { plan_id: 'p2', code: 'growth', name: 'Growth', description: 'For growing shops', active: true, sort_order: 2, trial_days: 14, monthly_amount: 7500, currency: 'NGN', limits: { branches: 3, employees: 15, products: 2000 }, subscriber_count: 96 },
    { plan_id: 'p3', code: 'scale', name: 'Scale', description: 'Multi-branch businesses', active: false, sort_order: 3, trial_days: 14, monthly_amount: 25000, currency: 'NGN', limits: { branches: null, employees: null, products: null }, subscriber_count: 36 },
  ],
  admin_list_admin_accounts: names.slice(0, 4).map((n, i) => ({ id: 'a' + i, user_id: 'u' + i, full_name: n, email: n.split(' ')[0].toLowerCase() + '@zerobyte.app', role: ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'][i], status: i === 3 ? 'revoked' : 'active', granted_by_name: i ? 'Ada Okafor' : null, granted_at: ago(500 + i * 90) })),
  admin_list_feedback: [
    { id: 'f1', organization_name: 'Mama Put Kitchen', user_email: 'ngozi@mamaput.ng', category: 'bug', severity: 'high', message: 'Receipts print twice on the second branch.', status: 'new', admin_response: null, created_at: ago(5) },
    { id: 'f2', organization_name: 'Bello Pharmacy', user_email: 'tunde@bellorx.ng', category: 'idea', severity: 'normal', message: 'Please add expiry-date alerts for stock.', status: 'planned', admin_response: 'Planned for the next release.', created_at: ago(70) },
    { id: 'f3', organization_name: 'Eze Fashion', user_email: null, category: 'praise', severity: 'low', message: 'The new sales screen is much faster.', status: 'closed', admin_response: 'Thank you!', created_at: ago(190) },
  ],
  admin_list_promoters: names.slice(0, 4).map((n, i) => ({ promoter_id: 'pr' + i, full_name: n, email: n.split(' ')[0].toLowerCase() + '@mail.com', whatsapp: '2348012345' + i + '00', referral_code: 'ZB' + (100 + i), status: i === 3 ? 'paused' : 'active', created_at: ago(900 + i * 50), total_referrals: 12 - i * 3, has_account: i < 3 })),
  admin_list_referrals: [0, 1, 2, 3, 4].map((i) => ({ referral_id: 'r' + i, promoter_name: names[i % 4], referral_code: 'ZB' + (100 + (i % 4)), business_name: i === 4 ? null : ['Mama Put Kitchen', 'Bello Pharmacy', 'Eze Fashion', 'Obi Hardware'][i], status: ['paid', 'active', 'signed_up', 'paid', 'signed_up'][i], signed_up_at: ago(30 + i * 40) })),
  admin_list_payout_requests: [
    { id: 'pay1', status: 'review', amount_kobo: 1850000, commission_count: 4, requested_at: ago(6), decided_at: null, decision_note: null, paid_at: null, payment_reference: null, promoter: { id: 'pr0', name: 'Ada Okafor', email: 'ada@mail.com', code: 'ZB100', status: 'active' }, verification: { minimum_kobo: 500000, warnings: [] }, items: [{ business: 'Mama Put Kitchen', kind: 'first_payment', percent: 20, commission_kobo: 150000, payment_kobo: 750000, earned_at: ago(100), still_ok: true }] },
    { id: 'pay2', status: 'paid', amount_kobo: 920000, commission_count: 2, requested_at: ago(300), decided_at: ago(290), decision_note: null, paid_at: ago(280), payment_reference: 'TRX-4412', promoter: { id: 'pr1', name: 'Tunde Bello', email: 'tunde@mail.com', code: 'ZB101', status: 'active' }, verification: {}, items: [] },
  ],
  admin_get_payout_settings: { minimum_payout_kobo: 500000, can_change: true },
  admin_get_revenue_overview: { currency: 'NGN', period_days: 30, payments_recorded: 212, revenue: { total: 4820000, today: 85000, week: 612000, month: 2310000 }, payment_counts: { successful: 190, pending: 9, failed: 8, abandoned: 5, needs_review: 2 }, subscriptions: { active_paid: 132, active_free: 210, trialing: 24, past_due: 6, canceled: 11, expired: 4, new_in_period: 28, ended_in_period: 7 }, contracted_monthly_value: 1240000, revenue_by_plan: [{ plan_code: 'growth', plan_name: 'Growth', revenue: 3100000, payments: 140 }, { plan_code: 'scale', plan_name: 'Scale', revenue: 1720000, payments: 50 }], daily: Array.from({ length: 30 }, (_, i) => ({ day: ago(24 * (30 - i)), revenue: 60000 + Math.round(Math.sin(i / 3) * 30000 + i * 3000), payments: 4 + (i % 5) })), recent: [0, 1, 2, 3].map((i) => ({ id: 'pm' + i, organization_name: ['Mama Put Kitchen', 'Bello Pharmacy', 'Eze Fashion', 'Obi Hardware'][i], plan_name: 'Growth', amount: 7500, currency: 'NGN', status: ['successful', 'successful', 'pending', 'failed'][i], provider: 'paystack', provider_reference: 'PSK-' + (9000 + i), occurred_at: ago(i * 7 + 1) })) },
  list_support_conversations: [0, 1, 2, 3].map((i) => ({ id: 'c' + i, organization_id: 'o' + i, organization_name: ['Mama Put Kitchen', 'Bello Pharmacy', 'Eze Fashion', 'Obi Hardware'][i], user_id: 'u' + i, user_name: names[i], user_email: 'x@y.ng', status: 'open', updated_at: ago(i + 1), latest_body: ['My printer is not working', 'How do I add a branch?', 'Thanks!', 'Invoice question'][i], latest_sender_role: i === 2 ? 'admin' : 'customer', latest_created_at: ago(i + 1), unread: i < 2, priority: ['urgent', 'normal', 'low', 'high'][i], admin_stage: 'new', assigned_to: null, assigned_to_name: null, waiting_since: ago(i + 2), queue_position: i + 1 })),
  list_platform_admins: [],
  get_plan_catalog: [{ code: 'free', name: 'Free' }, { code: 'growth', name: 'Growth' }],
  get_my_admin_profile: [{ role: 'SUPER_ADMIN', status: 'active', is_super: true, can_view_financials: true, full_name: 'Ada Okafor', email: 'ops@zerobyte.app' }],
  get_my_admin_sections: ['Overview','Analytics','Users','Organizations','Subscriptions','Plans','Promoters','Payouts','Gifts','Revenue','Admins','Branches','Inventory','Sales','Notifications','Messages','Feedback','Roadmap','Audit log','Monitoring','Profile','Settings'],
  admin_payout_queue_count: 2,
  get_platform_overview: { users: 1284, organizations: 342, branches: 517, employees: 1906, products: 18420, customers: 9310, sales: 41266, invoices: 6204, expenses: 12880 },
  get_platform_analytics: { points: points(30) },
  admin_get_analytics: (() => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(Math.min(i + 1, 28)).padStart(2, '0')}`)
    const wave = (i: number, base: number, amp: number) => Math.round(base + i * 1.4 + Math.sin(i / 2.2) * amp)
    const d = days(30)
    return {
      generated_at: new Date().toISOString(), period_days: 30,
      visitors: { today: 412, yesterday: 380, page_views_today: 1390, period_visitor_days: 9000, period_page_views: 21000,
        series: d.map((day, i) => ({ day, visitors: wave(i, 220, 40), page_views: wave(i, 600, 120) })),
        top_pages: [{ path: '/', views: 4200, visitors: 2100 }, { path: '/pricing', views: 1800, visitors: 900 }], top_referrers: [{ host: 'google.com', visitors: 800 }, { host: 'whatsapp', visitors: 520 }],
        devices: [{ device: 'mobile', visitors: 1900 }, { device: 'desktop', visitors: 700 }], promoter_codes: [{ ref_code: 'ZB100', visitors: 240 }] },
      users: { total: 1284, new_today: 12, new_7d: 64, new_30d: 210, dau: 188, wau: 640, mau: 990, retention_week1: 38, series: d.map((day, i) => ({ day, signups: wave(i, 6, 3), active: wave(i, 120, 25) })) },
      businesses: { total: 342, new_7d: 9, new_30d: 40, active_7d: 210, active_30d: 300, with_first_sale: 200, series: d.map((day, i) => ({ day, businesses: wave(i, 1, 1) })) },
      sales: { count_today: 233, volume_today: 4200000, count_period: 6200, volume_period: 91000000, series: d.map((day, i) => ({ day, volume: wave(i, 2500000, 700000), count: 100 })), top_businesses: [{ name: 'Mama Put Kitchen', volume: 9100000, sales: 820 }, { name: 'Bello Pharmacy', volume: 6400000, sales: 410 }] },
      funnel: { visitors: 9000, signups: 1284, businesses: 342, first_sale: 261, paid: 118 },
      plans: [{ plan: 'Free', businesses: 210 }, { plan: 'Growth', businesses: 96 }],
      revenue: { collected_period: 4820000, collected_month: 2310000, contracted_monthly: 1240000, failed_period: 8, needs_review: 0, paying_businesses: 132, series: d.map((day, i) => ({ day, amount: wave(i, 90000, 30000) })) },
      security: { admins_active: 3, admins_suspended: 1, admin_actions_24h: 41, blocked_logins_24h: 6, unverified_payments: 0, by_role: [{ role: 'SUPER_ADMIN', n: 1 }, { role: 'FINANCE_ADMIN', n: 2 }], recent_actions: [{ action: 'plan_price_changed', target_type: 'plan', actor_role: 'SUPER_ADMIN', created_at: new Date().toISOString() }] },
    }
  })(),
  admin_get_traffic_snapshot: { window_minutes: 60, requests_window: 18420, rps_now: 4.2, rps_avg: 3.1, rps_peak: 9.8, error_rate: 0.4, avg_ms: 180, p95_ms: 640, db_connections: 14, db_size_mb: 812, series: Array.from({ length: 60 }, (_, i) => ({ minute: new Date(Date.now() - (60 - i) * 60000).toISOString(), requests: Math.round(200 + Math.sin(i / 4) * 80), errors: 0 })) },
}
const call = (name: string) => Promise.resolve({ data: name in answers ? answers[name] : null, error: null })
const tables: Record<string, unknown[]> = {
  roadmap_items: [
    { id: 'rm1', title: 'Expiry-date alerts', description: 'Warn when stock is about to expire.', priority: 'high', target_release: 'v8.2', status: 'in_progress', created_at: ago(200) },
    { id: 'rm2', title: 'Offline sales', description: 'Keep selling without internet.', priority: 'normal', target_release: 'v9', status: 'planned', created_at: ago(400) },
    { id: 'rm3', title: 'Dark receipts', description: 'Printer themes.', priority: 'low', target_release: null, status: 'idea', created_at: ago(800) },
  ],
  promoter_applications: [{ id: 'app1', full_name: 'Chidi Nwosu', email: 'chidi@mail.com', phone: '2348055550000', location: 'Lagos', reason: 'I run a community of 3,000 shop owners.', status: 'applied', created_at: ago(20) }],
  admin_notifications: [{ id: 'n1', title: 'Scheduled maintenance', body: 'Sunday 2am.', audience: 'all', created_at: ago(40) }],
  app_version_announcements: [{ id: 'v1', version: '8.1.0', title: 'Faster sales screen', created_at: ago(90) }],
  support_messages: [{ id: 'm1', conversation_id: 'c0', sender_id: 'u0', sender_role: 'customer', body: 'Hello, my printer is not working since this morning.', created_at: ago(3) }, { id: 'm2', conversation_id: 'c0', sender_id: 'a0', sender_role: 'admin', body: 'Hi, we are looking into it. Which printer model is it?', created_at: ago(2.8) }, { id: 'm3', conversation_id: 'c0', sender_id: 'u0', sender_role: 'customer', body: 'Epson TM-T20', created_at: ago(2.5) }],
  support_internal_notes: [{ id: 'sn1', author_id: 'a0', body: 'Check plan limit before offering a free month.', created_at: ago(2) }],
  profiles: [{ id: 'u0', full_name: 'Ada Okafor', phone: '08012345678' }],
}
function builder(table: string) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: tables[table] ?? [], error: null })
      return () => proxy
    },
  }
  const proxy: unknown = new Proxy({}, handler)
  return proxy
}
export const edgeFixtures = {
  users: Array.from({ length: 8 }, (_, i) => ({ id: 'u' + i, email: names[i % 6].split(' ')[0].toLowerCase() + i + '@mail.ng', full_name: names[i % 6], phone: '0801234567' + i, created_at: ago(100 + i * 60), last_sign_in_at: ago(i * 9), banned: i === 5, organizations: 1 + (i % 2) })),
  records: Array.from({ length: 8 }, (_, i) => ({ name: ['Mama Put Kitchen', 'Bello Pharmacy', 'Eze Fashion', 'Obi Hardware'][i % 4] + ' ' + (i + 1), plan: ['Growth', 'Free', 'Scale'][i % 3], status: i === 4 ? 'past_due' : 'active', branches: 1 + (i % 3), created_at: ago(300 + i * 40) })),
  audit: [0, 1, 2, 3, 4, 5].map((i) => ({ source: i === 5 ? 'github' : 'platform', id: 'au' + i, action: ['admin.login', 'plan.price_changed', 'broadcast.sent', 'role.granted', 'payout.paid', 'push main'][i], actor: names[i % 4], target: ['console', 'Growth', 'all', 'Tunde Bello', 'pay2', 'repo'][i], organizationId: null, metadata: {}, createdAt: ago(i * 5 + 1) })),
}
export const adminSupabase = { rpc: call, from: builder, functions: { invoke: () => Promise.resolve({ data: {}, error: null }) }, auth: { updateUser: () => Promise.resolve({ error: null }), getUser: () => Promise.resolve({ data: { user: { id: 'u0', email: 'ops@zerobyte.app' } } }), getSession: () => Promise.resolve({ data: { session: { access_token: 't', expires_at: 4102444800 } }, error: null }), refreshSession: () => Promise.resolve({ data: { session: null }, error: null }) }, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel: () => {} }
export const supabase = adminSupabase
export const supabaseUrl = 'http://mock.local'
export const supabaseAnonKey = 'x'
export const isSupabaseConfigured = true
export const openedFromRecoveryLink = false
export const recoveryEventLatched = () => false
export const getDataMode = () => 'preview'
