import { Fragment, type ReactNode } from 'react'
import { EmptyInline, TableSkeleton } from '../../components/ui'
import { downloadCsv } from '../../lib/format'
import { type PeriodRow, type PeriodView, formatDayHeading, periodLabel, sumPeriods } from '../../lib/recordPeriods'

import type { RecordKind } from './recordHooks'

const money = (value: number) => `₦${value.toLocaleString('en-NG')}`
const plain = (value: number) => value.toLocaleString('en-NG')

const VIEWS: { id: PeriodView; label: string }[] = [
  { id: 'day', label: 'Day by day' },
  { id: 'month', label: 'Monthly' },
  { id: 'year', label: 'Yearly' },
]

export function ViewSwitch({ value, onChange }: { value: PeriodView; onChange: (view: PeriodView) => void }) {
  return (
    <div className="record-view-switch" role="group" aria-label="Group records by">
      {VIEWS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={value === item.id ? 'active' : ''}
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** Table rows for a list grouped by day: a heading row (date, how many, day total) before each day's records. */
export function DayGroups<T>({
  groups,
  colSpan,
  dayTotals,
  summary,
  renderRow,
}: {
  groups: { day: string; rows: T[] }[]
  colSpan: number
  dayTotals: Map<string, PeriodRow>
  summary: (day: string, known: PeriodRow | undefined, rows: T[]) => ReactNode
  renderRow: (row: T) => ReactNode
}) {
  return (
    <>
      {groups.map((group) => (
        <Fragment key={group.day}>
          <tr className="record-day-row">
            <td colSpan={colSpan}>
              <div className="record-day-inner">
                <span className="record-day-name">{formatDayHeading(group.day)}</span>
                <span className="record-day-total">{summary(group.day, dayTotals.get(group.day), group.rows)}</span>
              </div>
            </td>
          </tr>
          {group.rows.map((row) => renderRow(row))}
        </Fragment>
      ))}
    </>
  )
}

const COPY: Record<RecordKind, { noun: string; nouns: string; total: string; file: string }> = {
  sales: { noun: 'sale', nouns: 'Sales', total: 'Total sold', file: 'sales' },
  expenses: { noun: 'expense', nouns: 'Expenses', total: 'Total spent', file: 'expenses' },
  stock: { noun: 'intake', nouns: 'Intakes', total: 'Units received', file: 'stock-intake' },
}

/** Monthly or yearly totals, newest first, with a grand total, ready to export. */
export function PeriodSummary({
  kind,
  view,
  rows,
  loading,
  failed,
}: {
  kind: RecordKind
  view: Exclude<PeriodView, 'day'>
  rows: PeriodRow[]
  loading: boolean
  failed: boolean
}) {
  const copy = COPY[kind]
  const isSales = kind === 'sales'
  const isStock = kind === 'stock'
  const sum = sumPeriods(rows)
  const amount = (value: number) => (isStock ? plain(value) : money(value))
  if (loading) return <TableSkeleton />
  if (failed)
    return (
      <div className="form-error">
        The {view === 'month' ? 'monthly' : 'yearly'} totals are temporarily unavailable.
      </div>
    )
  if (!rows.length)
    return (
      <EmptyInline
        title="Nothing to add up yet"
        text="Totals appear here as soon as there are records in this period."
      />
    )
  const exportSummary = () =>
    downloadCsv(
      `zerobyte-${copy.file}-${view === 'month' ? 'monthly' : 'yearly'}.csv`,
      [
        view === 'month' ? 'Month' : 'Year',
        copy.nouns,
        copy.total,
        ...(isSales ? ['Average sale', 'Refunded sales', 'Refunded amount'] : []),
      ],
      [
        ...rows.map((row) => [
          periodLabel(view, row.period),
          row.count,
          row.total,
          ...(isSales ? [row.count ? Math.round(row.total / row.count) : 0, row.refundCount, row.refundTotal] : []),
        ]),
        [
          'All periods shown',
          sum.count,
          sum.total,
          ...(isSales ? [sum.count ? Math.round(sum.total / sum.count) : 0, sum.refundCount, sum.refundTotal] : []),
        ],
      ],
    )
  return (
    <>
      <div className="table-wrap">
        <table className="record-period-table">
          <thead>
            <tr>
              <th>{view === 'month' ? 'Month' : 'Year'}</th>
              <th className="amount">{copy.nouns}</th>
              <th className="amount">{copy.total}</th>
              {isSales && <th className="amount">Average sale</th>}
              {isSales && <th className="amount">Refunded</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period}>
                <td>
                  <strong>{periodLabel(view, row.period)}</strong>
                </td>
                <td className="amount" data-label={copy.nouns}>
                  {plain(row.count)}
                </td>
                <td className="amount" data-label={copy.total}>
                  {amount(row.total)}
                </td>
                {isSales && (
                  <td className="amount" data-label="Average sale">
                    {row.count ? money(Math.round(row.total / row.count)) : '—'}
                  </td>
                )}
                {isSales && (
                  <td className="amount" data-label="Refunded">
                    {row.refundCount ? `${plain(row.refundCount)} · ${money(row.refundTotal)}` : '—'}
                  </td>
                )}
              </tr>
            ))}
            <tr className="record-period-grand">
              <td>
                <strong>All periods shown</strong>
              </td>
              <td className="amount" data-label={copy.nouns}>
                {plain(sum.count)}
              </td>
              <td className="amount" data-label={copy.total}>
                {amount(sum.total)}
              </td>
              {isSales && (
                <td className="amount" data-label="Average sale">
                  {sum.count ? money(Math.round(sum.total / sum.count)) : '—'}
                </td>
              )}
              {isSales && (
                <td className="amount" data-label="Refunded">
                  {sum.refundCount ? `${plain(sum.refundCount)} · ${money(sum.refundTotal)}` : '—'}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="record-period-foot">
        <p className="field-help">
          {isSales
            ? 'Only completed sales are added up. Refunded sales are shown separately. Days run from 12:00 am to 11:59 pm in your business time zone (Settings > Reports).'
            : 'Days run from 12:00 am to 11:59 pm in your business time zone (Settings > Reports).'}{' '}
          Use the Period filter above to choose which months or years to include.
        </p>
        <button className="secondary" onClick={exportSummary}>
          Export totals (CSV)
        </button>
      </div>
    </>
  )
}
