import { describe, expect, it } from 'vitest'
import { toWhatsAppNumber, whatsappUrl } from './whatsapp'

describe('toWhatsAppNumber', () => {
  it('turns a local Nigerian number into international format', () => {
    expect(toWhatsAppNumber('0803 123 4567')).toBe('2348031234567')
    expect(toWhatsAppNumber('08031234567')).toBe('2348031234567')
  })
  it('keeps numbers that already carry a country code', () => {
    expect(toWhatsAppNumber('+234 803 123 4567')).toBe('2348031234567')
    expect(toWhatsAppNumber('2348031234567')).toBe('2348031234567')
    expect(toWhatsAppNumber('0044 7911 123456')).toBe('447911123456')
    expect(toWhatsAppNumber('+1 (415) 555-2671')).toBe('14155552671')
  })
  it('rejects values that cannot be a phone number', () => {
    expect(toWhatsAppNumber('')).toBeNull()
    expect(toWhatsAppNumber(null)).toBeNull()
    expect(toWhatsAppNumber('12345')).toBeNull()
    expect(toWhatsAppNumber('not a number')).toBeNull()
  })
})

describe('whatsappUrl', () => {
  it('encodes the message and targets the number', () => {
    expect(whatsappUrl('Hi & welcome', '0803 123 4567')).toBe('https://wa.me/2348031234567?text=Hi%20%26%20welcome')
  })
  it('falls back to the share sheet when there is no usable number', () => {
    expect(whatsappUrl('Hello', 'bad')).toBe('https://wa.me/?text=Hello')
  })
})
