import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

// What the server says about a business's right to use the app. The DATABASE is what actually enforces the lock
// (writes are refused with SUBSCRIPTION_REQUIRED); this only lets the screen explain it and count down.
export type AccessState = 'trial' | 'active' | 'locked'
export type SubscriptionAccess = {
  state: AccessState
  reason: string | null
  status: string | null
  planName: string | null
  planCode: string | null
  periodEnd: string | null
  secondsLeft: number | null
  canPay: boolean
}

type RawAccess = {
  state?: string
  reason?: string | null
  status?: string | null
  plan_name?: string | null
  plan_code?: string | null
  period_end?: string | null
  seconds_left?: number | null
  can_pay?: boolean
}

const RECHECK_MS = 5 * 60 * 1000

export function parseAccess(raw: RawAccess | null | undefined): SubscriptionAccess | null {
  if (!raw || (raw.state !== 'trial' && raw.state !== 'active' && raw.state !== 'locked')) return null
  return {
    state: raw.state,
    reason: raw.reason ?? null,
    status: raw.status ?? null,
    planName: raw.plan_name ?? null,
    planCode: raw.plan_code ?? null,
    periodEnd: raw.period_end ?? null,
    secondsLeft: typeof raw.seconds_left === 'number' ? raw.seconds_left : null,
    canPay: Boolean(raw.can_pay),
  }
}

/** "6 days", "1 day", "5 hours", "20 minutes". Rounds up so the last day never reads as zero. */
export function timeLeftText(secondsLeft: number | null) {
  if (secondsLeft == null) return ''
  if (secondsLeft >= 86400) {
    const days = Math.ceil(secondsLeft / 86400)
    return `${days} day${days === 1 ? '' : 's'}`
  }
  if (secondsLeft >= 3600) {
    const hours = Math.ceil(secondsLeft / 3600)
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  const minutes = Math.max(1, Math.ceil(secondsLeft / 60))
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/**
 * Loads the access state for the open business, re-checks when the tab regains focus, every few minutes, right after
 * a payment settles, and at the exact moment the trial/period ends, so the screen locks without a manual refresh.
 * If the check itself fails (offline, function not deployed yet) it returns null and the app stays usable; the
 * database is still the real gatekeeper.
 */
export function useSubscriptionAccess(orgId: string | null | undefined, refreshKey = 0) {
  const [access, setAccess] = useState<SubscriptionAccess | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    if (!supabase || !orgId) {
      setAccess(null)
      return
    }
    const { data, error } = await supabase.rpc('get_subscription_access', { target_org: orgId })
    if (error) return
    setAccess(parseAccess(data as RawAccess))
  }, [orgId])

  useEffect(() => {
    setAccess(null)
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const interval = window.setInterval(() => void load(), RECHECK_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  // Lock at the exact second the period ends (setTimeout cannot wait longer than ~24 days, so cap it and re-arm).
  const secondsLeft = access && access.state !== 'locked' ? access.secondsLeft : null
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (secondsLeft == null) return
    timer.current = window.setTimeout(() => void load(), Math.min(secondsLeft * 1000 + 1500, 2_000_000_000))
    return () => window.clearTimeout(timer.current)
  }, [secondsLeft, load])

  return { access, refresh: load }
}
