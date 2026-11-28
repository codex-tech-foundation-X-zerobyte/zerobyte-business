// Keeps backend and database wording out of anything a visitor can read (screens, the browser console, saved logs).
//
// Technical failures arrive as short sentences such as: new row for relation "products" violates check constraint
// "products_stock_check". Visitors should never see table names, constraint names, SQL words or the name of the tool
// that stores the data. This wrapper sits on every request the app makes, rewrites the message of an error response
// when it looks technical, and drops the `details` and `hint` fields. The `code` is kept untouched because the app
// uses it to decide what to do (for example a conflict or a missing feature).
//
// Messages written for people (for example "Not enough stock for Indomie") pass through unchanged.

const TECHNICAL =
  /\b(relation|constraint|violates|syntax error|duplicate key|null value|schema|postgres|postgrest|supabase|jwt|rls|row[- ]level|sql|pgrst|pg_|function public\.|permission denied|could not serialize|deadlock|invalid input syntax|foreign key|stack depth|statement timeout|auth\/v1|rest\/v1)\b/i

const BY_CODE: Record<string, string> = {
  '23505': 'That already exists.',
  '23503': 'This is linked to other records, so it cannot be changed that way.',
  '23502': 'A required detail is missing.',
  '23514': 'That value is not allowed.',
  '22P02': 'One of the details is not in the right format.',
  '42501': 'You do not have permission to do that.',
  PGRST301: 'Your session has expired. Please sign in again.',
  PGRST303: 'Your session has expired. Please sign in again.',
  '57014': 'That took too long. Please try again.',
}

const GENERIC = 'Something went wrong. Please try again.'

export function safeMessage(message: unknown, code?: unknown): string {
  const text = typeof message === 'string' ? message : ''
  const key = typeof code === 'string' ? code : ''
  if (text && !TECHNICAL.test(text)) return text
  if (BY_CODE[key]) return BY_CODE[key]
  // Admin screens test for this phrase to say "not set up yet"; keep it, without the technical name that came with it.
  if (/does not exist/i.test(text)) return 'This feature does not exist yet.'
  return text ? GENERIC : text
}

function clean(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const record = { ...(body as Record<string, unknown>) }
  const code = record.code ?? record.error_code
  for (const field of ['message', 'msg', 'error', 'error_description'] as const) {
    if (typeof record[field] === 'string') record[field] = safeMessage(record[field], code)
  }
  delete record.details
  delete record.hint
  return record
}

/** Wraps a fetch so error responses never carry technical wording. Successful responses are returned untouched. */
export function withSafeErrors(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init)
    if (response.ok) return response
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('json')) return response
    try {
      const body = await response.clone().json()
      const headers = new Headers(response.headers)
      headers.delete('content-length')
      headers.delete('content-encoding')
      return new Response(JSON.stringify(clean(body)), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch {
      return response
    }
  }
}
