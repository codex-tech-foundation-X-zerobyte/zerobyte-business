import { BrandMark } from '../../components/BrandMark'
import { AlertTriangle, ArrowRight, Check, Copy, LogOut, MessageCircle, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart, DonutChart, ProgressBar } from '../../components/charts'
import { Skeleton } from '../../components/ui'
import { compactKobo, formatKobo } from '../../lib/format'
import { appPath } from '../../lib/routing'
import { siteConfig } from '../../lib/siteConfig'
import { supabase } from '../../lib/supabase'
import { toWhatsAppNumber, whatsappUrl } from '../../lib/whatsapp'

type PromoterSummary = {
  promoter_id: string
  referral_code: string
  status: string
  total_referrals: number
  qualified_referrals: number
  commissionable_referrals: number
}
type PromoterReferral = { business_label: string; status: string; signed_up_at: string; qualified_at: string | null }
type HeldCommission = { commission_id: string; business: string; kind: string; commission_kobo: number; reason: string }
type PayoutRequest = {
  id: string
  amount_kobo: number
  commission_count: number
  status: string
  requested_at: string
  decided_at: string | null
  paid_at: string | null
  payment_reference: string | null
  decision_note: string | null
}
type PayoutOverview = {
  minimum_kobo: number
  eligible_kobo: number
  eligible_count: number
  waiting_kobo: number
  held: HeldCommission[]
  reasons: string[]
  can_request: boolean
  requested_kobo: number
  paid_kobo: number
  history: PayoutRequest[]
}
type LedgerRow = {
  kind: string
  percent: number
  commission_kobo: number
  status: string
  created_at: string
  business: string
}
type Earnings = { pending_kobo: number; requested_kobo: number; paid_kobo: number; recent: LedgerRow[] }

type Tone = 'good' | 'wait' | 'bad' | 'quiet'

const REFERRAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  registered: { label: 'Signed up', tone: 'wait' },
  verified: { label: 'Verified', tone: 'wait' },
  active: { label: 'Active', tone: 'wait' },
  qualified: { label: 'Qualified', tone: 'good' },
  commissionable: { label: 'Commission due', tone: 'good' },
  paid: { label: 'Paid', tone: 'good' },
  expired: { label: 'Expired', tone: 'bad' },
}

const COMMISSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'wait' },
  requested: { label: 'In review', tone: 'wait' },
  paid: { label: 'Paid', tone: 'good' },
  void: { label: 'Voided', tone: 'quiet' },
}

const PAYOUT_STATUS: Record<string, { label: string; tone: Tone }> = {
  review: { label: 'In review', tone: 'wait' },
  approved: { label: 'Approved', tone: 'good' },
  paid: { label: 'Paid', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  canceled: { label: 'Canceled', tone: 'quiet' },
}

// Plain-language reasons a commission is held back from a payout request.
const HELD_REASON: Record<string, string> = {
  self_referral: 'This is a business you belong to, and self-referrals do not earn commission.',
  payment_not_verified: 'The payment has not been confirmed by Paystack yet.',
  customer_not_active: 'This business is not on an active paid plan right now.',
}

const REQUEST_ERRORS: Record<string, string> = {
  below_minimum: 'You have not reached the minimum payout yet.',
  request_already_open: 'You already have a payout request waiting for review.',
  promoter_not_active: 'Your promoter account is not active, so payouts are paused.',
}

const kindLabel = (kind: string) => (kind === 'first' ? 'First payment' : 'Recurring')
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

/** Turns a database error such as "PAYOUT_NOT_ELIGIBLE: below_minimum" into a sentence the promoter can act on. */
function payoutErrorText(message: string) {
  const reason = message.match(/PAYOUT_NOT_ELIGIBLE:\s*(\w+)/)?.[1]
  if (reason) return REQUEST_ERRORS[reason] ?? 'This payout cannot be requested right now.'
  if (message.includes('VALIDATION_ERROR')) return message.replace(/^.*VALIDATION_ERROR:\s*/, '')
  return 'The request did not go through. Check your connection and try again.'
}

function Chip({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`pd-chip ${tone}`}>{children}</span>
}

/** Commission earned per calendar month for the last six months, from the ledger rows the server returned. */
function monthlyEarnings(rows: LedgerRow[]) {
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString('en-NG', { month: 'short' }),
      value: 0,
    }
  })
  for (const row of rows) {
    if (row.status === 'void') continue
    const date = new Date(row.created_at)
    const slot = months.find((month) => month.key === `${date.getFullYear()}-${date.getMonth()}`)
    if (slot) slot.value += row.commission_kobo
  }
  return months.map(({ label, value }) => ({ label, value, color: 'var(--chart-1)' }))
}

