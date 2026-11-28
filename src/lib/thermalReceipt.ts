import { jsPDF } from 'jspdf'
import { pdfSafe, type ReceiptPdfData } from './receiptPdf'

// A receipt for the 58 mm and 80 mm roll printers most shops use (Bluetooth and USB thermal printers, and the printer
// built into many POS devices). One narrow, tall page in a fixed-width font so the columns always line up, with no
// colours and no logo: it prints crisply in black and white and the page is exactly as long as the receipt.
export type PaperWidth = 58 | 80
export type ThermalBusiness = {
  name: string
  tagline?: string
  address: string
  phone: string
  email: string
  website: string
  currency: string
}

const PT_PER_MM = 72 / 25.4
const TOTAL_SIZE = 1.15

/** Word-wraps text to a number of characters; a word longer than a line is cut. */
export function wrapText(text: string, columns: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let rest = word
    while (rest.length > columns) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(rest.slice(0, columns))
      rest = rest.slice(columns)
    }
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= columns) line += ` ${rest}`
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** "left      right" filling exactly the given number of characters; the left side gives way if they do not both fit. */
export function pairLine(left: string, right: string, columns: number) {
  const room = Math.max(columns - right.length - 1, 1)
  const clipped = left.length > room ? left.slice(0, room) : left
  return clipped + ' '.repeat(Math.max(columns - clipped.length - right.length, 1)) + right
}

type Line = { text: string; bold?: boolean; size?: number; center?: boolean }

export function thermalLines(receipt: ReceiptPdfData, business: ThermalBusiness, columns: number): Line[] {
  const amount = (value: number) => Number(value).toLocaleString('en-NG')
  const rule = '-'.repeat(columns)
  const lines: Line[] = []
  const centered = (text: string, bold = false) =>
    wrapText(pdfSafe(text), columns).forEach((part) => lines.push({ text: part, center: true, bold }))
  centered(business.name || 'Receipt', true)
  if (business.tagline) centered(business.tagline)
  if (business.address) centered(business.address)
  if (business.phone) centered(business.phone)
  lines.push({ text: rule })
  lines.push({ text: pairLine('Receipt', receipt.receiptNumber, columns) })
  lines.push({
    text: pdfSafe(new Date(receipt.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })),
  })
  const customerName = receipt.customer?.name
  if (customerName)
    wrapText(pdfSafe(`Customer: ${customerName}`), columns).forEach((part) => lines.push({ text: part }))
  lines.push({ text: rule })
  for (const item of receipt.items) {
    wrapText(pdfSafe(item.name), columns).forEach((part) => lines.push({ text: part, bold: true }))
    lines.push({ text: pairLine(`${item.quantity} x ${amount(item.unitPrice)}`, amount(item.lineTotal), columns) })
  }
  lines.push({ text: rule })
  lines.push({ text: pairLine('Subtotal', amount(receipt.subtotal), columns) })
  if ((receipt.discountAmount ?? 0) > 0)
    lines.push({ text: pairLine('Discount', `-${amount(receipt.discountAmount ?? 0)}`, columns) })
  if (receipt.taxAmount > 0)
    lines.push({ text: pairLine(pdfSafe(receipt.taxLabel), amount(receipt.taxAmount), columns) })
  lines.push({
    // Printed larger, so fewer characters fit on the line.
    text: pairLine('TOTAL', `${pdfSafe(business.currency)} ${amount(receipt.total)}`, Math.floor(columns / TOTAL_SIZE)),
    bold: true,
    size: TOTAL_SIZE,
  })
  lines.push({ text: pairLine('Paid by', pdfSafe(receipt.paymentMethod), columns) })
  lines.push({ text: rule })
  centered('Thank you!', true)
  if (business.website) centered(business.website)
  centered('Powered by Zerobyte')
  return lines
}

export function buildThermalReceiptPdf(
  receipt: ReceiptPdfData,
  business: ThermalBusiness,
  paper: PaperWidth = 80,
): jsPDF {
  const width = Math.round(paper * PT_PER_MM * 100) / 100
  const margin = paper === 58 ? 6 : 8
  const fontSize = paper === 58 ? 7.2 : 8.4
  const columns = Math.floor((width - margin * 2) / (fontSize * 0.6)) // Courier: every character is 0.6 of the font size wide
  const lines = thermalLines(receipt, business, columns)
  const leading = fontSize * 1.4
  const height = Math.ceil(margin + lines.reduce((total, line) => total + leading * (line.size ?? 1), 0) + margin * 2)
  const doc = new jsPDF({ unit: 'pt', format: [width, Math.max(height, width + 1)] })
  doc.setTextColor(0, 0, 0)
  let y = margin + fontSize
  for (const line of lines) {
    doc.setFont('courier', line.bold ? 'bold' : 'normal')
    doc.setFontSize(fontSize * (line.size ?? 1))
    if (line.center) doc.text(line.text, width / 2, y, { align: 'center' })
    else doc.text(line.text, margin, y)
    y += leading * (line.size ?? 1)
  }
  return doc
}
