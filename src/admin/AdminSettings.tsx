import { Check, LogOut, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { codexMonitorStatus } from '../lib/codexMonitor'
import { adminSupabase } from '../lib/supabase'
import { AdminTwoFactorCard } from './AdminTwoFactorCard'
import type { AdminSection } from './types'

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '7.0.0'
export const ADMIN_START_KEY = 'zerobyte.admin-start'

type Props = {
  email: string
  fullName: string
  roleLabel: string
  isSuper: boolean
  /** The sections this admin can open (a super admin can open everything). */
  sections: string[]
  dark: boolean
  onTheme: (dark: boolean) => void
  onOpen: (section: AdminSection) => void
  onLogout: () => void
}

/** Settings for the person using the console: look, start page, password, access and a connection check. */
export function AdminSettings({
  email,
  fullName,
  roleLabel,
  isSuper,
  sections,
  dark,
  onTheme,
  onOpen,
  onLogout,
}: Props) {
  const [start, setStart] = useState(() => window.localStorage.getItem(ADMIN_START_KEY) ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [connection, setConnection] = useState<{ ok: boolean; text: string } | null>(null)

  function chooseStart(value: string) {
    setStart(value)
    if (value) window.localStorage.setItem(ADMIN_START_KEY, value)
    else window.localStorage.removeItem(ADMIN_START_KEY)
    setMessage({
      tone: 'good',
      text: value
        ? `The console will open on ${value} next time.`
        : 'The console will open on the first section of your role.',
    })
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase || busy) return
    if (password.length < 10)
      return setMessage({ tone: 'bad', text: 'Use at least 10 characters for the new password.' })
    if (password !== confirm) return setMessage({ tone: 'bad', text: 'The two passwords are not the same.' })
    setBusy(true)
    const { error } = await adminSupabase.auth.updateUser({ password })
    setBusy(false)
    if (error)
      return setMessage({
        tone: 'bad',
        text: error.message || 'The password could not be changed. Sign in again and retry.',
      })
    setPassword('')
    setConfirm('')
    setMessage({ tone: 'good', text: 'Password changed. Use the new one the next time you sign in.' })
  }

  async function checkConnection() {
    if (!adminSupabase) return setConnection({ ok: false, text: 'The console is not connected to a backend.' })
    setConnection(null)
    const started = performance.now()
    const { error } = await adminSupabase.rpc('get_my_admin_sections')
    const ms = Math.round(performance.now() - started)
    setConnection(
      error
        ? { ok: false, text: `The backend answered with an error (${error.message}).` }
        : { ok: true, text: `Connected. Answered in ${ms} ms.` },
    )
  }

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const monitor = codexMonitorStatus()
  const startOptions = sections.filter((name) => !['Profile', 'Settings'].includes(name))

  return (
    <>
      {message && (
        <div className={`ap-banner ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.tone === 'good' ? <Check size={16} /> : <TriangleAlert size={16} />}
          <span>{message.text}</span>
        </div>
      )}
      <section className="admin-card st-top" aria-label="Console preferences">
        <div className="st-row">
          <div>
            <strong>Signed in as</strong>
            <small>{email}</small>
          </div>
          <span className={`admin-pill ${isSuper ? 'success' : ''}`}>{roleLabel}</span>
        </div>
        <div className="st-row">
          <div>
            <strong>Appearance</strong>
            <small>{dark ? 'Dark console' : 'Light console'}</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Dark console"
            className="st-toggle"
            onClick={() => onTheme(!dark)}
          >
            <i />
          </button>
        </div>
        <div className="st-row">
          <div>
            <strong>Reduced motion</strong>
            <small>Follows your device setting</small>
          </div>
          <span className="admin-pill">{reducedMotion ? 'On' : 'Off'}</span>
        </div>
        <div className="st-row">
          <button type="button" className="secondary" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </section>
      <div className="admin-settings-grid">
        <section className="admin-card set-card" aria-labelledby="set-account">
          <h3 id="set-account">Your account</h3>
          <dl className="set-list">
            <div>
              <dt>Name</dt>
              <dd>{fullName || 'Not set'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleLabel}</dd>
            </div>
          </dl>
          <div className="ap-inline">
            <button type="button" className="secondary" onClick={() => onOpen('Profile')}>
              Edit name and phone
            </button>
          </div>
        </section>

        <section className="admin-card set-card" aria-labelledby="set-look">
          <h3 id="set-look">Start page</h3>
          <label className="set-field">
            Open this section when I sign in
            <select value={start} onChange={(event) => chooseStart(event.target.value)}>
              <option value="">The first section of my role</option>
              {startOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">This choice is remembered on this device only.</p>
        </section>

        <section className="admin-card set-card" aria-labelledby="set-security">
          <h3 id="set-security">Password</h3>
          <form className="set-form" onSubmit={changePassword}>
            <label className="set-field">
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="set-field">
              Type it again
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || !password}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </form>
        </section>

        <AdminTwoFactorCard isSuper={isSuper} />

        <section className="admin-card set-card" aria-labelledby="set-access">
          <h3 id="set-access">What you can open</h3>
          <p className="field-help">
            {isSuper ? 'As super admin you can open every section.' : 'These are the sections your role includes.'}
          </p>
          <div className="set-chips">
            {sections.map((name) => (
              <button key={name} type="button" onClick={() => onOpen(name as AdminSection)}>
                {name}
              </button>
            ))}
          </div>
        </section>

        <section className="admin-card set-card" aria-labelledby="set-about">
          <h3 id="set-about">About this console</h3>
          <dl className="set-list">
            <div>
              <dt>Version</dt>
              <dd>{APP_VERSION}</dd>
            </div>
            <div>
              <dt>Error reporting (Codex)</dt>
              <dd>{monitor === 'on' ? 'On' : monitor === 'development' ? 'Off in development' : 'Not configured'}</dd>
            </div>
          </dl>
          <div className="ap-inline">
            <button type="button" className="secondary" onClick={() => void checkConnection()}>
              Check connection
            </button>
            {connection && <span className={`ap-chip ${connection.ok ? 'good' : 'bad'}`}>{connection.text}</span>}
          </div>
        </section>
      </div>
    </>
  )
}
