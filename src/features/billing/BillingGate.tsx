import { Lock } from 'lucide-react'
import { type SubscriptionAccess, timeLeftText } from './subscriptionAccess'

/** The amber strip shown while the free trial runs. It turns red-amber in the last two days. */
export function TrialBanner({ access, onChoosePlan }: { access: SubscriptionAccess; onChoosePlan: () => void }) {
  if (access.state !== 'trial') return null
  const urgent = access.secondsLeft != null && access.secondsLeft <= 2 * 86400
  return (
    <div className={`notice-banner${urgent ? ' urgent' : ''}`} role="status">
      <div>
        <strong>Free trial · {timeLeftText(access.secondsLeft)} left</strong>
        <span>{access.canPay ? 'Subscribe to keep adding records' : 'Ask the business owner to subscribe'}</span>
      </div>
      {access.canPay && (
        <button type="button" className="primary" onClick={onChoosePlan}>
          Plan
        </button>
      )}
    </div>
  )
}

/** Shown above every page except Overview while locked: the records stay readable, nothing can be added or changed. */
export function LockedBanner({ access, onChoosePlan }: { access: SubscriptionAccess; onChoosePlan: () => void }) {
  const title = access.reason === 'trial_used' ? 'This business needs a plan' : 'Your plan has ended'
  return (
    <div className="notice-banner urgent" role="status">
      <div>
        <strong>{title}</strong>
        <span>Records are read-only until you renew.</span>
      </div>
      {access.canPay && (
        <button type="button" className="primary" onClick={onChoosePlan}>
          Renew
        </button>
      )}
    </div>
  )
}

type LockedScreenProps = { access: SubscriptionAccess; onChoosePlan: () => void; onViewRecords: () => void }

/** Shown on Overview when the trial or paid period is over. The records are kept and can still be read. */
export function LockedScreen({ access, onChoosePlan, onViewRecords }: LockedScreenProps) {
  const trialEnded = access.reason === 'trial_ended' || access.reason === 'no_subscription'
  const trialUsed = access.reason === 'trial_used'
  const title = trialUsed
    ? 'Choose a plan to start this business'
    : trialEnded
      ? 'Your free trial has ended'
      : 'Your plan has ended'
  const message = trialUsed
    ? 'The free trial is once per person and was already used on your first business. Pick a plan to start using this one.'
    : access.reason === 'suspended'
      ? 'This business has been suspended. Please contact support to get it reopened.'
      : 'Your records are safe and stay readable. Renew to add or edit records again.'
  return (
    <section className="locked-screen" aria-labelledby="locked-title">
      <div className="locked-brand">
        <span className="sh-logo" aria-hidden="true">
          ø
        </span>
        <strong>Zerøbyte</strong>
        <small>Business</small>
      </div>
      <div className="locked-card">
        <div className="locked-icon" aria-hidden="true">
          <Lock size={22} />
        </div>
        <h1 id="locked-title">{title}</h1>
        <p>{message}</p>
        {access.canPay ? (
          <button type="button" className="primary" onClick={onChoosePlan}>
            Renew with Paystack
          </button>
        ) : (
          <p className="locked-staff">
            Only the business owner can pay. Please ask them to open Settings, then Billing.
          </p>
        )}
        <button type="button" className="secondary" onClick={onViewRecords}>
          View records
        </button>
      </div>
    </section>
  )
}
