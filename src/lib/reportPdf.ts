import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { paymentMethodLabel } from './format'
import { pdfSafe } from './receiptPdf'
import { changeLabel, hourLabel, reportFilename, reportPeriodLabel, type ReportPayload } from './reports'

type Rgb = [number, number, number]
const COLOR = {
  title: [16, 80, 46] as Rgb,
  accent: [20, 164, 87] as Rgb,
  paleFill: [244, 250, 247] as Rgb,
  border: [220, 236, 228] as Rgb,
  text: [30, 45, 38] as Rgb,
  muted: [96, 128, 112] as Rgb,
  bad: [180, 60, 50] as Rgb,
}

/** The built-in PDF fonts have no naira sign, so amounts print as "NGN 1,000" (same as the receipts). */
const pdfMoney = (value: number | string | null | undefined, currency: string) => {
  const amount = Math.round(Number(value ?? 0))
  return pdfSafe(`${currency}${amount < 0 ? ' -' : ' '}${Math.abs(amount).toLocaleString('en-NG')}`)
}

/**
 * Builds the report as a real PDF. It draws only what the database already calculated (nothing is recomputed here),
 * and every piece of text goes through pdfSafe, so a name with unusual characters can never break the file.
 */
export function buildReportPdf(report: ReportPayload): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const page = doc.internal.pageSize.getWidth()
  const margin = 40
  const c = report.business.currency
  const s = report.summary
  let y = 48

  doc
    .setFont('helvetica', 'bold')
    .setFontSize(11)
    .setTextColor(...COLOR.muted)
  doc.text(pdfSafe(report.business.name).toUpperCase(), margin, y)
  y += 26
  doc.setFontSize(22).setTextColor(...COLOR.title)
  doc.text(report.kind === 'daily' ? 'Daily report' : 'Weekly report', margin, y)
  y += 18
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(11)
    .setTextColor(...COLOR.muted)
  doc.text(pdfSafe(reportPeriodLabel(report)), margin, y)
  const change = changeLabel(report)
  if (change) {
    doc.text(pdfSafe(change), page - margin, y, { align: 'right' })
  }
  y += 22

  // Four headline boxes.
  const boxes: [string, string][] = [
    ['Revenue', pdfMoney(s.revenue, c)],
    ['Gross profit', pdfMoney(s.gross_profit, c)],
    ['Net profit', pdfMoney(s.net_profit, c)],
    ['Sales', `${s.sales_count.toLocaleString('en-NG')}`],
  ]
  const gap = 10
  const boxWidth = (page - margin * 2 - gap * 3) / 4
  boxes.forEach(([label, value], index) => {
    const x = margin + index * (boxWidth + gap)
    doc
      .setFillColor(...COLOR.paleFill)
      .setDrawColor(...COLOR.border)
      .roundedRect(x, y, boxWidth, 54, 6, 6, 'FD')
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8.5)
      .setTextColor(...COLOR.muted)
    doc.text(label, x + 10, y + 18)
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(label === 'Sales' ? 16 : 12.5)
      .setTextColor(...COLOR.title)
    doc.text(value, x + 10, y + 40, { maxWidth: boxWidth - 16 })
  })
  y += 70

  const section = (title: string, head: string[], body: string[][]) => {
    if (!body.length) return
    // Never leave a table heading stranded at the bottom of a page with its rows on the next one.
    if (y > doc.internal.pageSize.getHeight() - 150) {
      doc.addPage()
      y = 48
    }
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [
        [
          {
            content: pdfSafe(title),
            colSpan: head.length,
            styles: { fillColor: COLOR.title, textColor: 255, fontSize: 9.5 },
          },
        ],
        head,
      ],
      body,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 5,
        textColor: COLOR.text,
        lineColor: COLOR.border,
        lineWidth: 0.5,
      },
      headStyles: { fillColor: COLOR.accent, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      columnStyles: head.length > 1 ? { [head.length - 1]: { halign: 'right' } } : {},
      didDrawPage: () => undefined,
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
  }

  section(
    'Money',
    ['Line', 'Amount'],
    [
      ['Revenue', pdfMoney(s.revenue, c)],
      ['Cost of goods', pdfMoney(s.cogs, c)],
      ['Gross profit', pdfMoney(s.gross_profit, c)],
      ['Operating expenses', pdfMoney(s.operating_expenses, c)],
      ['Net profit', pdfMoney(s.net_profit, c)],
      ...(s.discounts > 0 ? [['Discounts given', pdfMoney(s.discounts, c)]] : []),
      ...(s.refunds_count > 0 ? [[`Refunds (${s.refunds_count})`, pdfMoney(s.refunds_total, c)]] : []),
    ].map((r) => r.map(pdfSafe)),
  )
  section(
    'How customers paid',
    ['Method', 'Sales', 'Amount'],
    report.payments.by_method.map((m) =>
      [paymentMethodLabel(m.method), String(m.sales_count), pdfMoney(m.total, c)].map(pdfSafe),
    ),
  )
  if (report.payments.credit_sales_total > 0 || report.payments.credit_collected > 0)
    section(
      'Credit',
      ['Line', 'Amount'],
      [
        ['Sold on credit', pdfMoney(report.payments.credit_sales_total, c)],
        ['Credit repayments received', pdfMoney(report.payments.credit_collected, c)],
        [`Customers who owe (${report.customers.owing_count})`, pdfMoney(report.customers.owing_total, c)],
      ].map((r) => r.map(pdfSafe)),
    )
  section(
    'Top products',
    ['Product', 'Sold', 'Amount'],
    report.top_products.map((p) => [p.name, String(p.quantity), pdfMoney(p.revenue, c)].map(pdfSafe)),
  )
  section(
    'Customers',
    ['Customer', 'Sales', 'Spent'],
    report.customers.top.map((p) => [p.name, String(p.sales_count), pdfMoney(p.total, c)].map(pdfSafe)),
  )
  if (report.customers.new_count > 0)
    section(
      'New customers',
      ['Name'],
      report.customers.new_names.map((n) => [pdfSafe(n)]),
    )
  if (report.staff.length > 1)
    section(
      'Sales by team member',
      ['Team member', 'Sales', 'Amount'],
      report.staff.map((p) => [p.name, String(p.sales_count), pdfMoney(p.revenue, c)].map(pdfSafe)),
    )
  if (report.branches.length > 1)
    section(
      'Sales by branch',
      ['Branch', 'Sales', 'Amount'],
      report.branches.map((p) => [p.name, String(p.sales_count), pdfMoney(p.revenue, c)].map(pdfSafe)),
    )
  section(
    'Expenses',
    ['Category', 'Amount'],
    report.expense_categories.map((p) => [p.category, pdfMoney(p.amount, c)].map(pdfSafe)),
  )
  if (report.new_products.count > 0)
    section(
      'New products added',
      ['Product'],
      report.new_products.names.map((n) => [pdfSafe(n)]),
    )
  section(
    'Running low',
    ['Product', 'In stock'],
    report.low_stock.items.map((p) => [p.name, String(p.stock)].map(pdfSafe)),
  )
  if (report.kind === 'weekly')
    section(
      'Day by day',
      ['Day', 'Sales', 'Amount'],
      report.daily.map((p) =>
        [
          new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-NG', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          }),
          String(p.sales_count),
          pdfMoney(p.revenue, c),
        ].map(pdfSafe),
      ),
    )
  if (report.kind === 'daily' && report.peak_hour && report.peak_hour.revenue > 0)
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(9)
      .setTextColor(...COLOR.muted)
      .text(`Busiest hour: ${hourLabel(report.peak_hour.hour)}`, margin, y)

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(...COLOR.muted)
    doc.text(
      pdfSafe(`${report.business.name} · generated ${new Date(report.generated_at).toLocaleString('en-NG')}`),
      margin,
      doc.internal.pageSize.getHeight() - 24,
    )
    doc.text(`Page ${i} of ${pages}`, page - margin, doc.internal.pageSize.getHeight() - 24, { align: 'right' })
  }
  return { doc, filename: reportFilename(report, 'pdf') }
}
