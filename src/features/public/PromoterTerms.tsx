import { useEffect, useState } from 'react'
import { ArrowRight, BadgePercent, CalendarClock, Repeat } from 'lucide-react'
import { formatNaira } from '../../lib/format'
import { supabase } from '../../lib/supabase'

// The promoter commission rules are edited by a Super or Finance admin (Admin > Promoters) and read from the database,
// so the landing page, the promoter pages and the Terms never disagree with what is actually paid.
export type PromoterTerms = { first: number; recurring: number; months: number }

export function usePromoterTerms() {
  const [terms, setTerms] = useState<PromoterTerms | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let active = true
    void Promise.resolve(supabase.rpc('get_public_promoter_terms')).then(({ data }) => {
      if (!active) return
      const row = (data as { first_payment_percent: number; recurring_percent: number; duration_months: number }[] | null)?.[0]
      if (row) setTerms({ first: Number(row.first_payment_percent), recurring: Number(row.recurring_percent), months: Number(row.duration_months) })
      setLoading(false)
    }).catch(() => active && setLoading(false))
    return () => { active = false }
  }, [])
  return { terms, loading }
}

export const percentText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, '')}%`
// 18 -> "1 year 6 months", 24 -> "2 years", 6 -> "6 months"
export function humanMonths(months: number) {
  const years = Math.floor(months / 12); const rest = months % 12
  return [years ? `${years} year${years > 1 ? 's' : ''}` : '', rest ? `${rest} month${rest > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ')
}
export const durationText = (months: number) => months >= 12 ? `${months} months (${humanMonths(months)})` : humanMonths(months)

// A worked example so the numbers are easy to picture. Purely illustrative: the real amounts follow the plan the business pays for.
export function earningsExample(terms: PromoterTerms, monthlyPrice = 10000) {
  const first = monthlyPrice * terms.first / 100; const recurring = monthlyPrice * terms.recurring / 100
  const laterPayments = Math.max(terms.months - 1, 0)
  return { monthlyPrice, first, recurring, laterPayments, total: first + recurring * laterPayments }
}

export function PromoterProgramSection({ onApply, onHaveAccount }: { onApply: () => void; onHaveAccount: () => void }) {
  const { terms, loading } = usePromoterTerms()
  const example = terms ? earningsExample(terms) : null
  return <section className="landing-promoters" id="promoters" aria-labelledby="promoters-title">
    <div className="promoters-copy">
      <span className="section-label">Zerøbyte Promoter Programme</span>
      <h2 id="promoters-title">Earn when the businesses<br />you refer grow with us.</h2>
      <p className="landing-detail">Know shop owners, traders or service businesses that need to manage sales and stock? Share your personal link. When a business you referred pays for a plan, you earn a share of that payment{terms ? ` for ${durationText(terms.months)}` : ''}.</p>
      <div className="hero-actions"><button className="primary hero-button" onClick={onApply}>Become a promoter <ArrowRight size={17} /></button><button className="text-btn" onClick={onHaveAccount}>Already a promoter? Sign in</button></div>
    </div>
    <div className="promoters-terms">
      {terms ? <>
        <div className="promoter-rates">
          <div><BadgePercent size={20} /><strong>{percentText(terms.first)}</strong><span>of the first payment a referred business makes</span></div>
          <div><Repeat size={20} /><strong>{percentText(terms.recurring)}</strong><span>of every monthly payment after that</span></div>
          <div><CalendarClock size={20} /><strong>{humanMonths(terms.months)}</strong><span>{terms.months >= 12 ? `${terms.months} months, ` : ''}counted from the first payment</span></div>
        </div>
        {example && <p className="promoter-example"><strong>Example:</strong> a business on a {formatNaira(example.monthlyPrice)}-a-month plan earns you {formatNaira(example.first)} on its first payment, then {formatNaira(example.recurring)} on each later monthly payment: up to {formatNaira(example.total)} over {terms.months} months from one referral.</p>}
      </> : <p className="promoter-example">{loading ? 'Loading the current commission rates…' : 'Promoters earn a percentage of the plan payments made by the businesses they refer. The current rates are shown when you apply.'}</p>}
      <ul className="promoter-steps">
        <li><span>1</span>Apply in a couple of minutes and our team reviews your application.</li>
        <li><span>2</span>Once approved you get a personal referral link and a dashboard.</li>
        <li><span>3</span>Share it. When a referred business pays for a plan, your commission is recorded automatically.</li>
        <li><span>4</span>Track every referral and commission in your dashboard. We pay out commissions we have confirmed.</li>
      </ul>
      <small className="promoter-fine">Commission is calculated on the plan price paid, not on gateway fees. Rates can change for new referrals; a referral keeps the rates in force when its first payment was made. See the Terms of Service for the full rules.</small>
    </div>
  </section>
}

// Compact version for the promoter application and dashboard pages.
export function PromoterTermsCard() {
  const { terms } = usePromoterTerms()
  if (!terms) return null
  return <div className="promoter-terms-card"><strong>How you earn</strong><span>{percentText(terms.first)} of the first payment each referred business makes, then {percentText(terms.recurring)} of every monthly payment after that, for {durationText(terms.months)} from that first payment.</span></div>
}
