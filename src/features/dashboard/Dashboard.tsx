import { ArrowRight, Check, Package, Plus, ShieldCheck, ShoppingCart, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Metric, Skeleton } from '../../components/ui'
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
  return <div className="page"><div className="welcome-strip"><div><span className="auth-kicker">Last 30 days · {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>{displayName ? `Welcome back, ${displayName}.` : workerMode ? 'Your shift, in view.' : 'Your business, in view.'}</h1><p className="muted">{workerMode ? 'The tasks and sales you need for today.' : 'A clear read on what needs your attention next.'}</p></div><button className="primary" onClick={() => onNavigate('Sales')}><Plus size={17} /> Record a sale</button></div>{dashboardError && !workerMode && <div className="form-error" role="alert">{dashboardError}</div>}<div className="metrics" aria-busy={dashboardLoading}>{dashboardLoading ? Array.from({ length: workerMode ? 2 : 6 }).map((_, index) => <Skeleton key={index} className="skeleton-card" />) : <>{!workerMode && <><Metric label="Revenue" value={`₦${Number(metrics?.revenue ?? 0).toLocaleString('en-NG')}`} note={`${metrics?.sales_count ?? 0} completed sales`} /><Metric label="COGS" value={`₦${Number(metrics?.cogs ?? 0).toLocaleString('en-NG')}`} note="Historical cost basis" /><Metric label="Gross profit" value={`₦${Number(metrics?.gross_profit ?? 0).toLocaleString('en-NG')}`} note="Revenue less COGS" /><Metric label="Net profit" value={`₦${Number(metrics?.net_profit ?? 0).toLocaleString('en-NG')}`} note="After operating expenses" /></>}<Metric label="Products" value={products.length.toString()} note={products.length ? `${low.length} need attention` : 'Add your first product'} /><Metric label="Customers" value={customers.length.toString()} note={customers.length ? 'In your records' : 'Add your first customer'} /></>}</div><div className="dashboard-grid"><section className="panel spotlight"><div className="panel-heading"><div><span className="section-label">{workerMode ? 'Staff focus' : 'Next best action'}</span><h2>{workerMode ? 'Serve customers with confidence.' : products.length ? 'Keep your records moving.' : 'Start with your catalog.'}</h2></div><ShieldCheck size={20} color="#06d466" /></div><p>{workerMode ? 'Record sales, select customers, and keep receipts ready. Stock and financial controls stay with managers.' : products.length ? 'Your workspace is connected. Add customers and record sales to make your reports useful.' : 'Add the products you sell so sales, stock and receipts can work from the same source of truth.'}</p><div className="action-row"><button className="secondary" onClick={() => onNavigate('Sales')}><ShoppingCart size={16} /> Record sale</button><button className="secondary" onClick={() => onNavigate('Customers')}><Users size={16} /> Find customer</button></div></section><section className="panel"><div className="panel-heading"><div><span className="section-label">Attention</span><h2>Low stock</h2></div><button className="text-btn" onClick={() => onNavigate('Sales')}>Open sales <ArrowRight size={14} /></button></div>{low.length ? low.slice(0, 4).map((product) => <div className="list-row" key={product.id}><span className="row-icon"><Package size={15} /></span><div><strong>{product.name}</strong><small>{product.sku}</small></div><b className="warning-text">{product.stock} left</b></div>) : <div className="quiet-empty">{workerMode ? 'Stock alerts are managed by your manager.' : <><Check size={16} /> No low-stock products yet.</>}</div>}</section></div><section className="panel activity-panel"><div className="panel-heading"><div><span className="section-label">Live activity</span><h2>Recent sales</h2></div><button className="text-btn" onClick={() => onNavigate('Records')}>View all records <ArrowRight size={14} /></button></div>{recentSales.length ? <><div className="activity-list">{recentSales.map((sale) => <div className="list-row" key={sale.id}><span className="row-icon sale"><ShoppingCart size={15} /></span><div><strong>Completed sale</strong><small>{new Date(sale.created_at).toLocaleString('en-NG')}</small></div><b>{workerMode ? 'Recorded' : `₦${Number(sale.total).toLocaleString('en-NG')}`}</b></div>)}</div>{sales.length > recentSales.length && <p className="activity-footnote">Showing the latest {recentSales.length} sales. Open Records to see the full history.</p>}</> : <div className="quiet-empty">No sales recorded yet. Your first completed sale will appear here.</div>}</section></div>
}
