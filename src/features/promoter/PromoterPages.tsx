import { ArrowRight, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Metric, WorkspaceSkeleton } from '../../components/ui'
import { appPath } from '../../lib/routing'
import { supabase } from '../../lib/supabase'

export function PromoterApplicationPage({ navigate }: { navigate: (path: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', location: '', social: '', experience: '', reason: '', agreed: false })
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form.agreed) { setError('Please agree to the promoter terms to continue.'); return }
    if (!supabase) { setError('This deployment is not connected to a backend yet, so applications cannot be submitted here.'); return }
    setStatus('sending'); setError('')
    const { error: result } = await supabase.rpc('submit_promoter_application', {
      applicant_name: form.name, applicant_email: form.email, applicant_phone: form.phone || null,
      applicant_location: form.location || null, applicant_social: form.social || null,
      applicant_experience: form.experience || null, applicant_reason: form.reason, terms_agreed: form.agreed,
    })
    if (result) { setStatus('error'); setError(result.message.includes('DUPLICATE_APPLICATION') ? 'An application from this email is already under review.' : result.message) }
    else setStatus('sent')
  }
  return <div className="legal-shell"><header className="legal-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Business</small></div><button className="text-btn" onClick={() => navigate('/auth')}>Sign in <ArrowRight size={14} /></button></header><main className="legal-content promoter-apply"><span className="section-label">Zerøbyte Promoters</span><h1>Earn by introducing businesses to Zerøbyte.</h1><p className="legal-intro">Apply below. Approved promoters get a referral code and link to share — commission is paid once a referred business becomes a paying customer, according to the program's terms.</p>{status === 'sent' ? <div className="panel form-success-panel"><Check size={20} /><h2>Application received.</h2><p>We'll review it and email {form.email} with a decision.</p></div> : <form className="panel record-form" onSubmit={submit}><label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label><label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, state" /></label><label className="form-wide">Social profile or website (optional)<input value={form.social} onChange={(e) => setForm({ ...form, social: e.target.value })} placeholder="https://..." /></label><label className="form-wide">Marketing experience (optional)<textarea value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} /></label><label className="form-wide">Why do you want to promote Zerøbyte?<textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label><label className="settings-toggle-row form-wide"><span>I agree to the Zerøbyte Promoter terms</span><input type="checkbox" checked={form.agreed} onChange={(e) => setForm({ ...form, agreed: e.target.checked })} /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary" disabled={status === 'sending'}>{status === 'sending' ? 'Submitting…' : 'Submit application'}</button></form>}</main><footer className="landing-footer legal-footer"><span>Zerøbyte Business</span><div className="legal-links"><button onClick={() => navigate('/privacy')}>Privacy</button><button onClick={() => navigate('/terms')}>Terms</button></div></footer></div>
}

export function PromoterDashboard({ navigate }: { navigate: (path: string) => void }) {
  const [summary, setSummary] = useState<{ promoter_id: string; referral_code: string; status: string; total_referrals: number; qualified_referrals: number; commissionable_referrals: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
      if (!supabase) { setLoading(false); return }
    const client = supabase
    let active = true
    void client.rpc('link_promoter_account').then(() => client.rpc('get_promoter_summary')).then(({ data }) => {
      if (!active) return
      setSummary((data ?? [])[0] ?? null)
      setLoading(false)
    })
    return () => { active = false }
  }, [])
  const referralLink = summary ? `${window.location.origin}${appPath('/')}?ref=${summary.referral_code}` : ''
  async function copyLink() {
    await navigator.clipboard.writeText(referralLink)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return <div className="legal-shell"><header className="legal-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Promoters</small></div><button className="text-btn" onClick={() => navigate('/')}>Back to Zerøbyte <ArrowRight size={14} /></button></header><main className="legal-content promoter-apply">{loading ? <WorkspaceSkeleton /> : summary ? <><span className="section-label">Your promoter dashboard</span><h1>Referrals and commission status.</h1>{summary.status === 'suspended' && <div className="form-error">Your promoter account is currently suspended. Contact support if you believe this is a mistake.</div>}<div className="panel" style={{ marginTop: 24 }}><span className="section-label">Referral code</span><h2 className="mono" style={{ margin: '6px 0 14px' }}>{summary.referral_code}</h2><div className="admin-plan-price-row" style={{ maxWidth: 'none' }}><input readOnly value={referralLink} style={{ flex: 1 }} /><button type="button" className="secondary" onClick={() => void copyLink()}>{copied ? 'Copied!' : 'Copy link'}</button></div></div><div className="metrics" style={{ marginTop: 20 }}><Metric label="Total referrals" value={summary.total_referrals.toString()} note="Businesses that signed up with your code" /><Metric label="Qualified" value={summary.qualified_referrals.toString()} note="Became active paying customers" /><Metric label="Commissionable" value={summary.commissionable_referrals.toString()} note="Commission payouts are not live yet" /></div><p className="field-help" style={{ marginTop: 18 }}>Commission calculation and payouts go live once Zerøbyte's payment processor is connected — your referral tracking above is already real and live.</p></> : <><span className="section-label">Promoter dashboard</span><h1>No promoter account found.</h1><p className="legal-intro">This account isn't linked to an approved promoter application yet. If you've applied, make sure you're signed in with the same email you applied with.</p><button className="primary" onClick={() => navigate('/promoters')}>Apply to become a promoter</button></>}</main></div>
}
