import { Check, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DonutChart, ProgressBar } from '../components/charts'
import { Skeleton } from '../components/ui'
import { formatKobo } from '../lib/format'
import { adminSupabase } from '../lib/supabase'

type PayoutItem = {
  business: string
  kind: string
  percent: number
  commission_kobo: number
  payment_kobo: number
  earned_at: string
  still_ok: boolean
}
type PayoutRequest = {
  id: string
  status: 'review' | 'approved' | 'paid' | 'rejected' | 'canceled'
  amount_kobo: number
  commission_count: number
  requested_at: string
  decided_at: string | null
  decision_note: string | null
  paid_at: string | null
  payment_reference: string | null
  promoter: { id: string; name: string; email: string; code: string; status: string }
  verification: { minimum_kobo?: number; warnings?: { code: string; business: string }[] }
  items: PayoutItem[]
}
type Settings = { minimum_payout_kobo: number; can_change: boolean }
type Tab = 'action' | 'paid' | 'closed' | 'all'

const STATUS_LABEL: Record<string, string> = {
  review: 'Waiting for review',
  approved: 'Approved, not paid yet',
  paid: 'Paid',
  rejected: 'Rejected',
  canceled: 'Canceled by promoter',
}
const STATUS_TONE: Record<string, string> = {
  review: 'wait',
  approved: 'wait',
  paid: 'good',
  rejected: 'bad',
  canceled: 'quiet',
}
const TABS: { id: Tab; label: string; match: (row: PayoutRequest) => boolean }[] = [
  { id: 'action', label: 'Needs action', match: (row) => row.status === 'review' || row.status === 'approved' },
  { id: 'paid', label: 'Paid', match: (row) => row.status === 'paid' },
  {
    id: 'closed',
    label: 'Rejected or canceled',
    match: (row) => row.status === 'rejected' || row.status === 'canceled',
  },
  { id: 'all', label: 'All', match: () => true },
]

const day = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

/** Strips the database error code so the admin sees only the sentence. */
const cleanError = (message: string) =>
  message.replace(/^.*?(VALIDATION_ERROR|PAYOUT_RECHECK_FAILED|UNAUTHORIZED|NOT_FOUND):\s*/, '')

