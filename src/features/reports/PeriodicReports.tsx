import { Download, FileSpreadsheet, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Metric, MetricSkeleton } from '../../components/ui'
import { downloadCsv, paymentMethodLabel } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useOrgTimezone } from './useOrgTimezone'
import {
  changeLabel,
  localDateIn,
  hourLabel,
  reportCsvRows,
  reportFilename,
  reportMoney,
  reportPeriodLabel,
  reportTitle,
  reportWhatsAppUrl,
  type ReportKind,
  type ReportPayload,
} from '../../lib/reports'

type HistoryRow = { id: string; period_from: string; period_to: string; is_final: boolean }

const plural = (count: number, one: string) => `${count.toLocaleString('en-NG')} ${count === 1 ? one : `${one}s`}`

function Rows({ rows }: { rows: { label: string; detail?: string; value?: string }[] }) {
  if (!rows.length) return <p className="muted">Nothing to show for this period.</p>
  return (
    <ul className="report-rows">
      {rows.map((row, index) => (
        <li key={`${row.label}-${index}`}>
          <span>
            {row.label}
            {row.detail && <small>{row.detail}</small>}
          </span>
          {row.value && <strong>{row.value}</strong>}
        </li>
      ))}
    </ul>
  )
}

/**
 * The daily and weekly report. Every figure is calculated by the database (the same numbers the Overview shows and the
 * notification quotes), then shown here, downloaded as PDF or CSV, or shared as a WhatsApp message. Only owners and
 * admins can load it: the database refuses everyone else.
 */
