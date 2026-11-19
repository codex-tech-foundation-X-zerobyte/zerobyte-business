import { useCallback, useEffect, useState } from 'react'
import { adminSupabase } from '../lib/supabase'

type Day<T> = { day: string } & T
export type Analytics = {
  generated_at: string
  period_days: number
  visitors: {
    today: number
    yesterday: number
    page_views_today: number
    period_visitor_days: number
    period_page_views: number
    series: Day<{ visitors: number; page_views: number }>[]
    top_pages: { path: string; views: number; visitors: number }[]
    top_referrers: { host: string; visitors: number }[]
    devices: { device: string; visitors: number }[]
    promoter_codes: { ref_code: string; visitors: number }[]
  }
  users: {
    total: number
    new_today: number
    new_7d: number
    new_30d: number
    dau: number
    wau: number
    mau: number
    retention_week1: number | null
    series: Day<{ signups: number; active: number }>[]
  }
  businesses: {
    total: number
    new_7d: number
    new_30d: number
    active_7d: number
    active_30d: number
    with_first_sale: number
    series: Day<{ businesses: number }>[]
  }
  sales: {
    count_today: number
    volume_today: number
    count_period: number
    volume_period: number
    series: Day<{ sales: number; volume: number }>[]
    top_businesses: { name: string; sales: number; volume: number }[]
  }
  funnel: { visitors: number; signups: number; businesses: number; first_sale: number; paid: number }
  plans: { plan: string; businesses: number }[]
  revenue?: {
    collected_period: number
    collected_month: number
    contracted_monthly: number
    paying_businesses: number
    needs_review: number
    failed_period: number
    series: Day<{ amount: number }>[]
  }
  security?: {
    admins_active: number
    admins_suspended: number
    by_role: { role: string; n: number }[]
    admin_actions_24h: number
    recent_actions: { action: string; target_type: string | null; actor_role: string | null; created_at: string }[]
    blocked_logins_24h: number
    unverified_payments: number
  }
}

export function useAdminAnalytics(days: number) {
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!adminSupabase) return
    setLoading(true)
    const { data: result, error: failure } = await adminSupabase.rpc('admin_get_analytics', { period_days: days })
    if (failure)
      setError(
        failure.code === 'PGRST202' || failure.message.includes('does not exist')
          ? 'Apply the latest Supabase migration (admin_analytics) to see analytics.'
          : failure.message,
      )
    else {
      setError('')
      setData(result as Analytics)
    }
    setLoading(false)
  }, [days])
  useEffect(() => {
    void load()
  }, [load])
  return { data, error, loading, reload: load }
}
