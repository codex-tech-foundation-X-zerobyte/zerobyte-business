import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { pollWhileVisible } from '../lib/visiblePoll'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { Kpi } from './AdminCharts'
import { HeaderActions } from './HeaderActions'
import { adminSupabase } from '../lib/supabase'

// One page for everything that can quietly go wrong: money, plans, functions, capacity, security, data, customers,
// browser errors and promoter abuse. All numbers come from admin_get_health_center(); nothing is computed here.
type Row = Record<string, string | number | null>
type Alert = { key: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string }
type Health = {
  generated_at: string
  alerts: Alert[]
  financial_hidden?: boolean
  payments?: {
    success_24h: number
    failed_24h: number
    abandoned_24h: number
    needs_review: number
    pending_stuck: number
    revenue_24h_kobo: number
    stuck: Row[]
    activation_gaps: Row[]
    activation_gap_count: number
    webhooks: { total_24h: number; errors_24h: number; last_webhook_at: string | null }
  }
  subscriptions?: {
    trialing: number
    active_paid: number
    past_due: number
    expired_7d: number
    canceled_30d: number
    trials_ending_48h: number
    trials_ending_list: Row[]
    cohort_trials_60d: number
    cohort_converted: number
    conversion_rate: number | null
    churn_30d_rate: number | null
  }
  functions: { function_name: string; requests: number; errors: number; error_rate: number; avg_ms: number; p95_ms: number }[]
  capacity: {
    db_bytes: number
    db_limit_bytes: number
    db_used_percent: number
    top_tables: { table_name: string; bytes: number }[]
    connections: number
    max_connections: number
    storage_bytes: number | null
    auth_users: number | null
    hours_since_activity: number | null
  }
  security: {
    throttle_total_24h: number
    throttle_buckets: { bucket: string; hits: number }[]
    admins_without_mfa: number | null
    admins_without_mfa_list: string[]
    admin_actions_24h: number
    admin_sensitive_24h: number
    bulk_delete_businesses: Row[]
  }
  integrity: {
    negative_stock_count: number
    stock_mismatch_count: number
    stock_mismatch: Row[]
    sale_total_mismatch_count: number
    sale_total_mismatch: Row[]
    sales_without_items: number
    sale_syncs_24h: number
    customer_syncs_24h: number
    sync_failures_24h: number
  }
  customers: {
    total_businesses: number
    silent_7_13: number
    silent_14_29: number
    silent_30_plus: number
    silent_list: Row[]
    no_products: Row[]
    no_products_count: number
    no_sales: Row[]
    no_sales_count: number
    support_open: number
    support_waiting_24h: number
    support_oldest_wait_hours: number | null
  }
  app_errors: {
    errors_24h: number
    errors_prev_24h: number
    affected_users_24h: number
    mobile_share: number | null
    top: { message: string; kind: string; count: number; last_seen: string }[]
    versions: { version: string; errors: number }[]
  }
  promoters: {
    self_referrals: Row[]
    referral_spikes: Row[]
    payouts_waiting_7d: number
    payouts_over_earned: Row[]
    duplicate_payout_references: number
  }
}

const SECTIONS = [
  ['payments', 'Payments'],
  ['subscriptions', 'Subscriptions'],
  ['functions', 'Functions'],
  ['capacity', 'Capacity'],
  ['security', 'Security'],
  ['integrity', 'Data checks'],
  ['customers', 'Customers'],
  ['app-errors', 'App errors'],
  ['promoters', 'Promoters'],
] as const

const naira = (kobo: number) => `₦${Math.round((kobo || 0) / 100).toLocaleString('en-NG')}`
const mb = (bytes: number | null) =>
  bytes === null || bytes === undefined ? 'Not available' : bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'
const tone = (bad: boolean, warn = false) => (bad ? 'bad' : warn ? 'warn' : 'good')

