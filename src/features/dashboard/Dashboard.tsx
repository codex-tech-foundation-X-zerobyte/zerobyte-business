import { ArrowRight, Check, FileText, Package, Plus, ShoppingCart, Users, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useBranch } from '../workspace/branchContext'
import { Metric, MetricSkeleton, PageIntro } from '../../components/ui'
import { formatNaira } from '../../lib/format'
import { type OfflineScope, readScopedCache, writeScopedCache } from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { localDateIn, shiftDate } from '../../lib/reports'
import { type View } from '../../lib/types'
import { useOrgTimezone } from '../reports/useOrgTimezone'

export function Dashboard({
  orgId,
  scope,
  onNavigate,
  workerMode = false,
  displayName = '',
}: {
  orgId: string
  scope: OfflineScope | null
  onNavigate: (view: View) => void
  workerMode?: boolean
  displayName?: string
}) {
  const { branchId, branches } = useBranch()
  // The Overview answers "how is today going?" first. Days follow the business's own clock (default Africa/Lagos).
  const timezone = useOrgTimezone(orgId)
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('today')
  const [yesterday, setYesterday] = useState<{ revenue: number; sales_count: number } | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(!workerMode)
  const [byBranch, setByBranch] = useState<
    { branch_id: string | null; branch_name: string; revenue: number; sales_count: number }[]
  >([])
  type LowStock = { id: string; name: string; sku: string; stock: number; reorder_point: number | null }
  type Summary = { id: string; productCount: number; customerCount: number; lowTotal: number; low: LowStock[] }
  const [summary, setSummary] = useState<Summary>({
    id: 'summary',
    productCount: 0,
    customerCount: 0,
    lowTotal: 0,
    low: [],
  })
  const [sales, setSales] = useState<{ id: string; total: number; created_at: string }[]>([])
  const [metrics, setMetrics] = useState<{
    revenue: number
    cogs: number
    gross_profit: number
    operating_expenses: number
    net_profit: number
    sales_count: number
  } | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardLoading, setDashboardLoading] = useState(true)
  useEffect(() => {
    let active = true
    // The saved copy (for offline use) is read from the device and can finish AFTER the live data on a fast
    // connection. It must never overwrite live numbers, so it only fills in while the live data has not arrived.
    let liveDataArrived = false
    if (scope && !branchId)
      void Promise.all([
        readScopedCache<Summary>(scope, 'dashboard-summary'),
        readScopedCache<{ id: string; total: number; created_at: string }>(scope, 'recent-sales'),
      ]).then(([cachedSummary, cachedSales]) => {
        if (active && !liveDataArrived) {
          if (cachedSummary[0]) setSummary(cachedSummary[0])
          setSales(cachedSales)
          if (!navigator.onLine) setDashboardLoading(false)
        }
      })
    if (!supabase || !navigator.onLine) {
      setDashboardLoading(false)
      return () => {
        active = false
      }
    }
    // Counts and the handful of low-stock products come from the database; the whole catalogue is never downloaded here.
    void Promise.all([
      (() => {
        const products = supabase
          .from('products')
          .select('id', { count: 'estimated', head: true })
          .eq('organization_id', orgId)
        return branchId ? products.eq('branch_id', branchId) : products
      })(),
      supabase.from('customers').select('id', { count: 'estimated', head: true }).eq('organization_id', orgId),
      (() => {
        const recent = supabase
          .from('sales')
          .select(workerMode ? 'id,created_at' : 'id,total,created_at')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(20)
        return branchId ? recent.eq('branch_id', branchId) : recent
      })(),
      workerMode
        ? Promise.resolve(null)
        : supabase.rpc('get_low_stock_products', { target_org: orgId, max_rows: 4, target_branch: branchId }),
    ])
      .then(async ([p, c, s, lowResult]) => {
        if (!active) return
        liveDataArrived = true
        const lowRows = (lowResult?.data ?? []) as (LowStock & { total_low: number })[]
        const nextSummary: Summary = {
          id: 'summary',
          productCount: p.count ?? 0,
          customerCount: c.count ?? 0,
          lowTotal: lowRows.length ? Number(lowRows[0].total_low) : 0,
          low: lowRows.map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            stock: row.stock,
            reorder_point: row.reorder_point,
          })),
        }
        setSummary(nextSummary)
        setSales((s.data ?? []) as unknown as { id: string; total: number; created_at: string }[])
        if (scope && !branchId) {
          await writeScopedCache(scope, 'dashboard-summary', [nextSummary])
          if (s.data)
            await writeScopedCache(
              scope,
              'recent-sales',
              s.data as unknown as { id: string; total: number; created_at: string }[],
            )
        }
        if (active) setDashboardLoading(false)
      })
      .catch(() => {
        if (active) setDashboardLoading(false)
      })
    return () => {
      active = false
    }
  }, [orgId, scope, workerMode, branchId])
  // The headline numbers for the chosen period. "Today" also fetches yesterday so the owner sees how today compares.
  useEffect(() => {
    if (!supabase || workerMode || !navigator.onLine) {
      setMetricsLoading(false)
      return
    }
    const client = supabase
    let active = true
    setMetricsLoading(true)
    const todayIso = localDateIn(timezone)
    const from = period === 'today' ? todayIso : shiftDate(todayIso, period === '7d' ? -6 : -29)
    const metricsFor = (dateFrom: string, dateTo: string) =>
      client.rpc('get_dashboard_metrics', {
        target_org: orgId,
        date_from: dateFrom,
        date_to: dateTo,
        target_branch: branchId,
      })
    const dayBefore = shiftDate(todayIso, -1)
    void Promise.all([
      metricsFor(from, todayIso),
      period === 'today' ? metricsFor(dayBefore, dayBefore) : Promise.resolve(null),
    ])
      .then(([m, y]) => {
        if (!active) return
        if (m.error) {
          setMetrics(null)
          setDashboardError(
            m.error.code === 'PGRST202'
              ? 'Dashboard reports are not available yet. Apply the latest Supabase migrations, then try again.'
              : 'Dashboard metrics are temporarily unavailable.',
          )
        } else {
          setDashboardError('')
          setMetrics((m.data ?? null) as typeof metrics)
        }
        setYesterday(y && !y.error ? (y.data as { revenue: number; sales_count: number }) : null)
        setMetricsLoading(false)
      })
      .catch(() => {
        if (active) setMetricsLoading(false)
      })
    return () => {
      active = false
    }
  }, [orgId, workerMode, branchId, period, timezone])
  const periodLabel = period === 'today' ? 'Today' : period === '7d' ? 'Last 7 days' : 'Last 30 days'
  // Revenue of each branch over the same period, shown on the Total view only.
  useEffect(() => {
    if (!supabase || workerMode || branchId || branches.length < 2 || !navigator.onLine) return
    let active = true
    const to = localDateIn(timezone)
    const from = period === 'today' ? to : shiftDate(to, period === '7d' ? -6 : -29)
    void Promise.resolve(
      supabase.rpc('get_branch_breakdown', { target_org: orgId, date_from: from, date_to: to }),
    ).then(({ data }) => {
      if (active)
        setByBranch(
          ((data ?? []) as typeof byBranch).map((row) => ({
            ...row,
            revenue: Number(row.revenue),
            sales_count: Number(row.sales_count),
          })),
        )
    })
    return () => {
      active = false
    }
  }, [orgId, workerMode, branchId, branches.length, period, timezone])
  const low = summary.low
  const products = { length: summary.productCount }
  const customers = { length: summary.customerCount }
  const recentSales = sales.slice(0, 6)
  const firstName = displayName.trim().split(/\s+/)[0]
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })
  const money = (value: number | undefined) => formatNaira(value)
  // "Up 12% on yesterday": only on the Today view, and only when yesterday has something to compare with.
  const versusYesterday = (() => {
    if (period !== 'today' || !yesterday || !metrics) return ''
    const before = Number(yesterday.revenue)
    const now = Number(metrics.revenue)
    if (before <= 0) return now > 0 ? ' · yesterday had no sales' : ''
    const change = Math.round(((now - before) / before) * 100)
    return change === 0 ? ' · same as yesterday' : ` · ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on yesterday`
  })()
  // First-run guidance only while something is still missing; a working business should not see a to-do list.
  const setup = workerMode
    ? []
    : [
        { done: products.length > 0, label: 'Add the products you sell', view: 'Inventory' as View, icon: Package },
        { done: customers.length > 0, label: 'Add your customers', view: 'Customers' as View, icon: Users },
        { done: sales.length > 0, label: 'Record your first sale', view: 'Sales' as View, icon: ShoppingCart },
      ]
  // Phone only: the four things people do most, one tap away (the desktop has the sidebar and the header button).
  const quickActions: { label: string; view: View; icon: LucideIcon }[] = workerMode
    ? [
        { label: 'New sale', view: 'Sales', icon: ShoppingCart },
        { label: 'Customers', view: 'Customers', icon: Users },
        { label: 'Receipts', view: 'Receipts', icon: FileText },
      ]
    : [
        { label: 'New sale', view: 'Sales', icon: ShoppingCart },
        { label: 'Add stock', view: 'Inventory', icon: Package },
        { label: 'Invoice', view: 'Invoices', icon: FileText },
        { label: 'Expense', view: 'Expenses', icon: Wallet },
      ]
  const setupOpen = !dashboardLoading && setup.some((step) => !step.done)
  return (
    <div className="page dashboard-page">
      <PageIntro
        label="Overview"
        description={`${firstName ? `Welcome back, ${firstName}. ` : ''}${workerMode ? `Today is ${today}.` : `${periodLabel}.`}`}
        actions={
          <button className="primary" onClick={() => onNavigate('Sales')}>
            <Plus size={17} /> Record a sale
          </button>
        }
      />
      <nav className="quick-actions" aria-label="Quick actions">
        {quickActions.map(({ label, view, icon: Icon }) => (
          <button type="button" key={label} onClick={() => onNavigate(view)}>
            <span aria-hidden="true">
              <Icon size={22} />
            </span>
            {label}
          </button>
        ))}
      </nav>
      {dashboardError && !workerMode && (
        <div className="form-error" role="alert">
          {dashboardError}
        </div>
      )}
      {!workerMode && (
        <div className="segmented period-switch" role="tablist" aria-label="Period">
          {(
            [
              ['today', 'Today'],
              ['7d', '7 days'],
              ['30d', '30 days'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={period === key}
              className={period === key ? 'active' : ''}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="metrics" aria-busy={dashboardLoading || (!workerMode && metricsLoading)}>
        {dashboardLoading || (!workerMode && metricsLoading) ? (
          Array.from({ length: workerMode ? 2 : 4 }).map((_, index) => <MetricSkeleton key={index} />)
        ) : workerMode ? (
          <>
            <Metric
              label="Products"
              value={products.length.toString()}
              note={products.length ? `${summary.lowTotal} running low` : 'None added yet'}
            />
            <Metric
              label="Customers"
              value={customers.length.toString()}
              note={customers.length ? 'In your records' : 'None added yet'}
            />
          </>
        ) : (
          <>
            <Metric
              label="Revenue"
              value={money(metrics?.revenue)}
              note={`${Number(metrics?.sales_count ?? 0).toLocaleString('en-NG')} completed sales${versusYesterday}`}
            />
            <Metric label="Gross profit" value={money(metrics?.gross_profit)} note="Revenue minus cost of goods" />
            <Metric label="Net profit" value={money(metrics?.net_profit)} note="After operating expenses" />
            <Metric label="Cost of goods" value={money(metrics?.cogs)} note="What the stock you sold cost you" />
          </>
        )}
      </div>
      {!branchId && !workerMode && branches.length > 1 && byBranch.length > 0 && (
        <section className="panel branch-revenue" aria-labelledby="branch-revenue-title">
          <div className="panel-heading">
            <h2 id="branch-revenue-title">Revenue by branch</h2>
            <span className="muted">{periodLabel}</span>
          </div>
          <ul className="branch-revenue-list">
            {byBranch.map((row) => {
              const top = Math.max(...byBranch.map((item) => item.revenue), 1)
              return (
                <li key={row.branch_id ?? 'none'}>
                  <span className="branch-revenue-name">{row.branch_name}</span>
                  <span className="branch-revenue-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max((row.revenue / top) * 100, row.revenue > 0 ? 3 : 0)}%` }} />
                  </span>
                  <strong>{money(row.revenue)}</strong>
                  <small>{row.sales_count.toLocaleString('en-NG')} sales</small>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <h2>Recent sales</h2>
            <button className="text-btn" onClick={() => onNavigate('Records')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {recentSales.length ? (
            <>
              <div className="activity-list">
                {recentSales.map((sale) => (
                  <div className="list-row" key={sale.id}>
                    <span className="row-icon sale">
                      <ShoppingCart size={15} />
                    </span>
                    <div>
                      <strong>Sale</strong>
                      <small>
                        {new Date(sale.created_at).toLocaleString('en-NG', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </div>
                    <b className="row-amount">{workerMode ? 'Recorded' : money(sale.total)}</b>
                  </div>
                ))}
              </div>
              {sales.length > recentSales.length && (
                <p className="activity-footnote">
                  Showing the latest {recentSales.length} sales. Open Records for the full history.
                </p>
              )}
            </>
          ) : (
            <div className="quiet-empty">
              {dashboardLoading ? 'Loading…' : 'No sales yet. Your first completed sale will appear here.'}
            </div>
          )}
        </section>
        <div className="dashboard-side">
          {setupOpen && (
            <section className="panel setup-panel">
              <div className="panel-heading">
                <h2>Get started</h2>
                <span className="muted">
                  {setup.filter((step) => step.done).length} of {setup.length} done
                </span>
              </div>
              <div className="setup-list">
                {setup.map((step) => (
                  <button
                    type="button"
                    key={step.label}
                    className={`setup-step${step.done ? ' done' : ''}`}
                    onClick={() => onNavigate(step.view)}
                  >
                    <span className="setup-check">{step.done ? <Check size={14} /> : <step.icon size={14} />}</span>
                    <span>{step.label}</span>
                    {!step.done && <ArrowRight size={14} />}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Running low</h2>
              {!workerMode && (
                <button className="text-btn" onClick={() => onNavigate('Inventory')}>
                  Inventory <ArrowRight size={14} />
                </button>
              )}
            </div>
            {low.length ? (
              low.map((product) => (
                <div className="list-row" key={product.id}>
                  <span className="row-icon">
                    <Package size={15} />
                  </span>
                  <div>
                    <strong>{product.name}</strong>
                    <small>{product.sku}</small>
                  </div>
                  <b className="warning-text">{product.stock} left</b>
                </div>
              ))
            ) : (
              <div className="quiet-empty">
                {workerMode ? (
                  'Stock alerts are managed by your manager.'
                ) : (
                  <>
                    <Check size={16} /> Nothing is running low.
                  </>
                )}
              </div>
            )}
          </section>
          {!workerMode && (
            <section className="panel glance-panel">
              <div className="panel-heading">
                <h2>At a glance</h2>
              </div>
              <button type="button" className="glance-row" onClick={() => onNavigate('Inventory')}>
                <span>Products</span>
                <strong>{products.length}</strong>
              </button>
              <button type="button" className="glance-row" onClick={() => onNavigate('Customers')}>
                <span>Customers</span>
                <strong>{customers.length}</strong>
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
