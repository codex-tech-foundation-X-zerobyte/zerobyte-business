// WhatsApp deep links ("click to chat") need the number in international format with digits only.
// Nigerian numbers are commonly typed as 0803 123 4567, so a leading 0 is read as +234.
export function toWhatsAppNumber(input: string | null | undefined, defaultCountryCode = '234'): string | null {
  let digits = String(input ?? '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1)
  digits = digits.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

// Opens a chat with `phone` (or the share sheet when no number is given) with the message prefilled.
export function whatsappUrl(message: string, phone?: string | null): string {
  const number = toWhatsAppNumber(phone)
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(message)}`
}
