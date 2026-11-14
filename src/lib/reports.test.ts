import { describe, expect, it } from 'vitest'
import { csvSafe, csvText } from './format'
import { buildReportPdf } from './reportPdf'
import {
  changeLabel,
  localDateIn,
  reportCsvRows,
  reportMoney,
  reportTitle,
  reportWhatsAppText,
  reportWhatsAppUrl,
  shiftDate,
  type ReportPayload,
} from './reports'

const report = (over: Partial<ReportPayload> = {}): ReportPayload => ({
  version: 1,
  kind: 'daily',
  period_from: '2026-11-09',
  period_to: '2026-11-09',
  days: 1,
  timezone: 'Africa/Lagos',
  generated_at: '2026-11-09T20:00:00Z',
  business: { name: 'Adaeze Stores', currency: 'NGN' },
  summary: {
    revenue: 161100,
    sales_count: 14,
    average_sale: 11507,
    items_sold: 40,
    cogs: 141000,
    gross_profit: 20100,
    operating_expenses: 8220,
    net_profit: 11880,
    discounts: 0,
    tax_collected: 0,
    refunds_count: 1,
    refunds_total: 700,
  },
  comparison: {
    previous_from: '2026-11-08',
    previous_to: '2026-11-08',
    previous_revenue: 140000,
    previous_sales_count: 10,
    revenue_change_pct: 15.1,
  },
  payments: {
    by_method: [
      { method: 'cash', sales_count: 9, total: 100000 },
      { method: 'transfer', sales_count: 5, total: 61100 },
    ],
    credit_sales_total: 0,
    credit_collected: 0,
  },
  top_products: [
    { name: 'Rice 5kg', quantity: 12, revenue: 117600 },
    { name: 'Palm Oil 5L', quantity: 3, revenue: 37500 },
  ],
  low_stock: { count: 2, items: [{ name: 'Indomie Chicken (carton)', stock: 0, reorder_point: 5 }] },
  new_products: { count: 1, names: ['Hypo Bleach 1L'] },
  customers: {
    new_count: 2,
    new_names: ['Ngozi Okafor', 'Tunde Bello'],
    top: [{ name: 'Ngozi Okafor', sales_count: 2, total: 9000 }],
    owing_count: 1,
    owing_total: 1100,
  },
  staff: [
    { name: 'Ada Eze', sales_count: 10, revenue: 120000 },
    { name: 'Chidi', sales_count: 4, revenue: 41100 },
  ],
  branches: [],
  expense_categories: [{ category: 'Transport', amount: 8220 }],
  daily: [{ date: '2026-11-09', sales_count: 14, revenue: 161100 }],
  peak_hour: { hour: 17, revenue: 50000 },
  ...over,
})

describe('CSV formula injection', () => {
  it.each(['=HYPERLINK("http://evil/","x")', '+cmd|calc', '-2+3+cmd', '@SUM(A1)', '\tTAB', '\rCR'])(
    'neutralises %j',
    (value) => {
      expect(csvSafe(value).startsWith("'")).toBe(true)
    },
  )
  it('leaves ordinary text, numbers and phone numbers alone', () => {
    expect(csvSafe('Rice 5kg')).toBe('Rice 5kg')
    expect(csvSafe(-500)).toBe('-500')
    expect(csvSafe('+2348012345678')).toBe('+2348012345678')
    expect(csvSafe('0801 234 5678')).toBe('0801 234 5678')
    expect(csvSafe("O'Brien")).toBe("O'Brien")
  })
  it('quotes and escapes whole rows', () => {
    expect(csvText(['a'], [['say "hi"'], ['=1+1']])).toBe('"a"\r\n"say ""hi"""\r\n"\'=1+1"')
  })
})

describe('business-day helpers', () => {
  it('uses the business time zone, not UTC', () => {
    const lateNightLagos = new Date('2026-11-09T23:30:00Z') // 00:30 on 10 Nov in Lagos
    expect(localDateIn('Africa/Lagos', lateNightLagos)).toBe('2026-11-10')
    expect(localDateIn('UTC', lateNightLagos)).toBe('2026-11-09')
  })
  it('falls back to Lagos for an unknown zone instead of crashing', () => {
    expect(localDateIn('Mars/Olympus', new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10')
  })
  it('shifts dates across month and year ends', () => {
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('report text', () => {
  it('formats money and titles', () => {
    expect(reportMoney(161100, 'NGN')).toBe('₦161,100')
    expect(reportMoney(-48400, 'NGN')).toBe('₦-48,400')
    expect(reportMoney(5000, 'GHS')).toBe('GHS 5,000')
    expect(reportTitle(report())).toContain('Daily report')
    expect(reportTitle(report({ kind: 'weekly', period_from: '2026-11-02', period_to: '2026-11-08' }))).toContain(
      'Weekly report',
    )
  })
  it('describes the change against the previous period', () => {
    expect(changeLabel(report())).toBe('Up 15.1% on the day before')
    expect(
      changeLabel(report({ kind: 'weekly', comparison: { ...report().comparison, revenue_change_pct: -4 } })),
    ).toBe('Down 4% on the week before')
    expect(changeLabel(report({ comparison: { ...report().comparison, revenue_change_pct: null } }))).toBeNull()
    expect(changeLabel(report({ comparison: { ...report().comparison, revenue_change_pct: 2236.5 } }))).toBe(
      'Up over 999% on the day before',
    )
  })
  it('builds a WhatsApp message with the key facts and no more than needed', () => {
    const text = reportWhatsAppText(report())
    expect(text).toContain('₦161,100 from 14 sales')
    expect(text).toContain('Rice 5kg')
    expect(text).toContain('New customers: 2')
    expect(text).toContain('Owed to you: ₦1,100')
    expect(text).not.toMatch(/\d{11}/) // no phone numbers
    expect(reportWhatsAppUrl(report()).startsWith('https://wa.me/?text=')).toBe(true)
  })
  it('lists everything in the spreadsheet export', () => {
    const { headers, rows } = reportCsvRows(report())
    expect(headers).toEqual(['Section', 'Item', 'Count', 'Amount'])
    expect(rows.some((r) => r[0] === 'Top product' && r[1] === 'Rice 5kg')).toBe(true)
    expect(rows.some((r) => r[0] === 'Summary' && r[1] === 'Net profit' && r[3] === 11880)).toBe(true)
  })
  it('keeps a hostile product name safe in the exported file', () => {
    const { headers, rows } = reportCsvRows(
      report({ top_products: [{ name: '=HYPERLINK("http://evil/","x")', quantity: 1, revenue: 1 }] }),
    )
    expect(csvText(headers, rows)).toContain(`"'=HYPERLINK(`)
  })
})

describe('PDF', () => {
  it('builds a document even with unusual and hostile names', () => {
    const { doc, filename } = buildReportPdf(
      report({
        business: { name: 'Ọlá & Sons <script>alert(1)</script> 🛒', currency: 'NGN' },
        top_products: [{ name: 'Ẹ̀gúsí "melon" — 5kg', quantity: 2, revenue: 3000 }],
        branches: [
          { name: 'Ikeja', sales_count: 3, revenue: 4000 },
          { name: 'Lekki', sales_count: 1, revenue: 500 },
        ],
      }),
    )
    expect(filename).toBe('zerobyte-daily-report-2026-11-09.pdf')
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  })
  it('builds the weekly day-by-day table', () => {
    const { doc } = buildReportPdf(
      report({
        kind: 'weekly',
        period_from: '2026-11-02',
        period_to: '2026-11-08',
        days: 7,
        daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${2 + i}`, sales_count: i, revenue: i * 1000 })),
      }),
    )
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })
})
