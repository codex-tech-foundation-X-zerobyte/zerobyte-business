// Command logic for the Telegram bot. Pure functions only (no Deno, no network) so every command can be tested.
// Every command is READ-ONLY: the bot can report, never change anything.

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : [])
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

export type Alert = { key: string; severity: string; title: string; detail: string }
export type Deps = {
  snapshot: (force: boolean) => Promise<Obj>
  alerts: (snapshot: Obj) => Promise<Alert[]>
  stats: () => Promise<Obj>
  findBusiness: (query: string) => Promise<Obj[]>
  ping: () => Promise<{ dbMs: number | null; authOk: boolean; authMs: number | null }>
}

export const COMMANDS: [string, string][] = [
  ['health', 'Overall status and anything needing attention'],
  ['alerts', 'Active alerts only'],
  ['ping', 'Is the database and sign-in responding?'],
  ['users', 'Accounts, businesses and sales today'],
  ['payments', 'Payments in the last 24 hours'],
  ['trials', 'Trials ending in 48 hours'],
  ['errors', 'App errors and failing functions'],
  ['capacity', 'Database size, connections, storage'],
  ['security', 'Sign-in pressure and admin safety'],
  ['customers', 'Who has gone quiet or never started'],
  ['business', 'Look up a business: /business mama'],
  ['refresh', 'Run a fresh health scan now'],
  ['help', 'Show this list'],
]

export function parseCommand(text: unknown): { name: string; arg: string } | null {
  if (typeof text !== 'string') return null
  const match = text.trim().match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { name: match[1].toLowerCase(), arg: (match[2] ?? '').trim().slice(0, 80) }
}

/** `allowed` is the TELEGRAM_CHAT_ID secret: one id, or several separated by commas. Anything else is ignored. */
export function isAllowed(chatId: unknown, allowed: string | undefined): boolean {
  if (chatId === undefined || chatId === null || !allowed) return false
  const ids = allowed.split(',').map((id) => id.trim()).filter(Boolean)
  return ids.includes(String(chatId))
}

