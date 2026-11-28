// Day, month and year grouping for the Records page, in the business's own time zone (Settings > Reports, default
// Africa/Lagos: the same clock the Overview and the daily report use), so a sale made at 00:30 belongs to the new day and
// the totals agree everywhere.
export type PeriodView = 'day' | 'month' | 'year'
export type PeriodRow = { period: string; count: number; total: number; refundCount: number; refundTotal: number }

export const DEFAULT_ZONE = 'Africa/Lagos'
const dayFormats = new Map<string, Intl.DateTimeFormat>()
function dayFormat(zone: string) {
  let format = dayFormats.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayFormats.set(zone, format)
  }
  return format
}

/** "2026-11-18" for a timestamp, as the date it was in the given time zone. */
export const dayIn = (iso: string, zone = DEFAULT_ZONE) => dayFormat(zone).format(new Date(iso))
export const lagosDay = (iso: string) => dayIn(iso, DEFAULT_ZONE)

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

// How far a time zone is ahead of UTC at a given moment, in minutes (it changes with daylight saving).
function offsetMinutes(utcMs: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((wallAsUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

/** The exact moment (ISO, UTC) a calendar day starts or ends in the given time zone. */
export function zonedDay(date: string, edge: 'start' | 'end', zone = DEFAULT_ZONE) {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  const wall =
    edge === 'start' ? Date.UTC(year, month - 1, day, 0, 0, 0, 0) : Date.UTC(year, month - 1, day, 23, 59, 59, 999)
  // Two passes settle the offset even on the day daylight saving changes.
  let instant = wall - offsetMinutes(wall, zone) * 60000
  instant = wall - offsetMinutes(instant, zone) * 60000
  return new Date(instant).toISOString()
}
export const lagosDayStart = (date: string) => zonedDay(date, 'start', DEFAULT_ZONE)
export const lagosDayEnd = (date: string) => zonedDay(date, 'end', DEFAULT_ZONE)

/** Keeps the order of the rows and starts a new group whenever the Lagos day changes. */
export function groupByDay<T>(rows: T[], timestamp: (row: T) => string, zone = DEFAULT_ZONE) {
  const groups: { day: string; rows: T[] }[] = []
  for (const row of rows) {
    const day = dayIn(timestamp(row), zone)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return groups
}

/** Same as groupByDay for rows that already carry a plain date (expenses). */
export function groupByDate<T>(rows: T[], date: (row: T) => string) {
  const groups: { day: string; rows: T[] }[] = []
  for (const row of rows) {
    const day = date(row).slice(0, 10)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return groups
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
