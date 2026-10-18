import { UserGuide } from '../guide/UserGuide'
import { BookOpen, CreditCard, MessageCircle, Palette, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, PageIntro } from '../../components/ui'
import { normalizeLogoUrl } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { PasswordSettings } from '../auth/AuthScreens'

export function SettingsPage({ orgId, themeDark, onThemeChange, initialTab, billingRefreshKey }: { billingRefreshKey?: number; orgId: string; themeDark: boolean; onThemeChange: (dark: boolean) => void; initialTab?: 'profile' | 'business' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide' }) {
  const [form, setForm] = useState({ name: '', tagline: '', address: '', phone: '', email: '', website: '', logo_url: '', receipt_prefix: '', tax_rate: '0' }); const [saved, setSaved] = useState(false); const [error, setError] = useState('')
  const [announcements, setAnnouncements] = useState<{ id: string; version: string; message: string; created_at: string }[]>([])
  const [activeTab, setActiveTab] = useState<'profile' | 'business' | 'billing' | 'appearance' | 'security' | 'feedback' | 'guide'>(initialTab ?? 'business')
  const [profileForm, setProfileForm] = useState({ full_name: '', phone: '' })
  const [profileMeta, setProfileMeta] = useState<{ email: string; createdAt: string } | null>(null)
  const [profileSaved, setProfileSaved] = useState(false); const [profileError, setProfileError] = useState(''); const [profileBusy, setProfileBusy] = useState(false)
  const loadProfile = useCallback(async () => {
    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return
    setProfileMeta({ email: user.email ?? '', createdAt: user.created_at })
    const { data } = await supabase.from('profiles').select('full_name,phone').eq('id', user.id).maybeSingle()
    if (data) setProfileForm({ full_name: data.full_name ?? '', phone: data.phone ?? '' })
  }, [])
  useEffect(() => { if (activeTab === 'profile') void loadProfile() }, [activeTab, loadProfile])
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setProfileBusy(true); setProfileError(''); setProfileSaved(false)
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) { setProfileBusy(false); return }
    const { error: result } = await supabase.from('profiles').upsert({ id: user.id, full_name: profileForm.full_name.trim(), phone: profileForm.phone.trim() || null, updated_at: new Date().toISOString() })
    setProfileBusy(false)
    if (result) setProfileError(result.message)
    else { setProfileSaved(true); window.setTimeout(() => setProfileSaved(false), 2500) }
  }
  const [plans, setPlans] = useState<{ plan_id: string; code: string; name: string; description: string; trial_days: number; monthly_amount: number | null; currency: string; limits: Record<string, number | null> }[]>([])
  const [subscription, setSubscription] = useState<{ plan_id: string; status: string; trial_end: string | null; current_period_end: string | null } | null>(null)
  const [billingError, setBillingError] = useState(''); const [billingBusyPlan, setBillingBusyPlan] = useState('')
  const loadBilling = useCallback(() => {
    if (!supabase) return
    supabase.rpc('get_plan_catalog').then(({ data }) => setPlans((data ?? []) as typeof plans))
    supabase.from('subscriptions').select('plan_id,status,trial_end,current_period_end').eq('organization_id', orgId).maybeSingle().then(({ data }) => setSubscription(data))
  }, [orgId])
  useEffect(() => { loadBilling() }, [loadBilling])
  async function startTrial(planId: string) {
    if (!supabase) return
    setBillingBusyPlan(planId); setBillingError('')
    const { error: result } = await supabase.rpc('start_plan_trial', { target_org: orgId, target_plan: planId })
    if (result) setBillingError(result.message)
    else loadBilling()
    setBillingBusyPlan('')
  }
  // The browser only says which plan it wants. The price, the reference and the "was it paid?" decision all
  // live on the server (paystack-initialize / paystack-verify / paystack-webhook).
  async function payForPlan(planId: string) {
    if (!supabase) return
    setBillingBusyPlan(planId); setBillingError('')
    const { data, error: result } = await supabase.functions.invoke('paystack-initialize', { body: { organizationId: orgId, planId, interval: 'monthly' } })
    const url = (data as { authorizationUrl?: string } | null)?.authorizationUrl
    if (result || !url) {
      let message = 'Could not start the payment. Please try again.'
      try { const body = await (result as { context?: Response } | null)?.context?.json(); if (body?.error) message = body.error } catch { /* keep the generic message */ }
      setBillingError(message); setBillingBusyPlan(''); return
    }
    let safe = false
    try { const target = new URL(url); safe = target.protocol === 'https:' && (target.hostname === 'paystack.com' || target.hostname.endsWith('.paystack.com')) } catch { safe = false }
    if (!safe) { setBillingError('The payment page address looked wrong, so we stopped. Please try again or contact support.'); setBillingBusyPlan(''); return }
    window.location.assign(url)
  }
  // Payment confirmation now happens at workspace level (usePaymentReturn); here we only reload the plan once it settles.
  useEffect(() => { if (billingRefreshKey) loadBilling() }, [billingRefreshKey, loadBilling])
  const currentPlan = plans.find((plan) => plan.plan_id === subscription?.plan_id)
  const trialDaysLeft = subscription?.trial_end ? Math.max(0, Math.ceil((new Date(subscription.trial_end).getTime() - Date.now()) / 86400000)) : null
  const [feedbackRows, setFeedbackRows] = useState<{ id: string; category: string; severity: string; message: string; status: string; admin_response: string | null; created_at: string }[]>([])
  const [feedbackForm, setFeedbackForm] = useState({ category: 'feature_request', severity: 'medium', message: '' })
  const [feedbackBusy, setFeedbackBusy] = useState(false); const [feedbackError, setFeedbackError] = useState('')
  const loadFeedback = useCallback(() => { if (!supabase) return; supabase.from('product_feedback').select('id,category,severity,message,status,admin_response,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).then(({ data }) => setFeedbackRows(data ?? [])) }, [orgId])
  useEffect(() => { if (activeTab === 'feedback') loadFeedback() }, [activeTab, loadFeedback])
  async function submitFeedback(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !feedbackForm.message.trim()) return
    setFeedbackBusy(true); setFeedbackError('')
    const userId = (await supabase.auth.getUser()).data.user?.id
    if (!userId) { setFeedbackBusy(false); return }
    const { error: result } = await supabase.from('product_feedback').insert({ organization_id: orgId, user_id: userId, category: feedbackForm.category, severity: feedbackForm.severity, message: feedbackForm.message.trim() })
    if (result) setFeedbackError(result.message)
    else { setFeedbackForm({ category: 'feature_request', severity: 'medium', message: '' }); loadFeedback() }
    setFeedbackBusy(false)
  }
  useEffect(() => { supabase?.from('organizations').select('name,tagline,address,phone,email,website,logo_url,receipt_prefix,tax_rate').eq('id', orgId).single().then(({ data }) => setForm({ name: data?.name ?? '', tagline: data?.tagline ?? '', address: data?.address ?? '', phone: data?.phone ?? '', email: data?.email ?? '', website: data?.website ?? '', logo_url: normalizeLogoUrl(data?.logo_url), receipt_prefix: data?.receipt_prefix ?? '', tax_rate: String(data?.tax_rate ?? 0) })) }, [orgId])
  useEffect(() => { supabase?.from('app_version_announcements').select('id,version,message,created_at').order('created_at', { ascending: false }).limit(20).then(({ data }) => setAnnouncements((data ?? []) as typeof announcements)) }, [])
  async function save(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); const payload = { ...form, tagline: form.tagline.trim() || null, receipt_prefix: form.receipt_prefix.toUpperCase(), tax_rate: Math.min(100, Math.max(0, Number(form.tax_rate) || 0)) }; const { error: result } = await supabase.from('organizations').update(payload).eq('id', orgId); if (result) setError(result.message); else { setForm({ ...form, tagline: form.tagline.trim(), receipt_prefix: payload.receipt_prefix, tax_rate: String(payload.tax_rate) }); setSaved(true) } }
  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file || !supabase) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Choose a PNG, JPG, or WEBP image.'); return } if (file.size > 2 * 1024 * 1024) { setError('Logo must be smaller than 2 MB.'); return } setError(''); const path = `${orgId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const { error: uploadError } = await supabase.storage.from('business-logos').upload(path, file, { upsert: false, contentType: file.type }); if (uploadError) { setError(`Logo upload failed: ${uploadError.message}. Only the business owner or an admin can change the logo.`); return } const { data } = supabase.storage.from('business-logos').getPublicUrl(path); const logoUrl = normalizeLogoUrl(data.publicUrl); setForm((current) => ({ ...current, logo_url: logoUrl })); const { error: saveError } = await supabase.from('organizations').update({ logo_url: logoUrl }).eq('id', orgId); if (saveError) { setError(`The logo uploaded but could not be saved to your business: ${saveError.message}`); setSaved(false); return } setSaved(true) }
  async function removeLogo() { if (!supabase) return; setError(''); const { error: removeError } = await supabase.from('organizations').update({ logo_url: null }).eq('id', orgId); if (removeError) { setError(`Could not remove the logo: ${removeError.message}`); return } setForm((current) => ({ ...current, logo_url: '' })); setSaved(true) }
  const tabs = [{ id: 'profile', label: 'My profile', icon: UserRound }, { id: 'business', label: 'Business profile', icon: Settings }, { id: 'billing', label: 'Billing', icon: CreditCard }, { id: 'appearance', label: 'Appearance', icon: Palette }, { id: 'security', label: 'Security', icon: ShieldCheck }, { id: 'feedback', label: 'Feedback', icon: MessageCircle }, { id: 'guide', label: 'Guide & updates', icon: BookOpen }] as const
  return <div className="page settings-page"><PageIntro label="Settings" title="Make it yours." description="Manage your business identity, workspace preferences, account security, and updates." /><div className="settings-layout"><nav className="settings-tabs" aria-label="Settings sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`settings-tab ${activeTab === id ? 'active' : ''}`} aria-selected={activeTab === id} onClick={() => setActiveTab(id)}><Icon size={16} />{label}</button>)}</nav><div className="settings-content">
    {activeTab === 'profile' && <form className="panel settings-form" onSubmit={saveProfile}><div className="settings-section-heading"><span className="section-label">My profile</span><p className="muted">Your personal identity on this account — separate from the business profile.</p></div><label>Full name<input required value={profileForm.full_name} onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} placeholder="Your name" /></label><label>Phone number<input type="tel" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} placeholder="+234..." /></label><label>Email<input value={profileMeta?.email ?? ''} disabled /><small className="field-help">Contact support to change the email on your account.</small></label>{profileMeta?.createdAt && <p className="field-help">Member since {new Date(profileMeta.createdAt).toLocaleDateString('en-NG', { dateStyle: 'long' })}</p>}<div className="settings-actions"><button className="primary" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button>{profileSaved && <span className="form-success">Saved.</span>}{profileError && <span className="form-error">{profileError}</span>}</div></form>}
    {activeTab === 'business' && <form className="settings-stack" onSubmit={save}>
      <section className="settings-card receipt-peek" aria-label="How your receipts will look">
        <span className="section-label">Receipt preview</span>
        <div className="receipt-peek-body">
          {form.logo_url ? <img src={form.logo_url} alt="" className="receipt-peek-logo" /> : <div className="receipt-peek-logo placeholder">{(form.name || 'ø').trim().charAt(0).toUpperCase()}</div>}
          <div><strong>{form.name || 'Your business name'}</strong>{form.tagline && <em>{form.tagline}</em>}<small>{[form.address, form.phone].filter(Boolean).join(' · ') || 'Address and phone appear here'}</small></div>
          <span className="receipt-peek-number">{(form.receipt_prefix || 'ZB')}-001</span>
        </div>
      </section>
      <section className="settings-card">
        <header><h3>Brand</h3><p>Your name and logo appear at the top of every receipt and invoice.</p></header>
        <div className="logo-row">
          {form.logo_url ? <img src={form.logo_url} alt="Business logo" className="logo-tile" /> : <div className="logo-tile placeholder">{(form.name || 'ø').trim().charAt(0).toUpperCase()}</div>}
          <div className="logo-actions"><div><label className="button-like secondary">{form.logo_url ? 'Replace logo' : 'Upload logo'}<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadLogo(e)} /></label>{form.logo_url && <button type="button" className="text-btn danger-text" onClick={() => void removeLogo()}>Remove</button>}</div><small className="field-help">PNG, JPG or WEBP, up to 2 MB. Saved as soon as it uploads.</small></div>
        </div>
        <div className="settings-grid">
          <label className="settings-field">Business name<input required minLength={2} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setSaved(false) }} /></label>
          <label className="settings-field"><span>Slogan <span className="optional">optional</span></span><input maxLength={120} value={form.tagline} onChange={(e) => { setForm({ ...form, tagline: e.target.value }); setSaved(false) }} placeholder="e.g. Quality you can trust" /></label>
        </div>
      </section>
      <section className="settings-card">
        <header><h3>Contact details</h3><p>Customers see these on receipts, so use real ones.</p></header>
        <div className="settings-grid">
          <label className="settings-field wide">Address<input value={form.address} onChange={(e) => { setForm({ ...form, address: e.target.value }); setSaved(false) }} placeholder="Street, city, state" /></label>
          <label className="settings-field">Phone number<input type="tel" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setSaved(false) }} placeholder="+234..." /></label>
          <label className="settings-field">Business email<input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setSaved(false) }} placeholder="hello@business.com" /></label>
          <label className="settings-field wide"><span>Website <span className="optional">optional</span></span><input type="url" value={form.website} onChange={(e) => { setForm({ ...form, website: e.target.value }); setSaved(false) }} placeholder="https://business.com" /></label>
        </div>
      </section>
      <section className="settings-card">
        <header><h3>Receipts and tax</h3><p>Past receipts keep the rate that applied when they were created.</p></header>
        <div className="settings-grid">
          <label className="settings-field">Receipt prefix<input maxLength={8} pattern="[A-Za-z0-9]{2,8}" value={form.receipt_prefix} onChange={(e) => { setForm({ ...form, receipt_prefix: e.target.value.toUpperCase() }); setSaved(false) }} placeholder="ZB" /><small className="field-help">Numbers look like {(form.receipt_prefix || 'ZB')}-001.</small></label>
          <label className="settings-field">Tax / VAT rate (%)<input type="number" min="0" max="100" step="0.01" value={form.tax_rate} onChange={(e) => { setForm({ ...form, tax_rate: e.target.value }); setSaved(false) }} placeholder="7.5" /><small className="field-help">Applied to new sales going forward.</small></label>
        </div>
      </section>
      <div className="settings-savebar"><span className="settings-savebar-status">{error ? <span className="form-error">{error}</span> : saved ? <span className="form-success">All changes saved.</span> : <span className="muted">Changes are not saved until you press Save.</span>}</span><button className="primary">Save changes</button></div>
    </form>}
    {activeTab === 'billing' && <><section className="panel settings-info billing-current"><span className="section-label">Current plan</span><h2>{currentPlan?.name ?? 'Free'}{subscription?.status === 'trialing' && <span className="version-badge">Trial</span>}</h2><p className="muted">{subscription?.status === 'trialing' && trialDaysLeft != null ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your trial. No card was charged to start it.` : subscription?.status === 'active' ? 'Your plan is active.' : subscription ? `Status: ${subscription.status}` : 'Loading your subscription…'}</p>{currentPlan && <ul className="billing-limits">{Object.entries(currentPlan.limits).map(([resource, limit]) => <li key={resource}><span>{resource.replace(/_/g, ' ')}</span><strong>{limit == null ? 'Unlimited' : limit.toLocaleString('en-NG')}</strong></li>)}</ul>}{subscription?.status === 'active' && subscription.current_period_end && currentPlan && currentPlan.code !== 'free' && <p className="field-help">Paid through {new Date(subscription.current_period_end).toLocaleDateString('en-NG', { dateStyle: 'long' })}.</p>}</section>{subscription?.current_period_end && ['active', 'trialing'].includes(subscription.status) && new Date(subscription.current_period_end) < new Date() && <div className="notice" role="status">Your paid period has ended, so your business is on Free plan limits. Your records are untouched. Pay for a plan to restore your limits.</div>}<p className="field-help">Payments are one-time for one month at the price shown. Nothing renews automatically and your card is never stored by Zerøbyte. Paystack processes the payment and sends your receipt.</p>{billingError && <div className="form-error" role="alert">{billingError}</div>}<section className="panel"><span className="section-label">Available plans</span><h2>Compare plans and pay securely.</h2><div className="billing-plan-grid">{plans.map((plan) => <div key={plan.plan_id} className={`billing-plan-card ${currentPlan?.plan_id === plan.plan_id ? 'billing-plan-current' : ''}`}><strong>{plan.name}</strong><span className="amount">{plan.monthly_amount ? `₦${Number(plan.monthly_amount).toLocaleString('en-NG')}/mo` : plan.code === 'enterprise' ? 'Custom pricing' : 'Free'}</span><p className="muted">{plan.description}</p>{currentPlan?.plan_id === plan.plan_id && subscription?.status === 'active' && plan.code === 'free' ? <span className="status completed">Current plan</span> : plan.code === 'enterprise' ? <button type="button" className="secondary" disabled>Contact support</button> : plan.code === 'free' ? <span className="muted">Free forever</span> : <div className="billing-plan-actions">{plan.monthly_amount ? <button type="button" className="primary" disabled={Boolean(billingBusyPlan)} onClick={() => void payForPlan(plan.plan_id)}>{billingBusyPlan === plan.plan_id ? 'Opening Paystack…' : currentPlan?.plan_id === plan.plan_id && subscription?.status === 'active' ? 'Renew with Paystack' : 'Pay with Paystack'}</button> : null}{plan.trial_days > 0 && subscription?.status !== 'trialing' && currentPlan?.plan_id !== plan.plan_id && <button type="button" className="secondary" disabled={Boolean(billingBusyPlan)} onClick={() => void startTrial(plan.plan_id)}>Start {plan.trial_days}-day trial</button>}</div>}</div>)}</div></section></>}
    {activeTab === 'appearance' && <section className="panel settings-preferences"><div><span className="section-label">Preferences</span><h2>Make the workspace comfortable.</h2><p>These settings are saved on this device and do not change your business records.</p></div><label className="settings-toggle-row"><span><strong>Dark mode</strong><small>Use the dark Zerøbyte workspace theme.</small></span><input type="checkbox" role="switch" checked={themeDark} onChange={(event) => onThemeChange(event.target.checked)} /></label></section>}
    {activeTab === 'feedback' && <><section className="panel"><span className="section-label">Tell us what's not working (or what would help)</span><h2>Send feedback.</h2><form className="record-form" onSubmit={submitFeedback} style={{ marginTop: 16 }}><label>Category<select value={feedbackForm.category} onChange={(e) => setFeedbackForm({ ...feedbackForm, category: e.target.value })}><option value="bug">Bug</option><option value="ux">Something's confusing</option><option value="feature_request">Feature request</option><option value="performance">Performance</option><option value="billing">Billing</option><option value="documentation">Documentation</option><option value="integration">Integration</option></select></label><label>Severity<select value={feedbackForm.severity} onChange={(e) => setFeedbackForm({ ...feedbackForm, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical — blocking my work</option></select></label><label className="form-wide">What happened?<textarea required value={feedbackForm.message} onChange={(e) => setFeedbackForm({ ...feedbackForm, message: e.target.value })} placeholder="The more detail the better." /></label>{feedbackError && <div className="form-error">{feedbackError}</div>}<button className="primary" disabled={feedbackBusy}>{feedbackBusy ? 'Sending…' : 'Send feedback'}</button></form></section><section className="panel table-panel"><div className="panel-heading"><div><span className="section-label">Your reports</span><h2>{feedbackRows.length} submitted</h2></div></div>{feedbackRows.length ? <div className="table-wrap"><table><thead><tr><th>Category</th><th>Severity</th><th>Message</th><th>Status</th><th>Response</th><th>Date</th></tr></thead><tbody>{feedbackRows.map((row) => <tr key={row.id}><td>{row.category.replace(/_/g, ' ')}</td><td>{row.severity}</td><td style={{ maxWidth: 260 }}>{row.message}</td><td><span className={`status ${row.status === 'resolved' ? 'completed' : row.status === 'declined' ? 'refunded' : 'pending'}`}>{row.status}</span></td><td>{row.admin_response || '—'}</td><td>{new Date(row.created_at).toLocaleDateString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No feedback sent yet" text="Anything you report here goes straight to the team." />}</section></>}
    {activeTab === 'security' && <><section className="panel settings-security"><span className="section-label">Account security</span><h2>Change your password</h2><p>Choose a unique password you do not reuse elsewhere.</p><PasswordSettings /></section><section className="panel settings-info"><span className="section-label">Data protection</span><h2>Organization-scoped by default.</h2><p>Every product, customer, sale and expense is protected by Supabase Row Level Security and tied to this workspace.</p></section></>}
    {activeTab === 'guide' && <><UserGuide embedded canReplayTour /><section className="panel app-version-card"><div><span className="section-label">Application</span><h2>Zerøbyte Business <span className="version-badge">v{import.meta.env.VITE_APP_VERSION ?? '1.0.0'}</span></h2><p className="muted">{announcements[0] ? `Latest release · v${announcements[0].version}: ${announcements[0].message}` : 'You are running the current published workspace.'}</p></div></section>{announcements.length > 0 && <section className="panel changelog-panel"><div className="panel-heading"><div><span className="section-label">Release history</span><h2>Changelog</h2></div><span className="version-badge">{announcements.length} release{announcements.length === 1 ? '' : 's'}</span></div><div className="changelog-list">{announcements.map((item) => <article className="changelog-entry" key={item.id}><div><strong>v{item.version}</strong><time>{new Date(item.created_at).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</time></div><p>{item.message}</p></article>)}</div></section>}<section className="panel settings-info"><span className="section-label">User guide</span><h2>A simple rhythm for clean records.</h2><div className="guide-list"><p><strong>1. Inventory:</strong> add products and receive stock. Stock intake is recorded automatically.</p><p><strong>2. Sales:</strong> choose a customer first, add products, then complete the sale.</p><p><strong>3. Expenses:</strong> record operating costs on the Expenses page.</p><p><strong>4. Records:</strong> choose a period to review history, totals, and export CSV for Excel or Sheets. Records are read-only here.</p><p><strong>5. Offline:</strong> drafts and queued changes stay on this device until you reconnect. Review the sync banner before signing out.</p></div></section></>}
  </div></div></div>
}
