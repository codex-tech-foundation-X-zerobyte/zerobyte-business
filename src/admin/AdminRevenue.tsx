import { useCallback, useEffect, useState } from 'react'
import { HeaderActions, PeriodTabs } from './HeaderActions'
import { RefreshCw } from 'lucide-react'
import { DonutChart } from '../components/charts'
import { Skeleton } from '../components/ui'
import { BarChart, Kpi } from './AdminCharts'
import { adminSupabase } from '../lib/supabase'

type Overview = {
  currency: string
  period_days: number
  payments_recorded: number
  revenue: { total: number; today: number; week: number; month: number }
  payment_counts: { successful: number; pending: number; failed: number; abandoned: number; needs_review: number }
  subscriptions: {
    active_paid: number
    active_free: number
    trialing: number
    past_due: number
    canceled: number
    expired: number
    new_in_period: number
    ended_in_period: number
  }
  contracted_monthly_value: number
  revenue_by_plan: { plan_code: string; plan_name: string; revenue: number; payments: number }[]
  daily: { day: string; revenue: number; payments: number }[]
  recent: {
    id: string
    organization_name: string
    plan_name: string | null
    amount: number
    currency: string
    status: string
    provider: string
    provider_reference: string
    occurred_at: string
  }[]
}

/** Fills anything the database left out, so an older or partial answer shows zeros instead of crashing the page. */
function normalizeOverview(raw: unknown): Overview {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Overview>
  const rows = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
  return {
    currency: source.currency ?? 'NGN',
    period_days: source.period_days ?? 30,
    payments_recorded: source.payments_recorded ?? 0,
    revenue: { total: 0, today: 0, week: 0, month: 0, ...(source.revenue ?? {}) },
    payment_counts: {
      successful: 0,
      pending: 0,
      failed: 0,
      abandoned: 0,
      needs_review: 0,
      ...(source.payment_counts ?? {}),
    },
    subscriptions: {
      active_paid: 0,
      active_free: 0,
      trialing: 0,
      past_due: 0,
      canceled: 0,
      expired: 0,
      new_in_period: 0,
      ended_in_period: 0,
      ...(source.subscriptions ?? {}),
    },
    contracted_monthly_value: source.contracted_monthly_value ?? 0,
    revenue_by_plan: rows<Overview['revenue_by_plan'][number]>(source.revenue_by_plan),
    daily: rows<Overview['daily'][number]>(source.daily),
    recent: rows<Overview['recent'][number]>(source.recent),
  }
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
    setLoading(true)
    setError('')
    adminSupabase
      .rpc('admin_get_revenue_overview', { period_days: period })
      .then(({ data: result, error: rpcError }) => {
        setLoading(false)
        if (rpcError)
          setError(
            rpcError.code === 'PGRST202'
              ? 'Revenue monitoring is not set up yet. Apply the latest Supabase migrations, then refresh.'
              : rpcError.message,
          )
        else setData(normalizeOverview(result))
      })
  }, [period])
  useEffect(() => {
    load()
  }, [load])

  if (loading && !data)
    return (
      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h2>Revenue</h2>
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
  if (error)
    return (
      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h2>Revenue</h2>
          </div>
        </div>
        <div className="form-error" role="alert">
          {error}
        </div>
      </section>
    )
  if (!data) return null

  const noPayments = data.payments_recorded === 0

  return (
    <>
      <HeaderActions>
        <PeriodTabs
          value={period}
          label="Revenue period"
          onChange={setPeriod}
          options={[
            { value: 7, full: 'Last 7 days', short: '7d' },
            { value: 30, full: 'Last 30 days', short: '30d' },
            { value: 90, full: 'Last 90 days', short: '90d' },
          ]}
        />
        <button type="button" className="secondary" onClick={load}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </HeaderActions>
      {noPayments && (
        <div className="av-banner">
          <p>
            No payments have been recorded yet. This fills in automatically once Paystack is connected and processing
            real payments.
          </p>
        </div>
      )}
      <section className="rev-top">
        <div className="akpi-grid rev-tiles">
          <Kpi
            label="Revenue today"
            value={naira(data.revenue.today)}
            sub="Successful payments only"
            accent="var(--chart-1)"
            trend={data.daily.slice(-14).map((point) => point.revenue)}
          />
          <Kpi
            label="This week"
            value={naira(data.revenue.week)}
            sub="Since the start of the week"
            accent="var(--chart-2)"
            trend={data.daily.slice(-7).map((point) => point.revenue)}
          />
          <Kpi
            label="This month"
            value={naira(data.revenue.month)}
            sub="Since the 1st"
            accent="var(--chart-3)"
            trend={data.daily.map((point) => point.revenue)}
          />
          <Kpi
            label="All time"
            value={naira(data.revenue.total)}
            sub={`${data.payment_counts.successful} successful payment${data.payment_counts.successful === 1 ? '' : 's'}`}
          />
        </div>
      </section>

      <div className="admin-overview-columns">
        <section className="admin-card rev-panel">
          <div className="admin-card-header">
            <div>
              <h3>Payments</h3>
              <p>By status</p>
            </div>
          </div>
          <div className="rev-donut">
            <DonutChart
              size={150}
              thickness={16}
              slices={[
                { label: 'Successful', value: data.payment_counts.successful },
                { label: 'Pending', value: data.payment_counts.pending },
                { label: 'Failed', value: data.payment_counts.failed },
                { label: 'Abandoned', value: data.payment_counts.abandoned ?? 0 },
                { label: 'Needs review', value: data.payment_counts.needs_review ?? 0 },
              ]}
              centerValue={String(
                Object.values(data.payment_counts).reduce((sum, count) => sum + Number(count ?? 0), 0),
              )}
              centerLabel="payments"
            />
          </div>
          <p className="field-help rev-note">
            Needs review means an amount mismatch or a refund. Abandoned means the customer never paid.
          </p>
        </section>
        <section className="admin-card rev-panel">
          <div className="admin-card-header">
            <div>
              <h3>Subscriptions</h3>
              <p>By status, right now</p>
            </div>
          </div>
          <div className="rev-donut">
            <DonutChart
              size={150}
              thickness={16}
              slices={[
                { label: 'Active (paid)', value: data.subscriptions.active_paid },
                { label: 'Active (free)', value: data.subscriptions.active_free },
                { label: 'Trialing', value: data.subscriptions.trialing },
                { label: 'Past due', value: data.subscriptions.past_due },
                { label: 'Canceled', value: data.subscriptions.canceled },
                { label: 'Expired', value: data.subscriptions.expired },
              ]}
              centerValue={String(
                data.subscriptions.active_paid + data.subscriptions.active_free + data.subscriptions.trialing,
              )}
              centerLabel="in use"
            />
          </div>
          <p className="field-help rev-note">
            New this period: {data.subscriptions.new_in_period} · Ended this period:{' '}
            {data.subscriptions.ended_in_period} · Contracted monthly value of active paid plans:{' '}
            {naira(data.contracted_monthly_value)} (what is on the books, not money collected)
          </p>
        </section>
      </div>

      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h3>Daily revenue</h3>
            <p>Successful payments over the selected period.</p>
          </div>
        </div>
        <BarChart
          labels={data.daily.map((point) =>
            new Date(point.day).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
          )}
          values={data.daily.map((point) => point.revenue)}
          format={(value) => naira(value)}
          name="Revenue"
          height={200}
        />
      </section>

      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h3>Revenue by plan</h3>
          </div>
        </div>
        {!data.revenue_by_plan.length ? (
          <div className="admin-empty">No successful payments yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Revenue</th>
                  <th>Payments</th>
                </tr>
              </thead>
              <tbody>
                {data.revenue_by_plan.map((row) => (
                  <tr key={row.plan_code}>
                    <td>{row.plan_name}</td>
                    <td>{naira(row.revenue)}</td>
                    <td>{row.payments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h3>Recent transactions</h3>
          </div>
        </div>
        {!data.recent.length ? (
          <div className="admin-empty">No transactions recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Reference</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.id}>
                    <td>{row.organization_name}</td>
                    <td>{row.plan_name ?? '—'}</td>
                    <td>{naira(row.amount, row.currency)}</td>
                    <td>
                      <span
                        className={`admin-status ${row.status === 'successful' ? 'active' : row.status === 'failed' ? 'failed' : ''}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>{row.provider}</td>
                    <td className="mono">{row.provider_reference}</td>
                    <td>{new Date(row.occurred_at).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
