export function formatAdminValue(column: string, value: string | number | null) {
  if (value == null || value === '') return '—'
  if (['created_at', 'updated_at', 'last_sign_in_at', 'sent_at'].includes(column)) {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
  }
  return String(value)
}
