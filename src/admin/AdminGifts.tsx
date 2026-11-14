import { Check, Gift, Search, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { adminSupabase } from '../lib/supabase'

type Business = {
  id: string
  name: string
  plan: string | null
  status: string | null
  period_end: string | null
  provider: string | null
}
type Discount = {
  id: string
  organization_name: string
  plan_code: string | null
  percent: number
  uses_left: number
  expires_at: string | null
  reason: string
  created_at: string
  revoked_at: string | null
  usable: boolean
}

const PLAN_OPTIONS = [
  { code: 'basic', label: 'Basic' },
  { code: 'pro', label: 'Pro' },
  { code: 'pro_plus', label: 'Pro Plus' },
]
const day = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
const cleanError = (message: string) => message.replace(/^.*?(VALIDATION_ERROR|NOT_FOUND|UNAUTHORIZED):\s*/, '')

/** Super admin only: give a business 30 free days on a paid plan, or a percentage off its next online payment. */
export function AdminGifts() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Business[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [giftPlan, setGiftPlan] = useState('pro')
  const [giftReason, setGiftReason] = useState('')
  const [confirmGift, setConfirmGift] = useState(false)
  const [percent, setPercent] = useState('20')
  const [discountPlan, setDiscountPlan] = useState('')
  const [uses, setUses] = useState('1')
  const [validDays, setValidDays] = useState('30')
  const [discountReason, setDiscountReason] = useState('')

  const loadDiscounts = useCallback(async () => {
    if (!adminSupabase) return
    const { data, error } = await adminSupabase.rpc('admin_list_discounts')
    if (error) setMessage({ tone: 'bad', text: cleanError(error.message) })
    else setDiscounts((data ?? []) as Discount[])
  }, [])

  useEffect(() => {
    void loadDiscounts()
  }, [loadDiscounts])

  // Search as the super admin types (after a short pause).
  useEffect(() => {
    if (!adminSupabase || query.trim().length < 2) {
      setResults([])
      return
    }
    const client = adminSupabase
    const timer = window.setTimeout(() => {
      void Promise.resolve(client.rpc('admin_search_organizations', { p_query: query.trim() })).then(({ data }) =>
        setResults((data ?? []) as Business[]),
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  async function refreshBusiness(id: string) {
    if (!adminSupabase || !business) return
    const { data } = await adminSupabase.rpc('admin_search_organizations', { p_query: business.name })
    const fresh = ((data ?? []) as Business[]).find((item) => item.id === id)
    if (fresh) setBusiness(fresh)
  }

  async function gift() {
    if (!adminSupabase || !business || busy) return
    setBusy(true)
    setMessage(null)
    const { data, error } = await adminSupabase.rpc('admin_gift_plan', {
      p_org: business.id,
      p_plan_code: giftPlan,
      p_reason: giftReason,
    })
    setBusy(false)
    setConfirmGift(false)
    if (error) {
      setMessage({ tone: 'bad', text: cleanError(error.message) })
      return
    }
    setMessage({
      tone: 'good',
      text: `${business.name} now has ${PLAN_OPTIONS.find((p) => p.code === giftPlan)?.label} until ${day(String(data))}.`,
    })
    setGiftReason('')
    await refreshBusiness(business.id)
  }

  async function createDiscount() {
    if (!adminSupabase || !business || busy) return
    setBusy(true)
    setMessage(null)
    const { error } = await adminSupabase.rpc('admin_create_discount', {
      p_org: business.id,
      p_percent: Number(percent),
      p_plan_code: discountPlan || null,
      p_uses: Number(uses),
      p_valid_days: validDays.trim() ? Number(validDays) : null,
      p_reason: discountReason,
    })
    setBusy(false)
    if (error) {
      setMessage({ tone: 'bad', text: cleanError(error.message) })
      return
    }
    setMessage({
      tone: 'good',
      text: `${percent}% off created for ${business.name}. It applies automatically when they next pay online.`,
    })
    setDiscountReason('')
    await loadDiscounts()
  }

  async function revoke(id: string) {
    if (!adminSupabase) return
    const { error } = await adminSupabase.rpc('admin_revoke_discount', { p_discount: id })
    if (error) setMessage({ tone: 'bad', text: cleanError(error.message) })
    else {
      setMessage({ tone: 'good', text: 'Discount revoked.' })
      await loadDiscounts()
    }
  }

  return (
    <>
      <section className="admin-card wide admin-gifts">
        <div className="admin-card-header">
          <div>
            <h2>Gifts and discounts</h2>
            <p>
              Give a business 30 free days on a paid plan, or a percentage off its next online payment. Every action is
              recorded in the audit log.
            </p>
          </div>
        </div>
        <div className="gift-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search for a business"
            placeholder="Search a business by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {results.length > 0 && !business && (
          <ul className="gift-results">
            {results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setBusiness(item)
                    setResults([])
                    setQuery('')
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.plan ?? 'No plan'} · {item.status ?? 'no subscription'}
                    {item.period_end ? ` · until ${day(item.period_end)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message && (
        <div className={`ap-banner ${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.tone === 'good' ? <Check size={16} /> : <TriangleAlert size={16} />}
          <span>{message.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {business && (
        <div className="gift-grid">
          <section className="admin-card gift-card" aria-labelledby="gift-title">
            <header>
              <h3 id="gift-title">
                <Gift size={16} /> Give 30 free days
              </h3>
              <p className="field-help">
                {business.name}: {business.plan ?? 'no plan'} · {business.status ?? 'no subscription'}
                {business.period_end ? ` · until ${day(business.period_end)}` : ''}.{' '}
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    setBusiness(null)
                    setConfirmGift(false)
                  }}
                >
                  Change business
                </button>
              </p>
            </header>
            <label>
              Plan
              <select value={giftPlan} onChange={(event) => setGiftPlan(event.target.value)}>
                {PLAN_OPTIONS.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason (kept in the audit log)
              <input
                value={giftReason}
                onChange={(event) => setGiftReason(event.target.value)}
                placeholder="For example: launch partner"
              />
            </label>
            {confirmGift ? (
              <div className="ap-inline">
                <button type="button" className="primary" disabled={busy} onClick={() => void gift()}>
                  {busy ? 'Giving…' : `Yes, give 30 days of ${PLAN_OPTIONS.find((p) => p.code === giftPlan)?.label}`}
                </button>
                <button type="button" className="secondary" onClick={() => setConfirmGift(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={giftReason.trim().length < 5}
                onClick={() => setConfirmGift(true)}
              >
                Give 30 free days
              </button>
            )}
            <p className="field-help">
              If the business already has time on this plan, the 30 days are added after it. A trial or an ended plan
              starts now.
            </p>
          </section>

          <section className="admin-card gift-card" aria-labelledby="discount-title">
            <header>
              <h3 id="discount-title">Discount on the next payment</h3>
              <p className="field-help">
                Applied automatically at checkout for {business.name}; used up only when a payment succeeds.
              </p>
            </header>
            <div className="gift-row">
              <label>
                Percent off
                <input inputMode="numeric" value={percent} onChange={(event) => setPercent(event.target.value)} />
              </label>
              <label>
                Plan
                <select value={discountPlan} onChange={(event) => setDiscountPlan(event.target.value)}>
                  <option value="">Any paid plan</option>
                  {PLAN_OPTIONS.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="gift-row">
              <label>
                Payments it covers
                <input inputMode="numeric" value={uses} onChange={(event) => setUses(event.target.value)} />
              </label>
              <label>
                Valid for (days)
                <input
                  inputMode="numeric"
                  value={validDays}
                  onChange={(event) => setValidDays(event.target.value)}
                  placeholder="Leave empty for no end"
                />
              </label>
            </div>
            <label>
              Reason (kept in the audit log)
              <input
                value={discountReason}
                onChange={(event) => setDiscountReason(event.target.value)}
                placeholder="For example: loyalty reward"
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={busy || discountReason.trim().length < 5}
              onClick={() => void createDiscount()}
            >
              {busy ? 'Creating…' : 'Create discount'}
            </button>
          </section>
        </div>
      )}

      <section className="admin-card wide">
        <div className="admin-card-header">
          <div>
            <h2>Discounts given</h2>
            <p>The latest 100.</p>
          </div>
        </div>
        {discounts.length ? (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Off</th>
                  <th>Plan</th>
                  <th>Left</th>
                  <th>Ends</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {discounts.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Business">{item.organization_name}</td>
                    <td data-label="Off">{item.percent}%</td>
                    <td data-label="Plan">{item.plan_code ?? 'Any paid plan'}</td>
                    <td data-label="Left">{item.uses_left}</td>
                    <td data-label="Ends">{item.expires_at ? day(item.expires_at) : 'No end'}</td>
                    <td data-label="Reason">{item.reason}</td>
                    <td data-label="Status">
                      <span className={`ap-chip ${item.usable ? 'good' : 'quiet'}`}>
                        {item.revoked_at
                          ? 'Revoked'
                          : item.usable
                            ? 'Can be used'
                            : item.uses_left === 0
                              ? 'Used up'
                              : 'Expired'}
                      </span>
                    </td>
                    <td>
                      {item.usable && (
                        <button type="button" className="text-btn" onClick={() => void revoke(item.id)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">No discounts yet.</div>
        )}
      </section>
    </>
  )
}
