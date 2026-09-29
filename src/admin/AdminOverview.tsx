import { useEffect, useState } from 'react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { type AdminSection } from './types'

const stats = [
  { label: 'Registered users', key: 'users', detail: 'Accounts registered in Supabase Auth.' },
  { label: 'Organizations', key: 'organizations', detail: 'Businesses created in the shared backend.' },
  { label: 'Branches', key: 'branches', detail: 'Active and archived branches across organizations.' },
  { label: 'Employees', key: 'employees', detail: 'Employee profiles across the platform.' },
  { label: 'Products', key: 'products', detail: 'Products currently tracked by businesses.' },
  { label: 'Customers', key: 'customers', detail: 'Customer records across organizations.' },
  { label: 'Sales', key: 'sales', detail: 'Recorded business sales transactions.' },
  { label: 'Invoices', key: 'invoices', detail: 'Invoices created by businesses.' },
  { label: 'Expenses', key: 'expenses', detail: 'Recorded business expenses.' },
]

export function AdminOverview({ onOpenSection }: { onOpenSection: (section: AdminSection) => void }) {
  const [overview, setOverview] = useState<Record<string, number> | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [analyticsPeriod, setAnalyticsPeriod] = useState('30d')
  const [analytics, setAnalytics] = useState<{ label: string; users: number; organizations: number; sales: number; revenue: number; expenses: number }[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(true)

  useEffect(() => {
    if (!adminSupabase) return
    adminSupabase.rpc('get_platform_overview').then(({ data, error }) => {
      if (error) {
        setOverviewError(error.message.includes('does not exist') ? 'Apply the platform-admin migration in Supabase, then refresh.' : error.message)
        return
      }
      setOverview((data ?? {}) as Record<string, number>)
    })
  }, [])
  useEffect(() => {
    if (!adminSupabase) return
    setAnalyticsLoading(true)
    adminSupabase.rpc('get_platform_analytics', { period_key: analyticsPeriod }).then(({ data, error }) => {
      setAnalyticsLoading(false)
      if (error) {
        setOverviewError(error.message.includes('does not exist') ? 'Apply the platform analytics migration in Supabase, then refresh.' : error.message)
        return
      }
      setAnalytics((data?.points ?? []) as typeof analytics)
    })
  }, [analyticsPeriod])

  const chartItems = stats.filter((stat) => stat.key).slice(0, 7)
  const maxValue = Math.max(...chartItems.map((stat) => overview?.[stat.key ?? ''] ?? 0), 1)
  const maxTrend = Math.max(...analytics.map((point) => Math.max(point.users, point.organizations, point.sales)), 1)
  return <>
    {overviewError && <div className="form-error" role="alert">{overviewError}</div>}
    {overview ? <div className="admin-grid admin-summary-grid">{['users', 'organizations', 'sales', 'products'].map((key) => <article key={key} className="admin-card"><div className="admin-card-label">{key}</div><div className="admin-card-value">{(overview[key] ?? 0).toLocaleString()}</div><p>Current platform total</p></article>)}</div> : <div className="admin-grid admin-summary-grid">{[1, 2, 3, 4].map((item) => <article key={item} className="admin-card admin-card-skeleton"><Skeleton className="skeleton-line short" /><Skeleton className="skeleton-line value" /><Skeleton className="skeleton-line" /></article>)}</div>}
    <section className="admin-card admin-trend-card"><div className="admin-card-header"><div><h2>Platform growth</h2><p>New users, organizations, and sales recorded over time.</p></div><div className="admin-chart-controls"><select value={analyticsPeriod} onChange={(event) => setAnalyticsPeriod(event.target.value)} aria-label="Analytics period"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="12m">Last 12 months</option><option value="5y">Last 5 years</option></select><span className="admin-pill success">{analyticsLoading ? 'Updating' : 'Live data'}</span></div></div>{analyticsLoading ? <div className="admin-line-skeleton"><Skeleton /><Skeleton /><Skeleton /></div> : <div className="admin-trend-chart"><div className="admin-trend-grid"><i /><i /><i /><i /></div><svg viewBox="0 0 1000 280" preserveAspectRatio="none" aria-label="Platform growth chart"><polyline points={analytics.map((point, index) => `${analytics.length === 1 ? 500 : index / (analytics.length - 1) * 1000},${270 - point.users / maxTrend * 220}`).join(' ')} /><polyline className="org-line" points={analytics.map((point, index) => `${analytics.length === 1 ? 500 : index / (analytics.length - 1) * 1000},${270 - point.organizations / maxTrend * 220}`).join(' ')} /><polyline className="sales-line" points={analytics.map((point, index) => `${analytics.length === 1 ? 500 : index / (analytics.length - 1) * 1000},${270 - point.sales / maxTrend * 220}`).join(' ')} /></svg><div className="admin-trend-labels">{analytics.filter((_, index) => index === 0 || index === analytics.length - 1 || index % Math.max(1, Math.floor(analytics.length / 5)) === 0).map((point) => <span key={point.label}>{point.label}</span>)}</div></div>}<div className="admin-chart-legend"><span><i className="users-dot" /> Users</span><span><i className="org-dot" /> Organizations</span><span><i className="sales-dot" /> Sales</span></div></section>
    <div className="admin-overview-columns">
      <section className="admin-card admin-chart-card"><div className="admin-card-header"><div><h2>Platform footprint</h2><p>Current records by operational area.</p></div><span className="admin-pill success">{overview ? 'Live data' : 'Connecting'}</span></div>{overview ? <div className="admin-bar-chart">{chartItems.map((stat) => <div className="admin-bar-item" key={stat.label}><div className="admin-bar-track"><i style={{ height: `${Math.max(6, ((overview[stat.key ?? ''] ?? 0) / maxValue) * 100)}%` }} /></div><strong>{(overview[stat.key ?? ''] ?? 0).toLocaleString()}</strong><small>{stat.label}</small></div>)}</div> : <div className="admin-chart-skeleton"><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>}</section>
      <section className="admin-card admin-brief-card"><div className="admin-card-header"><div><h2>Platform monitoring</h2><p>{overview ? 'Live counts from the shared Supabase backend.' : 'Preparing the platform overview.'}</p></div></div><div className="admin-list">{(['Users', 'Organizations', 'Branches', 'Inventory', 'Sales', 'Revenue', 'Notifications'] as AdminSection[]).map((name) => <div key={name} className="admin-list-item"><div><strong>{name}</strong><p>Open the live administrative view.</p></div><button className="text-btn" onClick={() => onOpenSection(name)}>Open</button></div>)}</div></section>
    </div>
  </>
}
