import { describe, expect, it } from 'vitest'
import {
  formatDayHeading,
  formatMonth,
  groupByDate,
  groupByDay,
  lagosDay,
  lagosDayEnd,
  lagosDayStart,
  dayIn,
  zonedDay,
  parsePeriodRows,
  periodLabel,
  sumPeriods,
} from './recordPeriods'

describe('Lagos days', () => {
  it('puts a sale made just after midnight in Lagos on the new day, not the UTC day before', () => {
    expect(lagosDay('2026-11-10T23:30:00Z')).toBe('2026-11-11') // 00:30 on the 11th in Lagos
    expect(lagosDay('2026-11-10T22:59:00Z')).toBe('2026-11-10') // 23:59 on the 10th in Lagos
  })
  it('turns a chosen date into the exact Lagos day', () => {
    expect(new Date(lagosDayStart('2026-11-11')).toISOString()).toBe('2026-11-10T23:00:00.000Z')
    expect(new Date(lagosDayEnd('2026-11-11')).toISOString()).toBe('2026-11-11T22:59:59.999Z')
  })
})

describe('any business time zone', () => {
  it('finds the day in the business zone', () => {
    expect(dayIn('2026-11-11T03:30:00Z', 'America/New_York')).toBe('2026-11-10') // 22:30 on the 10th there
    expect(dayIn('2026-11-11T03:30:00Z', 'Africa/Lagos')).toBe('2026-11-11')
  })
  it('turns a date into the exact start and end of that day, also across daylight saving', () => {
    expect(zonedDay('2026-11-11', 'start', 'America/New_York')).toBe('2026-11-11T05:00:00.000Z')
    expect(zonedDay('2026-11-01', 'start', 'America/New_York')).toBe('2026-11-01T04:00:00.000Z') // still summer time at midnight
    expect(zonedDay('2026-11-01', 'end', 'America/New_York')).toBe('2026-11-02T04:59:59.999Z') // winter time by evening
    expect(zonedDay('2026-11-11', 'end', 'Asia/Tokyo')).toBe('2026-11-11T14:59:59.999Z')
  })
})

describe('headings', () => {
  it('writes readable day, month and year headings', () => {
    expect(formatDayHeading('2026-11-18')).toMatch(/Wednesday.*18.*November.*2026/)
    expect(formatMonth('2026-11-01')).toMatch(/November 2026/)
    expect(periodLabel('year', '2026-01-01')).toBe('2026')
    expect(periodLabel('month', '2026-02-01')).toMatch(/February 2026/)
  })
})

describe('grouping', () => {
  it('starts a new group when the Lagos day changes and keeps the order', () => {
    const rows = [
      { id: 'a', at: '2026-11-11T11:00:00Z' },
      { id: 'b', at: '2026-11-10T23:30:00Z' }, // still the 11th in Lagos
      { id: 'c', at: '2026-11-10T20:00:00Z' },
    ]
    const groups = groupByDay(rows, (row) => row.at)
    expect(groups.map((group) => [group.day, group.rows.map((row) => row.id)])).toEqual([
      ['2026-11-11', ['a', 'b']],
      ['2026-11-10', ['c']],
    ])
  })
  it('groups plain dates (expenses) without any time zone shift', () => {
    const groups = groupByDate([{ d: '2026-11-11' }, { d: '2026-11-11' }, { d: '2026-11-09' }], (row) => row.d)
    expect(groups.map((group) => [group.day, group.rows.length])).toEqual([
      ['2026-11-11', 2],
      ['2026-11-09', 1],
    ])
  })
})

describe('database rows', () => {
  it('reads the totals the database sends, tolerating strings and junk', () => {
    const rows = parsePeriodRows([
      { period: '2026-11-11', row_count: '3', total: '4500', refund_count: '1', refund_total: '700' },
      { period: 'not a date', row_count: 1, total: 1 },
      { period: '2026-10-01', row_count: 2, total: 100.5 },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ period: '2026-11-11', count: 3, total: 4500, refundCount: 1, refundTotal: 700 })
    expect(sumPeriods(rows)).toEqual({ count: 5, total: 4600.5, refundCount: 1, refundTotal: 700 })
    expect(parsePeriodRows(null)).toEqual([])
  })
})
