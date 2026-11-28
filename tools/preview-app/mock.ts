// Preview-only stand-in for src/lib/supabase.ts with believable shop data (never shipped).
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const ORG = 'org-1'
const ORGROW = { id: ORG, name: 'Adaeze Stores', tagline: 'Groceries and household goods', address: '14 Allen Avenue, Ikeja, Lagos', phone: '0803 555 0142', email: 'hello@adaezestores.ng', website: null, logo_url: null, currency: 'NGN', receipt_prefix: 'ADZ', tax_rate: 0 }
const P = (id: string, name: string, sku: string, stock: number, cost: number, price: number, category: string, rp = 10) => ({ id, name, sku, stock, price, cost_price: cost, category, reorder_point: rp, branch_id: null, low_stock: stock <= rp })
const products = [
  P('p1', 'Peak Milk 400g tin', 'PK-400', 64, 2300, 2800, 'Groceries'),
  P('p2', 'Indomie Chicken (carton)', 'IND-CTN', 38, 6900, 7800, 'Groceries'),
  P('p3', 'Golden Penny Semovita 2kg', 'GP-SEM2', 9, 3300, 3900, 'Groceries'),
  P('p4', 'Dangote Sugar 1kg', 'DG-SUG1', 120, 1600, 1900, 'Groceries'),
  P('p5', 'Power Oil 5L', 'PWO-5L', 17, 10800, 12500, 'Cooking'),
  P('p6', 'Hypo Bleach 1L', 'HYP-1L', 52, 800, 1100, 'Household'),
  P('p7', 'Ariel Detergent 900g', 'ARL-900', 0, 2100, 2600, 'Household', 8),
  P('p8', 'Dettol Soap (pack of 3)', 'DTL-3P', 26, 1500, 1900, 'Household'),
]
const customers = [
  { id: 'c1', name: 'Mrs Bisi Adeyemi', email: 'bisi@mail.ng', phone: '0802 411 0933', address: '7 Adeniyi Jones, Ikeja' },
  { id: 'c2', name: 'Chukwudi Okeke', email: null, phone: '0813 220 4471', address: 'Computer Village, Ikeja' },
  { id: 'c3', name: 'Mama Tola Foods', email: 'tola@mamatola.ng', phone: '0706 902 1188', address: '21 Oba Akran, Ikeja' },
  { id: 'c4', name: 'Hauwa Bello', email: null, phone: '0815 600 2907', address: 'Maryland, Lagos' },
]
const sale = (i: number, h: number, cust: number | null, items: [number, number][], pay = 'cash', status = 'completed') => {
  const lines = items.map(([pi, q], k) => ({ id: `si${i}-${k}`, quantity: q, unit_price: products[pi].price, line_total: products[pi].price * q, products: { name: products[pi].name, sku: products[pi].sku } }))
  const total = lines.reduce((t, l) => t + l.line_total, 0)
  const c = cust === null ? null : customers[cust]
  return { id: `s${i}`, customer_id: c?.id ?? null, receipt_number: `ADZ-${String(1040 + i).padStart(6, '0')}`, total, tax_amount: 0, discount_amount: 0, payment_method: pay, status, created_at: ago(h), customer: c, sale_items: lines, items: lines }
}
const sales = [
  sale(7, 0.6, 0, [[1, 2], [3, 3]], 'transfer'), sale(6, 2, null, [[0, 6], [5, 4]]), sale(5, 4, 2, [[4, 2], [1, 3]], 'credit'),
  sale(4, 26, 1, [[2, 4]], 'card'), sale(3, 28, null, [[7, 5], [0, 2]]), sale(2, 31, 3, [[1, 5]], 'transfer'), sale(1, 50, null, [[3, 10], [5, 6]]),
]
const tables: Record<string, unknown[]> = {
  organization_members: [{ organization_id: ORG, role: 'owner', organizations: { id: ORG, name: 'Adaeze Stores' } }],
  employee_profiles: [],
  organizations: [ORGROW],
  branches: [],
  products,
  stock_movements: [
    { id: 'm1', product_id: 'p1', movement_type: 'PURCHASE', quantity: 48, created_at: ago(30), products: { name: 'Peak Milk 400g tin' } },
    { id: 'm2', product_id: 'p2', movement_type: 'SALE', quantity: -5, created_at: ago(31), products: { name: 'Indomie Chicken (carton)' } },
    { id: 'm3', product_id: 'p3', movement_type: 'ADJUSTMENT', quantity: -2, created_at: ago(52), products: { name: 'Golden Penny Semovita 2kg' } },
  ],
  customers,
  sales,
  expenses: [
    { id: 'e1', title: 'Shop rent (November)', category: 'Rent', amount: 150000, expense_date: new Date().toISOString().slice(0, 10), payment_method: 'transfer', description: null },
    { id: 'e2', title: 'Generator diesel', category: 'Utilities', amount: 28500, expense_date: new Date().toISOString().slice(0, 10), payment_method: 'cash', description: 'Two jerrycans' },
    { id: 'e3', title: 'Delivery rider', category: 'Transport', amount: 12000, expense_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), payment_method: 'cash', description: null },
  ],
  invoices: [],
  notifications: [
    { id: 'n1', organization_id: ORG, title: 'Low stock: Ariel Detergent 900g', body: 'Ariel Detergent 900g is out of stock. Receive more to keep selling it.', read_at: null, created_at: ago(1) },
    { id: 'n2', organization_id: ORG, title: 'Low stock: Golden Penny Semovita 2kg', body: 'Only 9 left (reorder point is 10).', read_at: null, created_at: ago(3) },
    { id: 'n3', organization_id: ORG, title: 'Daily report is ready', body: 'Yesterday you sold ₦186,400 across 14 sales.', read_at: ago(20), created_at: ago(26) },
  ],
  profiles: [{ id: 'u1', full_name: 'Adaeze Okonkwo', phone: '0803 555 0142' }],
  subscriptions: [{ plan_id: 'pl1', status: 'trialing', trial_end: ago(-24 * 5), current_period_end: null }],
  business_reports: [], product_feedback: [], app_version_announcements: [],
  support_conversations: [{ id: 'conv1', status: 'open', customer_read_at: null }],
  support_messages: [
    { id: 'sm1', conversation_id: 'conv1', sender_id: 'u1', sender_role: 'customer', body: 'Hello, my receipt shows the wrong customer name after I picked Mrs Bisi Adeyemi.', created_at: ago(0.4), source: null },
    { id: 'sm2', conversation_id: 'conv1', sender_id: 'a1', sender_role: 'admin', body: 'Hi Ada, sorry about that. Which receipt number is it, and did you pick the customer before tapping Complete sale?', created_at: ago(0.35), source: null },
    { id: 'sm3', conversation_id: 'conv1', sender_id: 'u1', sender_role: 'customer', body: 'ADZ-001047. I picked her first. Also a very long reference with no spaces: ZB-5f2c1a9e-77d4-4f1e-9a2b-0c9d3e5f7a11-5f2c1a9e-77d4-4f1e-9a2b-0c9d3e5f7a11', created_at: ago(0.3), source: null },
    { id: 'sm4', conversation_id: 'conv1', sender_id: 'a1', sender_role: 'admin', body: 'Thanks. I am sending this to technical support so they can look at it.', created_at: ago(0.2), source: 'codex' },
  ],
}
const rows = (n: number, f: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => f(i))
const healthSample = {
  generated_at: new Date().toISOString(),
  alert_cooldown_hours: 6,
  alerts: [
    { key: 'pay-gap', severity: 'critical', title: 'Paid but plan not active', detail: '1 business(es) paid in the last 14 days but are not on the plan they paid for.' },
    { key: 'fn-paystack-webhook', severity: 'critical', title: 'Function failing: paystack-webhook', detail: '41.7% of 12 requests failed in the last 24 hours.' },
    { key: 'db-high', severity: 'warning', title: 'Database filling up', detail: '72.4% of the plan limit is used.' },
    { key: 'admin-mfa', severity: 'warning', title: 'Admins without two-step sign-in', detail: '1 active admin(s) have no verified second factor.' },
  ],
  payments: { success_24h: 14, failed_24h: 2, abandoned_24h: 3, needs_review: 0, pending_stuck: 1, revenue_24h_kobo: 7000000,
    stuck: [{ reference: 'zb_9f21…c04a', business: 'Mama Tola Foods', minutes_pending: 47 }],
    activation_gaps: [{ business: 'Chukwudi Okeke Stores', plan_name: 'Basic', subscription_status: 'trialing', reference: 'zb_71ab…99d2' }],
    activation_gap_count: 1, webhooks: { total_24h: 31, errors_24h: 2, last_webhook_at: ago(0.4) } },
  subscriptions: { trialing: 38, active_paid: 64, past_due: 2, expired_7d: 9, canceled_30d: 4, trials_ending_48h: 5,
    trials_ending_list: [{ business: 'Bisi Provisions', hours_left: 6 }, { business: 'Hauwa Bello Mart', hours_left: 19 }, { business: 'Ikeja Fresh Foods', hours_left: 31 }],
    cohort_trials_60d: 212, cohort_converted: 61, conversion_rate: 28.8, churn_30d_rate: 5.9 },
  functions: [
    { function_name: 'paystack-webhook', requests: 12, errors: 5, error_rate: 41.7, avg_ms: 430, p95_ms: 529 },
    { function_name: 'resolve-worker-login', requests: 188, errors: 1, error_rate: 0.5, avg_ms: 212, p95_ms: 480 },
    { function_name: 'get-platform-records', requests: 940, errors: 0, error_rate: 0, avg_ms: 145, p95_ms: 330 },
    { function_name: 'platform-health-ping', requests: 288, errors: 0, error_rate: 0, avg_ms: 61, p95_ms: 120 },
  ],
  capacity: { db_bytes: 379000000, db_limit_bytes: 524288000, db_used_percent: 72.4, connections: 14, max_connections: 60, storage_bytes: 88000000, auth_users: 1240, hours_since_activity: 0.3,
    top_tables: [{ table_name: 'sales', bytes: 142000000 }, { table_name: 'sale_items', bytes: 118000000 }, { table_name: 'backend_request_latency', bytes: 52000000 }, { table_name: 'stock_movements', bytes: 31000000 }] },
  security: { throttle_total_24h: 63, throttle_buckets: [{ bucket: 'worker-login', hits: 58 }, { bucket: 'admin-login', hits: 5 }], admins_without_mfa: 1, admins_without_mfa_list: ['support@zerobyte.app'],
    admin_actions_24h: 27, admin_sensitive_24h: 3, bulk_delete_businesses: [] },
  integrity: { negative_stock_count: 0, stock_mismatch_count: 3, stock_mismatch: [{ business: 'Adaeze Stores', product: 'Golden Penny Semovita 2kg', shown: 9, from_movements: 11 }],
    sale_total_mismatch_count: 0, sale_total_mismatch: [], sales_without_items: 0, sale_syncs_24h: 212, customer_syncs_24h: 18, sync_failures_24h: 2 },
  customers: { total_businesses: 310, silent_7_13: 21, silent_14_29: 17, silent_30_plus: 44, silent_list: [{ business: 'Tunde Hardware', days_silent: 12 }, { business: 'Mama Put Stores', days_silent: 9 }],
    no_products: [{ business: 'Ngozi Beauty Hub', days_since_signup: 6 }], no_products_count: 12, no_sales: [{ business: 'Emeka Autos', days_since_signup: 9 }], no_sales_count: 19,
    support_open: 4, support_waiting_24h: 1, support_oldest_wait_hours: 31 },
  app_errors: { errors_24h: 18, errors_prev_24h: 11, affected_users_24h: 9, mobile_share: 83,
    top: [{ message: 'Cannot read properties of undefined (reading \'name\')', kind: 'js', count: 9, last_seen: ago(1) }, { message: 'Offline sale could not sync (409)', kind: 'sync', count: 5, last_seen: ago(3) }],
    versions: [{ version: '7.0.0', errors: 12 }, { version: '6.9.2', errors: 6 }] },
  promoters: { self_referrals: [], referral_spikes: [], payouts_waiting_7d: 2, payouts_over_earned: [], duplicate_payout_references: 0 },
}
const rpcAnswers: Record<string, unknown> = {
  admin_get_health_center: healthSample,
  get_subscription_access: { state: 'trial', reason: null, status: 'trialing', plan_name: 'Free', plan_code: 'free', period_end: ago(-24 * 5), seconds_left: 5 * 86400, can_pay: true },
  get_branch_breakdown: [],
  get_my_support_queue: { waiting: true, position: 2, ahead: 1, estimated_minutes: 6 },
  get_low_stock_products: [
    { id: 'p7', name: 'Ariel Detergent 900g', sku: 'ARL-900', stock: 0, reorder_point: 8 },
    { id: 'p3', name: 'Golden Penny Semovita 2kg', sku: 'GP-SEM2', stock: 9, reorder_point: 10 },
  ],
  get_dashboard_metrics: { revenue: 186400, cogs: 131200, gross_profit: 55200, operating_expenses: 28500, net_profit: 26700, sales_count: 14 },
  get_customer_balances: [{ customer_id: 'c3', balance: 94500 }],
  get_plan_catalog: [
    { plan_id: 'pl1', code: 'free', name: 'Free', description: 'For getting started', trial_days: 7, monthly_amount: 0, currency: 'NGN', limits: { branches: 1, employees: 3, products: 100 } },
    { plan_id: 'pl2', code: 'basic', name: 'Basic', description: 'For growing shops', trial_days: 7, monthly_amount: 5000, currency: 'NGN', limits: { branches: 2, employees: 10, products: 1000 } },
    { plan_id: 'pl3', code: 'pro', name: 'Pro', description: 'For multi-branch businesses', trial_days: 7, monthly_amount: 12000, currency: 'NGN', limits: { branches: null, employees: null, products: null } },
  ],
  get_product_performance: [
    { kind: 'best', product_id: 'p2', name: 'Indomie Chicken (carton)', sku: 'IND-CTN', units: 38, revenue: 296400, profit: 34200, stock: 38, last_sold: ago(2) },
    { kind: 'best', product_id: 'p1', name: 'Peak Milk 400g tin', sku: 'PK-400', units: 90, revenue: 252000, profit: 45000, stock: 64, last_sold: ago(1) },
    { kind: 'slow', product_id: 'p5', name: 'Power Oil 5L', sku: 'PWO-5L', units: 0, revenue: 0, profit: 0, stock: 17, last_sold: null },
  ],
}
// ?hang=products,sales keeps those tables loading forever, so loading skeletons can be photographed.
const hang = (new URLSearchParams(location.search).get('hang') || '').split(',').filter(Boolean)
function chain(table: string, single = false): unknown {
  const rows = tables[table] ?? []
  const result = () => ({ data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length })
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then')
        return (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
          hang.includes(table) ? new Promise(() => {}) : Promise.resolve(result()).then(res, rej)
      if (prop === 'single' || prop === 'maybeSingle') return () => chain(table, true)
      return () => proxy
    },
  }
  const proxy: unknown = new Proxy({}, handler)
  return proxy
}
const session = { access_token: 't', expires_at: 4102444800, user: { id: 'u1', email: 'owner@mamaput.ng', user_metadata: { full_name: 'Ada Okafor' } } }
const channel = () => ({ on() { return this }, subscribe() { return this }, unsubscribe() {} })
export const supabase = {
  rpc: (name: string) => Promise.resolve({ data: name in rpcAnswers ? rpcAnswers[name] : null, error: null }),
  from: (t: string) => chain(t),
  functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  auth: {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
    signOut: () => Promise.resolve({ error: null }),
    updateUser: () => Promise.resolve({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  channel, removeChannel: () => {},
}
export const adminSupabase = supabase
export const supabaseUrl = 'http://mock.local'
export const supabaseAnonKey = 'x'
export const isSupabaseConfigured = true
export const openedFromRecoveryLink = false
export const recoveryEventLatched = () => false
