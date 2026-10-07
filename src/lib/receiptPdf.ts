import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ReceiptCustomerView } from './receiptData'

export type ReceiptPdfItem = { name: string; sku?: string | null; quantity: number; unitPrice: number; lineTotal: number }
export type ReceiptPdfData = {
  receiptNumber: string
  createdAt: string
  paymentMethod: string
  subtotal: number
  discountAmount?: number
  taxAmount: number
  taxLabel: string
  total: number
  amountInWords: string
  customer: ReceiptCustomerView
  items: ReceiptPdfItem[]
}
export type ReceiptPdfBusiness = {
  name: string
  tagline?: string
  address: string
  phone: string
  email: string
  website: string
  currency: string
  logoDataUrl?: string | null
}

// The on-screen receipt's palette (see `.receipt-*` in styles.css). The PDF used to set no colour at
// all -- only black text and a near-black table header -- which is why it looked black and white next
// to the green preview. It is drawn with jsPDF primitives rather than captured from the DOM, so the
// colours have to be declared here.
type Rgb = [number, number, number]
const COLOR = {
  title: [16, 80, 46] as Rgb, // #10502e
  accent: [20, 164, 87] as Rgb, // #14a457 (table header)
  total: [22, 161, 87] as Rgb, // #16a157
  paleFill: [244, 250, 247] as Rgb, // #f4faf7
  border: [220, 236, 228] as Rgb, // #dcece4
  metaBorder: [216, 241, 228] as Rgb, // #d8f1e4
  text: [30, 45, 38] as Rgb,
  muted: [96, 128, 112] as Rgb, // #608070
  faint: [132, 155, 144] as Rgb, // #849b90
}

// jsPDF's built-in fonts only cover Latin-1. Characters outside it (e.g. the dotted vowels common in
// Yoruba/Igbo names, or typographic symbols) would otherwise print as garbage. Strip accents where
// possible and substitute '?' for anything that still cannot be drawn.
export function pdfSafe(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\t\n -~\u00a0-\u00ff]/g, '?')
}

const money = (business: ReceiptPdfBusiness, value: number) => pdfSafe(`${business.currency} ${Number(value).toLocaleString('en-NG')}`)

