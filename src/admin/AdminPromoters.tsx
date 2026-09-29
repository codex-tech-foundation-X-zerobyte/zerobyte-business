import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'
import { formatAdminValue } from './format'

export function AdminPromoters() {
  const [applications, setApplications] = useState<{ id: string; full_name: string; email: string; phone: string | null; location: string | null; reason: string; status: string; created_at: string }[]>([])
  const [promoterList, setPromoterList] = useState<{ promoter_id: string; full_name: string; email: string; referral_code: string; status: string; created_at: string; total_referrals: number }[]>([])
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
    ]).then(([appResult, promoterResult]) => {
      if (appResult.error || promoterResult.error) setError('Could not load promoter data. Apply the latest Supabase migrations, then refresh.')
      setApplications(appResult.data ?? [])
      setPromoterList((promoterResult.data ?? []) as typeof promoterList)
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

  return <>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Applications awaiting review</h2><p>Approving generates a referral code; the applicant claims it by signing in with the same email.</p></div><button type="button" className="text-btn" onClick={loadPromoters}><RefreshCw size={14} /> Refresh</button></div>{error && <div className="form-error" role="alert">{error}</div>}{loading ? <div className="admin-table-skeleton">{[1, 2].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : !applications.length ? <div className="admin-empty">No pending applications.</div> : <div className="promoter-application-list">{applications.map((application) => <div key={application.id} className="promoter-application-card"><div><strong>{application.full_name}</strong><small className="table-sub">{application.email}{application.phone ? ` · ${application.phone}` : ''}{application.location ? ` · ${application.location}` : ''}</small><p className="muted">{application.reason}</p></div><div className="promoter-application-actions"><input placeholder="Optional review note" value={reviewNote[application.id] ?? ''} onChange={(event) => setReviewNote((current) => ({ ...current, [application.id]: event.target.value }))} /><button type="button" className="secondary" disabled={busyId === application.id} onClick={() => void reviewApplication(application.id, 'approved')}>Approve</button><button type="button" className="text-btn danger-text" disabled={busyId === application.id} onClick={() => void reviewApplication(application.id, 'rejected')}>Reject</button></div></div>)}</div>}</section>
    <section className="admin-card wide"><div className="admin-card-header"><div><h2>Promoters</h2><p>{promoterList.length} approved promoter{promoterList.length === 1 ? '' : 's'}.</p></div></div>{!promoterList.length ? <div className="admin-empty">No approved promoters yet.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Referral code</th><th>Referrals</th><th>Status</th><th>Approved</th><th /></tr></thead><tbody>{promoterList.map((promoter) => <tr key={promoter.promoter_id}><td>{promoter.full_name}</td><td>{promoter.email}</td><td className="mono">{promoter.referral_code}</td><td>{promoter.total_referrals}</td><td><span className={`admin-status ${promoter.status === 'active' ? 'active' : ''}`}>{promoter.status}</span></td><td>{formatAdminValue('created_at', promoter.created_at)}</td><td>{promoter.status === 'active' ? <button className="text-btn danger-text" disabled={busyId === promoter.promoter_id} onClick={() => void setPromoterStatus(promoter.promoter_id, false)}>Suspend</button> : <button className="text-btn" disabled={busyId === promoter.promoter_id} onClick={() => void setPromoterStatus(promoter.promoter_id, true)}>Reactivate</button>}</td></tr>)}</tbody></table></div>}</section>
  </>
}
