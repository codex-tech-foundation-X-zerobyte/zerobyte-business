import { BrandMark } from '../../components/BrandMark'
import { BuiltBy } from '../../components/BuiltBy'
import { trackEvent } from '../../lib/googleAnalytics'
import { ArrowRight, Check } from 'lucide-react'
import { useState } from 'react'
import { usePublicPageMeta } from '../../lib/pageMeta'
import { supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase'
import { useTurnstile } from '../../components/Turnstile'
import { toWhatsAppNumber } from '../../lib/whatsapp'

export function PromoterApplicationPage({ navigate }: { navigate: (path: string) => void }) {
  usePublicPageMeta('/promoters')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    location: '',
    social: '',
    experience: '',
    reason: '',
    agreed: false,
  })
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const captcha = useTurnstile()
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form.agreed) {
      setError('Please agree to the promoter terms to continue.')
      return
    }
    if (!toWhatsAppNumber(form.phone)) {
      setError(
        'Enter a valid WhatsApp number, for example 0803 123 4567. We use it to send your promoter ID and sign-in link.',
      )
      return
    }
    if (!supabase || !supabaseUrl) {
      setError('This deployment is not connected to a backend yet, so applications cannot be submitted here.')
      return
    }
    if (captcha.enabled && !captcha.token) {
      setError('Please complete the human check, then submit again.')
      return
    }
    setStatus('sending')
    setError('')
    // The form no longer talks to the database directly: the edge function checks the human check first and
    // sends the real connection address along, so the rate limit cannot be dodged with a forged header.
    let failure = ''
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/submit-promoter-application`, {
        method: 'POST',
        headers: { apikey: supabaseAnonKey ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone.trim(),
          location: form.location || null,
          social: form.social || null,
          experience: form.experience || null,
          reason: form.reason,
          agreed: form.agreed,
          captchaToken: captcha.token,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        failure = payload?.error ?? 'Could not submit the application. Please try again.'
      }
    } catch {
      failure = 'We could not reach the server. Check your connection and try again.'
    }
    captcha.reset()
    if (failure) {
      setStatus('error')
      setError(failure)
    } else {
      trackEvent('generate_lead', { lead_type: 'promoter_application' })
      setStatus('sent')
    }
  }
  return (
    <div className="legal-shell">
      <header className="legal-nav">
        <div className="brand">
          <BrandMark />
          <span>Zerøbyte</span>
          <small>Business</small>
        </div>
        <button className="text-btn" onClick={() => navigate('/auth')}>
          Sign in <ArrowRight size={14} />
        </button>
      </header>
      <main className="legal-content promoter-apply">
        <span className="section-label">Zerøbyte Promoters</span>
        <h1>Earn by introducing businesses to Zerøbyte.</h1>
        <p className="legal-intro">
          Apply below. Approved promoters get a referral code and link to share — commission is paid once a referred
          business becomes a paying customer, according to the program's terms.
        </p>
        {status === 'sent' ? (
          <div className="panel form-success-panel">
            <Check size={20} />
            <h2>Application received.</h2>
            <p>
              We'll review it and message you on WhatsApp ({form.phone}) with a decision. If you're approved, that
              message will include your promoter ID and a link to set your password. Please keep that number active.
            </p>
          </div>
        ) : (
          <form className="panel record-form" onSubmit={submit}>
            <label>
              Full name
              <input
                autoComplete="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                autoComplete="email"
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              WhatsApp number
              <input
                autoComplete="tel"
                inputMode="tel"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="e.g. 0803 123 4567"
              />
              <small className="field-help">
                We send your promoter ID and sign-in link to this number on WhatsApp.
              </small>
            </label>
            <label>
              Location
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="City, state"
              />
            </label>
            <label className="form-wide">
              Social profile or website (optional)
              <input
                value={form.social}
                onChange={(e) => setForm({ ...form, social: e.target.value })}
                placeholder="https://..."
              />
            </label>
            <label className="form-wide">
              Marketing experience (optional)
              <textarea value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} />
            </label>
            <label className="form-wide">
              Why do you want to promote Zerøbyte?
              <textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </label>
            <label className="settings-toggle-row form-wide">
              <span>I agree to the Zerøbyte Promoter terms</span>
              <input
                type="checkbox"
                checked={form.agreed}
                onChange={(e) => setForm({ ...form, agreed: e.target.checked })}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {captcha.element}
            <button className="primary" disabled={status === 'sending'}>
              {status === 'sending' ? 'Submitting…' : 'Submit application'}
            </button>
          </form>
        )}
      </main>
      <footer className="landing-footer legal-footer">
        <span>
          Zerøbyte Business <BuiltBy />
        </span>
        <div className="legal-links">
          <button onClick={() => navigate('/about')}>About</button>
          <button onClick={() => navigate('/privacy')}>Privacy</button>
          <button onClick={() => navigate('/terms')}>Terms</button>
        </div>
      </footer>
    </div>
  )
}