// Builds the receipt as a real PDF document (not a browser print-to-PDF of the on-screen preview), so it
// can be downloaded directly and attached to a share sheet as an actual file.
export function buildReceiptPdf(receipt: ReceiptPdfData, business: ReceiptPdfBusiness): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 40
  const contentWidth = pageWidth - margin * 2
  let y = 46

  const color = (rgb: Rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2])
  const stroke = (rgb: Rgb, width = 0.8) => { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(width) }
  const ensureSpace = (needed: number) => { if (y + needed > pageHeight - 60) { doc.addPage(); y = 56 } }

  // --- Business header: logo, name, optional slogan, contact details -------------------------------
  let textX = margin
  if (business.logoDataUrl) {
    try {
      const { width, height } = doc.getImageProperties(business.logoDataUrl)
      const box = 46
      const scale = Math.min(box / width, box / height)
      doc.addImage(business.logoDataUrl, 'PNG', margin, y - 8, width * scale, height * scale)
      textX = margin + 58
    } catch { /* the logo is best-effort; a bad image must never block the receipt */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); color(COLOR.title)
  doc.text(pdfSafe(business.name), textX, y + 8, { maxWidth: pageWidth - margin - textX })
  let headerBottom = y + 22
  const tagline = pdfSafe(business.tagline).trim()
  if (tagline) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); color(COLOR.accent)
    doc.text(tagline, textX, headerBottom, { maxWidth: pageWidth - margin - textX })
    headerBottom += 13
  }
  const contact = [business.address, business.phone, business.email, business.website].map((part) => pdfSafe(part).trim()).filter(Boolean).join('  |  ')
  if (contact) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color(COLOR.muted)
    const lines = doc.splitTextToSize(contact, pageWidth - margin - textX) as string[]
    doc.text(lines, textX, headerBottom)
    headerBottom += lines.length * 11
  }
  y = Math.max(headerBottom, y + 46) + 12
  stroke(COLOR.border, 1); doc.line(margin, y, pageWidth - margin, y)
  y += 28

  // --- Title + receipt number / date -----------------------------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(21); color(COLOR.title)
  doc.text('SALES RECEIPT', margin, y + 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(COLOR.muted)
  doc.text('Thank you for your business!', margin, y + 22)
  const boxW = 205
  const boxX = pageWidth - margin - boxW
  stroke(COLOR.metaBorder, 1); doc.roundedRect(boxX, y - 14, boxW, 50, 5, 5, 'S')
  doc.setFontSize(7.5); color(COLOR.faint)
  doc.text('RECEIPT NO.', boxX + 12, y - 1); doc.text('DATE & TIME', boxX + 12, y + 22)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); color(COLOR.text)
  doc.text(pdfSafe(receipt.receiptNumber), boxX + 12, y + 10)
  doc.text(pdfSafe(new Date(receipt.createdAt).toLocaleString('en-NG')), boxX + 12, y + 33)
  y += 62

  // --- Customer (same decision logic as the on-screen preview) ------------------------------------------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); color(COLOR.accent)
  doc.text('CUSTOMER', margin, y)
  y += 14
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); color(receipt.customer.kind === 'registered' ? COLOR.text : COLOR.muted)
  doc.text(pdfSafe(receipt.customer.name), margin, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(COLOR.muted)
  for (const line of receipt.customer.lines) {
    y += 13
    doc.text(pdfSafe(line), margin, y, { maxWidth: contentWidth })
  }
  y += 18

  // --- Line items --------------------------------------------------------------------------------------
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['#', 'Item', 'Qty', 'Unit price', 'Total']],
    body: receipt.items.map((item, index) => [
      String(index + 1),
      pdfSafe(item.sku ? `${item.name}\n${item.sku}` : item.name),
      String(item.quantity),
      money(business, item.unitPrice),
      money(business, item.lineTotal),
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, textColor: COLOR.text, lineColor: COLOR.border, lineWidth: 0.6 },
    headStyles: { fillColor: COLOR.accent, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'center', cellWidth: 40 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    didParseCell: (data) => { if (data.section === 'head' && [2, 3, 4].includes(data.column.index)) data.cell.styles.halign = data.column.index === 2 ? 'center' : 'right' },
  })
  // autoTable extends the jsPDF instance with lastAutoTable at runtime; jsPDF's own types don't know it.
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24

  // --- Totals ---------------------------------------------------------------------------------------------
  ensureSpace(150)
  const summaryX = pageWidth - margin - 200
  const summaryRow = (label: string, value: string, options: { bold?: boolean; accent?: boolean } = {}) => {
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal')
    doc.setFontSize(options.accent ? 12 : 10)
    color(options.accent ? COLOR.total : COLOR.text)
    doc.text(pdfSafe(label), summaryX, y)
    doc.text(value, pageWidth - margin, y, { align: 'right' })
    y += options.accent ? 20 : 16
  }
  summaryRow('Subtotal', money(business, receipt.subtotal))
  if ((receipt.discountAmount ?? 0) > 0) summaryRow('Discount', `- ${money(business, receipt.discountAmount ?? 0)}`)
  summaryRow(receipt.taxLabel, money(business, receipt.taxAmount))
  stroke(COLOR.accent, 1); doc.line(summaryX, y - 6, pageWidth - margin, y - 6)
  y += 6
  summaryRow('Total', money(business, receipt.total), { bold: true, accent: true })
  y += 2

  // --- Payment + amount in words --------------------------------------------------------------------------
  ensureSpace(110)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(COLOR.muted)
  doc.text('Payment method', margin, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); color(COLOR.text)
  doc.text(pdfSafe(receipt.paymentMethod), margin + 90, y)
  y += 18
  const words = doc.splitTextToSize(pdfSafe(receipt.amountInWords), contentWidth - 24) as string[]
  const wordsHeight = 34 + words.length * 12
  doc.setFillColor(COLOR.paleFill[0], COLOR.paleFill[1], COLOR.paleFill[2])
  doc.roundedRect(margin, y, contentWidth, wordsHeight, 5, 5, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); color(COLOR.accent)
  doc.text('AMOUNT IN WORDS', margin + 12, y + 16)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); color(COLOR.text)
  doc.text(words, margin + 12, y + 31)
  y += wordsHeight + 28

  // --- Footer -----------------------------------------------------------------------------------------------
  ensureSpace(40)
  stroke(COLOR.border, 1); doc.line(margin, y, pageWidth - margin, y)
  y += 18
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); color(COLOR.title)
  doc.text('Thank you for your business.', margin, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color(COLOR.faint)
  doc.text(pdfSafe('Powered by Zerøbyte'), pageWidth - margin, y, { align: 'right' })

  return doc
}

export function receiptPdfFilename(receiptNumber: string) {
  return `receipt-${receiptNumber.replace(/[^a-z0-9-]/gi, '-')}.pdf`
}

// jsPDF's addImage needs a raster data URL, not a bare remote URL. The logo is re-drawn onto a canvas and
// exported as PNG, which (a) accepts the WEBP and SVG logos the Settings screen allows -- jsPDF cannot
// embed those directly -- (b) keeps transparency, and (c) caps the embedded size so a 2 MB upload does not
// bloat every receipt. Best-effort: on any failure the caller proceeds without a logo.
export async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) return null
    const objectUrl = URL.createObjectURL(await response.blob())
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('Logo could not be decoded'))
        element.src = objectUrl
      })
      const naturalWidth = image.naturalWidth || 256
      const naturalHeight = image.naturalHeight || 256
      const scale = Math.min(1, 320 / Math.max(naturalWidth, naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png')
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null
  }
}
