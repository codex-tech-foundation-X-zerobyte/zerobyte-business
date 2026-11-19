import { useBranch } from '../workspace/branchContext'
import { BarChart3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FitText, Metric, MetricSkeleton, PageIntro, TableSkeleton } from '../../components/ui'
import { compactNaira, formatNaira } from '../../lib/format'
import { localDateIn, shiftDate } from '../../lib/reports'
import { supabase } from '../../lib/supabase'
import { PeriodicReports } from './PeriodicReports'
import { useOrgTimezone } from './useOrgTimezone'

export function Reports({ orgId }: { orgId: string }) {
  const { branchId } = useBranch()
  const timezone = useOrgTimezone(orgId)
  const [tab, setTab] = useState<'summary' | 'daily' | 'weekly'>('summary')
  const [metrics, setMetrics] = useState<{
    revenue: number
    cogs: number
    gross_profit: number
    operating_expenses: number
    net_profit: number
    sales_count: number
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // "Today" is the business's own day (default Africa/Lagos), never the browser's UTC clock.
  const [dateFrom, setDateFrom] = useState(() => shiftDate(localDateIn('Africa/Lagos'), -29))
  const [dateTo, setDateTo] = useState(() => localDateIn('Africa/Lagos'))
  useEffect(() => {
    const today = localDateIn(timezone)
    setDateTo(today)
    setDateFrom(shiftDate(today, -29))
  }, [timezone])
  useEffect(() => {
    if (!supabase) return
    setError('')
    setLoading(true)
    supabase
      .rpc('get_dashboard_metrics', {
        target_org: orgId,
        date_from: dateFrom,
        date_to: dateTo,
        target_branch: branchId,
      })
      .then(({ data, error: result }) => {
        if (result) {
          setMetrics(null)
          setError(
            result.code === 'PGRST202'
              ? 'Reports are not available yet. Apply the latest Supabase migrations, then try again.'
              : 'Reports are temporarily unavailable.',
          )
        } else {
          setMetrics(data as typeof metrics)
        }
        setLoading(false)
      })
  }, [dateFrom, dateTo, orgId, branchId])
  const revenue = Number(metrics?.revenue ?? 0)
  const cogs = Number(metrics?.cogs ?? 0)
  const expenses = Number(metrics?.operating_expenses ?? 0)
  const gross = Number(metrics?.gross_profit ?? 0)
  const net = Number(metrics?.net_profit ?? 0)
  const maxValue = Math.max(revenue, cogs, expenses, gross, net, 1)
  const setPreset = (days: number) => {
    const today = localDateIn(timezone)
    setDateTo(today)
    setDateFrom(shiftDate(today, -days))
  }
  return (
    <div className="page reports-page">
      <PageIntro
        label="Reports"
        title="Understand the signal."
        description="A server-calculated view of sales performance, cost of goods, and operating expenses."
      />
      <div className="segmented" role="tablist" aria-label="Report type">
        {(
          [
            ['summary', 'Summary'],
            ['daily', 'Daily report'],
            ['weekly', 'Weekly report'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== 'summary' ? (
        <PeriodicReports orgId={orgId} kind={tab} />
      ) : (
        <>
          <section className="panel report-toolbar">
            <div>
              <span className="section-label">Reporting period</span>
              <strong>
                {new Date(`${dateFrom}T00:00:00`).toLocaleDateString('en-NG', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                —{' '}
                {new Date(`${dateTo}T00:00:00`).toLocaleDateString('en-NG', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </strong>
            </div>
            <div className="report-presets" aria-label="Quick reporting periods">
              <button className="text-btn" onClick={() => setPreset(6)}>
                7 days
              </button>
              <button className="text-btn" onClick={() => setPreset(29)}>
                30 days
              </button>
              <button className="text-btn" onClick={() => setPreset(364)}>
                12 months
              </button>
            </div>
            <div className="report-date-fields">
              <label>
                From
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  max={localDateIn(timezone)}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
            </div>
          </section>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="metrics report-metrics" aria-busy={loading}>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => <MetricSkeleton key={index} />)
            ) : (
              <>
                <Metric
                  label="Revenue"
                  value={formatNaira(revenue)}
                  note={`${Number(metrics?.sales_count ?? 0).toLocaleString('en-NG')} completed sales`}
                />
                <Metric label="COGS" value={formatNaira(cogs)} note="Historical sale costs" />
                <Metric label="Gross profit" value={formatNaira(gross)} note="Revenue less COGS" />
                <Metric label="Operating expenses" value={formatNaira(expenses)} note="Recorded expenses" />
              </>
            )}
          </div>
          {loading ? (
            <div className="panel report-breakdown">
              <TableSkeleton rows={5} />
            </div>
          ) : (
            <div className="report-grid">
              <section className="panel report-breakdown">
                <div className="panel-heading">
                  <div>
                    <span className="section-label">Financial shape</span>
                    <h2>Where the money moved</h2>
                  </div>
                  <BarChart3 size={20} color="#06d466" />
                </div>
                <div className="report-bars">
                  {[
                    ['Revenue', revenue, 'revenue'],
                    ['COGS', cogs, 'cogs'],
                    ['Expenses', expenses, 'expenses'],
                    ['Net profit', net, 'profit'],
                  ].map(([label, value, tone]) => (
                    <div className="report-bar-row" key={label as string}>
                      <div>
                        <span>{label}</span>
                        <strong>
                          <FitText text={formatNaira(Number(value))} compact={compactNaira(Number(value))} min={0.7} />
                        </strong>
                      </div>
                      <div className="report-bar-track">
                        <i
                          className={`report-bar ${tone}${tone === 'profit' && Number(value) < 0 ? ' loss' : ''}`}
                          style={{
                            width: `${Math.max((Math.abs(Number(value)) / maxValue) * 100, Number(value) > 0 ? 2 : 0)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="report-caption">
                  Bars are scaled against the largest value in this period. All figures come from completed records.
                </p>
              </section>
              <section className="panel report-profit">
                <span className="section-label">Bottom line</span>
                <h2>Net profit</h2>
                <strong className="fit-box">
                  <FitText text={formatNaira(net)} compact={compactNaira(net)} min={0.5} />
                </strong>
                <p>Revenue minus historical COGS and operating expenses.</p>
                <div className={net >= 0 ? 'profit-status positive' : 'profit-status negative'}>
                  {net >= 0 ? 'Positive result' : 'Needs attention'}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
