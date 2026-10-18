import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { formatNaira } from '../lib/format'
import { adminSupabase } from '../lib/supabase'
import { BarChart, compact, delta, Funnel, HBars, Kpi, LineChart } from './AdminCharts'

type Day<T> = { day: string } & T
export type Analytics = {
  generated_at: string; period_days: number
  visitors: { today: number; yesterday: number; page_views_today: number; period_visitor_days: number; period_page_views: number; series: Day<{ visitors: number; page_views: number }>[]; top_pages: { path: string; views: number; visitors: number }[]; top_referrers: { host: string; visitors: number }[]; devices: { device: string; visitors: number }[]; promoter_codes: { ref_code: string; visitors: number }[] }
  users: { total: number; new_today: number; new_7d: number; new_30d: number; dau: number; wau: number; mau: number; retention_week1: number | null; series: Day<{ signups: number; active: number }>[] }
  businesses: { total: number; new_7d: number; new_30d: number; active_7d: number; active_30d: number; with_first_sale: number; series: Day<{ businesses: number }>[] }
  sales: { count_today: number; volume_today: number; count_period: number; volume_period: number; series: Day<{ sales: number; volume: number }>[]; top_businesses: { name: string; sales: number; volume: number }[] }
  funnel: { visitors: number; signups: number; businesses: number; first_sale: number; paid: number }
  plans: { plan: string; businesses: number }[]
  revenue?: { collected_period: number; collected_month: number; contracted_monthly: number; paying_businesses: number; needs_review: number; failed_period: number; series: Day<{ amount: number }>[] }
  security?: { admins_active: number; admins_suspended: number; by_role: { role: string; n: number }[]; admin_actions_24h: number; recent_actions: { action: string; target_type: string | null; actor_role: string | null; created_at: string }[]; blocked_logins_24h: number; unverified_payments: number }
}

export function useAdminAnalytics(days: number) {
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!adminSupabase) return
    setLoading(true)
    const { data: result, error: failure } = await adminSupabase.rpc('admin_get_analytics', { period_days: days })
    if (failure) setError(failure.code === 'PGRST202' || failure.message.includes('does not exist') ? 'Apply the latest Supabase migration (admin_analytics) to see analytics.' : failure.message)
    else { setError(''); setData(result as Analytics) }
    setLoading(false)
  }, [days])
  useEffect(() => { void load() }, [load])
  return { data, error, loading, reload: load }
}

const short = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
const pct = (part: number, whole: number) => whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–'
const num = (value: number) => value.toLocaleString('en-NG')
const ngn = (value: number) => formatNaira(Math.round(value))

// The row of "what is happening today" cards, shared by the Overview and the Analytics page.
export function AnalyticsKpis({ data, onOpen }: { data: Analytics; onOpen?: (section: 'Analytics' | 'Revenue') => void }) {
  const { visitors, users, businesses, sales, revenue } = data
  return <div className="akpi-grid">
    <Kpi label="Visitors today" value={num(visitors.today)} sub={delta(visitors.today, visitors.yesterday)} tone={visitors.today >= visitors.yesterday ? 'good' : 'warn'} onClick={onOpen && (() => onOpen('Analytics'))} />
    <Kpi label="Page views today" value={num(visitors.page_views_today)} sub={`${num(visitors.period_page_views)} in ${data.period_days} days`} />
    <Kpi label="New sign-ups today" value={num(users.new_today)} sub={`${num(users.new_7d)} this week`} />
    <Kpi label="Active users today" value={num(users.dau)} sub={`${num(users.wau)} this week · ${num(users.mau)} this month`} />
    <Kpi label="Active businesses (7 days)" value={num(businesses.active_7d)} sub={`of ${num(businesses.total)} total`} />
    <Kpi label="Sales today" value={num(sales.count_today)} sub={ngn(sales.volume_today)} />
    {revenue && <Kpi label="Collected this month" value={ngn(revenue.collected_month)} sub={`${num(revenue.paying_businesses)} paying business${revenue.paying_businesses === 1 ? '' : 'es'}`} tone="good" onClick={onOpen && (() => onOpen('Revenue'))} />}
    {revenue && <Kpi label="Payments to review" value={num(revenue.needs_review)} sub={revenue.needs_review ? 'Amount mismatch: refund in Paystack' : 'Nothing waiting'} tone={revenue.needs_review ? 'bad' : 'good'} onClick={onOpen && (() => onOpen('Revenue'))} />}
  </div>
}

