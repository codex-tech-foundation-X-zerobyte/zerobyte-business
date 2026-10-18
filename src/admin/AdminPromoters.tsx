import { useCallback, useEffect, useState } from 'react'
import { Copy, MessageCircle, RefreshCw, X } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { toWhatsAppNumber, whatsappUrl } from '../lib/whatsapp'
import { fetchAdminFunction } from './api'
import { formatAdminValue } from './format'

export function AdminPromoters() {
  const [applications, setApplications] = useState<{ id: string; full_name: string; email: string; phone: string | null; location: string | null; reason: string; status: string; created_at: string }[]>([])
  const [promoterList, setPromoterList] = useState<{ promoter_id: string; full_name: string; email: string; whatsapp: string | null; referral_code: string; status: string; created_at: string; total_referrals: number; has_account: boolean }[]>([])
  const [referralList, setReferralList] = useState<{ referral_id: string; promoter_name: string; referral_code: string; business_name: string | null; status: string; signed_up_at: string }[]>([])
  const [referralDraft, setReferralDraft] = useState<Record<string, string>>({})
  const [access, setAccess] = useState<{ name: string; code: string; whatsapp: string | null; link: string; siteUrl: string; message: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({})

  const loadPromoters = useCallback(() => {
    if (!adminSupabase) return
    setLoading(true); setError('')
    Promise.all([
      adminSupabase.from('promoter_applications').select('id,full_name,email,phone,location,reason,status,created_at').in('status', ['applied', 'under_review']).order('created_at', { ascending: true }),
      adminSupabase.rpc('admin_list_promoters'),
      adminSupabase.rpc('admin_list_referrals'),
    ]).then(([appResult, promoterResult, referralResult]) => {
      if (appResult.error || promoterResult.error || referralResult.error) setError('Could not load promoter data. Apply the latest Supabase migrations, then refresh.')
      setApplications(appResult.data ?? [])
      setPromoterList((promoterResult.data ?? []) as typeof promoterList)
      setReferralList((referralResult.data ?? []) as typeof referralList)
      setLoading(false)
    })
  }, [])
  useEffect(() => { loadPromoters() }, [loadPromoters])

  async function reviewApplication(id: string, decision: 'approved' | 'rejected') {
    if (!adminSupabase) return
    if (decision === 'rejected' && !window.confirm('Reject this promoter application?')) return
    setBusyId(id)
    const { error: result } = await adminSupabase.rpc('admin_review_promoter_application', { target_application: id, new_status: decision, note: reviewNote[id] || null })
    if (result) setError(result.message)
    else loadPromoters()
    setBusyId('')
  }
  async function setPromoterStatus(id: string, makeActive: boolean) {
    if (!adminSupabase) return
    setBusyId(id)
    const { error: result } = await adminSupabase.rpc('admin_set_promoter_status', { target_promoter: id, new_status: makeActive ? 'active' : 'suspended' })
    if (result) setError(result.message)
    else loadPromoters()
    setBusyId('')
  }

  async function issueAccess(promoter: (typeof promoterList)[number], linkExisting = false): Promise<void> {
    setBusyId(promoter.promoter_id); setError('')
    try {
      const { response, expired, error: failure, timedOut } = await fetchAdminFunction('provision-promoter-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promoterId: promoter.promoter_id, linkExisting }) })
      if (expired) { setError('Your admin session expired. Sign in again.'); return }
      if (!response) { setError(timedOut ? 'The request timed out. Try again.' : (failure ?? 'Could not reach the server.')); return }
      const payload = await response.json().catch(() => null)
      if (response.status === 409 && payload?.error === 'ACCOUNT_EXISTS') {
        if (window.confirm(`${payload.message}\n\nLink the existing account?`)) { setBusyId(''); return await issueAccess(promoter, true) }
        return
      }
      if (!response.ok || !payload?.link) { setError(payload?.message ?? payload?.error ?? 'Could not create the access link.'); return }
      const firstName = promoter.full_name.trim().split(/\s+/)[0]
      const message = `Hello ${firstName}, welcome to the Zerøbyte promoter program!\n\nYour promoter ID: ${payload.promoter.code}\n\nSet your password here (the link works once and expires soon, so open it on your phone now):\n${payload.link}\n\nAfter that, sign in at ${payload.siteUrl}/auth to open your dashboard and get your referral link.`
      setAccess({ name: promoter.full_name, code: payload.promoter.code, whatsapp: payload.promoter.whatsapp ?? promoter.whatsapp, link: payload.link, siteUrl: payload.siteUrl, message })
      loadPromoters()
    } finally {
      setBusyId('')
    }
  }
  async function copyText(kind: string, text: string) {
    try { await navigator.clipboard.writeText(text) } catch { return }
    setCopied(kind); window.setTimeout(() => setCopied(''), 2000)
  }
  async function saveReferralStatus(id: string) {
    if (!adminSupabase || !referralDraft[id]) return
    setBusyId(id)
    const { error: result } = await adminSupabase.rpc('admin_set_referral_status', { target_referral: id, new_status: referralDraft[id] })
    if (result) setError(result.message.replace(/^[A-Z_]+: /, ''))
    else { setReferralDraft((current) => { const next = { ...current }; delete next[id]; return next }); loadPromoters() }
    setBusyId('')
  }

  return <>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Applications awaiting review</h2><p>Approving creates the promoter ID. Then use <strong>Send access on WhatsApp</strong> in the Promoters list below: it makes a one-time password-setup link you send to their WhatsApp. No password is ever created or shared.</p></div><button type="button" className="text-btn" onClick={loadPromoters}><RefreshCw size={14} /> Refresh</button></div>{error && <div className="form-error" role="alert">{error}</div>}{loading ? <div className="admin-table-skeleton">{[1, 2].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !applications.length ? <div className="admin-empty">No pending applications.</div> : <div className="promoter-application-list">{applications.map((application) => <div key={application.id} className="promoter-application-card"><div><strong>{application.full_name}</strong><small className="table-sub">{application.email}{application.phone ? ` · ${application.phone}` : ''}{application.location ? ` · ${application.location}` : ''}</small><p className="muted">{application.reason}</p>{toWhatsAppNumber(application.phone) && <a className="text-btn" href={whatsappUrl(`Hello ${application.full_name}, this is the Zerøbyte team about your promoter application.`, application.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> Message on WhatsApp</a>}</div><div className="promoter-application-actions"><input placeholder="Optional review note" value={reviewNote[application.id] ?? ''} onChange={(event) => setReviewNote((current) => ({ ...current, [application.id]: event.target.value }))} /><button type="button" className="secondary" disabled={busyId === application.id} onClick={() => void reviewApplication(application.id, 'approved')}>Approve</button><button type="button" className="text-btn danger-text" disabled={busyId === application.id} onClick={() => void reviewApplication(application.id, 'rejected')}>Reject</button></div></div>)}</div>}</section>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Promoters</h2><p>{promoterList.length} approved promoter{promoterList.length === 1 ? '' : 's'}.</p></div></div>{!promoterList.length ? <div className="admin-empty">No approved promoters yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>WhatsApp</th><th>Referral code</th><th>Referrals</th><th>Status</th><th>Approved</th><th /></tr></thead><tbody>{promoterList.map((promoter) => <tr key={promoter.promoter_id}><td>{promoter.full_name}</td><td>{promoter.email}</td><td>{promoter.whatsapp ?? '—'}</td><td className="mono">{promoter.referral_code}</td><td>{promoter.total_referrals}</td><td><span className={`admin-status ${promoter.status === 'active' ? 'active' : ''}`}>{promoter.status}</span></td><td>{formatAdminValue('created_at', promoter.created_at)}</td><td>{promoter.status === 'active' && <button type="button" className="secondary" disabled={busyId === promoter.promoter_id} onClick={() => void issueAccess(promoter)}>{promoter.has_account ? 'Resend access' : 'Send access on WhatsApp'}</button>}{promoter.status === 'active' ? <button className="text-btn danger-text" disabled={busyId === promoter.promoter_id} onClick={() => void setPromoterStatus(promoter.promoter_id, false)}>Suspend</button> : <button className="text-btn" disabled={busyId === promoter.promoter_id} onClick={() => void setPromoterStatus(promoter.promoter_id, true)}>Reactivate</button>}</td></tr>)}</tbody></table></div>}</section>
    {access && <section className="admin-card wide promoter-access-card" aria-live="polite"><div className="admin-card-header"><div><h2>Send access to {access.name}</h2><p>Promoter ID <strong className="mono">{access.code}</strong>. Send this on WhatsApp. The link logs them in once to choose their own password, so treat it like a password and don't post it anywhere public.</p></div><button type="button" className="text-btn" onClick={() => setAccess(null)} aria-label="Close"><X size={16} /></button></div>
      <textarea readOnly rows={8} value={access.message} onFocus={(event) => event.currentTarget.select()} />
      <div className="promoter-share-row">{toWhatsAppNumber(access.whatsapp) ? <a className="primary promoter-share-button" href={whatsappUrl(access.message, access.whatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Open WhatsApp with this message</a> : <span className="form-error">No valid WhatsApp number on file. Copy the message and send it another way.</span>}<button type="button" className="secondary" onClick={() => void copyText('message', access.message)}><Copy size={14} /> {copied === 'message' ? 'Copied!' : 'Copy message'}</button></div>
      <small className="field-help">Setup links expire (default 1 hour). If it expires, press <strong>Resend access</strong> to make a new one. In Supabase → Authentication → Email you can raise "OTP expiry" to 24 hours.</small></section>}
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Referrals</h2><p>Move each referral forward once you have checked it: Signed up → Qualified → Commission due → Paid. Every change is written to the audit log.</p></div></div>{!referralList.length ? <div className="admin-empty">No referrals yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Promoter</th><th>Business</th><th>Signed up</th><th>Status</th><th /></tr></thead><tbody>{referralList.map((referral) => <tr key={referral.referral_id}><td>{referral.promoter_name}<small className="table-sub mono">{referral.referral_code}</small></td><td>{referral.business_name ?? '—'}</td><td>{formatAdminValue('created_at', referral.signed_up_at)}</td><td><select aria-label={`Status for ${referral.business_name ?? 'referral'}`} value={referralDraft[referral.referral_id] ?? referral.status} onChange={(event) => setReferralDraft((current) => ({ ...current, [referral.referral_id]: event.target.value }))}>{['registered', 'verified', 'active', 'qualified', 'commissionable', 'paid', 'expired'].map((status) => <option key={status} value={status}>{status}</option>)}</select></td><td><button type="button" className="secondary" disabled={busyId === referral.referral_id || !referralDraft[referral.referral_id] || referralDraft[referral.referral_id] === referral.status} onClick={() => void saveReferralStatus(referral.referral_id)}>Save</button></td></tr>)}</tbody></table></div>}</section>
  </>
}
