import { describe, expect, it } from 'vitest'
import { paymentMethodLabel } from './format'

describe('paymentMethodLabel', () => {
  it('turns stored enum values into readable labels', () => {
    expect(paymentMethodLabel('bank_transfer')).toBe('Bank transfer')
    expect(paymentMethodLabel('cash')).toBe('Cash')
    expect(paymentMethodLabel('pos')).toBe('Pos')
  })
  it('never renders blank or "null" for missing values', () => {
    expect(paymentMethodLabel(null)).toBe('—')
    expect(paymentMethodLabel(undefined)).toBe('—')
    expect(paymentMethodLabel('')).toBe('—')
  })
})
