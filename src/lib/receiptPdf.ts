import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export type ReceiptPdfItem = { name: string; sku?: string | null; quantity: number; unitPrice: number; lineTotal: number }
export type ReceiptPdfCustomer = { name: string; phone?: string | null; email?: string | null } | null
export type ReceiptPdfData = {
  receiptNumber: string
  createdAt: string
  paymentMethod: string
  subtotal: number
  taxAmount: number
  taxLabel: string
  total: number
  amountInWords: string
  customer: ReceiptPdfCustomer
  items: ReceiptPdfItem[]
}
export type ReceiptPdfBusiness = { name: string; address: string; phone: string; email: string; website: string; currency: string; logoDataUrl?: string | null }

const money = (business: ReceiptPdfBusiness, value: number) => `${business.currency} ${Number(value).toLocaleString('en-NG')}`

// Builds the receipt as a real PDF document (not a browser print-to-PDF of
// the on-screen preview), so it can be downloaded directly and attached to
// a share sheet as an actual file rather than relying on the user manually
// picking "Save as PDF" from the print dialog.
export function buildReceiptPdf(receipt: ReceiptPdfData, business: ReceiptPdfBusiness): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

  if (business.logoDataUrl) {
    try { doc.addImage(business.logoDataUrl, 'PNG', margin, y - 20, 40, 40) } catch { /* logo is best-effort; a bad data URL should never block the receipt */ }
  }
  const textX = business.logoDataUrl ? margin + 52 : margin
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text(business.name || 'Zerøbyte Business', textX, y)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  const contactLine = [business.address, business.phone, business.email, business.website].filter(Boolean).join('  ·  ')
  if (contactLine) { y += 14; doc.text(contactLine, textX, y) }
  y += 30

  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('SALES RECEIPT', margin, y)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text(`Receipt No: ${receipt.receiptNumber}`, pageWidth - margin, y - 12, { align: 'right' })
  doc.text(new Date(receipt.createdAt).toLocaleString('en-NG'), pageWidth - margin, y, { align: 'right' })
  y += 18

  doc.setDrawColor(210); doc.line(margin, y, pageWidth - margin, y)
  y += 16
  doc.setFont('helvetica', 'bold'); doc.text('Customer', margin, y)
  doc.setFont('helvetica', 'normal')
  const customerLine = receipt.customer
    ? `${receipt.customer.name}${receipt.customer.phone ? `  ·  ${receipt.customer.phone}` : ''}${receipt.customer.email ? `  ·  ${receipt.customer.email}` : ''}`
    : 'Walk-in Customer'
  doc.text(customerLine, margin + 65, y)
  y += 20

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['#', 'Item', 'Qty', 'Unit price', 'Total']],
    body: receipt.items.map((item, index) => [
      String(index + 1),
      item.sku ? `${item.name}\n${item.sku}` : item.name,
      String(item.quantity),
      money(business, item.unitPrice),
      money(business, item.lineTotal),
    ]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [12, 20, 28], textColor: 255 },
    theme: 'grid',
  })
  // autoTable extends the jsPDF instance with lastAutoTable at runtime;
  // jsPDF's own type declarations don't know about the plugin.
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24

  const summaryX = pageWidth - margin - 180
  const summaryRow = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(label, summaryX, y)
    doc.text(value, pageWidth - margin, y, { align: 'right' })
    y += 16
  }
  doc.setFontSize(10)
  summaryRow('Subtotal', money(business, receipt.subtotal))
  summaryRow(receipt.taxLabel, money(business, receipt.taxAmount))
  doc.setDrawColor(210); doc.line(summaryX, y - 4, pageWidth - margin, y - 4)
  summaryRow('Total', money(business, receipt.total), true)
  summaryRow('Payment method', receipt.paymentMethod)
  y += 8

  doc.setFont('helvetica', 'italic'); doc.setFontSize(9)
  doc.text(`Amount in words: ${receipt.amountInWords}`, margin, y, { maxWidth: pageWidth - margin * 2 })
  y += 30

  doc.setDrawColor(230); doc.line(margin, y, pageWidth - margin, y)
  y += 18
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Thank you for your business.', margin, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140)
  doc.text('Powered by Zerøbyte', pageWidth - margin, y, { align: 'right' })

  return doc
}

export function receiptPdfFilename(receiptNumber: string) {
  return `receipt-${receiptNumber.replace(/[^a-z0-9-]/gi, '-')}.pdf`
}

// jsPDF's addImage needs a data URL (or an already-loaded image element), not
// a bare remote URL -- and a cross-origin logo can fail to load at all
// (CORS). This is best-effort: on any failure, the caller proceeds without a
// logo rather than blocking the receipt, matching the existing on-screen
// preview's onError-hides-the-logo behaviour.
export async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
