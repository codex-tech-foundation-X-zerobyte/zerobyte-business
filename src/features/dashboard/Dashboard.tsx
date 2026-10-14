import { ArrowRight, Check, Package, Plus, ShoppingCart, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Metric, PageIntro, Skeleton } from '../../components/ui'
import { formatNaira } from '../../lib/format'
import { type OfflineScope, readScopedCache, writeScopedCache } from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { type CustomerRow, type ProductRow, type View } from '../../lib/types'

export function Dashboard({ orgId, scope, onNavigate, workerMode = false, displayName = '' }: { orgId: string; scope: OfflineScope | null; onNavigate: (view: View) => void; workerMode?: boolean; displayName?: string }) {
  const [products, setProducts] = useState<ProductRow[]>([]); const [customers, setCustomers] = useState<CustomerRow[]>([]); const [sales, setSales] = useState<{ id: string; total: number; created_at: string }[]>([]); const [metrics, setMetrics] = useState<{ revenue: number; cogs: number; gross_profit: number; operating_expenses: number; net_profit: number; sales_count: number } | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardLoading, setDashboardLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (scope) void Promise.all([readScopedCache<ProductRow>(scope, 'products'), readScopedCache<CustomerRow>(scope, 'customers'), readScopedCache<{ id: string; total: number; created_at: string }>(scope, 'recent-sales')]).then(([cachedProducts, cachedCustomers, cachedSales]) => { if (active) { setProducts(cachedProducts); setCustomers(cachedCustomers); setSales(cachedSales); if (!navigator.onLine) setDashboardLoading(false) } })
    if (!supabase || !navigator.onLine) { setDashboardLoading(false); return () => { active = false } }
    const dateTo = new Date().toISOString().slice(0, 10)
    const dateFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
    void Promise.all([
      supabase.from('products').select(workerMode ? 'id,name,sku,stock,price' : 'id,name,sku,stock,price,cost_price,reorder_point').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name,email,phone').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('sales').select(workerMode ? 'id,created_at' : 'id,total,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20),
      workerMode ? Promise.resolve(null) : supabase.rpc('get_dashboard_metrics', { target_org: orgId, date_from: dateFrom, date_to: dateTo, target_branch: null }),
    ]).then(async ([p, c, s, m]) => {
      if (!active) return
      setProducts((p.data ?? []) as unknown as ProductRow[]); setCustomers(c.data ?? []); setSales((s.data ?? []) as unknown as { id: string; total: number; created_at: string }[])
      if (m?.error) {
        setMetrics(null)
        setDashboardError(m.error.code === 'PGRST202' ? 'Dashboard reports are not available yet. Apply the latest Supabase migrations, then try again.' : 'Dashboard metrics are temporarily unavailable.')
      } else {
        setDashboardError('')
        setMetrics((m?.data ?? null) as typeof metrics)
      }
      if (scope) { if (p.data) await writeScopedCache(scope, 'products', p.data as unknown as ProductRow[]); if (c.data) await writeScopedCache(scope, 'customers', c.data); if (s.data) await writeScopedCache(scope, 'recent-sales', s.data as unknown as { id: string; total: number; created_at: string }[]) }
      if (active) setDashboardLoading(false)
    }).catch(() => { if (active) setDashboardLoading(false) })
    return () => { active = false }
  }, [orgId, scope, workerMode])
  const low = products.filter((product) => product.stock <= (product.reorder_point ?? 5))
  const recentSales = sales.slice(0, 6)
  const firstName = displayName.trim().split(/\s+/)[0]
  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })
  const money = (value: number | undefined) => formatNaira(value)
  // First-run guidance only while something is still missing; a working business should not see a to-do list.
  const setup = workerMode ? [] : [
    { done: products.length > 0, label: 'Add the products you sell', view: 'Inventory' as View, icon: Package },
    { done: customers.length > 0, label: 'Add your customers', view: 'Customers' as View, icon: Users },
    { done: sales.length > 0, label: 'Record your first sale', view: 'Sales' as View, icon: ShoppingCart },
  ]
  const setupOpen = !dashboardLoading && setup.some((step) => !step.done)
  return <div className="page dashboard-page">
    <PageIntro label="Overview" description={`${firstName ? `Welcome back, ${firstName}. ` : ''}${workerMode ? `Today is ${today}.` : `Last 30 days, as of ${today}.`}`} actions={<button className="primary" onClick={() => onNavigate('Sales')}><Plus size={17} /> Record a sale</button>} />
    {dashboardError && !workerMode && <div className="form-error" role="alert">{dashboardError}</div>}
    <div className="metrics" aria-busy={dashboardLoading}>{dashboardLoading ? Array.from({ length: workerMode ? 2 : 4 }).map((_, index) => <Skeleton key={index} className="skeleton-card" />) : workerMode ? <>
      <Metric label="Products" value={products.length.toString()} note={products.length ? `${low.length} running low` : 'None added yet'} />
      <Metric label="Customers" value={customers.length.toString()} note={customers.length ? 'In your records' : 'None added yet'} />
    </> : <>
      <Metric label="Revenue" value={money(metrics?.revenue)} note={`${Number(metrics?.sales_count ?? 0).toLocaleString('en-NG')} completed sales`} />
      <Metric label="Gross profit" value={money(metrics?.gross_profit)} note="Revenue minus cost of goods" />
      <Metric label="Net profit" value={money(metrics?.net_profit)} note="After operating expenses" />
      <Metric label="Cost of goods" value={money(metrics?.cogs)} note="What the stock you sold cost you" />
    </>}</div>
    <div className="dashboard-grid">
      <section className="panel activity-panel">
        <div className="panel-heading"><h2>Recent sales</h2><button className="text-btn" onClick={() => onNavigate('Records')}>View all <ArrowRight size={14} /></button></div>
        {recentSales.length ? <>
          <div className="activity-list">{recentSales.map((sale) => <div className="list-row" key={sale.id}>
            <span className="row-icon sale"><ShoppingCart size={15} /></span>
            <div><strong>Sale</strong><small>{new Date(sale.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
            <b className="row-amount">{workerMode ? 'Recorded' : money(sale.total)}</b>
          </div>)}</div>
          {sales.length > recentSales.length && <p className="activity-footnote">Showing the latest {recentSales.length} sales. Open Records for the full history.</p>}
        </> : <div className="quiet-empty">{dashboardLoading ? 'Loading…' : 'No sales yet. Your first completed sale will appear here.'}</div>}
      </section>
      <div className="dashboard-side">
        {setupOpen && <section className="panel setup-panel">
          <div className="panel-heading"><h2>Get started</h2><span className="muted">{setup.filter((step) => step.done).length} of {setup.length} done</span></div>
          <div className="setup-list">{setup.map((step) => <button type="button" key={step.label} className={`setup-step${step.done ? ' done' : ''}`} onClick={() => onNavigate(step.view)}><span className="setup-check">{step.done ? <Check size={14} /> : <step.icon size={14} />}</span><span>{step.label}</span>{!step.done && <ArrowRight size={14} />}</button>)}</div>
        </section>}
        <section className="panel">
          <div className="panel-heading"><h2>Running low</h2>{!workerMode && <button className="text-btn" onClick={() => onNavigate('Inventory')}>Inventory <ArrowRight size={14} /></button>}</div>
          {low.length ? low.slice(0, 4).map((product) => <div className="list-row" key={product.id}>
            <span className="row-icon"><Package size={15} /></span>
            <div><strong>{product.name}</strong><small>{product.sku}</small></div>
            <b className="warning-text">{product.stock} left</b>
          </div>) : <div className="quiet-empty">{workerMode ? 'Stock alerts are managed by your manager.' : <><Check size={16} /> Nothing is running low.</>}</div>}
        </section>
        {!workerMode && <section className="panel glance-panel">
          <div className="panel-heading"><h2>At a glance</h2></div>
          <button type="button" className="glance-row" onClick={() => onNavigate('Inventory')}><span>Products</span><strong>{products.length}</strong></button>
          <button type="button" className="glance-row" onClick={() => onNavigate('Customers')}><span>Customers</span><strong>{customers.length}</strong></button>
        </section>}
      </div>
    </div>
  </div>
}
