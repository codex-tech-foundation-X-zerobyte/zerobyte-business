import { describe, expect, it } from 'vitest'
import type { ReceiptPdfData } from './receiptPdf'
import { buildThermalReceiptPdf, pairLine, thermalLines, wrapText } from './thermalReceipt'

const receipt: ReceiptPdfData = {
  receiptNumber: 'RC-000123',
  createdAt: '2026-11-18T10:30:00Z',
  paymentMethod: 'Transfer',
  subtotal: 9500,
  discountAmount: 500,
  taxAmount: 675,
  taxLabel: 'VAT (7.5%)',
  total: 9675,
  amountInWords: 'Nine thousand six hundred and seventy five naira',
  customer: { name: 'Ada Obi' } as ReceiptPdfData['customer'],
  items: [
    { name: 'Premium long grain parboiled rice 50kg bag', quantity: 1, unitPrice: 5000, lineTotal: 5000 },
    { name: 'Peak milk tin', quantity: 5, unitPrice: 900, lineTotal: 4500 },
  ],
}
const business = {
  name: 'Ada Provisions',
  tagline: '',
  address: '12 Market Road, Lagos',
  phone: '0801 234 5678',
  email: '',
  website: '',
  currency: 'NGN',
}

describe('thermal receipt layout', () => {
  it('wraps words to the printer width and cuts a word that is too long', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrapText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
    expect(wrapText('   ', 5)).toEqual([''])
  })
  it('puts a figure on the right edge, keeping the line exactly the width', () => {
    expect(pairLine('Subtotal', '9,500', 20)).toBe('Subtotal       9,500')
    expect(pairLine('A very long product name', '1,000', 16)).toHaveLength(16)
  })
  it('never makes a line wider than the paper allows, also the larger TOTAL line', () => {
    for (const columns of [30, 36, 42]) {
      for (const line of thermalLines(receipt, business, columns))
        expect(line.text.length * (line.size ?? 1)).toBeLessThanOrEqual(columns)
    }
  })
  it('lists the items, the totals and the payment method', () => {
    const text = thermalLines(receipt, business, 40)
      .map((line) => line.text)
      .join('\n')
    expect(text).toContain('RC-000123')
    expect(text).toContain('5 x 900')
    expect(text).toContain('Discount')
    expect(text).toContain('NGN 9,675')
    expect(text).toContain('Transfer')
  })
})

describe('thermal receipt PDF', () => {
  it('is one page exactly as wide as the roll (80 mm and 58 mm)', () => {
    for (const [paper, mm] of [
      [80, 80],
      [58, 58],
    ] as const) {
      const doc = buildThermalReceiptPdf(receipt, business, paper)
      expect(doc.getNumberOfPages()).toBe(1)
      expect(doc.internal.pageSize.getWidth()).toBeCloseTo((mm * 72) / 25.4, 1)
      expect(doc.internal.pageSize.getHeight()).toBeGreaterThan(200)
      expect(String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))).toBe('%PDF-')
    }
  })
})