export function AdminPayouts({ onQueueChange }: { onQueueChange: (count: number) => void }) {
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tab, setTab] = useState<Tab>('action')
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [references, setReferences] = useState<Record<string, string>>({})
  const [minimumDraft, setMinimumDraft] = useState('')

  const load = useCallback(async () => {
    if (!adminSupabase) {
      setPhase('error')
      return
    }
    const [list, config] = await Promise.all([
      adminSupabase.rpc('admin_list_payout_requests', { p_status: null }),
      adminSupabase.rpc('admin_get_payout_settings'),
    ])
    if (list.error) {
      setMessage({ tone: 'bad', text: cleanError(list.error.message) })
      setPhase('error')
      return
    }
    const rows = (list.data ?? []) as PayoutRequest[]
    setRequests(rows)
    onQueueChange(rows.filter((row) => row.status === 'review' || row.status === 'approved').length)
    if (!config.error && config.data) {
      const found = config.data as Settings
      setSettings(found)
      setMinimumDraft(String(found.minimum_payout_kobo / 100))
    }
    setPhase('ready')
  }, [onQueueChange])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(request: PayoutRequest, decision: 'approve' | 'reject' | 'mark_paid') {
    if (!adminSupabase || busyId) return
    setBusyId(request.id)
    setMessage(null)
    const { error } = await adminSupabase.rpc('admin_decide_payout', {
      p_request: request.id,
      p_decision: decision,
      p_note: decision === 'reject' ? (reasons[request.id] ?? '').trim() : null,
      p_reference: decision === 'mark_paid' ? (references[request.id] ?? '').trim() : null,
    })
    setBusyId('')
    if (error) {
      setMessage({ tone: 'bad', text: cleanError(error.message) })
      return
    }
    setMessage({
      tone: 'good',
      text:
        decision === 'approve'
          ? `Approved ${formatKobo(request.amount_kobo)} for ${request.promoter.name}. Pay them by bank transfer, then mark it paid with the reference.`
          : decision === 'reject'
            ? `Rejected. ${request.promoter.name} was given your reason and the commissions are available again.`
            : `Marked as paid (${(references[request.id] ?? '').trim()}).`,
    })
    await load()
  }

  async function saveMinimum() {
    if (!adminSupabase || !settings?.can_change) return
    const naira = Number(minimumDraft.replace(/,/g, ''))
    if (!Number.isFinite(naira) || naira <= 0) {
      setMessage({ tone: 'bad', text: 'Enter the minimum payout in Naira, for example 2000.' })
      return
    }
    setBusyId('minimum')
    const { error } = await adminSupabase.rpc('admin_set_minimum_payout', { p_kobo: Math.round(naira * 100) })
    setBusyId('')
    if (error) setMessage({ tone: 'bad', text: cleanError(error.message) })
    else {
      setMessage({ tone: 'good', text: 'Minimum payout updated. It applies to new payout requests.' })
      await load()
    }
  }

  const totals = useMemo(() => {
    const sum = (status: string) =>
      requests.filter((row) => row.status === status).reduce((total, row) => total + row.amount_kobo, 0)
    return { review: sum('review'), approved: sum('approved'), paid: sum('paid'), rejected: sum('rejected') }
  }, [requests])
  const visible = requests.filter(TABS.find((item) => item.id === tab)!.match)

  if (phase === 'loading')
    return (
      <section className="admin-card wide ap-pad" aria-busy="true">
        <Skeleton style={{ height: 28, width: 240, marginBottom: 16 }} />
        <Skeleton style={{ height: 160, borderRadius: 12 }} />
      </section>
    )

  if (phase === 'error')
    return (
      <section className="admin-card wide ap-pad" role="alert">
        <div className="admin-card-header">
          <div>
            <h2>Payout requests could not be loaded</h2>
            <p>{message?.text ?? 'Check your connection and try again.'}</p>
          </div>
          <button type="button" className="text-btn" onClick={() => void load()}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      </section>
    )

  return (
    <>
      <section className="admin-card wide ap-summary">
        <div className="ap-summary-main">
          <div className="admin-card-header">
            <div>
              <h2>Promoter payouts</h2>
              <p>
                Each request was checked by the system when it was made and is checked again when you mark it paid. You
                pay by bank transfer yourself, then record the reference here.
              </p>
            </div>
            <button type="button" className="text-btn" onClick={() => void load()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="ap-kpis">
            <div>
              <span>Waiting for review</span>
              <strong>{formatKobo(totals.review)}</strong>
            </div>
            <div>
              <span>Approved, to pay</span>
              <strong>{formatKobo(totals.approved)}</strong>
            </div>
            <div>
              <span>Paid so far</span>
              <strong>{formatKobo(totals.paid)}</strong>
            </div>
          </div>
        </div>
        <div className="ap-donut">
          <DonutChart
            size={132}
            thickness={14}
            slices={[
              { label: 'Review', value: totals.review },
              { label: 'Approved', value: totals.approved },
              { label: 'Paid', value: totals.paid },
              { label: 'Rejected', value: totals.rejected },
            ]}
            centerValue={String(requests.length)}
            centerLabel="requests"
            format={(value) => formatKobo(value)}
          />
        </div>
      </section>

      {settings && (
        <section className="admin-card wide ap-pad">
          <div className="ap-minimum">
            <div>
              <h3>Minimum payout</h3>
              <p className="field-help">
                A promoter can request a payout only when verified commission reaches this amount.
                {!settings.can_change && ' Only the super admin can change it.'}
              </p>
            </div>
            {settings.can_change ? (
              <div className="ap-inline">
                <span aria-hidden="true">₦</span>
                <input
                  inputMode="decimal"
                  aria-label="Minimum payout in Naira"
                  value={minimumDraft}
                  onChange={(event) => setMinimumDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={busyId === 'minimum'}
                  onClick={() => void saveMinimum()}
                >
                  {busyId === 'minimum' ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <strong>{formatKobo(settings.minimum_payout_kobo)}</strong>
            )}
          </div>
        </section>
      )}

      {message && (
        <div className={`ap-banner ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.tone === 'good' ? <Check size={16} /> : <TriangleAlert size={16} />}
          <span>{message.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="ap-tabs" role="tablist" aria-label="Payout requests">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <b>{requests.filter(item.match).length}</b>
          </button>
        ))}
      </div>

      {!visible.length && (
        <section className="admin-card wide">
          <div className="admin-empty">
            {tab === 'action' ? 'Nothing is waiting. New payout requests appear here.' : 'No requests in this list.'}
          </div>
        </section>
      )}

      {visible.map((request) => {
        const failing = request.items.filter((item) => !item.still_ok)
        const reason = reasons[request.id] ?? ''
        const reference = references[request.id] ?? ''
        const open = request.status === 'review' || request.status === 'approved'
        const busy = busyId === request.id
        return (
          <section
            className="admin-card wide ap-request"
            key={request.id}
            aria-label={`Payout request from ${request.promoter.name}`}
          >
            <header className="ap-request-head">
              <div>
                <h3>
                  {request.promoter.name} <span className="mono">{request.promoter.code}</span>
                </h3>
                <p className="field-help">
                  {request.promoter.email} · requested {day(request.requested_at)} · {request.commission_count}{' '}
                  commission{request.commission_count === 1 ? '' : 's'}
                  {request.promoter.status !== 'active' && ' · promoter is suspended'}
                </p>
              </div>
              <div className="ap-amount">
                <strong>{formatKobo(request.amount_kobo)}</strong>
                <span className={`ap-chip ${STATUS_TONE[request.status]}`}>{STATUS_LABEL[request.status]}</span>
              </div>
            </header>

            {request.verification.minimum_kobo ? (
              <div className="ap-verify">
                <span>Minimum when requested: {formatKobo(request.verification.minimum_kobo)}</span>
                <ProgressBar
                  value={request.amount_kobo}
                  max={request.verification.minimum_kobo}
                  label="Requested amount against the minimum"
                />
              </div>
            ) : null}

            {open && failing.length > 0 && (
              <div className="ap-banner bad" role="alert">
                <TriangleAlert size={16} />
                <span>
                  {failing.length === 1
                    ? 'One commission no longer passes'
                    : `${failing.length} commissions no longer pass`}{' '}
                  the checks ({failing.map((item) => item.business).join(', ')}). Payment will be refused; reject this
                  request so the promoter can request again.
                </span>
              </div>
            )}

            <div className="table-wrap">
              <table className="admin-table ap-table">
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Type</th>
                    <th>Customer paid</th>
                    <th>Rate</th>
                    <th>Commission</th>
                    <th>Earned</th>
                    <th>Check now</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map((item, index) => (
                    <tr key={`${item.business}-${item.earned_at}-${index}`}>
                      <td data-label="Business">{item.business}</td>
                      <td data-label="Type">{item.kind === 'first' ? 'First payment' : 'Recurring'}</td>
                      <td data-label="Customer paid">{formatKobo(item.payment_kobo)}</td>
                      <td data-label="Rate">{item.percent}%</td>
                      <td data-label="Commission">{formatKobo(item.commission_kobo)}</td>
                      <td data-label="Earned">{day(item.earned_at)}</td>
                      <td data-label="Check now">
                        <span className={`ap-chip ${item.still_ok ? 'good' : 'bad'}`}>
                          {item.still_ok ? 'Passes' : 'Fails'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {request.status === 'paid' && (
              <p className="ap-note">
                Paid {request.paid_at ? day(request.paid_at) : ''} · reference {request.payment_reference}
              </p>
            )}
            {request.status === 'rejected' && request.decision_note && (
              <p className="ap-note bad">Reason given to the promoter: {request.decision_note}</p>
            )}

            {open && (
              <footer className="ap-actions">
                {request.status === 'review' ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || failing.length > 0}
                    onClick={() => void decide(request, 'approve')}
                  >
                    {busy ? 'Working…' : 'Approve'}
                  </button>
                ) : (
                  <div className="ap-inline">
                    <input
                      aria-label="Bank transfer reference"
                      placeholder="Bank transfer reference"
                      value={reference}
                      onChange={(event) => setReferences({ ...references, [request.id]: event.target.value })}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || reference.trim().length < 4 || failing.length > 0}
                      onClick={() => void decide(request, 'mark_paid')}
                    >
                      {busy ? 'Working…' : 'Mark as paid'}
                    </button>
                  </div>
                )}
                <div className="ap-inline">
                  <input
                    aria-label="Reason for rejecting"
                    placeholder="Reason for rejecting (the promoter sees it)"
                    value={reason}
                    onChange={(event) => setReasons({ ...reasons, [request.id]: event.target.value })}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() => void decide(request, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </footer>
            )}
          </section>
        )
      })}
    </>
  )
}
