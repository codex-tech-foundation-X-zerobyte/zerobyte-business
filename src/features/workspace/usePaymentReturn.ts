import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

// When Paystack sends the customer back (/?payment=return&reference=...), this asks OUR SERVER to confirm the
// payment and then shows what the server said. The browser never decides that a payment succeeded.
//
// It lives at workspace level on purpose. It used to live inside the Settings page, but the workspace resets to the
// Overview page once the business has loaded, so Settings never mounted and nothing was ever verified.

const STORAGE_KEY = 'zb-pending-payment'
const REFERENCE = /^zb_[a-f0-9]{32}$/
const RETRY_MS = 5000
const MAX_AUTO_RETRIES = 6

export type PaymentNotice = { tone: 'info' | 'success' | 'warning' | 'error'; text: string; canRetry?: boolean }

function referenceFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const reference = params.get('reference') ?? params.get('trxref')
  return params.get('payment') === 'return' && reference && REFERENCE.test(reference) ? reference : null
}

export function usePaymentReturn(orgId: string | null | undefined, openBilling: () => void) {
  const [notice, setNotice] = useState<PaymentNotice | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Read once, before anything can rewrite the address. Kept in sessionStorage so a reload retries instead of losing it.
  const [reference] = useState(() => {
    const fromUrl = referenceFromUrl()
    try { if (fromUrl) window.sessionStorage.setItem(STORAGE_KEY, fromUrl); else return window.sessionStorage.getItem(STORAGE_KEY) } catch { /* storage unavailable */ }
    return fromUrl
  })
  const started = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const openBillingRef = useRef(openBilling)
  openBillingRef.current = openBilling

  const verify = useCallback(async (ref: string, attempt = 0) => {
    if (!supabase) return
    setNotice({ tone: 'info', text: attempt === 0 ? 'Confirming your payment with Paystack…' : 'Still confirming your payment…' })
    const { data, error } = await supabase.functions.invoke('paystack-verify', { body: { reference: ref } })
    const outcome = (data as { outcome?: string } | null)?.outcome
    if (outcome === 'activated' || outcome === 'already_settled') {
      try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      setRefreshKey((value) => value + 1)
      setNotice({ tone: 'success', text: 'Payment confirmed. Your plan is now active.' })
      return
    }
    if (outcome === 'pending') {
      if (attempt < MAX_AUTO_RETRIES) { timer.current = window.setTimeout(() => void verify(ref, attempt + 1), RETRY_MS); return }
      setNotice({ tone: 'warning', text: 'Paystack is still processing this payment. Your plan will update by itself once it is confirmed.', canRetry: true })
      return
    }
    if (outcome === 'abandoned') {
      try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      setNotice({ tone: 'warning', text: 'The payment was not completed, so nothing was charged and your plan has not changed.' })
      return
    }
    if (outcome === 'failed') {
      try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      setNotice({ tone: 'error', text: 'The payment did not go through, so your plan has not changed.' })
      return
    }
    if (outcome === 'mismatch') {
      try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      setNotice({ tone: 'error', text: `The amount Paystack received did not match the plan price, so nothing was activated. Please contact support and quote reference ${ref.slice(0, 11)}.` })
      return
    }
    // No usable outcome: a server or network problem, or an unknown reference.
    let status = 0
    try { status = (error as { context?: Response } | null)?.context?.status ?? 0 } catch { /* ignore */ }
    if (status === 404 || status === 400) {
      try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      setNotice({ tone: 'error', text: 'We could not find that payment on your account. If you were charged, contact support with your Paystack receipt.' })
      return
    }
    setNotice({ tone: 'warning', text: 'We could not confirm the payment just now. If you were charged, your plan will update automatically within a few minutes.', canRetry: true })
  }, [])

  useEffect(() => {
    if (!orgId || !reference || started.current) return
    started.current = true
    if (referenceFromUrl()) window.history.replaceState(null, '', window.location.pathname)
    openBillingRef.current()
    void verify(reference)
  }, [orgId, reference, verify])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const retry = useCallback(() => { if (reference) void verify(reference) }, [reference, verify])
  const dismiss = useCallback(() => setNotice(null), [])
  return { notice, refreshKey, retry, dismiss }
}
