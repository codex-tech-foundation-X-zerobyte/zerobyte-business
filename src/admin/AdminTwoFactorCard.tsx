import { useCallback, useEffect, useState } from 'react'
import { adminSupabase } from '../lib/supabase'

/**
 * Two-factor sign-in for the admin console (authenticator app, free, no email or SMS).
 * Every admin can set up their own authenticator here. A super admin can then make it compulsory for everyone;
 * the database refuses to do that while any admin has not set one up, so nobody can be locked out.
 */
export function AdminTwoFactorCard({ isSuper }: { isSuper: boolean }) {
  const [loading, setLoading] = useState(true)
  const [enrolled, setEnrolled] = useState(false)
  const [verifiedSession, setVerifiedSession] = useState(false)
  const [required, setRequired] = useState(false)
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!adminSupabase) return
    const [{ data: factors }, { data: aal }, { data: isRequired }] = await Promise.all([
      adminSupabase.auth.mfa.listFactors(),
      adminSupabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      adminSupabase.rpc('admin_mfa_required'),
    ])
    setEnrolled((factors?.totp.length ?? 0) > 0)
    setVerifiedSession(aal?.currentLevel === 'aal2')
    setRequired(Boolean(isRequired))
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function startSetup() {
    if (!adminSupabase) return
    setBusy(true)
    setMessage(null)
    const { data: factors } = await adminSupabase.auth.mfa.listFactors()
    for (const factor of factors?.all.filter((item) => item.status === 'unverified') ?? [])
      await adminSupabase.auth.mfa.unenroll({ factorId: factor.id })
    const { data, error } = await adminSupabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Zerøbyte admin ${Date.now()}`,
    })
    setBusy(false)
    if (error || !data) {
      setMessage({ tone: 'bad', text: error?.message ?? 'Could not start setup.' })
      return
    }
    setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function confirmSetup(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase || !setup) return
    setBusy(true)
    const { error } = await adminSupabase.auth.mfa.challengeAndVerify({ factorId: setup.factorId, code: code.trim() })
    setBusy(false)
    setCode('')
    if (error) {
      setMessage({ tone: 'bad', text: 'That code did not match. Wait for the next code and try again.' })
      return
    }
    setSetup(null)
    setMessage({ tone: 'good', text: 'Two-factor is set up. You will be asked for a code each time you sign in.' })
    await load()
  }

  async function toggleRequired() {
    if (!adminSupabase) return
    setBusy(true)
    setMessage(null)
    const { error } = await adminSupabase.rpc('admin_set_mfa_requirement', { p_required: !required })
    setBusy(false)
    if (error) {
      setMessage({ tone: 'bad', text: error.message.replace(/^.*?(MFA_REQUIRED|MFA_NOT_READY): /, '') })
      return
    }
    setMessage({
      tone: 'good',
      text: required
        ? 'Two-factor is no longer compulsory.'
        : 'Two-factor is now compulsory. Every admin must sign in with an authenticator code.',
    })
    await load()
  }

  return (
    <section className="admin-card set-card" aria-labelledby="set-2fa">
      <h3 id="set-2fa">Two-factor sign-in</h3>
      {loading ? (
        <p className="field-help">Checking…</p>
      ) : (
        <>
          <p className="field-help">
            {enrolled
              ? 'An authenticator app is set up on your account.'
              : 'Not set up yet. A stolen password alone should never be enough to open the admin console.'}
          </p>
          {message && (
            <div className={`ap-banner ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
              {message.text}
            </div>
          )}
          {!enrolled && !setup && (
            <button type="button" className="primary" onClick={() => void startSetup()} disabled={busy}>
              Set up authenticator app
            </button>
          )}
          {setup && (
            <form className="set-form" onSubmit={confirmSetup}>
              <img
                src={setup.qr}
                alt="QR code to add this account to your authenticator app"
                width={176}
                height={176}
              />
              <p className="field-help">
                Scan with Google Authenticator, Microsoft Authenticator, Authy or 1Password. Cannot scan? Key:{' '}
                <code>{setup.secret}</code>
              </p>
              <label className="set-field">
                6-digit code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <button type="submit" className="primary" disabled={busy || code.length !== 6}>
                Turn on two-factor
              </button>
            </form>
          )}
          {isSuper && (
            <div className="set-field">
              <strong>Compulsory for every admin: {required ? 'ON' : 'OFF'}</strong>
              <p className="field-help">
                {required
                  ? 'Every admin must enter an authenticator code to use the console.'
                  : verifiedSession
                    ? 'Turn this on once every admin has set up their authenticator. It will refuse if anyone has not.'
                    : 'Set up your own authenticator and sign in with its code first, then you can turn this on for everyone.'}
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => void toggleRequired()}
                disabled={busy || (!required && !verifiedSession)}
              >
                {required ? 'Make optional again' : 'Make compulsory for all admins'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
