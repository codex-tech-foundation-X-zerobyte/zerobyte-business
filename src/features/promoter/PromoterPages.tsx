import { ArrowRight, Check, Copy, LogOut, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Metric, WorkspaceSkeleton } from '../../components/ui'
import { appPath } from '../../lib/routing'
import { supabase } from '../../lib/supabase'
import { toWhatsAppNumber, whatsappUrl } from '../../lib/whatsapp'

export function PromoterApplicationPage({ navigate }: { navigate: (path: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', location: '', social: '', experience: '', reason: '', agreed: false })
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form.agreed) { setError('Please agree to the promoter terms to continue.'); return }
    if (!toWhatsAppNumber(form.phone)) { setError('Enter a valid WhatsApp number, for example 0803 123 4567. We use it to send your promoter ID and sign-in link.'); return }
    if (!supabase) { setError('This deployment is not connected to a backend yet, so applications cannot be submitted here.'); return }
    setStatus('sending'); setError('')
    const { error: result } = await supabase.rpc('submit_promoter_application', {
      applicant_name: form.name, applicant_email: form.email, applicant_phone: form.phone.trim(),
      applicant_location: form.location || null, applicant_social: form.social || null,
      applicant_experience: form.experience || null, applicant_reason: form.reason, terms_agreed: form.agreed,
    })
    if (result) { setStatus('error'); setError(result.message.includes('DUPLICATE_APPLICATION') ? 'An application from this email is already under review.' : result.message.replace(/^(VALIDATION_ERROR|RATE_LIMITED): /, '')) }
    else setStatus('sent')
  }
  return <div className="legal-shell"><header className="legal-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Business</small></div><button className="text-btn" onClick={() => navigate('/auth')}>Sign in <ArrowRight size={14} /></button></header><main className="legal-content promoter-apply"><span className="section-label">Zerøbyte Promoters</span><h1>Earn by introducing businesses to Zerøbyte.</h1><p className="legal-intro">Apply below. Approved promoters get a referral code and link to share — commission is paid once a referred business becomes a paying customer, according to the program's terms.</p>{status === 'sent' ? <div className="panel form-success-panel"><Check size={20} /><h2>Application received.</h2><p>We'll review it and message you on WhatsApp ({form.phone}) with a decision. If you're approved, that message will include your promoter ID and a link to set your password. Please keep that number active.</p></div> : <form className="panel record-form" onSubmit={submit}><label>Full name<input autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Email<input autoComplete="email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>WhatsApp number<input autoComplete="tel" inputMode="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 0803 123 4567" /><small className="field-help">We send your promoter ID and sign-in link to this number on WhatsApp.</small></label><label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, state" /></label><label className="form-wide">Social profile or website (optional)<input value={form.social} onChange={(e) => setForm({ ...form, social: e.target.value })} placeholder="https://..." /></label><label className="form-wide">Marketing experience (optional)<textarea value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} /></label><label className="form-wide">Why do you want to promote Zerøbyte?<textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label><label className="settings-toggle-row form-wide"><span>I agree to the Zerøbyte Promoter terms</span><input type="checkbox" checked={form.agreed} onChange={(e) => setForm({ ...form, agreed: e.target.checked })} /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary" disabled={status === 'sending'}>{status === 'sending' ? 'Submitting…' : 'Submit application'}</button></form>}</main><footer className="landing-footer legal-footer"><span>Zerøbyte Business</span><div className="legal-links"><button onClick={() => navigate('/privacy')}>Privacy</button><button onClick={() => navigate('/terms')}>Terms</button></div></footer></div>
}

type PromoterSummary = { promoter_id: string; referral_code: string; status: string; total_referrals: number; qualified_referrals: number; commissionable_referrals: number }
type PromoterReferral = { business_label: string; status: string; signed_up_at: string; qualified_at: string | null }

const REFERRAL_STATUS: Record<string, { label: string; tone: string }> = {
  registered: { label: 'Signed up', tone: 'pending' },
  verified: { label: 'Verified', tone: 'pending' },
  active: { label: 'Active', tone: 'pending' },
  qualified: { label: 'Qualified', tone: 'completed' },
  commissionable: { label: 'Commission due', tone: 'completed' },
  paid: { label: 'Paid', tone: 'completed' },
  expired: { label: 'Expired', tone: 'failed' },
}

const supportWhatsApp = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.trim()

