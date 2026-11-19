import { ArrowRight, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DonutChart } from '../components/charts'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { AdminTraffic } from './AdminTraffic'
import { Kpi, LineChart } from './AdminCharts'
import { useAdminAnalytics } from './analyticsData'
import { usePlatformHealth, type HealthState } from './platformHealth'
import { type AdminSection } from './types'

type Point = { label: string; users: number; organizations: number; sales: number; revenue: number; expenses: number }

const PERIODS = [
  { key: '7d', full: 'Last 7 days', short: '7d' },
  { key: '30d', full: 'Last 30 days', short: '30d' },
  { key: '12m', full: 'Last 12 months', short: '12m' },
  { key: '5y', full: 'Last 5 years', short: '5y' },
]
const TILES: { label: string; key: string; accent: string; series?: 'users' | 'organizations' }[] = [
  { label: 'Registered users', key: 'users', accent: 'var(--chart-1)', series: 'users' },
  { label: 'Organizations', key: 'organizations', accent: 'var(--chart-2)', series: 'organizations' },
  { label: 'Branches', key: 'branches', accent: 'var(--chart-3)' },
  { label: 'Employees', key: 'employees', accent: 'var(--chart-4)' },
]
const FOOTPRINT: { label: string; key: string; color: string }[] = [
  { label: 'Products', key: 'products', color: 'var(--chart-1)' },
  { label: 'Customers', key: 'customers', color: 'var(--chart-2)' },
  { label: 'Sales', key: 'sales', color: 'var(--chart-3)' },
  { label: 'Invoices', key: 'invoices', color: 'var(--chart-4)' },
  { label: 'Expenses', key: 'expenses', color: 'var(--chart-5)' },
]
const healthChip = (state: HealthState) =>
  state === 'up' ? '' : state === 'slow' ? ' warn' : state === 'down' ? ' bad' : ' idle'

