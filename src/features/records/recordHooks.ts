import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { type PeriodRow, type PeriodView, parsePeriodRows } from '../../lib/recordPeriods'

export type RecordKind = 'sales' | 'expenses' | 'stock'
type Dates = { from: string; to: string }

/** Remembers the last view per kind of record on this device. */
export function useRecordView(kind: RecordKind) {
  const key = `zerobyte.records.${kind}.view`
  const [view, setView] = useState<PeriodView>(() => {
    try {
      const saved = window.localStorage.getItem(key)
      return saved === 'month' || saved === 'year' ? saved : 'day'
    } catch {
      return 'day'
    }
  })
  const change = (next: PeriodView) => {
    setView(next)
    try {
      window.localStorage.setItem(key, next)
    } catch {
      // Storage can be blocked; the choice then lasts until the page is closed.
    }
  }
  return [view, change] as const
}

/**
 * One row per Lagos day, month or year for the WHOLE filtered set, added up by the database (not just the rows that
 * are on screen). The result is remembered with the request it answers, so a stale answer is never shown for a new one.
 */
export function useRecordPeriods(orgId: string, kind: RecordKind, view: PeriodView, dates: Dates, refreshKey: unknown) {
  const requestKey = `${orgId}|${kind}|${view}|${dates.from}|${dates.to}|${String(refreshKey)}`
  const [answer, setAnswer] = useState<{ key: string; rows: PeriodRow[]; failed: boolean } | null>(null)
  useEffect(() => {
    if (!supabase) return
    let alive = true
    void supabase
      .rpc('get_record_period_totals', {
        target_org: orgId,
        record_kind: kind,
        granularity: view,
        date_from: dates.from || null,
        date_to: dates.to || null,
        max_rows: view === 'day' ? 400 : 600,
      })
      .then(({ data, error }) => {
        if (alive) setAnswer({ key: requestKey, rows: error ? [] : parsePeriodRows(data), failed: Boolean(error) })
      })
    return () => {
      alive = false
    }
  }, [orgId, kind, view, dates.from, dates.to, requestKey])
  const current = answer?.key === requestKey ? answer : null
  return { rows: current?.rows ?? [], loading: !current, failed: Boolean(current?.failed) }
}

export const periodMap = (rows: PeriodRow[]) => new Map(rows.map((row) => [row.period, row]))