export function PromoterDashboard({ navigate }: { navigate: (path: string) => void }) {
  const [summary, setSummary] = useState<PromoterSummary | null>(null)
  const [referrals, setReferrals] = useState<PromoterReferral[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<'link' | 'message' | null>(null)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    const client = supabase
    let active = true
    void Promise.all([client.rpc('get_promoter_summary'), client.rpc('get_promoter_referrals')]).then(([summaryResult, referralResult]) => {
      if (!active) return
      setSummary(((summaryResult.data ?? []) as PromoterSummary[])[0] ?? null)
      setReferrals((referralResult.data ?? []) as PromoterReferral[])
      setLoading(false)
    })
    return () => { active = false }
  }, [])
  const referralLink = summary ? `${window.location.origin}${appPath('/')}?ref=${summary.referral_code}` : ''
  const shareMessage = `I run my business on Zerøbyte: stock, sales, customers and receipts in one place. Try it free with my link: ${referralLink}`
  async function copy(kind: 'link' | 'message') {
    try { await navigator.clipboard.writeText(kind === 'link' ? referralLink : shareMessage) } catch { return }
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 2000)
  }
  async function signOut() {
    await supabase?.auth.signOut()
    navigate('/')
  }
  const count = (...statuses: string[]) => referrals.filter((row) => statuses.includes(row.status)).length
  return <div className="legal-shell"><header className="legal-nav"><div className="brand"><div className="brand-mark">ø</div><span>Zerøbyte</span><small>Promoters</small></div><button className="text-btn" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button></header><main className="legal-content promoter-apply">{loading ? <WorkspaceSkeleton /> : summary ? <>
    <span className="section-label">Your promoter dashboard</span>
    <h1>Share your link. Track every referral.</h1>
    {summary.status === 'suspended' && <div className="form-error" role="alert">Your promoter account is currently suspended, so new signups will not be credited to you. Contact support if you believe this is a mistake.</div>}
    <div className="panel" style={{ marginTop: 24 }}>
      <span className="section-label">Your promoter ID</span>
      <h2 className="mono promoter-code">{summary.referral_code}</h2>
      <div className="admin-plan-price-row" style={{ maxWidth: 'none' }}>
        <input readOnly aria-label="Your referral link" value={referralLink} style={{ flex: 1 }} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="secondary" onClick={() => void copy('link')}><Copy size={14} /> {copied === 'link' ? 'Copied!' : 'Copy link'}</button>
      </div>
      <div className="promoter-share-row">
        <a className="primary promoter-share-button" href={whatsappUrl(shareMessage)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Share on WhatsApp</a>
        <button type="button" className="secondary" onClick={() => void copy('message')}>{copied === 'message' ? 'Message copied!' : 'Copy ready-made message'}</button>
      </div>
    </div>
    <div className="metrics" style={{ marginTop: 20 }}>
      <Metric label="Signed up" value={String(referrals.length || summary.total_referrals)} note="Businesses that joined with your code" />
      <Metric label="Qualified" value={String(referrals.length ? count('qualified', 'commissionable', 'paid') : summary.qualified_referrals)} note="Verified as real, active businesses" />
      <Metric label="Commission due" value={String(referrals.length ? count('commissionable') : summary.commissionable_referrals)} note="Ready to be paid out" />
      <Metric label="Paid" value={String(count('paid'))} note="Commissions already settled" />
    </div>
    <div className="panel" style={{ marginTop: 20 }}>
      <span className="section-label">Your referrals</span>
      {referrals.length ? <div className="table-wrap"><table><thead><tr><th>Business</th><th>Status</th><th>Signed up</th></tr></thead><tbody>{referrals.map((row, index) => {
        const info = REFERRAL_STATUS[row.status] ?? { label: row.status, tone: 'pending' }
        return <tr key={`${row.business_label}-${row.signed_up_at}-${index}`}><td>{row.business_label}</td><td><span className={`status ${info.tone}`}>{info.label}</span></td><td>{new Date(row.signed_up_at).toLocaleDateString('en-NG')}</td></tr>
      })}</tbody></table></div> : <p className="field-help" style={{ marginTop: 10 }}>No referrals yet. Share your link on WhatsApp, in business groups, or with shop owners you know. They show up here as soon as they sign up.</p>}
      <p className="field-help" style={{ marginTop: 12 }}>For privacy, business names are partly hidden. The Zerøbyte team reviews each referral before it becomes commissionable.</p>
    </div>
    <div className="panel" style={{ marginTop: 20 }}>
      <span className="section-label">How it works</span>
      <ol className="promoter-steps"><li>Send your link to a business owner.</li><li>They sign up and start using Zerøbyte. It appears above as <strong>Signed up</strong>.</li><li>Once the team confirms they are a real, active customer it becomes <strong>Qualified</strong>, then <strong>Commission due</strong>, and finally <strong>Paid</strong>.</li></ol>
      <p className="field-help">Also run a business? <button type="button" className="text-btn" onClick={() => { window.sessionStorage.setItem('zb-skip-promoter-redirect', '1'); navigate('/') }}>Set up your own workspace</button></p>
      {supportWhatsApp && toWhatsAppNumber(supportWhatsApp) && <a className="secondary promoter-share-button" href={whatsappUrl(`Hello, I'm promoter ${summary.referral_code} and I need help.`, supportWhatsApp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Chat with the team on WhatsApp</a>}
    </div>
  </> : <>
    <span className="section-label">Promoter dashboard</span>
    <h1>No promoter account found.</h1>
    <p className="legal-intro">This account isn't linked to a promoter profile. After your application is approved, the Zerøbyte team sends your promoter ID and a password-setup link on WhatsApp. Open that link on this device, then sign in here.</p>
    <button className="primary" onClick={() => navigate('/promoters')}>Apply to become a promoter</button>
  </>}</main></div>
}
