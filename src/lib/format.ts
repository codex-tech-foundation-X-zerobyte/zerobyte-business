import { type RecordRange } from './types'

export function normalizeLogoUrl(value: string | null | undefined) {
  if (!value) return ''
  return value.replace('/storage/v1/object/business-logos/', '/storage/v1/object/public/business-logos/')
}

export function recordDates(range: RecordRange, from: string, to: string) {
  if (range === 'all') return { from: '', to: '' }
  if (range === 'custom') return { from, to }
  const end = new Date()
  const start = new Date(end)
  if (range === 'today') start.setHours(0, 0, 0, 0)
  if (range === 'week') start.setDate(end.getDate() - 6)
  if (range === 'month') start.setDate(end.getDate() - 29)
  if (range === 'year') start.setDate(end.getDate() - 364)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

const numberWords = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]

const tensWords = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function wordsUnderThousand(value: number): string {
  if (value < 20) return numberWords[value]
  if (value < 100)
    return `${tensWords[Math.floor(value / 10)]}${value % 10 ? `-${numberWords[value % 10].toLowerCase()}` : ''}`
  return `${numberWords[Math.floor(value / 100)]} Hundred${value % 100 ? ` and ${wordsUnderThousand(value % 100)}` : ''}`
}

export function amountInWords(value: number) {
  const whole = Math.floor(Math.abs(value))
  const kobo = Math.round((Math.abs(value) - whole) * 100)
  if (whole === 0 && kobo === 0) return 'Zero Naira Only'
  const groups = [
    { value: 1_000_000_000, label: 'Billion' },
    { value: 1_000_000, label: 'Million' },
    { value: 1_000, label: 'Thousand' },
  ]
  let remaining = whole
  const parts: string[] = []
  groups.forEach((group) => {
    if (remaining >= group.value) {
      const count = Math.floor(remaining / group.value)
      parts.push(`${wordsUnderThousand(count)} ${group.label}`)
      remaining %= group.value
    }
  })
  if (remaining) parts.push(wordsUnderThousand(remaining))
  return `${parts.join(' ')} Naira${kobo ? ` and ${wordsUnderThousand(kobo)} Kobo` : ''} Only`
}

export function paymentMethodLabel(value: string | null | undefined) {
  const text = String(value ?? '')
    .replace(/_/g, ' ')
    .trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—'
}

// Money display. Whole naira stay clean (₦1,200); kobo show only when present (₦1,200.50).
export function formatNaira(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  const hasKobo = Math.round(Math.abs(amount) * 100) % 100 !== 0
  return `${amount < 0 ? '-' : ''}₦${Math.abs(amount).toLocaleString('en-NG', { minimumFractionDigits: hasKobo ? 2 : 0, maximumFractionDigits: 2 })}`
}

// Short form used only when the full figure cannot fit its box (₦48.2M). The full figure stays in the tooltip.
export function compactNumber(value: number) {
  const abs = Math.abs(value)
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  const unit = units.find(([size]) => abs >= size)
  if (!unit) return value.toLocaleString('en-NG', { maximumFractionDigits: 2 })
  return `${(value / unit[0]).toLocaleString('en-NG', { maximumFractionDigits: 2 })}${unit[1]}`
}
export function compactNaira(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return `${amount < 0 ? '-' : ''}₦${compactNumber(Math.abs(amount))}`
}