function PromoterSkeleton() {
  return (
    <div className="pd-skeleton" aria-busy="true" aria-label="Loading your dashboard">
      <Skeleton className="pd-sk-title" />
      <Skeleton className="pd-sk-card" />
      <div className="pd-kpis">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="pd-sk-kpi" />
        ))}
      </div>
      <div className="pd-grid">
        <Skeleton className="pd-sk-tall" />
        <Skeleton className="pd-sk-tall" />
      </div>
    </div>
  )
}

export function PromoterDashboard({ navigate }: { navigate: (path: string) => void }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [summary, setSummary] = useState<PromoterSummary | null>(null)
  const [referrals, setReferrals] = useState<PromoterReferral[]>([])
  const [payout, setPayout] = useState<PayoutOverview | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [moneyFailed, setMoneyFailed] = useState(false)
  const [copied, setCopied] = useState<'link' | 'message' | null>(null)
  const [confirming, setConfirming] = useState<'request' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!supabase) {
      setPhase('ready')
      return
    }
    if (!quiet) setPhase('loading')
    const client = supabase
    const [summaryResult, referralResult, payoutResult, earningsResult] = await Promise.all([
      client.rpc('get_promoter_summary'),
      client.rpc('get_promoter_referrals'),
      client.rpc('get_promoter_payout_overview'),
      client.rpc('get_promoter_earnings'),
    ])
    if (summaryResult.error || referralResult.error) {
      setPhase('error')
      return
    }
    const mine = ((summaryResult.data ?? []) as PromoterSummary[])[0] ?? null
    setSummary(mine)
    setReferrals((referralResult.data ?? []) as PromoterReferral[])
    // Payout figures are only meaningful for a real promoter; for anyone else the functions refuse, which is expected.
    setMoneyFailed(Boolean(mine) && Boolean(payoutResult.error || earningsResult.error))
    setPayout(payoutResult.error ? null : (payoutResult.data as PayoutOverview))
    setEarnings(earningsResult.error ? null : (earningsResult.data as Earnings))
    setPhase('ready')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const referralLink = summary ? `${window.location.origin}${appPath('/')}?ref=${summary.referral_code}` : ''
  const shareMessage = `I run my business on Zerøbyte: stock, sales, customers and receipts in one place. Try it free with my link: ${referralLink}`
  const supportWhatsApp = siteConfig.supportWhatsApp

  async function copy(kind: 'link' | 'message') {
    try {
      await navigator.clipboard.writeText(kind === 'link' ? referralLink : shareMessage)
    } catch {
      return
    }
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 2000)
  }

  async function signOut() {
    await supabase?.auth.signOut()
    navigate('/')
  }

  const openRequest = payout?.history.find((row) => row.status === 'review' || row.status === 'approved') ?? null

  async function requestPayout() {
    if (!supabase || busy) return
    setBusy(true)
    setNotice(null)
    const { error } = await supabase.rpc('request_promoter_payout')
    setBusy(false)
    setConfirming(null)
    if (error) {
      setNotice({ tone: 'bad', text: payoutErrorText(error.message) })
    } else {
      setNotice({
        tone: 'good',
        text: 'Payout requested. The team re-checks every referred business, then pays you. You can follow it under Payout history.',
      })
    }
    await load(true)
  }

  async function cancelRequest() {
    if (!supabase || busy || !openRequest) return
    setBusy(true)
    setNotice(null)
    const { error } = await supabase.rpc('cancel_promoter_payout', { p_request: openRequest.id })
    setBusy(false)
    setConfirming(null)
    setNotice(
      error
        ? { tone: 'bad', text: payoutErrorText(error.message) }
        : { tone: 'good', text: 'Request canceled. Those commissions are back in your available balance.' },
    )
    await load(true)
  }

  const months = useMemo(() => monthlyEarnings(earnings?.recent ?? []), [earnings])
  const count = (...statuses: string[]) => referrals.filter((row) => statuses.includes(row.status)).length

  return (
    <div className="legal-shell promoter-shell">
      <header className="pd-nav">
        <div className="pd-brand">
          <BrandMark />
          <strong>Zerøbyte</strong>
          <small>Promoters</small>
        </div>
        <button className="pd-link" onClick={() => void signOut()}>
          <LogOut size={14} /> Sign out
        </button>
      </header>
      <main className="pd">
        {phase === 'loading' && <PromoterSkeleton />}

        {phase === 'error' && (
          <section className="pd-card pd-empty" role="alert">
            <AlertTriangle size={22} />
            <h1>We could not load your dashboard.</h1>
            <p>Check your connection and try again. Your commissions are safe.</p>
            <button className="pd-btn primary" onClick={() => void load()}>
              <RefreshCw size={15} /> Try again
            </button>
          </section>
        )}

        {phase === 'ready' && !summary && (
          <section className="pd-card pd-empty">
            <h1>No promoter account found.</h1>
            <p>
              This account is not linked to a promoter profile. After your application is approved, the Zerøbyte team
              sends your promoter ID and a password-setup link on WhatsApp. Open that link on this device, then sign in
              here.
            </p>
            <button className="pd-btn primary" onClick={() => navigate('/promoters')}>
              Apply to become a promoter <ArrowRight size={15} />
            </button>
          </section>
        )}

        {phase === 'ready' && summary && (
          <>
            <div className="pd-head">
              <div>
                <h1>Promoter dashboard</h1>
                <p>Share your link, watch referrals turn into commission, and request your payout.</p>
              </div>
              <Chip tone={summary.status === 'active' ? 'good' : 'bad'}>
                {summary.status === 'active' ? 'Active promoter' : 'Suspended'}
              </Chip>
            </div>

            {summary.status === 'suspended' && (
              <div className="pd-banner bad" role="alert">
                Your promoter account is suspended, so new signups will not be credited to you and payouts are paused.
                Contact support if you believe this is a mistake.
              </div>
            )}

            {notice && (
              <div className={`pd-banner ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
                {notice.tone === 'good' ? <Check size={16} /> : <AlertTriangle size={16} />}
                <span>{notice.text}</span>
                <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                  <X size={14} />
                </button>
              </div>
            )}

            <section className="pd-card pd-referral">
              <div>
                <span className="pd-label">Your promoter ID</span>
                <strong className="pd-code">{summary.referral_code}</strong>
              </div>
              <div className="pd-link-row">
                <input
                  readOnly
                  aria-label="Your referral link"
                  value={referralLink}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" className="pd-btn" onClick={() => void copy('link')}>
                  <Copy size={14} /> {copied === 'link' ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <div className="pd-actions">
                <a
                  className="pd-btn primary"
                  href={whatsappUrl(shareMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={15} /> Share on WhatsApp
                </a>
                <button type="button" className="pd-btn" onClick={() => void copy('message')}>
                  {copied === 'message' ? 'Message copied' : 'Copy ready-made message'}
                </button>
              </div>
            </section>

            <div className="pd-kpis">
              <div className="pd-kpi">
                <span>Available to request</span>
                <strong>{payout ? formatKobo(payout.eligible_kobo) : '—'}</strong>
                <small>Verified commission you can cash out</small>
              </div>
              <div className="pd-kpi">
                <span>In review</span>
                <strong>{earnings ? formatKobo(earnings.requested_kobo) : '—'}</strong>
                <small>Waiting for the team to pay</small>
              </div>
              <div className="pd-kpi">
                <span>Paid to you</span>
                <strong>{earnings ? formatKobo(earnings.paid_kobo) : '—'}</strong>
                <small>Settled commission</small>
              </div>
              <div className="pd-kpi">
                <span>Businesses referred</span>
                <strong>{referrals.length || summary.total_referrals}</strong>
                <small>
                  {referrals.length ? count('qualified', 'commissionable', 'paid') : summary.qualified_referrals}{' '}
                  qualified
                </small>
              </div>
            </div>

            {moneyFailed && (
              <div className="pd-banner bad" role="alert">
                <AlertTriangle size={16} />
                <span>Your payout figures could not be loaded.</span>
                <button className="pd-link" onClick={() => void load(true)}>
                  Retry
                </button>
              </div>
            )}

            {payout && earnings && (
              <div className="pd-grid">
                <section className="pd-card" aria-labelledby="pd-payout-title">
                  <h2 id="pd-payout-title">Request a payout</h2>
                  <p className="pd-amount">{formatKobo(payout.eligible_kobo)}</p>
                  <ProgressBar
                    value={payout.eligible_kobo}
                    max={payout.minimum_kobo}
                    label="Progress to the minimum payout"
                  />
                  <p className="pd-hint">
                    {payout.eligible_kobo >= payout.minimum_kobo
                      ? `You have passed the ${formatKobo(payout.minimum_kobo)} minimum.`
                      : `${formatKobo(payout.minimum_kobo - payout.eligible_kobo)} more to reach the ${formatKobo(payout.minimum_kobo)} minimum.`}
                  </p>

                  <ul className="pd-checks">
                    <li className={payout.eligible_kobo >= payout.minimum_kobo ? 'ok' : 'no'}>
                      <i aria-hidden="true">{payout.eligible_kobo >= payout.minimum_kobo ? '✓' : '○'}</i>
                      Minimum payout of {formatKobo(payout.minimum_kobo)} reached
                    </li>
                    <li className={payout.reasons.includes('promoter_not_active') ? 'no' : 'ok'}>
                      <i aria-hidden="true">{payout.reasons.includes('promoter_not_active') ? '○' : '✓'}</i>
                      Promoter account is active
                    </li>
                    <li className={payout.reasons.includes('request_already_open') ? 'no' : 'ok'}>
                      <i aria-hidden="true">{payout.reasons.includes('request_already_open') ? '○' : '✓'}</i>
                      No other payout is waiting for review
                    </li>
                    <li className={payout.held.length ? 'no' : 'ok'}>
                      <i aria-hidden="true">{payout.held.length ? '○' : '✓'}</i>
                      {payout.held.length
                        ? `${payout.held.length} commission${payout.held.length === 1 ? ' is' : 's are'} on hold (${formatKobo(payout.waiting_kobo)})`
                        : 'Every referred business is paying and active'}
                    </li>
                  </ul>

                  {payout.held.length > 0 && (
                    <div className="pd-held">
                      <h3>Held back for now</h3>
                      <ul>
                        {payout.held.map((item) => (
                          <li key={item.commission_id}>
                            <div>
                              <strong>{item.business}</strong>
                              <span>{formatKobo(item.commission_kobo)}</span>
                            </div>
                            <p>{HELD_REASON[item.reason] ?? 'This commission is being checked.'}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {openRequest ? (
                    <div className="pd-open">
                      <div>
                        <strong>{formatKobo(openRequest.amount_kobo)} requested</strong>
                        <span>
                          {PAYOUT_STATUS[openRequest.status]?.label ?? openRequest.status} since{' '}
                          {shortDate(openRequest.requested_at)}
                        </span>
                      </div>
                      {openRequest.status === 'review' &&
                        (confirming === 'cancel' ? (
                          <div className="pd-actions">
                            <button className="pd-btn danger" disabled={busy} onClick={() => void cancelRequest()}>
                              {busy ? 'Canceling…' : 'Yes, cancel request'}
                            </button>
                            <button className="pd-btn" disabled={busy} onClick={() => setConfirming(null)}>
                              Keep it
                            </button>
                          </div>
                        ) : (
                          <button className="pd-btn" onClick={() => setConfirming('cancel')}>
                            Cancel request
                          </button>
                        ))}
                    </div>
                  ) : confirming === 'request' ? (
                    <div className="pd-confirm" role="group" aria-label="Confirm payout request">
                      <p>
                        Request <strong>{formatKobo(payout.eligible_kobo)}</strong> from {payout.eligible_count}{' '}
                        commission{payout.eligible_count === 1 ? '' : 's'}? The team checks each referred business again
                        before paying you.
                      </p>
                      <div className="pd-actions">
                        <button className="pd-btn primary" disabled={busy} onClick={() => void requestPayout()}>
                          {busy ? 'Requesting…' : 'Confirm request'}
                        </button>
                        <button className="pd-btn" disabled={busy} onClick={() => setConfirming(null)}>
                          Not now
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        className="pd-btn primary wide"
                        disabled={!payout.can_request || busy}
                        onClick={() => {
                          setNotice(null)
                          setConfirming('request')
                        }}
                      >
                        Request payout
                      </button>
                      {!payout.can_request && payout.reasons.length > 0 && (
                        <p className="pd-hint">{REQUEST_ERRORS[payout.reasons[0]] ?? 'Payout is not available yet.'}</p>
                      )}
                    </>
                  )}
                </section>

                <section className="pd-card" aria-labelledby="pd-split-title">
                  <h2 id="pd-split-title">Where your commission stands</h2>
                  <DonutChart
                    slices={[
                      { label: 'Pending', value: earnings.pending_kobo },
                      { label: 'In review', value: earnings.requested_kobo },
                      { label: 'Paid', value: earnings.paid_kobo },
                    ]}
                    centerValue={compactKobo(earnings.pending_kobo + earnings.requested_kobo + earnings.paid_kobo)}
                    centerLabel="earned"
                    format={(value) => formatKobo(value)}
                  />
                  <h3 className="pd-sub">Earned by month</h3>
                  <BarChart
                    data={months}
                    height={150}
                    format={(value) => compactKobo(value)}
                    emptyText="Commission appears here after a referred business pays."
                  />
                  {earnings.recent.length >= 30 && <p className="pd-hint">Based on your latest 30 commissions.</p>}
                </section>
              </div>
            )}

            {payout && (
              <section className="pd-card" aria-labelledby="pd-history-title">
                <h2 id="pd-history-title">Payout history</h2>
                {payout.history.length ? (
                  <ul className="pd-history">
                    {payout.history.map((row) => {
                      const info = PAYOUT_STATUS[row.status] ?? { label: row.status, tone: 'quiet' as Tone }
                      return (
                        <li key={row.id}>
                          <div>
                            <strong>{formatKobo(row.amount_kobo)}</strong>
                            <span>
                              {row.commission_count} commission{row.commission_count === 1 ? '' : 's'} ·{' '}
                              {shortDate(row.requested_at)}
                            </span>
                            {row.payment_reference && <span>Reference {row.payment_reference}</span>}
                            {row.decision_note && <p className="pd-note">Reason given: {row.decision_note}</p>}
                          </div>
                          <Chip tone={info.tone}>{info.label}</Chip>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="pd-hint">No payout requests yet. Your first one will show up here.</p>
                )}
              </section>
            )}

            {earnings && (
              <section className="pd-card" aria-labelledby="pd-ledger-title">
                <h2 id="pd-ledger-title">Commission ledger</h2>
                {earnings.recent.length ? (
                  <div className="pd-table-wrap">
                    <table className="pd-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Business</th>
                          <th>Type</th>
                          <th>Rate</th>
                          <th className="num">Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {earnings.recent.map((row, index) => {
                          const info = COMMISSION_STATUS[row.status] ?? { label: row.status, tone: 'quiet' as Tone }
                          return (
                            <tr key={`${row.created_at}-${row.business}-${index}`}>
                              <td data-label="Date">{shortDate(row.created_at)}</td>
                              <td data-label="Business">{row.business}</td>
                              <td data-label="Type">{kindLabel(row.kind)}</td>
                              <td data-label="Rate">{row.percent}%</td>
                              <td data-label="Amount" className="num">
                                {formatKobo(row.commission_kobo)}
                              </td>
                              <td data-label="Status">
                                <Chip tone={info.tone}>{info.label}</Chip>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="pd-hint">
                    No commission yet. It is added automatically when a business you referred makes a verified payment.
                  </p>
                )}
                {earnings.recent.length >= 30 && <p className="pd-hint">Showing your latest 30 commissions.</p>}
              </section>
            )}

            <section className="pd-card" aria-labelledby="pd-referrals-title">
              <h2 id="pd-referrals-title">Your referrals</h2>
              {referrals.length ? (
                <div className="pd-table-wrap">
                  <table className="pd-table">
                    <thead>
                      <tr>
                        <th>Business</th>
                        <th>Status</th>
                        <th>Signed up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrals.map((row, index) => {
                        const info = REFERRAL_STATUS[row.status] ?? { label: row.status, tone: 'wait' as Tone }
                        return (
                          <tr key={`${row.business_label}-${row.signed_up_at}-${index}`}>
                            <td data-label="Business">{row.business_label}</td>
                            <td data-label="Status">
                              <Chip tone={info.tone}>{info.label}</Chip>
                            </td>
                            <td data-label="Signed up">{shortDate(row.signed_up_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="pd-hint">
                  No referrals yet. Share your link on WhatsApp, in business groups, or with shop owners you know. They
                  show up here as soon as they sign up.
                </p>
              )}
              <p className="pd-hint">
                Business names are partly hidden for privacy. The team confirms each referral is a real, active customer
                before it earns commission.
              </p>
            </section>

            <footer className="pd-foot">
              <p>
                Also run a business?{' '}
                <button
                  type="button"
                  className="pd-link"
                  onClick={() => {
                    window.sessionStorage.setItem('zb-skip-promoter-redirect', '1')
                    navigate('/')
                  }}
                >
                  Set up your own workspace
                </button>
              </p>
              {supportWhatsApp && toWhatsAppNumber(supportWhatsApp) && (
                <a
                  className="pd-btn"
                  href={whatsappUrl(`Hello, I'm promoter ${summary.referral_code} and I need help.`, supportWhatsApp)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={15} /> Chat with the team on WhatsApp
                </a>
              )}
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
