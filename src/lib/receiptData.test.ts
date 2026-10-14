import { describe, expect, it } from 'vitest'
import { businessContactLine, describeReceiptCustomer, normalizeReceiptRow } from './receiptData'

const john = { name: 'John Doe', phone: '+2348030000001', email: 'john@example.com', address: '12 Ogui Road, Enugu' }

describe('describeReceiptCustomer', () => {
  it('shows the registered customer in phone, address, email order', () => {
    const view = describeReceiptCustomer({ customer_id: 'c1', customer: john })
    expect(view).toEqual({ kind: 'registered', name: 'John Doe', lines: ['+2348030000001', '12 Ogui Road, Enugu', 'john@example.com'] })
  })
  it('omits missing, null and blank fields instead of printing placeholders', () => {
    const view = describeReceiptCustomer({ customer_id: 'c2', customer: { name: 'Mary', phone: null, email: '   ', address: undefined as unknown as null } })
    expect(view.kind).toBe('registered')
    expect(view.lines).toEqual([])
    expect(JSON.stringify(view)).not.toMatch(/null|undefined/)
  })
  it('labels a sale with no customer as a walk-in', () => {
    expect(describeReceiptCustomer({ customer_id: null, customer: null })).toMatchObject({ kind: 'walk-in', name: 'Walk-in customer' })
  })
  it('does not call a sale a walk-in when it points at a customer the viewer cannot read', () => {
    expect(describeReceiptCustomer({ customer_id: 'c3', customer: null })).toMatchObject({ kind: 'unavailable' })
  })
})

describe('normalizeReceiptRow', () => {
  const base = { id: 's1', customer_id: 'c1', sale_items: [] }
  it('reads the aliased `customer` key', () => {
    expect(normalizeReceiptRow({ ...base, customer: john }).customer).toEqual(john)
  })
  it('still reads the un-aliased `customers` key (the shape that caused the original bug)', () => {
    expect(normalizeReceiptRow({ ...base, customers: john }).customer).toEqual(john)
  })
  it('unwraps a one-element array and defaults a missing relation to null', () => {
    expect(normalizeReceiptRow({ ...base, customer: [john] }).customer).toEqual(john)
    expect(normalizeReceiptRow({ id: 's2' }).customer).toBeNull()
    expect(normalizeReceiptRow({ id: 's2' }).customer_id).toBeNull()
  })
})

describe('businessContactLine', () => {
  it('keeps only the contact details the business actually has', () => {
    expect(businessContactLine({ address: '1 Alpha Rd', phone: '', email: ' hi@a.test ', website: undefined })).toEqual(['1 Alpha Rd', 'hi@a.test'])
  })
})
