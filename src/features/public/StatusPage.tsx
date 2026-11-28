import { useCallback, useEffect, useState } from 'react'
import { pollWhileVisible } from '../../lib/visiblePoll'
import { CheckCircle2, CircleAlert, Clock, RefreshCw, TriangleAlert } from 'lucide-react'
import { PublicFooter, PublicHeader } from '../../components/PublicChrome'
import { usePublicPageMeta } from '../../lib/pageMeta'
import { appPath } from '../../lib/routing'
import { supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase'

type State = 'checking' | 'up' | 'slow' | 'down'
type Check = { id: string; name: string; detail: string; state: State; ms: number | null }

const SLOW_MS = 1500
const GIVE_UP_MS = 8000

const withTimeout = async <T,>(work: Promise<T>): Promise<T> => {
  let timer: number | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('timeout')), GIVE_UP_MS)
      }),
    ])
  } finally {
    window.clearTimeout(timer)
  }
}

/** Runs one check and turns the result into up / slow / down. Anything below a 500 answer means the service replied. */
async function measure(run: () => Promise<boolean>): Promise<{ state: State; ms: number | null }> {
  const started = performance.now()
  try {
    const ok = await withTimeout(run())
    const ms = Math.round(performance.now() - started)
    return { state: !ok ? 'down' : ms > SLOW_MS ? 'slow' : 'up', ms }
  } catch {
    return { state: 'down', ms: null }
  }
}

const LABEL: Record<State, string> = {
  checking: 'Checking…',
  up: 'Working',
  slow: 'Slower than usual',
  down: 'Not responding',
}

const INITIAL: Check[] = [
  { id: 'site', name: 'Website and app', detail: 'The pages you are looking at right now.', state: 'up', ms: null },
  {
    id: 'auth',
    name: 'Sign in',
    detail: 'Signing in to your business, team and promoter accounts.',
    state: 'checking',
    ms: null,
  },
  {
    id: 'data',
    name: 'Your records',
    detail: 'Saving and reading sales, stock, customers and receipts.',
    state: 'checking',
    ms: null,
  },
]

/**
 * A public, honest "is it working?" page. The checks run from YOUR device against the live service, so a problem with your own
 * connection shows up here too: if everything is red, test your internet first.
 */
export function StatusPage({ navigate }: { navigate: (path: string) => void }) {
  usePublicPageMeta('/status')
  const [checks, setChecks] = useState<Check[]>(INITIAL)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    const set = (id: string, result: { state: State; ms: number | null }) =>
      setChecks((current) => current.map((check) => (check.id === id ? { ...check, ...result } : check)))
    setChecks((current) =>
      current.map((check) => (check.id === 'site' ? check : { ...check, state: 'checking', ms: null })),
    )
    await Promise.all([
      measure(async () => {
        if (!supabaseUrl || !supabaseAnonKey) return false
        const response = await fetch(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: supabaseAnonKey } })
        return response.status < 500
      }).then((result) => set('auth', result)),
      measure(async () => {
        if (!supabase) return false
        // A small read of public data: it goes through the same service every sale and receipt uses.
        const { error } = await supabase.from('plans').select('id').limit(1)
        return !error
      }).then((result) => set('data', result)),
    ])
    setCheckedAt(new Date())
    setRunning(false)
  }, [])

  useEffect(() => {
    void run()
    return pollWhileVisible(() => void run(), 60000)
  }, [run])

  const worst: State = checks.some((check) => check.state === 'down')
    ? 'down'
    : checks.some((check) => check.state === 'slow')
      ? 'slow'
      : checks.some((check) => check.state === 'checking')
        ? 'checking'
        : 'up'
  const headline = {
    up: 'Everything is working',
    slow: 'Working, but slower than usual',
    down: 'Something is not responding',
    checking: 'Checking the service…',
  }[worst]
  const Icon = worst === 'up' ? CheckCircle2 : worst === 'down' ? TriangleAlert : worst === 'slow' ? CircleAlert : Clock

  return (
    <div className="legal-shell public-page support-page status-page">
      <PublicHeader navigate={navigate} />
      <main className="legal-content support-content">
        <span className="section-label">Status</span>
        <h1>Is Zerøbyte working?</h1>
        <p className="legal-intro">
          These checks run from your device against the live service, every minute while this page is open. If
          everything shows a problem, test your own internet connection first.
        </p>
        <div className={`status-banner ${worst}`} role="status">
          <Icon size={22} />
          <strong>{headline}</strong>
        </div>
        <ul className="status-list">
          {checks.map((check) => (
            <li key={check.id} className={`status-row ${check.state}`}>
              <div>
                <strong>{check.name}</strong>
                <span>{check.detail}</span>
              </div>
              <div className="status-result">
                <b>{LABEL[check.state]}</b>
                {check.ms !== null && check.id !== 'site' && <small>{check.ms.toLocaleString('en-NG')} ms</small>}
              </div>
            </li>
          ))}
        </ul>
        <div className="status-actions">
          <button type="button" className="secondary" disabled={running} onClick={() => void run()}>
            <RefreshCw size={15} /> {running ? 'Checking…' : 'Check again'}
          </button>
          {checkedAt && (
            <span className="field-help">
              Last checked{' '}
              {checkedAt.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
            </span>
          )}
        </div>
        <section>
          <h2>Something looks wrong and this page says it is fine?</h2>
          <p>
            Refresh the page once. If the problem stays, tell us from the <a href={appPath('/support')}>Support page</a>{' '}
            and include what you were doing and the message you saw. Anything you recorded offline is kept on your
            device and sent when the connection is back.
          </p>
        </section>
      </main>
      <PublicFooter onStart={() => navigate('/auth')} />
    </div>
  )
}
