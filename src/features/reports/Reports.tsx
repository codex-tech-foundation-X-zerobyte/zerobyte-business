import { BarChart3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Metric, PageIntro, Skeleton, TableSkeleton } from '../../components/ui'
import { supabase } from '../../lib/supabase'

export function Reports({ orgId }: { orgId: string }) {
  const [metrics, setMetrics] = useState<{ revenue: number; cogs: number; gross_profit: number; operating_expenses: number; net_profit: number; sales_count: number } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  useEffect(() => {
    if (!supabase) return
    setError(''); setLoading(true)
    supabase.rpc('get_dashboard_metrics', { target_org: orgId, date_from: dateFrom, date_to: dateTo, target_branch: null }).then(({ data, error: result }) => {
      if (result) {
        setMetrics(null)
        setError(result.code === 'PGRST202' ? 'Reports are not available yet. Apply the latest Supabase migrations, then try again.' : 'Reports are temporarily unavailable.')
      } else {
        setMetrics(data as typeof metrics)
      }
      setLoading(false)
    })
  }, [dateFrom, dateTo, orgId])
  const revenue = Number(metrics?.revenue ?? 0)
  const cogs = Number(metrics?.cogs ?? 0)
  const expenses = Number(metrics?.operating_expenses ?? 0)
  const gross = Number(metrics?.gross_profit ?? 0)
  const net = Number(metrics?.net_profit ?? 0)
  const maxValue = Math.max(revenue, cogs, expenses, gross, net, 1)
  const setPreset = (days: number) => { const end = new Date(); setDateTo(end.toISOString().slice(0, 10)); setDateFrom(new Date(end.getTime() - days * 86400000).toISOString().slice(0, 10)) }
  return <div className="page reports-page"><PageIntro label="Reports" title="Understand the signal." description="A server-calculated view of sales performance, cost of goods, and operating expenses." /><section className="panel report-toolbar"><div><span className="section-label">Reporting period</span><strong>{new Date(`${dateFrom}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} — {new Date(`${dateTo}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div><div className="report-presets" aria-label="Quick reporting periods"><button className="text-btn" onClick={() => setPreset(6)}>7 days</button><button className="text-btn" onClick={() => setPreset(29)}>30 days</button><button className="text-btn" onClick={() => setPreset(364)}>12 months</button></div><div className="report-date-fields"><label>From<input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} min={dateFrom} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDateTo(event.target.value)} /></label></div></section>{error && <div className="form-error" role="alert">{error}</div>}<div className="metrics report-metrics" aria-busy={loading}>{loading ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="skeleton-card" />) : <><Metric label="Revenue" value={`₦${revenue.toLocaleString('en-NG')}`} note={`${metrics?.sales_count ?? 0} completed sales`} /><Metric label="COGS" value={`₦${cogs.toLocaleString('en-NG')}`} note="Historical sale costs" /><Metric label="Gross profit" value={`₦${gross.toLocaleString('en-NG')}`} note="Revenue less COGS" /><Metric label="Operating expenses" value={`₦${expenses.toLocaleString('en-NG')}`} note="Recorded expenses" /></>}</div>{loading ? <div className="panel report-breakdown"><TableSkeleton rows={5} /></div> : <div className="report-grid"><section className="panel report-breakdown"><div className="panel-heading"><div><span className="section-label">Financial shape</span><h2>Where the money moved</h2></div><BarChart3 size={20} color="#06d466" /></div><div className="report-bars">{[['Revenue', revenue, 'revenue'], ['COGS', cogs, 'cogs'], ['Expenses', expenses, 'expenses'], ['Net profit', net, 'profit']].map(([label, value, tone]) => <div className="report-bar-row" key={label as string}><div><span>{label}</span><strong>₦{Number(value).toLocaleString('en-NG')}</strong></div><div className="report-bar-track"><i className={`report-bar ${tone}`} style={{ width: `${Math.max((Math.abs(Number(value)) / maxValue) * 100, Number(value) > 0 ? 2 : 0)}%` }} /></div></div>)}</div><p className="report-caption">Bars are scaled against the largest value in this period. All figures come from completed records.</p></section><section className="panel report-profit"><span className="section-label">Bottom line</span><h2>Net profit</h2><strong>₦{net.toLocaleString('en-NG')}</strong><p>Revenue minus historical COGS and operating expenses.</p><div className={net >= 0 ? 'profit-status positive' : 'profit-status negative'}>{net >= 0 ? 'Positive result' : 'Needs attention'}</div></section></div>}</div>
}
