// Shared Paystack helpers for the three payment Edge Functions.
//
// The secret key lives ONLY in the function secret PAYSTACK_SECRET_KEY:
//   supabase secrets set PAYSTACK_SECRET_KEY="sk_test_..."
// It is never sent to the browser, never put in a VITE_* variable, and never written to a file in this repo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Overridable only so the payment tests can point at a local fake Paystack. Production never sets it.
const PAYSTACK_API = Deno.env.get('PAYSTACK_API_URL') ?? 'https://api.paystack.co'

export const paystackSecret = () => Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''

export type PaystackTransaction = {
  status: string
  amount: number
  currency: string
  id: number | string
  channel?: string
  paid_at?: string | null
  reference: string
  // Paystack's own record of what we asked for and what it charged on top (non-zero when the customer bears the fees).
  requested_amount?: number | null
  fees?: number | null
}

async function paystackFetch(path: string, init: RequestInit = {}) {
  const secret = paystackSecret()
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY is not set')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    return await fetch(`${PAYSTACK_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function initializeTransaction(input: {
  email: string
  amountKobo: number
  currency: string
  reference: string
  callbackUrl: string
  metadata: Record<string, string>
}) {
  const response = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  })
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean
    message?: string
    data?: { authorization_url?: string; access_code?: string }
  } | null
  if (!response.ok || !payload?.status || !payload.data?.authorization_url)
    throw new Error(payload?.message ?? 'Paystack could not start the payment')
  // The browser will be sent to this address, so only ever hand it a real Paystack checkout page.
  const target = new URL(payload.data.authorization_url)
  if (
    target.protocol !== 'https:' ||
    !(target.hostname === 'paystack.com' || target.hostname.endsWith('.paystack.com'))
  )
    throw new Error('Unexpected checkout address')
  return { authorizationUrl: target.toString() }
}

// Asks Paystack itself what happened to a reference. Everything we act on comes from this answer, never from the
// browser and never from the body of a webhook.
export async function verifyTransaction(
  reference: string,
): Promise<{ transaction: PaystackTransaction | null; httpStatus: number; message?: string }> {
  const response = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean
    message?: string
    data?: PaystackTransaction
  } | null
  if (!payload?.status || !payload.data)
    return { transaction: null, httpStatus: response.status, message: payload?.message }
  return { transaction: payload.data, httpStatus: response.status }
}

export type SettleSource = 'return' | 'webhook' | 'reconcile'

// Verify with Paystack, then let the database settle it atomically (checks amount + currency, activates once).
// Every attempt leaves one safe row in payment_events so a missing activation can be explained afterwards.
export async function settleReference(reference: string, source: SettleSource) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Server configuration is incomplete')
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const log = async (row: {
    paystack_status?: string | null
    amount_kobo?: number | null
    requested_amount_kobo?: number | null
    fees_kobo?: number | null
    currency?: string | null
    outcome: string
    error?: string | null
  }) => {
    try {
      await admin.from('payment_events').insert({ reference, source, ...row })
    } catch {
      /* diagnostics must never break settlement */
    }
  }
  const { transaction, httpStatus, message } = await verifyTransaction(reference)
  if (!transaction) {
    // Paystack did not give us a transaction. A 401 here usually means PAYSTACK_SECRET_KEY is wrong or from the other mode (live vs test).
    await log({
      outcome: 'paystack_no_transaction',
      error: `HTTP ${httpStatus}: ${String(message ?? 'no message').slice(0, 200)}`,
    })
    return { outcome: 'pending' as const }
  }
  const { data, error } = await admin.rpc('settle_paystack_payment', {
    p_reference: reference,
    p_status: transaction.status,
    p_amount_kobo: transaction.amount,
    p_currency: transaction.currency,
    p_transaction_id: String(transaction.id),
    p_channel: transaction.channel ?? null,
    p_paid_at: transaction.paid_at ?? null,
    p_requested_amount_kobo: transaction.requested_amount ?? null,
    p_fees_kobo: transaction.fees ?? null,
  })
  if (error) {
    await log({
      paystack_status: transaction.status,
      amount_kobo: transaction.amount,
      requested_amount_kobo: transaction.requested_amount ?? null,
      fees_kobo: transaction.fees ?? null,
      currency: transaction.currency,
      outcome: 'settle_error',
      error: `${error.code ?? ''} ${error.message}`.trim().slice(0, 300),
    })
    throw new Error('Could not record the payment')
  }
  const outcome = String(data) as
    'activated' | 'already_settled' | 'pending' | 'abandoned' | 'failed' | 'mismatch' | 'not_found'
  await log({
    paystack_status: transaction.status,
    amount_kobo: transaction.amount,
    requested_amount_kobo: transaction.requested_amount ?? null,
    fees_kobo: transaction.fees ?? null,
    currency: transaction.currency,
    outcome,
  })
  return { outcome }
}

export async function hmacSha512Hex(secret: string, message: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}