const TZ = 'Africa/Lagos'
const when = (iso: unknown) =>
  typeof iso === 'string' && iso ? new Date(iso).toLocaleString('en-NG', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'never'
const day = (iso: unknown) =>
  typeof iso === 'string' && iso ? new Date(iso).toLocaleDateString('en-NG', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown'
const naira = (whole: number) => `₦${Math.round(whole).toLocaleString('en-NG')}`
const kobo = (k: number) => naira(k / 100)
const mb = (bytes: unknown) => (typeof bytes === 'number' ? (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`) : 'n/a')
const icon = (severity: string) => (severity === 'critical' ? '🔴' : severity === 'warning' ? '🟠' : '🔵')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const MAX_MESSAGE = 3900 // Telegram allows 4096 characters
export const clip = (text: string) => (text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE - 20)}\n…(shortened)`)

function help() {
  return ['Zerøbyte bot (read-only)', '', ...COMMANDS.map(([name, about]) => `/${name} — ${about}`)].join('\n')
}

async function health(deps: Deps, force: boolean) {
  const snap = await deps.snapshot(force)
  const alerts = await deps.alerts(snap)
  const critical = alerts.filter((a) => a.severity === 'critical').length
  const head = alerts.length === 0 ? '🟢 All clear' : `${critical ? '🔴' : '🟠'} ${plural(alerts.length, 'thing')} need${alerts.length === 1 ? 's' : ''} attention`
  const lines = [head, `Scan taken ${when(snap.generated_at)}`]
  if (alerts.length) lines.push('', ...alerts.map((a) => `${icon(a.severity)} ${a.title}\n${a.detail}`))
  const pay = obj(snap.payments)
  const cap = obj(snap.capacity)
  lines.push('', `Paid (24h): ${num(pay.success_24h)} · ${kobo(num(pay.revenue_24h_kobo))}`, `Database: ${num(cap.db_used_percent)}% used`)
  return lines.join('\n')
}

async function alertsOnly(deps: Deps) {
  const alerts = await deps.alerts(await deps.snapshot(false))
  if (!alerts.length) return '✅ No active alerts.'
  return alerts.map((a) => `${icon(a.severity)} ${a.title}\n${a.detail}`).join('\n\n')
}

async function ping(deps: Deps) {
  const p = await deps.ping()
  return [
    '🏓 Pong',
    `Database: ${p.dbMs === null ? 'not responding' : `${p.dbMs} ms`}`,
    `Sign-in service: ${p.authOk ? `OK (${p.authMs} ms)` : 'not responding'}`,
  ].join('\n')
}

async function users(deps: Deps) {
  const s = await deps.stats()
  const top = arr(s.top_businesses_today)
  const lines = [
    '👥 Users',
    `Registered accounts: ${s.registered_accounts === null ? 'n/a' : num(s.registered_accounts)} (+${num(s.new_accounts_24h)} today, +${num(s.new_accounts_7d)} this week)`,
    `Businesses: ${num(s.businesses_total)} (+${num(s.new_businesses_24h)} today, +${num(s.new_businesses_7d)} this week)`,
    `Active today: ${num(s.active_businesses_today)} businesses`,
    '',
    `Sales today: ${num(s.sales_today)} · ${naira(num(s.sales_today_total))}`,
  ]
  if (top.length) lines.push('', 'Top businesses today:', ...top.map((t, i) => `${i + 1}. ${str(t.business)} — ${naira(num(t.total))} (${num(t.sales)} sales)`))
  return lines.join('\n')
}

async function payments(deps: Deps) {
  const p = obj((await deps.snapshot(false)).payments)
  const w = obj(p.webhooks)
  const gaps = arr(p.activation_gaps)
  const stuck = arr(p.stuck)
  const lines = [
    '💳 Payments (24h)',
    `Paid: ${num(p.success_24h)} · ${kobo(num(p.revenue_24h_kobo))}`,
    `Failed: ${num(p.failed_24h)}`,
    `Pending over 30 min: ${num(p.pending_stuck)}`,
    `Need review: ${num(p.needs_review)}`,
    `Paid but plan not active: ${num(p.activation_gap_count)}`,
    `Confirmation errors: ${num(w.errors_24h)} of ${num(w.total_24h)}`,
  ]
  if (gaps.length) lines.push('', 'Paid, plan not active:', ...gaps.map((g) => `• ${str(g.business)} (${str(g.plan_name, 'plan')}, now ${str(g.subscription_status, 'unknown')})`))
  if (stuck.length) lines.push('', 'Stuck pending:', ...stuck.map((g) => `• ${str(g.business)} — ${num(g.minutes_pending)} min`))
  return lines.join('\n')
}

async function trials(deps: Deps) {
  const sub = obj((await deps.snapshot(false)).subscriptions)
  const list = arr(sub.trials_ending_list)
  const lines = [`⏳ Trials ending in 48 hours: ${num(sub.trials_ending_48h)}`, `In trial now: ${num(sub.trialing)} · Paying: ${num(sub.active_paid)} · Past due: ${num(sub.past_due)}`]
  if (sub.conversion_rate !== null && sub.conversion_rate !== undefined) lines.push(`Trial to paid (60 days): ${num(sub.conversion_rate)}%`)
  if (list.length) lines.push('', ...list.map((t) => `• ${str(t.business)} — ${num(t.hours_left)} h left`))
  else lines.push('', 'None right now.')
  return lines.join('\n')
}

async function errors(deps: Deps) {
  const snap = await deps.snapshot(false)
  const app = obj(snap.app_errors)
  const fns = arr(snap.functions).filter((f) => num(f.errors) > 0)
  const top = arr(app.top)
  const lines = [`🐞 App errors (24h): ${num(app.errors_24h)} (${num(app.errors_prev_24h)} the day before), ${num(app.affected_users_24h)} people`]
  if (top.length) lines.push('', 'Most common:', ...top.slice(0, 5).map((t) => `• ${str(t.message).slice(0, 90)} ×${num(t.count)}`))
  lines.push('', fns.length ? 'Functions with errors:' : 'No function errors in 24h.')
  lines.push(...fns.map((f) => `• ${str(f.function_name)}: ${num(f.errors)}/${num(f.requests)} (${num(f.error_rate)}%)`))
  return lines.join('\n')
}

async function capacity(deps: Deps) {
  const c = obj((await deps.snapshot(false)).capacity)
  const tables = arr(c.top_tables)
  const lines = [
    '🗄️ Capacity',
    `Database: ${num(c.db_used_percent)}% (${mb(c.db_bytes)} of ${mb(c.db_limit_bytes)})`,
    `Connections: ${num(c.connections)}/${num(c.max_connections)}`,
    `File storage: ${mb(c.storage_bytes)}`,
    `Since last activity: ${num(c.hours_since_activity)} h`,
  ]
  if (tables.length) lines.push('', 'Largest tables:', ...tables.slice(0, 4).map((t) => `• ${str(t.table_name)} ${mb(t.bytes)}`))
  return lines.join('\n')
}

async function security(deps: Deps) {
  const s = obj((await deps.snapshot(false)).security)
  const noMfa = s.admins_without_mfa
  const lines = [
    '🔐 Security (24h)',
    `Rate-limit hits: ${num(s.throttle_total_24h)}`,
    `Admins without 2-step: ${noMfa === null || noMfa === undefined ? 'n/a' : num(noMfa)}`,
    `Admin actions: ${num(s.admin_actions_24h)} (${num(s.admin_sensitive_24h)} sensitive)`,
    `Businesses deleting a lot: ${arr(s.bulk_delete_businesses).length}`,
  ]
  return lines.join('\n')
}

async function customers(deps: Deps) {
  const c = obj((await deps.snapshot(false)).customers)
  return [
    '🧑‍🤝‍🧑 Customer health',
    `Businesses: ${num(c.total_businesses)}`,
    `Quiet 7–13 days: ${num(c.silent_7_13)}`,
    `Quiet 14–29 days: ${num(c.silent_14_29)}`,
    `Quiet 30+ days: ${num(c.silent_30_plus)}`,
    `Never added a product: ${num(c.no_products_count)}`,
    `Products but no sale yet: ${num(c.no_sales_count)}`,
    `Support open: ${num(c.support_open)} (${num(c.support_waiting_24h)} waiting over 24 h)`,
  ].join('\n')
}

async function business(deps: Deps, query: string) {
  if (query.length < 2) return 'Tell me which business: /business mama'
  const rows = await deps.findBusiness(query)
  if (!rows.length) return `No business found for "${query}".`
  return rows
    .map((b) =>
      [
        `🏪 ${str(b.business)}`,
        `Plan: ${str(b.plan)} (${str(b.subscription_status)})${b.trial_end ? `, trial ends ${day(b.trial_end)}` : ''}`,
        `Signed up: ${day(b.created_at)} · Members: ${num(b.members)}`,
        `Products: ${num(b.products)} · Sales (30 days): ${num(b.sales_30d)}`,
        `Last sale: ${when(b.last_sale_at)}`,
      ].join('\n'),
    )
    .join('\n\n')
}

/** Runs one message and returns the reply text, or null when the message is not a command (the bot stays silent). */
export async function runCommand(text: unknown, deps: Deps): Promise<string | null> {
  const command = parseCommand(text)
  if (!command) return null
  try {
    switch (command.name) {
      case 'start':
      case 'help':
        return clip(help())
      case 'health':
        return clip(await health(deps, false))
      case 'refresh':
        return clip(await health(deps, true))
      case 'alerts':
        return clip(await alertsOnly(deps))
      case 'ping':
        return clip(await ping(deps))
      case 'users':
      case 'user':
        return clip(await users(deps))
      case 'payments':
        return clip(await payments(deps))
      case 'trials':
        return clip(await trials(deps))
      case 'errors':
        return clip(await errors(deps))
      case 'capacity':
        return clip(await capacity(deps))
      case 'security':
        return clip(await security(deps))
      case 'customers':
        return clip(await customers(deps))
      case 'business':
        return clip(await business(deps, command.arg))
      default:
        return 'I do not know that command. Send /help to see the list.'
    }
  } catch {
    // Never show technical detail in chat.
    return 'Could not get that right now. Please try again in a moment.'
  }
}
