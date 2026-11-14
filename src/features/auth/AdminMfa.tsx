import { useEffect, useState } from 'react'
import { BrandMark } from '../../components/BrandMark'
import { adminSupabase } from '../../lib/supabase'

// Authenticator-app (TOTP) step for the admin console. Supabase MFA does the real work (free, no email or SMS):
//   verify - the admin already has an authenticator: ask for the 6-digit code to upgrade this session.
//   enroll - first time (or two-factor is now required): show a QR code, then confirm with a code.
export function AdminMfaStep({
  mode,
  email,
  onDone,
  onSignOut,
}: {
  mode: 'verify' | 'enroll'
  email: string
  onDone: () => void
  onSignOut: () => void
}) {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    let active = true
    async function prepare() {
      if (!adminSupabase) return
      const { data, error: listError } = await adminSupabase.auth.mfa.listFactors()
      if (!active) return
      if (listError) {
        setError(listError.message)
        return
      }
      const verified = data.totp[0]
      if (verified) {
        setFactorId(verified.id)
        return
      }
      // First time: clear any half-finished setup from an earlier attempt, then start a fresh one.
      for (const factor of data.all.filter((item) => item.status === 'unverified'))
        await adminSupabase.auth.mfa.unenroll({ factorId: factor.id })
      const { data: created, error: enrollError } = await adminSupabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Zerøbyte admin ${Date.now()}`,
      })
      if (!active) return
      if (enrollError || !created) {
        setError(enrollError?.message ?? 'Could not start authenticator setup.')
        return
      }
      setEnrolling(true)
      setFactorId(created.id)
      setQr(created.totp.qr_code)
      setSecret(created.totp.secret)
    }
    void prepare()
    return () => {
      active = false
    }
  }, [mode])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase || !factorId || busy) return
    setBusy(true)
    setError('')
    const { error: verifyError } = await adminSupabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (verifyError) {
      setCode('')
      setError('That code did not match. Wait for the next code in your app and try again.')
      return
    }
    onDone()
  }

  return (
    <div className="av-gate">
      <div className="av-gate-card av-gate-solo">
        <span className="av-logo">
          <BrandMark />
        </span>
        <h1>{enrolling ? 'Set up two-factor sign-in' : 'Enter your authenticator code'}</h1>
        <p>
          {enrolling
            ? `${email || 'This account'} needs an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). Scan the code, then type the 6 digits it shows.`
            : `Open your authenticator app and type the 6-digit code for ${email || 'this account'}.`}
        </p>
        {enrolling && qr && (
          <>
            <img src={qr} alt="QR code to add this account to your authenticator app" width={180} height={180} />
            <p className="field-help">
              Cannot scan? Enter this key by hand: <code>{secret}</code>
            </p>
          </>
        )}
        <form onSubmit={submit}>
          <label>
            6-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary entry-button" disabled={busy || !factorId || code.length !== 6}>
            {busy ? 'Checking…' : enrolling ? 'Turn on two-factor' : 'Verify'}
          </button>
        </form>
        <button type="button" className="text-btn" onClick={onSignOut}>
          Use a different account
        </button>
      </div>
    </div>
  )
}
