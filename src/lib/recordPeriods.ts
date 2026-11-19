// Day, month and year grouping for the Records page, always in Lagos time (the same clock the Overview and the daily
// report use), so a sale made at 00:30 belongs to the new day and the totals agree everywhere.
export type PeriodView = 'day' | 'month' | 'year'
export type PeriodRow = { period: string; count: number; total: number; refundCount: number; refundTotal: number }

const TZ = 'Africa/Lagos'
const dayParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** "2026-11-18" for a timestamp, as the date it was in Lagos. */
export const lagosDay = (iso: string) => dayParts.format(new Date(iso))

// A plain date such as 2026-11-18 is turned into noon UTC so no time zone can move it to another day when formatting.
const noon = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`)
const format = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-NG', { ...options, timeZone: 'UTC' }).format(noon(day))

export const formatDayHeading = (day: string) =>
  format(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const formatMonth = (day: string) => format(day, { month: 'long', year: 'numeric' })
export const formatYear = (day: string) => day.slice(0, 4)
export const periodLabel = (view: PeriodView, period: string) =>
  view === 'day' ? formatDayHeading(period) : view === 'month' ? formatMonth(period) : formatYear(period)

/** Lagos is UTC+1 all year (no daylight saving), so a day starts at 00:00+01:00 and ends at 23:59:59.999+01:00. */
export const lagosDayStart = (date: string) => `${date}T00:00:00.000+01:00`
export const lagosDayEnd = (date: string) => `${date}T23:59:59.999+01:00`

/** Keeps the order of the rows and starts a new group whenever the Lagos day changes. */
export function groupByDay<T>(rows: T[], timestamp: (row: T) => string) {
  const groups: { day: string; rows: T[] }[] = []
  for (const row of rows) {
    const day = lagosDay(timestamp(row))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return groups
}

/** Same as groupByDay for rows that already carry a plain date (expenses). */
export function groupByDate<T>(rows: T[], date: (row: T) => string) {
  return groupByDay(rows, (row) => `${date(row).slice(0, 10)}T12:00:00+01:00`)
}

const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parsePeriodRows(data: unknown): PeriodRow[] {
  if (!Array.isArray(data)) return []
  return data
    .map((row: Record<string, unknown>) => ({
      period: String(row.period ?? '').slice(0, 10),
      count: num(row.row_count),
      total: num(row.total),
      refundCount: num(row.refund_count),
      refundTotal: num(row.refund_total),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.period))
}

export function sumPeriods(rows: PeriodRow[]) {
  return rows.reduce(
    (sum, row) => ({
      count: sum.count + row.count,
      total: sum.total + row.total,
      refundCount: sum.refundCount + row.refundCount,
      refundTotal: sum.refundTotal + row.refundTotal,
    }),
    { count: 0, total: 0, refundCount: 0, refundTotal: 0 },
  )
}
