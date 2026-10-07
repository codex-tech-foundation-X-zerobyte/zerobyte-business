import { ArrowRight, Check, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { toWhatsAppNumber, whatsappUrl } from '../../lib/whatsapp'
import { appPath } from '../../lib/routing'
import { adminSupabase, supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase'

// Optional support number (international format). Lets people who cannot receive the reset email ask for a link on WhatsApp.
const supportWhatsApp = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.trim()

export function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'forgot'>('sign-in'); const [accountMode, setAccountMode] = useState<'owner' | 'worker'>('owner'); const [fullName, setFullName] = useState(''); const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('error_code') === 'otp_expired' ? 'That reset link has expired. Request a new one below.' : ''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [showPassword, setShowPassword] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase || busy) return; setBusy(true); setError(''); setMessage('')
    try {
      if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(identifier.trim(), { redirectTo: `${window.location.origin}${appPath('/auth')}` })
        // Same answer whether or not the account exists, so this form cannot be used to discover registered emails.
        if (resetError && /rate limit|too many/i.test(resetError.message)) setError('Too many reset requests. Please wait a few minutes and try again.')
        else setMessage('If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.')
        return
      }
      let result
      if (mode === 'sign-up') {
        result = await supabase.auth.signUp({ email: identifier.trim(), password, options: { data: { full_name: fullName.trim() } } })
      } else if (accountMode === 'owner') {
        result = await supabase.auth.signInWithPassword({ email: identifier.trim(), password })
      } else if (!supabaseUrl || !supabaseAnonKey) {
        setError('Worker sign-in is not configured.')
        return
      } else {
        const response = await fetch(`${supabaseUrl}/functions/v1/resolve-worker-login`, { method: 'POST', headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
          setError(payload?.error ?? 'Invalid worker credentials')
          return
        }
        result = await supabase.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token })
      }
      if (result.error) {
        const normalized = result.error.message.toLowerCase()
        if (mode === 'sign-in' && normalized.includes('invalid login credentials')) {
          setError('That email and password do not match. Check both values or create an account first.')
        } else if (mode === 'sign-in' && normalized.includes('email not confirmed')) {
          setError('Confirm your email address using the link we sent you, then sign in again.')
        } else {
          setError(result.error.message)
        }
      } else if (mode === 'sign-up') setMessage('Check your email to confirm your account, then sign in.')
    } catch {
      // A dropped connection used to leave the button stuck on "Please wait…" forever.
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="auth-shell"><div className="auth-brand"><div className="brand-mark">ø</div><strong>Zerøbyte</strong><span>Business</span></div><div className="auth-layout"><section className="auth-intro"><span className="auth-kicker">Business OS for Nigeria</span><h1>Know what sold.<br /><em>Know what’s next.</em></h1><p>One calm workspace for stock, customers, sales, receipts and expenses — built around how your business actually runs.</p><div className="auth-trust"><span><Check size={14} /> Naira-first workflows</span><span><Check size={14} /> Your data, your organization</span><span><Check size={14} /> No payment required</span></div></section><form className="auth-card" onSubmit={submit}>  <div className={`auth-mode-switch ${accountMode}`} role="tablist" aria-label="Choose how to sign in"><span className="auth-mode-indicator" aria-hidden="true" /><button type="button" role="tab" aria-selected={accountMode === 'owner'} className={accountMode === 'owner' ? 'active' : ''} onClick={() => { setAccountMode('owner'); setMode('sign-in'); setIdentifier(''); setPassword(''); setError(''); setMessage('') }}>Owner</button><button type="button" role="tab" aria-selected={accountMode === 'worker'} className={accountMode === 'worker' ? 'active' : ''} onClick={() => { setAccountMode('worker'); setMode('sign-in'); setIdentifier(''); setPassword(''); setError(''); setMessage('') }}>Worker</button></div><div className="auth-mode-heading"><span className="auth-kicker">{mode === 'sign-in' ? 'Welcome back' : mode === 'forgot' ? 'Account recovery' : 'Start your workspace'}</span><span className="auth-mode-context">{accountMode === 'owner' ? 'Business owner access' : 'Team member access'}</span></div><h2>{mode === 'sign-in' ? `Sign in as ${accountMode}` : mode === 'forgot' ? 'Reset your password' : 'Create your owner account'}</h2><p>{mode === 'forgot' ? 'Enter your owner email and we will send you a link to choose a new password.' : mode === 'sign-in' ? (accountMode === 'worker' ? 'Use your worker email or workspace-scoped employee ID and current password.' : 'Continue where your business left off.') : 'Create an owner account, then set up your business in minutes.'}</p>{mode === 'sign-up' && <label>Full name<input type="text" autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" /></label>}<label>{mode === 'sign-up' || accountMode === 'owner' ? 'Email address' : 'Email or employee ID'}<input type={accountMode === 'owner' || mode !== 'sign-in' ? 'email' : 'text'} autoComplete={accountMode === 'owner' || mode !== 'sign-in' ? 'email' : 'username'} autoCapitalize="none" spellCheck={false} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={accountMode === 'worker' ? 'workspace-slug:EMP-001 or worker@business.com' : 'you@business.com'} /></label>{mode !== 'forgot' && <label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} required minLength={mode === 'sign-up' ? 8 : undefined} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'sign-up' ? 'At least 8 characters' : 'Your current password'} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>}{mode === 'sign-up' && <p className="field-help auth-consent">By creating an account you agree to our <a href={appPath('/terms')} target="_blank" rel="noopener noreferrer">Terms</a> and <a href={appPath('/privacy')} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>}{error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success" role="status">{message}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create account'} <ArrowRight size={16} /></button>{mode === 'forgot' && toWhatsAppNumber(supportWhatsApp) && <p className="field-help auth-worker-help">No email after a few minutes? <a href={whatsappUrl(`Hello, I forgot my Zerøbyte password. My email is ${identifier.trim() || '(not entered yet)'}.`, supportWhatsApp)} target="_blank" rel="noopener noreferrer">Message support on WhatsApp</a> and we will send you a reset link.</p>}{accountMode === 'owner' && mode === 'sign-in' && <button type="button" className="entry-link" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Forgot your password?</button>}{accountMode === 'worker' && mode === 'sign-in' && <p className="field-help auth-worker-help">Forgot your password? Ask your workspace owner to reset it for you.</p>}{accountMode === 'owner' && <button type="button" className="entry-link" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); setMessage('') }}>{mode === 'sign-in' ? 'New here? Create an account' : mode === 'sign-up' ? 'Already registered? Sign in' : 'Back to sign in'}</button>}</form></div></div>
}

export function ResetPasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    if (password.length < 8 || password !== confirmation) {
      setError(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.')
      return
    }
    setBusy(true); setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) setError(updateError.message)
      else onComplete()
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="auth-loading"><form className="auth-card" onSubmit={submit}><div className="brand-mark">ø</div><span className="auth-kicker">Account recovery</span><h1>Choose a new password</h1><p>Enter a new password for your account. You will stay signed in afterwards.</p><label>New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Confirm new password<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Saving…' : 'Save new password'} <ArrowRight size={16} /></button></form></div>
}

