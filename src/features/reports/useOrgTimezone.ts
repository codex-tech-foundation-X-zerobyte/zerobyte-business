import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// A business's "day" follows its own clock (default Africa/Lagos). Every screen that says "today" asks here, so the
// Overview, Reports and the daily report always agree with each other and with the database.
const DEFAULT_ZONE = 'Africa/Lagos'
const known = new Map<string, string>()

export function rememberOrgTimezone(orgId: string, timezone: string) {
  known.set(orgId, timezone)
}

export function useOrgTimezone(orgId: string): string {
  const [timezone, setTimezone] = useState(known.get(orgId) ?? DEFAULT_ZONE)
  useEffect(() => {
    if (!supabase || known.has(orgId)) {
      setTimezone(known.get(orgId) ?? DEFAULT_ZONE)
      return
    }
    let active = true
    void Promise.resolve(supabase.from('organizations').select('report_timezone').eq('id', orgId).maybeSingle()).then(
      ({ data }) => {
        const zone = (data as { report_timezone?: string } | null)?.report_timezone
        if (zone) {
          known.set(orgId, zone)
          if (active) setTimezone(zone)
        }
      },
    )
    return () => {
      active = false
    }
  }, [orgId])
  return timezone
}
