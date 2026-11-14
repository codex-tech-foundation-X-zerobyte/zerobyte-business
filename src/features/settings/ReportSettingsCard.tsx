import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { hourLabel } from '../../lib/reports'
import { rememberOrgTimezone } from '../reports/useOrgTimezone'

const ZONES: [string, string][] = [
  ['Africa/Lagos', 'Nigeria (Lagos)'],
  ['Africa/Accra', 'Ghana (Accra)'],
  ['Africa/Nairobi', 'Kenya (Nairobi)'],
  ['Africa/Johannesburg', 'South Africa'],
  ['Africa/Cairo', 'Egypt (Cairo)'],
  ['Europe/London', 'United Kingdom'],
  ['America/New_York', 'United States (New York)'],
]

type Prefs = {
  report_daily_enabled: boolean
  report_weekly_enabled: boolean
  report_hour: number
  report_timezone: string
}

/**
 * When the daily and weekly reports are prepared. Saved on the business itself; only owners and admins can change it
 * (the database enforces that), and the time zone decides where a "day" starts and ends.
 */
export function ReportSettingsCard({ orgId }: { orgId: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    void Promise.resolve(
      supabase
        .from('organizations')
        .select('report_daily_enabled,report_weekly_enabled,report_hour,report_timezone')
        .eq('id', orgId)
        .maybeSingle(),
    ).then(({ data }) => {
      if (active && data) setPrefs(data as Prefs)
    })
    return () => {
      active = false
    }
  }, [orgId])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !prefs) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('organizations').update(prefs).eq('id', orgId)
    setBusy(false)
    if (error) {
      setMessage({ tone: 'bad', text: 'Could not save. Only the owner or an admin can change report settings.' })
      return
    }
    rememberOrgTimezone(orgId, prefs.report_timezone)
    setMessage({ tone: 'good', text: 'Report settings saved.' })
  }

  if (!prefs) return null
  const zones = ZONES.some(([value]) => value === prefs.report_timezone)
    ? ZONES
    : [...ZONES, [prefs.report_timezone, prefs.report_timezone] as [string, string]]
  return (
    <div className="settings-stack">
      <form className="settings-card" onSubmit={save} aria-labelledby="report-settings-title">
        <header>
          <h3 id="report-settings-title">Daily and weekly reports</h3>
          <p>
            A summary of your sales, profit, top products and customers is prepared automatically. It shows in Reports,
            with a notification. Your day follows your local time zone, and late-night sales are included once the day
            closes just after midnight.
          </p>
        </header>
        <div className="settings-grid">
          <label className="settings-field wide report-toggle">
            <input
              type="checkbox"
              checked={prefs.report_daily_enabled}
              onChange={(event) => setPrefs({ ...prefs, report_daily_enabled: event.target.checked })}
            />
            <span>
              <strong>Daily report</strong>
              <small>Every evening, covering the day so far.</small>
            </span>
          </label>
          <label className="settings-field wide report-toggle">
            <input
              type="checkbox"
              checked={prefs.report_weekly_enabled}
              onChange={(event) => setPrefs({ ...prefs, report_weekly_enabled: event.target.checked })}
            />
            <span>
              <strong>Weekly report</strong>
              <small>Every Sunday evening, covering Monday to Sunday.</small>
            </span>
          </label>
          <label className="settings-field">
            Send time
            <select
              value={prefs.report_hour}
              onChange={(event) => setPrefs({ ...prefs, report_hour: Number(event.target.value) })}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            Time zone
            <select
              value={prefs.report_timezone}
              onChange={(event) => setPrefs({ ...prefs, report_timezone: event.target.value })}
            >
              {zones.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {message && (
          <div
            className={message.tone === 'good' ? 'form-success' : 'form-error'}
            role={message.tone === 'good' ? 'status' : 'alert'}
          >
            {message.text}
          </div>
        )}
        <div className="report-settings-actions">
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save report settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
