// Daily and weekly reports: the shape the database builds, plus everything that turns it into text, CSV and a
// WhatsApp message. The numbers are NEVER recalculated here; the database builds them once so the Overview, the stored
// reports, the PDF, the CSV and the notification can never disagree.
import { paymentMethodLabel } from './format'

export type ReportKind = 'daily' | 'weekly'
export type ReportPayload = {
  version: number
  kind: ReportKind
  period_from: string
  period_to: string
  days: number
  timezone: string
  generated_at: string
  business: { name: string; currency: string }
  summary: {
    revenue: number
    sales_count: number
    average_sale: number
    items_sold: number
    cogs: number
    gross_profit: number
    operating_expenses: number
    net_profit: number
    discounts: number
    tax_collected: number
    refunds_count: number
    refunds_total: number
  }
  comparison: {
    previous_from: string
    previous_to: string
    previous_revenue: number
    previous_sales_count: number
    revenue_change_pct: number | null
  }
  payments: {
    by_method: { method: string; sales_count: number; total: number }[]
    credit_sales_total: number
    credit_collected: number
  }
  top_products: { name: string; quantity: number; revenue: number }[]
  low_stock: { count: number; items: { name: string; stock: number; reorder_point: number }[] }
  new_products: { count: number; names: string[] }
  customers: {
    new_count: number
    new_names: string[]
    top: { name: string; sales_count: number; total: number }[]
    owing_count: number
    owing_total: number
  }
  staff: { name: string; sales_count: number; revenue: number }[]
  branches: { name: string; sales_count: number; revenue: number }[]
  expense_categories: { category: string; amount: number }[]
  daily: { date: string; sales_count: number; revenue: number }[]
  peak_hour: { hour: number; revenue: number } | null
}

/** Today's date (YYYY-MM-DD) on the wall clock of the business's own time zone, not the browser's or UTC. */
export function localDateIn(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  }
}

export function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}

const longDate = (iso: string, withYear = true) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })

