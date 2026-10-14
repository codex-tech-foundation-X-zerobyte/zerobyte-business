import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'

type Overview = {
  currency: string; period_days: number; payments_recorded: number
  revenue: { total: number; today: number; week: number; month: number }
  payment_counts: { successful: number; pending: number; failed: number }
  subscriptions: { active_paid: number; active_free: number; trialing: number; past_due: number; canceled: number; expired: number; new_in_period: number; ended_in_period: number }
  contracted_monthly_value: number
  revenue_by_plan: { plan_code: string; plan_name: string; revenue: number; payments: number }[]
  daily: { day: string; revenue: number; payments: number }[]
  recent: { id: string; organization_name: string; plan_name: string | null; amount: number; currency: string; status: string; provider: string; provider_reference: string; occurred_at: string }[]
}

function naira(amount: number, currency = 'NGN') {
  const symbol = currency === 'NGN' ? '₦' : `${currency} `
  return `${symbol}${Number(amount || 0).toLocaleString('en-NG')}`
}

export function AdminRevenue() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState(30)

  const load = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true); setError('')
    adminSupabase.rpc('admin_get_revenue_overview', { period_days: period }).then(({ data: result, error: rpcError }) => {
      setLoading(false)
      if (rpcError) setError(rpcError.code === 'PGRST202' ? 'Revenue monitoring is not set up yet. Apply the latest Supabase migrations, then refresh.' : rpcError.message)
      else setData(result as Overview)
    })
  }, [period])
  useEffect(() => { load() }, [load])

  if (loading && !data) return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Revenue</h2><p>Loading…</p></div></div><div className="admin-grid admin-summary-grid">{[1, 2, 3, 4].map((item) => <article key={item} className="admin-card admin-card-skeleton"><Skeleton className="skeleton-line short" /><Skeleton className="skeleton-line value" /><Skeleton className="skeleton-line" /></article>)}</div></section>
  if (error) return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Revenue</h2></div></div><div className="form-error" role="alert">{error}</div></section>
  if (!data) return null

  const noPayments = data.payments_recorded === 0
  const maxDaily = Math.max(...data.daily.map((point) => point.revenue), 1)

  return <>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Revenue</h2><p>{noPayments ? 'No payments have been recorded yet — this fills in automatically once Paystack is connected and processing real payments.' : `Figures from ${data.payments_recorded} recorded payment${data.payments_recorded === 1 ? '' : 's'}.`}</p></div><div className="admin-actions-inline"><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><button type="button" className="text-btn" onClick={load}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button></div></div>
      <div className="admin-grid admin-summary-grid">
        <article className="admin-card"><div className="admin-card-label">Revenue today</div><div className="admin-card-value">{naira(data.revenue.today)}</div><p>Successful payments only</p></article>
        <article className="admin-card"><div className="admin-card-label">This week</div><div className="admin-card-value">{naira(data.revenue.week)}</div><p>Since the start of the week</p></article>
        <article className="admin-card"><div className="admin-card-label">This month</div><div className="admin-card-value">{naira(data.revenue.month)}</div><p>Since the 1st</p></article>
        <article className="admin-card"><div className="admin-card-label">All time</div><div className="admin-card-value">{naira(data.revenue.total)}</div><p>{data.payment_counts.successful} successful payment{data.payment_counts.successful === 1 ? '' : 's'}</p></article>
      </div>
    </section>

    <div className="admin-overview-columns">
      <section className="admin-card"><div className="admin-card-header"><div><h3>Payments</h3><p>By status</p></div></div><div className="admin-list"><div className="admin-list-item"><strong>Successful</strong><span>{data.payment_counts.successful}</span></div><div className="admin-list-item"><strong>Pending / processing</strong><span>{data.payment_counts.pending}</span></div><div className="admin-list-item"><strong>Failed / canceled</strong><span>{data.payment_counts.failed}</span></div></div></section>
      <section className="admin-card"><div className="admin-card-header"><div><h3>Subscriptions</h3><p>By status, right now</p></div></div><div className="admin-list"><div className="admin-list-item"><strong>Active (paid)</strong><span>{data.subscriptions.active_paid}</span></div><div className="admin-list-item"><strong>Active (free)</strong><span>{data.subscriptions.active_free}</span></div><div className="admin-list-item"><strong>Trialing</strong><span>{data.subscriptions.trialing}</span></div><div className="admin-list-item"><strong>Past due</strong><span>{data.subscriptions.past_due}</span></div><div className="admin-list-item"><strong>Canceled</strong><span>{data.subscriptions.canceled}</span></div><div className="admin-list-item"><strong>Expired</strong><span>{data.subscriptions.expired}</span></div></div><p className="field-help">New this period: {data.subscriptions.new_in_period} · Ended this period: {data.subscriptions.ended_in_period} · Contracted monthly value of active paid plans: {naira(data.contracted_monthly_value)} (what's on the books, not money collected)</p></section>
    </div>

    <section className="admin-card wide"><div className="admin-card-header"><div><h3>Daily revenue</h3><p>Successful payments over the selected period.</p></div></div>{data.daily.every((point) => point.revenue === 0) ? <p className="admin-empty">No revenue recorded in this period.</p> : <div className="admin-bar-chart">{data.daily.map((point) => <div className="admin-bar-item" key={point.day}><div className="admin-bar-track"><i style={{ height: `${Math.max(2, (point.revenue / maxDaily) * 100)}%` }} /></div><small title={naira(point.revenue)}>{new Date(point.day).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</small></div>)}</div>}</section>

    <section className="admin-card wide"><div className="admin-card-header"><div><h3>Revenue by plan</h3></div></div>{!data.revenue_by_plan.length ? <div className="admin-empty">No successful payments yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Plan</th><th>Revenue</th><th>Payments</th></tr></thead><tbody>{data.revenue_by_plan.map((row) => <tr key={row.plan_code}><td>{row.plan_name}</td><td>{naira(row.revenue)}</td><td>{row.payments}</td></tr>)}</tbody></table></div>}</section>

    <section className="admin-card wide"><div className="admin-card-header"><div><h3>Recent transactions</h3></div></div>{!data.recent.length ? <div className="admin-empty">No transactions recorded yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Organization</th><th>Plan</th><th>Amount</th><th>Status</th><th>Provider</th><th>Reference</th><th>Date</th></tr></thead><tbody>{data.recent.map((row) => <tr key={row.id}><td>{row.organization_name}</td><td>{row.plan_name ?? '—'}</td><td>{naira(row.amount, row.currency)}</td><td><span className={`admin-status ${row.status === 'successful' ? 'active' : row.status === 'failed' ? 'failed' : ''}`}>{row.status}</span></td><td>{row.provider}</td><td className="mono">{row.provider_reference}</td><td>{new Date(row.occurred_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div>}</section>
  </>
}