export function AdminAnalytics({ onOpenSection }: { onOpenSection?: (section: 'Revenue') => void }) {
  const [days, setDays] = useState(30)
  const { data, error, loading, reload } = useAdminAnalytics(days)
  if (loading && !data) return <div className="akpi-grid">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="skeleton-card" />)}</div>
  return <>
    <section className="admin-card wide analytics-head">
      <div className="admin-card-header"><div><h2>Analytics</h2><p>Visitors, people, businesses and sales across the platform. Updated {data ? new Date(data.generated_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '…'}.</p></div>
        <div className="admin-actions-inline"><select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><button type="button" className="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh'}</button></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
    {data && <>
      <AnalyticsKpis data={data} onOpen={(section) => section === 'Revenue' && onOpenSection?.('Revenue')} />
      <div className="admin-grid analytics-two">
        <section className="admin-card"><div className="admin-card-header"><div><h2>Visitors</h2><p>Unique visitors per day and total page views. Counted without cookies or IP addresses.</p></div></div>
          <LineChart labels={data.visitors.series.map((point) => short(point.day))} series={[{ label: 'Visitors', color: 'var(--brand)', values: data.visitors.series.map((point) => point.visitors) }, { label: 'Page views', color: '#60a5fa', values: data.visitors.series.map((point) => point.page_views) }]} /></section>
        <section className="admin-card"><div className="admin-card-header"><div><h2>Sign-ups and active users</h2><p>New accounts and people who opened the app each day.</p></div></div>
          <LineChart labels={data.users.series.map((point) => short(point.day))} series={[{ label: 'New sign-ups', color: '#f59e0b', values: data.users.series.map((point) => point.signups) }, { label: 'Active users', color: 'var(--brand)', values: data.users.series.map((point) => point.active) }]} /></section>
        <section className="admin-card"><div className="admin-card-header"><div><h2>Sales on the platform</h2><p>{num(data.sales.count_period)} sales worth {ngn(data.sales.volume_period)} recorded by businesses. This is their sales, not your revenue.</p></div></div>
          <BarChart labels={data.sales.series.map((point) => short(point.day))} values={data.sales.series.map((point) => Number(point.volume))} format={(value) => value >= 1000 ? `₦${compact(value)}` : `₦${Math.round(value)}`} name="Sales value" /></section>
        <section className="admin-card"><div className="admin-card-header"><div><h2>New businesses</h2><p>{num(data.businesses.new_30d)} created in 30 days · {pct(data.businesses.with_first_sale, data.businesses.total)} have recorded a sale.</p></div></div>
          <BarChart labels={data.businesses.series.map((point) => short(point.day))} values={data.businesses.series.map((point) => point.businesses)} color="#f59e0b" name="New businesses" /></section>
      </div>
      <section className="admin-card wide"><div className="admin-card-header"><div><h2>From visitor to paying customer</h2><p>Over the last {days} days. Visitors are daily unique counts, so the same person on two days counts twice.</p></div></div>
        <Funnel steps={[{ label: 'Visitors', value: data.funnel.visitors }, { label: 'Signed up', value: data.funnel.signups }, { label: 'Created a business', value: data.funnel.businesses }, { label: 'Recorded a first sale', value: data.funnel.first_sale }, ...(data.revenue ? [{ label: 'Paid for a plan', value: data.funnel.paid }] : [])]} /></section>
      <div className="admin-grid analytics-three">
        <section className="admin-card"><div className="admin-card-header"><h2>Top pages</h2></div><HBars items={data.visitors.top_pages.map((page) => ({ label: page.path === '/' ? 'Home' : page.path, value: page.views, note: `${num(page.visitors)} visitors` }))} empty="Visits appear once people open your site." /></section>
        <section className="admin-card"><div className="admin-card-header"><h2>Where visitors come from</h2></div><HBars items={data.visitors.top_referrers.map((item) => ({ label: item.host, value: item.visitors }))} empty="No referrers yet." /></section>
        <section className="admin-card"><div className="admin-card-header"><h2>Devices</h2></div><HBars items={data.visitors.devices.map((item) => ({ label: item.device[0].toUpperCase() + item.device.slice(1), value: item.visitors }))} empty="No visits yet." /></section>
        <section className="admin-card"><div className="admin-card-header"><h2>Promoter links</h2><p>Visits that arrived through a promoter code.</p></div><HBars items={data.visitors.promoter_codes.map((item) => ({ label: item.ref_code, value: item.visitors }))} empty="No promoter visits yet." /></section>
        <section className="admin-card"><div className="admin-card-header"><h2>Top businesses by sales</h2><p>Last {days} days.</p></div><HBars items={data.sales.top_businesses.map((item) => ({ label: item.name, value: Number(item.volume), note: `${num(item.sales)} sales` }))} format={(value) => ngn(value)} empty="No sales yet." /></section>
        <section className="admin-card"><div className="admin-card-header"><h2>Plans in use</h2><p>Active and trial subscriptions.</p></div><HBars items={data.plans.map((item) => ({ label: item.plan, value: item.businesses }))} empty="No subscriptions yet." /></section>
      </div>
      <section className="admin-card wide"><div className="admin-card-header"><div><h2>Engagement</h2><p>How often people come back.</p></div></div>
        <div className="akpi-grid compact"><Kpi label="Daily active" value={num(data.users.dau)} /><Kpi label="Weekly active" value={num(data.users.wau)} /><Kpi label="Monthly active" value={num(data.users.mau)} /><Kpi label="Stickiness (daily ÷ monthly)" value={pct(data.users.dau, data.users.mau)} /><Kpi label="Week-one return" value={data.users.retention_week1 == null ? '–' : `${data.users.retention_week1}%`} sub="of people who joined 8 to 14 days ago" /><Kpi label="Total accounts" value={num(data.users.total)} /></div></section>
      {data.revenue && <section className="admin-card wide"><div className="admin-card-header"><div><h2>Revenue</h2><p>Money actually collected through Paystack. Visible to super and finance admins only.</p></div>{onOpenSection && <button type="button" className="secondary" onClick={() => onOpenSection('Revenue')}>Open Revenue Tracking</button>}</div>
        <div className="akpi-grid compact"><Kpi label={`Collected (${days} days)`} value={ngn(data.revenue.collected_period)} tone="good" /><Kpi label="Collected this month" value={ngn(data.revenue.collected_month)} /><Kpi label="Monthly value of active plans" value={ngn(data.revenue.contracted_monthly)} sub="Plan prices, not money received" /><Kpi label="Failed payments" value={num(data.revenue.failed_period)} tone={data.revenue.failed_period ? 'warn' : 'good'} /></div>
        <BarChart labels={data.revenue.series.map((point) => short(point.day))} values={data.revenue.series.map((point) => Number(point.amount))} format={(value) => `₦${compact(value)}`} name="Collected" /></section>}
      {data.security && <section className="admin-card wide"><div className="admin-card-header"><div><h2>Admin team and security</h2><p>Visible to super admins only.</p></div></div>
        <div className="akpi-grid compact"><Kpi label="Active admins" value={num(data.security.admins_active)} sub={data.security.by_role.map((item) => `${item.n} ${item.role.replace('_ADMIN', '').toLowerCase()}`).join(' · ')} /><Kpi label="Suspended or revoked" value={num(data.security.admins_suspended)} /><Kpi label="Admin actions (24 h)" value={num(data.security.admin_actions_24h)} /><Kpi label="Blocked sign-in attempts (24 h)" value={num(data.security.blocked_logins_24h)} tone={data.security.blocked_logins_24h > 50 ? 'warn' : undefined} /><Kpi label="Payments awaiting confirmation" value={num(data.security.unverified_payments)} sub="Pending for over a day" tone={data.security.unverified_payments ? 'warn' : 'good'} /></div>
        {data.security.recent_actions.length ? <ul className="admin-recent">{data.security.recent_actions.map((item, index) => <li key={index}><strong>{item.action.replace(/_/g, ' ')}</strong><span>{item.target_type ?? ''} · {item.actor_role?.replace('_ADMIN', '').toLowerCase() ?? 'admin'}</span><time>{new Date(item.created_at).toLocaleString('en-NG')}</time></li>)}</ul> : <p className="admin-empty">No admin actions recorded yet.</p>}</section>}
    </>}
  </>
}