function Panel({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={`hc-${id}`} className="admin-card wide hc-panel">
      <div className="admin-card-header">
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Mini({ columns, rows, empty }: { columns: [string, string][]; rows: Row[]; empty: string }) {
  if (!rows?.length) return <p className="field-help hc-empty">{empty}</p>
  return (
    <div className="table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map(([key]) => (
                <td key={key}>{row[key] === null || row[key] === undefined ? '—' : String(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AdminHealthCenter() {
  const [data, setData] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The page reads a saved scan that is at most 5 minutes old. The Refresh button asks for a new scan.
  const load = useCallback((force = false) => {
    if (!adminSupabase) return
    setLoading(true)
    adminSupabase.rpc('admin_get_health_center', force ? { p_force: true } : undefined).then(({ data: result, error: rpcError }) => {
      setLoading(false)
      if (rpcError) {
        setError(
          rpcError.code === 'PGRST202'
            ? 'The Health center is not set up yet. Please try again shortly.'
            : 'The Health center could not be loaded. Try again in a moment.',
        )
        return
      }
      setError('')
      setData(result as Health)
    })
  }, [])
  useEffect(() => {
    load()
    return pollWhileVisible(() => load(), 60000)
  }, [load])

  if (loading && !data)
    return (
      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h2>Health center</h2>
            <p>Loading…</p>
          </div>
        </div>
        <div className="admin-grid admin-summary-grid">
          {[1, 2, 3, 4].map((item) => (
            <article key={item} className="admin-card admin-card-skeleton">
              <Skeleton className="skeleton-line short" />
              <Skeleton className="skeleton-line value" />
              <Skeleton className="skeleton-line" />
            </article>
          ))}
        </div>
      </section>
    )
  if (error && !data)
    return (
      <section className="admin-card wide">
        <div className="form-error" role="alert">
          {error}
        </div>
      </section>
    )
  if (!data) return null

  const { payments, subscriptions, capacity, security, integrity, customers, promoters } = data
  const critical = data.alerts.filter((alert) => alert.severity === 'critical').length
  const used = capacity.db_used_percent

  return (
    <>
      <HeaderActions>
        <button type="button" className="secondary" onClick={() => load(true)}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </HeaderActions>

      <section className={`av-banner hc-status ${critical ? 'bad' : data.alerts.length ? 'warn' : 'good'}`} role="status">
        {data.alerts.length ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        <div>
          <strong>
            {data.alerts.length === 0
              ? 'Everything looks healthy'
              : `${data.alerts.length} thing${data.alerts.length === 1 ? '' : 's'} need${data.alerts.length === 1 ? 's' : ''} attention`}
          </strong>
          <p>Scan taken {when(data.generated_at)}. Checked again at most every 5 minutes; press Refresh for a new scan.</p>
          {data.alerts.length > 0 && (
            <ul className="hc-alerts">
              {data.alerts.map((alert) => (
                <li key={alert.key}>
                  <span className={`admin-pill ${alert.severity === 'critical' ? 'danger' : 'warn'}`}>{alert.severity}</span>
                  <b>{alert.title}</b> <span>{alert.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <nav className="hc-jump" aria-label="Jump to a section">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#hc-${id}`} onClick={(event) => {
            event.preventDefault()
            document.getElementById(`hc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}>
            {label}
          </a>
        ))}
      </nav>

      {data.financial_hidden ? (
        <Panel id="payments" title="Payments and subscriptions" hint="Visible to finance admins.">
          <p className="field-help">Your role does not include payment data.</p>
        </Panel>
      ) : (
        <>
          {payments && (
            <Panel id="payments" title="Payments" hint="Money in, and anything that did not settle cleanly.">
              <div className="akpi-grid">
                <Kpi label="Paid in 24 hours" value={String(payments.success_24h)} sub={naira(payments.revenue_24h_kobo)} />
                <Kpi label="Failed in 24 hours" value={String(payments.failed_24h)} tone={tone(payments.failed_24h >= 3, payments.failed_24h > 0)} />
                <Kpi label="Pending over 30 min" value={String(payments.pending_stuck)} tone={tone(payments.pending_stuck >= 3, payments.pending_stuck > 0)} sub="Customer started, nothing confirmed" />
                <Kpi label="Need review" value={String(payments.needs_review)} tone={tone(payments.needs_review > 0)} sub="Wrong amount or currency" />
                <Kpi label="Paid, plan not active" value={String(payments.activation_gap_count)} tone={tone(payments.activation_gap_count > 0)} sub="Last 14 days" />
                <Kpi label="Confirmation errors" value={String(payments.webhooks.errors_24h)} tone={tone(payments.webhooks.errors_24h >= 3, payments.webhooks.errors_24h > 0)} sub={`${payments.webhooks.total_24h} checked · last ${when(payments.webhooks.last_webhook_at)}`} />
              </div>
              <h4 className="hc-sub">Paid but the business is not on the plan it paid for</h4>
              <Mini columns={[['business', 'Business'], ['plan_name', 'Plan paid for'], ['subscription_status', 'Now'], ['reference', 'Reference']]} rows={payments.activation_gaps} empty="None. Every recent payment matches an active plan." />
              <h4 className="hc-sub">Pending for over 30 minutes</h4>
              <Mini columns={[['business', 'Business'], ['minutes_pending', 'Minutes'], ['reference', 'Reference']]} rows={payments.stuck} empty="Nothing is stuck." />
            </Panel>
          )}
          {subscriptions && (
            <Panel id="subscriptions" title="Subscriptions" hint="Trials about to end, accounts at risk, and how trials turn into paying customers.">
              <div className="akpi-grid">
                <Kpi label="Trials ending in 48 hours" value={String(subscriptions.trials_ending_48h)} tone={tone(false, subscriptions.trials_ending_48h > 0)} sub="Worth a nudge" />
                <Kpi label="In trial now" value={String(subscriptions.trialing)} />
                <Kpi label="Paying" value={String(subscriptions.active_paid)} />
                <Kpi label="Past due" value={String(subscriptions.past_due)} tone={tone(subscriptions.past_due > 0)} />
                <Kpi label="Expired (7 days)" value={String(subscriptions.expired_7d)} tone={tone(false, subscriptions.expired_7d > 0)} />
                <Kpi label="Cancelled (30 days)" value={String(subscriptions.canceled_30d)} sub={subscriptions.churn_30d_rate === null ? undefined : `${subscriptions.churn_30d_rate}% churn`} />
                <Kpi label="Trial to paid" value={subscriptions.conversion_rate === null ? '—' : `${subscriptions.conversion_rate}%`} sub={`${subscriptions.cohort_converted} of ${subscriptions.cohort_trials_60d} trials, last 60 days`} />
              </div>
              <h4 className="hc-sub">Trials ending soon</h4>
              <Mini columns={[['business', 'Business'], ['hours_left', 'Hours left']]} rows={subscriptions.trials_ending_list} empty="No trials end in the next 48 hours." />
            </Panel>
          )}
        </>
      )}

      <Panel id="functions" title="Functions" hint="Server functions over the last 24 hours. A failing one here is usually a broken feature for someone.">
        {data.functions.length === 0 ? (
          <p className="field-help hc-empty">No function traffic recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Requests</th>
                  <th>Errors</th>
                  <th>Error rate</th>
                  <th>Average</th>
                  <th>Slowest 5%</th>
                </tr>
              </thead>
              <tbody>
                {data.functions.map((fn) => (
                  <tr key={fn.function_name}>
                    <td>{fn.function_name}</td>
                    <td>{fn.requests}</td>
                    <td>{fn.errors}</td>
                    <td>
                      <span className={`admin-pill ${fn.error_rate >= 20 && fn.requests >= 10 ? 'danger' : fn.errors > 0 ? 'warn' : 'success'}`}>{fn.error_rate}%</span>
                    </td>
                    <td>{fn.avg_ms} ms</td>
                    <td>{fn.p95_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel id="capacity" title="Capacity" hint="Plan limits are the quiet risk on a free plan.">
        <div className="akpi-grid">
          <Kpi label="Database used" value={`${used}%`} tone={tone(used >= 85, used >= 70)} sub={`${mb(capacity.db_bytes)} of ${mb(capacity.db_limit_bytes)}`} />
          <Kpi label="Connections" value={`${capacity.connections}/${capacity.max_connections}`} tone={tone(capacity.connections / capacity.max_connections >= 0.8)} />
          <Kpi label="File storage" value={mb(capacity.storage_bytes)} />
          <Kpi label="Registered accounts" value={capacity.auth_users === null ? 'Not available' : capacity.auth_users.toLocaleString('en-NG')} />
          <Kpi label="Since last activity" value={capacity.hours_since_activity === null ? '—' : `${Math.round(capacity.hours_since_activity)} h`} tone={tone((capacity.hours_since_activity ?? 0) >= 120)} sub="Free projects pause after about 7 days idle" />
        </div>
        <div className="hc-bar" role="img" aria-label={`Database ${used}% full`}>
          <span style={{ width: `${Math.min(used, 100)}%` }} className={used >= 85 ? 'bad' : used >= 70 ? 'warn' : ''} />
        </div>
        <h4 className="hc-sub">Largest tables</h4>
        <Mini columns={[['table_name', 'Table'], ['size', 'Size']]} rows={capacity.top_tables.map((t) => ({ table_name: t.table_name, size: mb(t.bytes) }))} empty="No tables yet." />
        <p className="field-help hc-empty">
          Bandwidth use and the date of the last backup cannot be read from here. Check them in the hosting dashboard; the free plan does not include point-in-time recovery.
        </p>
      </Panel>

      <Panel id="security" title="Security" hint="Sign-in pressure, admin safety and unusual deletions.">
        <div className="akpi-grid">
          <Kpi label="Rate-limit hits (24 h)" value={String(security.throttle_total_24h)} tone={tone(security.throttle_total_24h >= 200, security.throttle_total_24h >= 50)} />
          <Kpi label="Admins without 2-step" value={security.admins_without_mfa === null ? 'Not available' : String(security.admins_without_mfa)} tone={tone((security.admins_without_mfa ?? 0) > 0)} />
          <Kpi label="Admin actions (24 h)" value={String(security.admin_actions_24h)} />
          <Kpi label="Sensitive admin actions" value={String(security.admin_sensitive_24h)} tone={tone(false, security.admin_sensitive_24h >= 10)} sub="Deletes, grants, plan changes" />
        </div>
        {security.admins_without_mfa_list.length > 0 && <p className="field-help hc-empty">Without 2-step sign-in: {security.admins_without_mfa_list.join(', ')}</p>}
        <h4 className="hc-sub">Where sign-in attempts were limited</h4>
        <Mini columns={[['bucket', 'Area'], ['hits', 'Hits']]} rows={security.throttle_buckets} empty="No rate limiting in the last 24 hours." />
        <h4 className="hc-sub">Businesses deleting a lot (15 or more in 24 hours)</h4>
        <Mini columns={[['business', 'Business'], ['deletes', 'Deletions']]} rows={security.bulk_delete_businesses} empty="No unusual deletions." />
      </Panel>

      <Panel id="integrity" title="Data checks" hint="Records that disagree with each other. Each one is a bug or a bad edit worth a look.">
        <div className="akpi-grid">
          <Kpi label="Sale total ≠ items (30 d)" value={String(integrity.sale_total_mismatch_count)} tone={tone(integrity.sale_total_mismatch_count > 0)} />
          <Kpi label="Stock ≠ movements" value={String(integrity.stock_mismatch_count)} tone={tone(false, integrity.stock_mismatch_count > 0)} sub="Older products can differ" />
          <Kpi label="Sales without items (30 d)" value={String(integrity.sales_without_items)} tone={tone(integrity.sales_without_items > 0, false)} />
          <Kpi label="Sales synced (24 h)" value={String(integrity.sale_syncs_24h)} sub={`${integrity.customer_syncs_24h} customers`} />
          <Kpi label="Sync failures (24 h)" value={String(integrity.sync_failures_24h)} tone={tone(integrity.sync_failures_24h >= 5, integrity.sync_failures_24h > 0)} sub="From phones working offline" />
        </div>
        <h4 className="hc-sub">Sales whose total does not match their items</h4>
        <Mini columns={[['business', 'Business'], ['recorded', 'Recorded'], ['from_items', 'From items'], ['sale_id', 'Sale']]} rows={integrity.sale_total_mismatch} empty="Every recent sale adds up." />
        <h4 className="hc-sub">Stock that differs from its recorded movements</h4>
        <Mini columns={[['business', 'Business'], ['product', 'Product'], ['shown', 'Shown'], ['from_movements', 'From movements']]} rows={integrity.stock_mismatch} empty="Stock matches its history." />
      </Panel>

      <Panel id="customers" title="Customer health" hint="Who is drifting away, who never got started, and who is waiting on you.">
        <div className="akpi-grid">
          <Kpi label="Quiet 7–13 days" value={String(customers.silent_7_13)} tone={tone(false, customers.silent_7_13 > 0)} sub={`of ${customers.total_businesses} businesses`} />
          <Kpi label="Quiet 14–29 days" value={String(customers.silent_14_29)} tone={tone(false, customers.silent_14_29 > 0)} />
          <Kpi label="Quiet 30+ days" value={String(customers.silent_30_plus)} tone={tone(customers.silent_30_plus > 0)} />
          <Kpi label="No products yet" value={String(customers.no_products_count)} sub="Signed up 2–30 days ago" />
          <Kpi label="No sale yet" value={String(customers.no_sales_count)} sub="Has products, no sales" />
          <Kpi label="Support waiting" value={String(customers.support_open)} tone={tone(customers.support_waiting_24h > 0)} sub={customers.support_oldest_wait_hours === null ? 'No one waiting' : `Oldest ${customers.support_oldest_wait_hours} h · ${customers.support_waiting_24h} over 24 h`} />
        </div>
        <div className="admin-overview-columns">
          <div>
            <h4 className="hc-sub">Gone quiet</h4>
            <Mini columns={[['business', 'Business'], ['days_silent', 'Days quiet']]} rows={customers.silent_list} empty="Nobody has gone quiet." />
          </div>
          <div>
            <h4 className="hc-sub">Never added a product</h4>
            <Mini columns={[['business', 'Business'], ['days_since_signup', 'Days since signup']]} rows={customers.no_products} empty="Everyone added products." />
          </div>
          <div>
            <h4 className="hc-sub">Have products, no sale</h4>
            <Mini columns={[['business', 'Business'], ['days_since_signup', 'Days since signup']]} rows={customers.no_sales} empty="Everyone recorded a sale." />
          </div>
        </div>
      </Panel>

      <Panel id="app-errors" title="App errors" hint="Crashes and failures seen in people's browsers and phones. Personal details are never recorded.">
        <div className="akpi-grid">
          <Kpi label="Errors (24 h)" value={String(data.app_errors.errors_24h)} tone={tone(data.app_errors.errors_24h >= 50 && data.app_errors.errors_24h >= 2 * data.app_errors.errors_prev_24h, data.app_errors.errors_24h >= 10)} sub={`${data.app_errors.errors_prev_24h} the day before`} />
          <Kpi label="People affected" value={String(data.app_errors.affected_users_24h)} />
          <Kpi label="On phones" value={data.app_errors.mobile_share === null ? '—' : `${data.app_errors.mobile_share}%`} />
        </div>
        <h4 className="hc-sub">Most common</h4>
        <Mini columns={[['message', 'What happened'], ['kind', 'Type'], ['count', 'Times'], ['last_seen', 'Last seen']]} rows={data.app_errors.top.map((row) => ({ ...row, last_seen: when(row.last_seen) }))} empty="No errors reported." />
        <h4 className="hc-sub">By app version</h4>
        <Mini columns={[['version', 'Version'], ['errors', 'Errors']]} rows={data.app_errors.versions} empty="No errors reported." />
      </Panel>

      <Panel id="promoters" title="Promoter checks" hint="Signs of gaming the referral programme.">
        <div className="akpi-grid">
          <Kpi label="Possible self-referrals" value={String(promoters.self_referrals.length)} tone={tone(promoters.self_referrals.length > 0)} />
          <Kpi label="Referral spikes (24 h)" value={String(promoters.referral_spikes.length)} tone={tone(false, promoters.referral_spikes.length > 0)} sub="10 or more in a day" />
          <Kpi label="Payouts waiting 7+ days" value={String(promoters.payouts_waiting_7d)} tone={tone(false, promoters.payouts_waiting_7d > 0)} />
          <Kpi label="Asking more than earned" value={String(promoters.payouts_over_earned.length)} tone={tone(promoters.payouts_over_earned.length > 0)} />
          <Kpi label="Repeated payout references" value={String(promoters.duplicate_payout_references)} tone={tone(promoters.duplicate_payout_references > 0)} />
        </div>
        <h4 className="hc-sub">Possible self-referrals</h4>
        <Mini columns={[['promoter', 'Promoter'], ['business', 'Business']]} rows={promoters.self_referrals} empty="None found." />
        <h4 className="hc-sub">Payout requests above total earned</h4>
        <Mini columns={[['promoter', 'Promoter'], ['requested', 'Requested (₦)'], ['ever_earned', 'Ever earned (₦)']]} rows={promoters.payouts_over_earned} empty="None found." />
        <h4 className="hc-sub">Referral spikes</h4>
        <Mini columns={[['promoter', 'Promoter'], ['referrals_24h', 'Referrals in 24 h']]} rows={promoters.referral_spikes} empty="No spikes." />
      </Panel>
    </>
  )
}
