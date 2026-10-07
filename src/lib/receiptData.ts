import type { ReceiptRow } from './types'

// One place decides who a receipt is for, so the on-screen preview and the PDF can never disagree.
export type ReceiptCustomerView =
  | { kind: 'registered'; name: string; lines: string[] }
  | { kind: 'walk-in'; name: string; lines: string[] }
  | { kind: 'unavailable'; name: string; lines: string[] }

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function describeReceiptCustomer(row: Pick<ReceiptRow, 'customer_id' | 'customer'>): ReceiptCustomerView {
  const customer = row.customer
  const name = clean(customer?.name)
  if (customer && name) {
    // Order requested for receipts: phone, address, email. Missing/blank fields are simply left out.
    return { kind: 'registered', name, lines: [customer.phone, customer.address, customer.email].map(clean).filter(Boolean) }
  }
  // The sale points at a customer record this viewer cannot read (e.g. another branch's customer).
  // That is not a walk-in, so do not label it as one.
  if (row.customer_id) return { kind: 'unavailable', name: 'Registered customer', lines: [] }
  return { kind: 'walk-in', name: 'Walk-in customer', lines: [] }
}

const first = (value: unknown) => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null))

// PostgREST returns an embedded relation under the key it was requested with ("customer:customers(...)"
// -> `customer`). Receipts used to request `customers(...)` and read `.customer`, which was always
// undefined, so every receipt looked like a walk-in. This accepts either key and either shape.
export function normalizeReceiptRow(raw: Record<string, unknown>): ReceiptRow {
  return {
    ...(raw as unknown as ReceiptRow),
    customer_id: (raw.customer_id as string | null | undefined) ?? null,
    customer: first(raw.customer ?? raw.customers) as ReceiptRow['customer'],
    sale_items: Array.isArray(raw.sale_items) ? (raw.sale_items as ReceiptRow['sale_items']) : [],
  }
}

export function businessContactLine(business: { address?: string; phone?: string; email?: string; website?: string }) {
  return [business.address, business.phone, business.email, business.website].map(clean).filter(Boolean)
}
