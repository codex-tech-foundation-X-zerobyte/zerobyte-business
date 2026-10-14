// Shared Paystack helpers for the three payment Edge Functions.
//
// The secret key lives ONLY in the function secret PAYSTACK_SECRET_KEY:
//   supabase secrets set PAYSTACK_SECRET_KEY="sk_test_..."
// It is never sent to the browser, never put in a VITE_* variable, and never written to a file in this repo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_API = 'https://api.paystack.co'

export const paystackSecret = () => Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''

export type PaystackTransaction = {
  status: string
  amount: number
  currency: string
  id: number | string
  channel?: string
  paid_at?: string | null
  reference: string
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

export async function initializeTransaction(input: { email: string; amountKobo: number; currency: string; reference: string; callbackUrl: string; metadata: Record<string, string> }) {
  const response = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({ email: input.email, amount: input.amountKobo, currency: input.currency, reference: input.reference, callback_url: input.callbackUrl, metadata: input.metadata }),
  })
  const payload = await response.json().catch(() => null) as { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string } } | null
  if (!response.ok || !payload?.status || !payload.data?.authorization_url) throw new Error(payload?.message ?? 'Paystack could not start the payment')
  // The browser will be sent to this address, so only ever hand it a real Paystack checkout page.
  const target = new URL(payload.data.authorization_url)
  if (target.protocol !== 'https:' || !(target.hostname === 'paystack.com' || target.hostname.endsWith('.paystack.com'))) throw new Error('Unexpected checkout address')
  return { authorizationUrl: target.toString() }
}

// Asks Paystack itself what happened to a reference. Everything we act on comes from this answer, never from the
// browser and never from the body of a webhook.
export async function verifyTransaction(reference: string): Promise<PaystackTransaction | null> {
  const response = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
  const payload = await response.json().catch(() => null) as { status?: boolean; data?: PaystackTransaction } | null
  if (!payload?.status || !payload.data) return null
  return payload.data
}

// Verify with Paystack, then let the database settle it atomically (checks amount + currency, activates once).
export async function settleReference(reference: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Server configuration is incomplete')
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const transaction = await verifyTransaction(reference)
  if (!transaction) return { outcome: 'pending' as const }
  const { data, error } = await admin.rpc('settle_paystack_payment', {
    p_reference: reference,
    p_status: transaction.status,
    p_amount_kobo: transaction.amount,
    p_currency: transaction.currency,
    p_transaction_id: String(transaction.id),
    p_channel: transaction.channel ?? null,
    p_paid_at: transaction.paid_at ?? null,
  })
  if (error) throw new Error('Could not record the payment')
  return { outcome: String(data) as 'activated' | 'already_settled' | 'pending' | 'failed' | 'mismatch' | 'not_found' }
}

export async function hmacSha512Hex(secret: string, message: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}
