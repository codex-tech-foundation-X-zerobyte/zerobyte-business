import { useEffect, useState } from 'react'
import { adminSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase'

export type HealthState = 'checking' | 'up' | 'slow' | 'down'
type HealthItem = { name: string; state: HealthState }

async function probe(path: string): Promise<HealthState> {
  if (!supabaseUrl || !supabaseAnonKey) return 'down'
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 6000)
  const started = performance.now()
  try {
    const response = await fetch(`${supabaseUrl}${path}`, {
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal,
    })
    if (response.status >= 500) return 'down'
    return performance.now() - started > 1500 ? 'slow' : 'up'
  } catch {
    return 'down'
  } finally {
    window.clearTimeout(timer)
  }
}

/** A quick, light check of the services the console depends on (the full set of checks lives in Monitoring). */
export function usePlatformHealth(databaseOk: boolean | null) {
  const [auth, setAuth] = useState<HealthState>('checking')
  useEffect(() => {
    if (!adminSupabase) {
      setAuth('down')
      return
    }
    let alive = true
    void probe('/auth/v1/health').then((state) => alive && setAuth(state))
    return () => {
      alive = false
    }
  }, [])
  const database: HealthState = databaseOk === null ? 'checking' : databaseOk ? 'up' : 'down'
  const items: HealthItem[] = [
    // The data API (REST) is what answered the database check, so it shares that result. Probing the API root with the
    // public key returns 401 on current Supabase projects, which only produced a red console error.
    { name: 'REST', state: database },
    { name: 'Database', state: database },
    { name: 'Auth', state: auth },
  ]
  return items
}