export function AdminOverview({ onOpenSection }: { onOpenSection: (section: AdminSection) => void }) {
  const [overview, setOverview] = useState<Record<string, number> | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [period, setPeriod] = useState('30d')
  const [analytics, setAnalytics] = useState<Point[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const today = useAdminAnalytics(7)
  const health = usePlatformHealth(overview ? true : overviewError ? false : null)
  const [exportSlot, setExportSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setExportSlot(document.getElementById('av-header-actions')), [])

  useEffect(() => {
    if (!adminSupabase) return
    adminSupabase.rpc('get_platform_overview').then(({ data, error }) => {
      if (error) {
        setOverviewError(
          error.message.includes('does not exist')
            ? 'Apply the platform-admin migration in Supabase, then refresh.'
            : error.message,
        )
        return
      }
      setOverview((data ?? {}) as Record<string, number>)
    })
  }, [])
  useEffect(() => {
    if (!adminSupabase) return
    setAnalyticsLoading(true)
    adminSupabase.rpc('get_platform_analytics', { period_key: period }).then(({ data, error }) => {
      setAnalyticsLoading(false)
      if (error) {
        setOverviewError(
          error.message.includes('does not exist')
            ? 'Apply the platform analytics migration in Supabase, then refresh.'
            : error.message,
        )
        return
      }
      setAnalytics((data?.points ?? []) as Point[])
    })
  }, [period])

  const periodLabel = PERIODS.find((item) => item.key === period)?.short ?? period
  const total = (key: string) => overview?.[key] ?? 0
  const sum = (key: 'users' | 'organizations') => analytics.reduce((all, point) => all + point[key], 0)
  const slices = FOOTPRINT.map((item) => ({ label: item.label, value: total(item.key), color: item.color }))

  function exportSnapshot() {
    if (!overview) return
    const rows = [
      ['Measure', 'Value'],
      ...[...TILES, ...FOOTPRINT].map((item) => [item.label, String(total(item.key))]),
    ]
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `zerobyte-overview-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {exportSlot &&
        createPortal(
          <button type="button" className="secondary hide-sm" disabled={!overview} onClick={exportSnapshot}>
            <Download size={16} aria-hidden="true" /> Export snapshot
          </button>,
          exportSlot,
        )}
      {overviewError && (
        <div className="form-error" role="alert">
          {overviewError}
        </div>
      )}
      <div className="akpi-grid">
        {TILES.map((tile) => {
          if (!overview)
            return (
              <article key={tile.key} className="akpi" aria-busy="true">
                <Skeleton className="skeleton-line short" />
                <Skeleton className="skeleton-line value" />
              </article>
            )
          const values = tile.series ? analytics.map((point) => point[tile.series!]) : []
          const added = tile.series ? sum(tile.series) : 0
          return (
            <Kpi
              key={tile.key}
              label={tile.label}
              value={total(tile.key).toLocaleString()}
              count={total(tile.key)}
              accent={tile.accent}
              tone={added > 0 ? 'good' : undefined}
              sub={
                tile.series
                  ? added > 0
                    ? `▲ +${added.toLocaleString()} in ${periodLabel}`
                    : `No new in ${periodLabel}`
                  : 'Platform total'
              }
              trend={values.length > 1 && values.some((value) => value > 0) ? values : undefined}
            />
          )
        })}
      </div>

      <div className="ov-grid">
        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2>Platform growth</h2>
              <p>New users, organizations and sales over time.</p>
            </div>
            <div className="ov-tabs" role="tablist" aria-label="Analytics period">
              {PERIODS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={period === item.key}
                  className={period === item.key ? 'on' : ''}
                  onClick={() => setPeriod(item.key)}
                >
                  <span className="full">{item.full}</span>
                  <span className="short">{item.short}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ov-chart">
            {analyticsLoading ? (
              <div className="admin-line-skeleton">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : (
              <LineChart
                height={260}
                labels={analytics.map((point) => point.label)}
                series={[
                  { label: 'Users', color: 'var(--chart-1)', values: analytics.map((point) => point.users) },
                  {
                    label: 'Organizations',
                    color: 'var(--chart-2)',
                    values: analytics.map((point) => point.organizations),
                  },
                  { label: 'Sales', color: 'var(--chart-3)', values: analytics.map((point) => point.sales) },
                ]}
              />
            )}
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2>Platform footprint</h2>
              <p>Current records by area.</p>
            </div>
            <span className="admin-pill success">{overview ? 'Live counts' : 'Connecting'}</span>
          </div>
          {overview ? (
            <div className="ov-donut">
              <DonutChart
                slices={slices}
                size={150}
                thickness={18}
                centerValue={String(slices.filter((slice) => slice.value > 0).length)}
                centerLabel="record sets"
              />
              <ul className="ov-legend">
                {slices.map((slice) => (
                  <li key={slice.label}>
                    <i style={{ background: slice.color }} />
                    {slice.label}
                    <b>{slice.value.toLocaleString()}</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="admin-chart-skeleton">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
        </section>
      </div>

      <AdminTraffic compact />

      <div className="ov-foot">
        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2>Today at a glance</h2>
              <p>Visitors, people and sales right now.</p>
            </div>
            <button type="button" className="secondary" onClick={() => onOpenSection('Analytics')}>
              Open Analytics <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          {today.data ? (
            <div className="ov-glance">
              <div>
                <span>Visitors</span>
                <strong>{today.data.visitors.today.toLocaleString()}</strong>
              </div>
              <div>
                <span>Page views</span>
                <strong>{today.data.visitors.page_views_today.toLocaleString()}</strong>
              </div>
              <div>
                <span>Sign-ups</span>
                <strong>{today.data.users.new_today.toLocaleString()}</strong>
              </div>
              <div>
                <span>Active users</span>
                <strong>{today.data.users.dau.toLocaleString()}</strong>
              </div>
              <div>
                <span>Sales</span>
                <strong>{today.data.sales.count_today.toLocaleString()}</strong>
              </div>
            </div>
          ) : (
            <div className="ov-glance">
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="skeleton-line value" />
              ))}
            </div>
          )}
        </section>

        <section className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2>Platform monitoring</h2>
              <p>Quick check of what this console depends on.</p>
            </div>
            <span
              className={`admin-pill ${health.some((item) => item.state === 'down') ? 'danger' : health.some((item) => item.state === 'slow') ? 'warn' : health.every((item) => item.state === 'up') ? 'success' : ''}`}
            >
              {health.some((item) => item.state === 'down')
                ? 'Issue found'
                : health.some((item) => item.state === 'checking')
                  ? 'Checking…'
                  : health.some((item) => item.state === 'slow')
                    ? 'Slow'
                    : 'All up'}
            </span>
          </div>
          <div className="ov-health">
            {health.map((item) => (
              <span
                key={item.name}
                className={`ov-chip${healthChip(item.state)}`}
                title={
                  item.state === 'checking'
                    ? 'Checking'
                    : item.state === 'up'
                      ? 'Responding'
                      : item.state === 'slow'
                        ? 'Responding slowly'
                        : 'Not responding'
                }
              >
                <i className={`av-live${item.state === 'down' ? ' r' : item.state === 'slow' ? ' w' : ''}`} />
                {item.name}
              </span>
            ))}
            <button type="button" className="text-btn" onClick={() => onOpenSection('Monitoring')}>
              Full monitoring →
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