export function reportPeriodLabel(report: Pick<ReportPayload, 'kind' | 'period_from' | 'period_to'>): string {
  if (report.kind === 'daily') return longDate(report.period_from)
  const from = new Date(`${report.period_from}T12:00:00Z`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const to = new Date(`${report.period_to}T12:00:00Z`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return `${from} to ${to}`
}

export function reportTitle(report: Pick<ReportPayload, 'kind' | 'period_from' | 'period_to'>): string {
  return `${report.kind === 'daily' ? 'Daily' : 'Weekly'} report: ${reportPeriodLabel(report)}`
}

export function reportMoney(value: number | string | null | undefined, currency = 'NGN'): string {
  const amount = Math.round(Number(value ?? 0))
  const grouped = Math.abs(amount).toLocaleString('en-NG')
  return `${currency === 'NGN' ? '₦' : `${currency} `}${amount < 0 ? '-' : ''}${grouped}`
}

export function changeLabel(report: ReportPayload): string | null {
  const change = report.comparison.revenue_change_pct
  if (change === null || change === undefined) return null
  const versus = report.kind === 'daily' ? 'the day before' : 'the week before'
  if (Number(change) === 0) return `Same as ${versus}`
  // A huge percentage from a tiny starting figure is noise, not news.
  const size = Math.abs(Number(change)) > 999 ? 'over 999' : String(Math.abs(Number(change)))
  return `${Number(change) > 0 ? 'Up' : 'Down'} ${size}% on ${versus}`
}

export function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? 'pm' : 'am'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${suffix}`
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** The WhatsApp message: short enough to read on a phone, with the facts an owner wants at a glance. */
export function reportWhatsAppText(report: ReportPayload): string {
  const c = report.business.currency
  const s = report.summary
  const lines: string[] = [`*${report.business.name}*`, `*${reportTitle(report)}*`, '']
  lines.push(`Sales: ${reportMoney(s.revenue, c)} from ${plural(s.sales_count, 'sale')}`)
  lines.push(`Profit: ${reportMoney(s.net_profit, c)} after expenses of ${reportMoney(s.operating_expenses, c)}`)
  const change = changeLabel(report)
  if (change) lines.push(change)
  if (report.top_products.length) {
    lines.push('', '*Top sellers*')
    report.top_products
      .slice(0, 3)
      .forEach((p, i) => lines.push(`${i + 1}. ${p.name}: ${p.quantity} sold (${reportMoney(p.revenue, c)})`))
  }
  if (report.customers.new_count > 0)
    lines.push(
      '',
      `New customers: ${report.customers.new_count}${report.customers.new_names.length ? ` (${report.customers.new_names.slice(0, 3).join(', ')})` : ''}`,
    )
  if (report.customers.owing_total > 0)
    lines.push(
      `Owed to you: ${reportMoney(report.customers.owing_total, c)} by ${plural(report.customers.owing_count, 'customer')}`,
    )
  if (report.low_stock.count > 0) lines.push(`Running low: ${plural(report.low_stock.count, 'item')}`)
  lines.push('', 'Sent from Zerøbyte Business')
  return lines.join('\n')
}

export function reportWhatsAppUrl(report: ReportPayload): string {
  return `https://wa.me/?text=${encodeURIComponent(reportWhatsAppText(report))}`
}

/** One flat table for spreadsheets: a Section column keeps everything readable in a single sheet. */
export function reportCsvRows(report: ReportPayload): { headers: string[]; rows: (string | number)[][] } {
  const headers = ['Section', 'Item', 'Count', 'Amount']
  const s = report.summary
  const rows: (string | number)[][] = [
    ['Report', reportTitle(report), '', ''],
    ['Business', report.business.name, '', ''],
    ['Summary', 'Revenue', s.sales_count, s.revenue],
    ['Summary', 'Cost of goods', '', s.cogs],
    ['Summary', 'Gross profit', '', s.gross_profit],
    ['Summary', 'Operating expenses', '', s.operating_expenses],
    ['Summary', 'Net profit', '', s.net_profit],
    ['Summary', 'Items sold', s.items_sold, ''],
    ['Summary', 'Average sale', '', s.average_sale],
    ['Summary', 'Discounts given', '', s.discounts],
    ['Summary', 'Refunds', s.refunds_count, s.refunds_total],
    [
      'Comparison',
      'Previous period revenue',
      report.comparison.previous_sales_count,
      report.comparison.previous_revenue,
    ],
    ...report.payments.by_method.map((m): (string | number)[] => [
      'Payment method',
      paymentMethodLabel(m.method),
      m.sales_count,
      m.total,
    ]),
    ['Credit', 'Sold on credit', '', report.payments.credit_sales_total],
    ['Credit', 'Credit repayments received', '', report.payments.credit_collected],
    ...report.top_products.map((p): (string | number)[] => ['Top product', p.name, p.quantity, p.revenue]),
    ['Customers', 'New customers', report.customers.new_count, ''],
    ...report.customers.top.map((p): (string | number)[] => ['Top customer', p.name, p.sales_count, p.total]),
    ['Customers', 'Customers who owe', report.customers.owing_count, report.customers.owing_total],
    ...report.staff.map((p): (string | number)[] => ['Team member', p.name, p.sales_count, p.revenue]),
    ...report.branches.map((p): (string | number)[] => ['Branch', p.name, p.sales_count, p.revenue]),
    ...report.expense_categories.map((p): (string | number)[] => ['Expense', p.category, '', p.amount]),
    ...report.low_stock.items.map((p): (string | number)[] => ['Low stock', p.name, p.stock, '']),
    ...report.daily.map((p): (string | number)[] => ['Day', p.date, p.sales_count, p.revenue]),
  ]
  return { headers, rows }
}

export function reportFilename(
  report: Pick<ReportPayload, 'kind' | 'period_from' | 'period_to'>,
  extension: 'pdf' | 'csv',
): string {
  const range = report.kind === 'daily' ? report.period_from : `${report.period_from}_to_${report.period_to}`
  return `zerobyte-${report.kind}-report-${range}.${extension}`
}