export function PeriodicReports({ orgId, kind }: { orgId: string; kind: ReportKind }) {
  const timezone = useOrgTimezone(orgId)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [selected, setSelected] = useState<string>('live')
  const [report, setReport] = useState<ReportPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'' | 'pdf' | 'csv'>('')

  useEffect(() => {
    setSelected('live')
    if (!supabase) return
    let active = true
    void Promise.resolve(
      supabase
        .from('business_reports')
        .select('id,period_from,period_to,is_final')
        .eq('organization_id', orgId)
        .eq('kind', kind)
        .order('period_from', { ascending: false })
        .limit(30),
    ).then(({ data }) => {
      if (active) setHistory((data ?? []) as HistoryRow[])
    })
    return () => {
      active = false
    }
  }, [orgId, kind])

  useEffect(() => {
    if (!supabase) return
    let active = true
    setLoading(true)
    setError('')
    const request =
      selected === 'live'
        ? supabase.rpc('get_business_report', { p_org: orgId, p_kind: kind, p_date: null })
        : supabase.from('business_reports').select('payload').eq('id', selected).eq('organization_id', orgId).single()
    void Promise.resolve(request).then((result) => {
      if (!active) return
      const failure = result.error
      if (failure) {
        setReport(null)
        setError(
          failure.code === 'PGRST202'
            ? 'Reports are not available yet. Apply the latest Supabase migrations, then try again.'
            : 'This report could not be loaded. Only owners and admins can open reports.',
        )
      } else {
        const data = result.data as unknown
        setReport((selected === 'live' ? data : (data as { payload: unknown } | null)?.payload) as ReportPayload)
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [orgId, kind, selected])

  async function downloadPdf() {
    if (!report || busy) return
    setBusy('pdf')
    try {
      // Loaded only when someone asks for a PDF, so the PDF engine never slows down the rest of the app.
      const { buildReportPdf } = await import('../../lib/reportPdf')
      const { doc, filename } = buildReportPdf(report)
      doc.save(filename)
    } finally {
      setBusy('')
    }
  }
  function downloadSpreadsheet() {
    if (!report) return
    const { headers, rows } = reportCsvRows(report)
    downloadCsv(reportFilename(report, 'csv'), headers, rows)
  }

  const c = report?.business.currency ?? 'NGN'
  const s = report?.summary
  const change = report ? changeLabel(report) : null
  const biggest = report ? Math.max(...report.daily.map((d) => Number(d.revenue)), 1) : 1
  const liveLabel = kind === 'daily' ? 'Today' : 'This week'

  return (
    <div className="periodic-report">
      <div className="report-history" role="tablist" aria-label={`${kind === 'daily' ? 'Daily' : 'Weekly'} reports`}>
        <button
          type="button"
          role="tab"
          aria-selected={selected === 'live'}
          className={selected === 'live' ? 'active' : ''}
          onClick={() => setSelected('live')}
        >
          {liveLabel} <b>live</b>
        </button>
        {history
          // The period that is still running is already the "live" tab; do not list it twice.
          .filter((row) => {
            const today = localDateIn(timezone)
            return !(row.period_from <= today && today <= row.period_to)
          })
          .map((row) => (
            <button
              key={row.id}
              type="button"
              role="tab"
              aria-selected={selected === row.id}
              className={selected === row.id ? 'active' : ''}
              onClick={() => setSelected(row.id)}
            >
              {reportPeriodLabel({ kind, period_from: row.period_from, period_to: row.period_to })}
              {!row.is_final && <b>so far</b>}
            </button>
          ))}
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {report && (
        <section className="panel report-head">
          <div>
            <span className="section-label">{report.business.name}</span>
            <h2>{reportTitle(report)}</h2>
            {change && <span className="muted">{change}</span>}
          </div>
          <div className="report-actions">
            <button type="button" className="primary" onClick={() => void downloadPdf()} disabled={busy === 'pdf'}>
              <Download size={16} /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}
            </button>
            <button type="button" onClick={downloadSpreadsheet}>
              <FileSpreadsheet size={16} /> Spreadsheet
            </button>
            <a className="button-like" href={reportWhatsAppUrl(report)} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
        </section>
      )}

      <div className="metrics report-metrics" aria-busy={loading}>
        {loading || !report || !s ? (
          Array.from({ length: 4 }).map((_, index) => <MetricSkeleton key={index} />)
        ) : (
          <>
            <Metric
              label="Revenue"
              value={reportMoney(s.revenue, c)}
              note={`${plural(s.sales_count, 'sale')}${s.sales_count ? ` · avg ${reportMoney(s.average_sale, c)}` : ''}`}
            />
            <Metric
              label="Gross profit"
              value={reportMoney(s.gross_profit, c)}
              note={`Cost of goods ${reportMoney(s.cogs, c)}`}
            />
            <Metric
              label="Net profit"
              value={reportMoney(s.net_profit, c)}
              note={`After ${reportMoney(s.operating_expenses, c)} expenses`}
            />
            <Metric
              label="Items sold"
              value={s.items_sold.toLocaleString('en-NG')}
              note={
                s.refunds_count
                  ? `${plural(s.refunds_count, 'refund')} (${reportMoney(s.refunds_total, c)})`
                  : 'No refunds'
              }
            />
          </>
        )}
      </div>

      {report && !loading && (
        <div className="periodic-grid">
          <section className="panel">
            <h2>How customers paid</h2>
            <Rows
              rows={report.payments.by_method.map((m) => ({
                label: paymentMethodLabel(m.method),
                detail: plural(m.sales_count, 'sale'),
                value: reportMoney(m.total, c),
              }))}
            />
            {(report.payments.credit_sales_total > 0 ||
              report.payments.credit_collected > 0 ||
              report.customers.owing_total > 0) && (
              <Rows
                rows={[
                  { label: 'Sold on credit', value: reportMoney(report.payments.credit_sales_total, c) },
                  { label: 'Credit repayments received', value: reportMoney(report.payments.credit_collected, c) },
                  {
                    label: 'Owed to you in total',
                    detail: plural(report.customers.owing_count, 'customer'),
                    value: reportMoney(report.customers.owing_total, c),
                  },
                ]}
              />
            )}
          </section>
          <section className="panel">
            <h2>Top products</h2>
            <Rows
              rows={report.top_products.map((p) => ({
                label: p.name,
                detail: `${p.quantity.toLocaleString('en-NG')} sold`,
                value: reportMoney(p.revenue, c),
              }))}
            />
            {report.new_products.count > 0 && (
              <p className="muted">
                New products added: {report.new_products.names.join(', ')}
                {report.new_products.count > report.new_products.names.length ? ' and more' : ''}
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Customers</h2>
            {report.customers.new_count > 0 && (
              <p>
                <strong>{plural(report.customers.new_count, 'new customer')}</strong>
                {report.customers.new_names.length > 0 && (
                  <span className="muted"> · {report.customers.new_names.join(', ')}</span>
                )}
              </p>
            )}
            <Rows
              rows={report.customers.top.map((p) => ({
                label: p.name,
                detail: plural(p.sales_count, 'sale'),
                value: reportMoney(p.total, c),
              }))}
            />
          </section>
          {report.staff.length > 1 && (
            <section className="panel">
              <h2>Sales by team member</h2>
              <Rows
                rows={report.staff.map((p) => ({
                  label: p.name,
                  detail: plural(p.sales_count, 'sale'),
                  value: reportMoney(p.revenue, c),
                }))}
              />
            </section>
          )}
          {report.branches.length > 1 && (
            <section className="panel">
              <h2>Sales by branch</h2>
              <Rows
                rows={report.branches.map((p) => ({
                  label: p.name,
                  detail: plural(p.sales_count, 'sale'),
                  value: reportMoney(p.revenue, c),
                }))}
              />
            </section>
          )}
          {report.expense_categories.length > 0 && (
            <section className="panel">
              <h2>Expenses</h2>
              <Rows
                rows={report.expense_categories.map((p) => ({ label: p.category, value: reportMoney(p.amount, c) }))}
              />
            </section>
          )}
          {report.low_stock.count > 0 && (
            <section className="panel">
              <h2>Running low ({report.low_stock.count})</h2>
              <Rows
                rows={report.low_stock.items.map((p) => ({
                  label: p.name,
                  value: p.stock === 0 ? 'Out of stock' : `${p.stock} left`,
                }))}
              />
            </section>
          )}
          {kind === 'weekly' && (
            <section className="panel report-days">
              <h2>Day by day</h2>
              <ul>
                {report.daily.map((d) => (
                  <li key={d.date}>
                    <span>
                      {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-NG', {
                        weekday: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                    <span className="bar" aria-hidden="true">
                      <i style={{ width: `${Math.round((Number(d.revenue) / biggest) * 100)}%` }} />
                    </span>
                    <strong>{reportMoney(d.revenue, c)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {kind === 'daily' && report.peak_hour && report.peak_hour.revenue > 0 && (
            <section className="panel">
              <h2>Busiest hour</h2>
              <p>
                <strong>{hourLabel(report.peak_hour.hour)}</strong>{' '}
                <span className="muted">brought in {reportMoney(report.peak_hour.revenue, c)}</span>
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