export function ChangePasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (password.length < 8 || password !== confirmation) {
      setError(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.')
      return
    }

    setBusy(true); setError('')
    const { error: passwordError } = await supabase.auth.updateUser({ password })
    if (!passwordError) {
      const { error: markError } = await supabase.rpc('mark_worker_password_changed')
      if (markError) setError(markError.message)
      else onComplete()
    } else setError(passwordError.message)
    setBusy(false)
  }
  return <div className="auth-loading"><form className="auth-card" onSubmit={submit}><div className="brand-mark">ø</div><span className="auth-kicker">First sign-in</span><h1>Choose a new password</h1><p>Your temporary password has been accepted. Change it before using the workspace.</p><label>New password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><label>Confirm password<input required minLength={8} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary entry-button" disabled={busy}>{busy ? 'Saving…' : 'Save new password'} <ArrowRight size={16} /></button><button type="button" className="entry-link" onClick={() => void supabase?.auth.signOut()}>Sign out</button></form></div>
}

export function PasswordSettings() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    if (!supabase) return
    if (password.length < 8 || password !== confirmation) { setError(password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.'); return }
    setBusy(true)
    const { error: result } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (result) setError(result.message)
    else { setPassword(''); setConfirmation(''); setMessage('Password changed successfully.') }
  }
  return <form className="settings-security-form" onSubmit={submit}><label>New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><label>Confirm new password<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repeat your new password" /></label><button className="secondary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>{message && <div className="form-success" role="status">{message}</div>}{error && <div className="form-error" role="alert">{error}</div>}</form>
}

export function AdminLogin() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!adminSupabase) {
      setError('Supabase is not configured for the admin console.');
      return;
    }
    setLoading(true); setError('');
    const { error: authError } = await adminSupabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    const { data: allowed, error: accessError } = await adminSupabase.rpc('is_platform_admin')
    if (accessError || !allowed) {
      setError('This account does not have platform administrator access.');
      void adminSupabase.auth.signOut();
      return;
    }
    window.location.href = appPath('/admin.html')
  }

  return <div className="auth-shell"><div className="auth-brand"><div className="brand-mark">ø</div><strong>Zerøbyte</strong><span>Admin Console</span></div><div className="auth-layout"><section className="auth-intro"><span className="auth-kicker">Platform operations</span><h1>Platform access<br /><em>restricted to approved admins.</em></h1><p>Only verified platform administrators can access the admin console. Business ownership, worker roles, and organization membership do not grant platform access.</p></section><form className="auth-card" onSubmit={handleSubmit}><span className="auth-kicker">Secure sign-in</span><h2>Admin login</h2><label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@zerobyte.app" /></label><label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary entry-button" disabled={loading}>{loading ? 'Authenticating…' : 'Enter admin console'}</button></form></div></div>
}

export function AdminAccessDenied({ email, onBack }: { email: string; onBack: () => void }) {
  const safeEmail = email || 'Unknown user';
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>Access denied</h1><p>{safeEmail} is not assigned a platform admin role in this environment.</p><p>The admin URL is intentionally separate from the user application. Business ownership and worker access do not grant platform administration rights.</p><button className="primary" onClick={onBack}>Return to business app</button></div></div>
}

export function AdminConsoleUnavailable() {
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>Admin console unavailable</h1><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and define <code>VITE_ADMIN_EMAILS</code> with the approved platform-admin addresses.</p><code>VITE_ADMIN_EMAILS=hello@zerobyte.app,ops@zerobyte.app</code></div></div>
}

export function ConfigurationRequired() {
  return <div className="auth-loading"><div className="auth-card"><div className="brand-mark">ø</div><h1>Connect your workspace</h1><p>Add your Supabase URL and publishable key to <code>.env.local</code>, then restart the dev server. Zerøbyte never shows invented business data.</p><code>VITE_SUPABASE_URL=…<br />VITE_SUPABASE_ANON_KEY=…</code></div></div>
}
