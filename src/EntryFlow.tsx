import { useState } from 'react'
import { ArrowRight, Check, LockKeyhole, ShieldCheck } from 'lucide-react'
import { appPath } from './lib/routing'

type Mode = 'welcome' | 'auth' | 'onboarding'

type OnboardingStep = {
  title: string
  description: string
}

const proofPoints = ['Inventory clarity', 'Sales in context', 'Organization-first data']

const onboardingSteps: OnboardingStep[] = [
  {
    title: 'Name your workspace',
    description: 'This is where your team will work together.',
  },
  {
    title: 'Choose your focus',
    description: 'We’ll shape your starting view around the work you do most.',
  },
  {
    title: 'You’re ready to go',
    description: 'Your workspace will use real, organization-scoped records.',
  },
]

function BrandHeader() {
  return (
    <div className="entry-brand">
      <span className="brand-mark">ø</span>
      <strong>Zerøbyte</strong>
      <small>Business</small>
    </div>
  )
}

function routeTo(path: string) {
  window.location.href = appPath(path)
}

function WelcomeCard() {
  return (
    <>
      <div className="entry-icon">
        <ShieldCheck size={18} />
      </div>
      <h2>Welcome to Zerøbyte</h2>
      <p>Start with a focused workspace for your daily operations.</p>
      <button className="primary entry-button" onClick={() => routeTo('/auth')}>
        Create a workspace <ArrowRight size={16} />
      </button>
      <button className="entry-link" onClick={() => routeTo('/')}>
        Explore the product
      </button>
    </>
  )
}

function AuthCard() {
  const [email, setEmail] = useState('')

  return (
    <>
      <div className="entry-icon">
        <LockKeyhole size={18} />
      </div>
      <h2>Sign in to your workspace</h2>
      <p>Use your work email to continue. No payment details required.</p>
      <label>
        Email address
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          type="email"
        />
      </label>
      <button
        className="primary entry-button"
        disabled={!email.includes('@')}
        onClick={() => routeTo('/onboarding')}
      >
        Continue <ArrowRight size={16} />
      </button>
      <button className="entry-link" onClick={() => routeTo('/welcome')}>
        Back to welcome
      </button>
    </>
  )
}

function OnboardingCard() {
  const [step, setStep] = useState(0)
  const currentStep = onboardingSteps[step]

  const next = () => setStep((value) => Math.min(value + 1, onboardingSteps.length - 1))

  return (
    <>
      <div className="stepper">
        {onboardingSteps.map((_, index) => (
          <span className={index <= step ? 'done' : ''} key={index}>
            {index + 1}
          </span>
        ))}
      </div>
      <h2>{currentStep.title}</h2>
      <p>{currentStep.description}</p>

      {step === 0 && <input placeholder="e.g. Adebayo Foods" />}

      {step === 1 && (
        <div className="choice-list">
          <button className="choice active">
            Retail & products <Check size={15} />
          </button>
          <button className="choice">Services & projects</button>
        </div>
      )}

      {step < onboardingSteps.length - 1 ? (
        <button className="primary entry-button" onClick={next}>
          Continue <ArrowRight size={16} />
        </button>
      ) : (
        <button className="primary entry-button" onClick={() => routeTo('/')}>
          Open workspace <ArrowRight size={16} />
        </button>
      )}
    </>
  )
}

function EntrySidebar() {
  return (
    <div className="entry-copy">
      <p className="eyebrow">A clearer way to operate</p>
      <h1>
        Run the work.
        <br />
        <em>Keep the signal.</em>
      </h1>
      <p>One calm workspace for the details that keep your business moving.</p>
      <div className="entry-proof">
        {proofPoints.map((point) => (
          <span key={point}>
            <Check size={14} /> {point}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function EntryFlow({ mode }: { mode: Mode }) {
  const content = {
    welcome: <WelcomeCard />,
    auth: <AuthCard />,
    onboarding: <OnboardingCard />,
  }[mode]

  return (
    <div className="entry-shell">
      <BrandHeader />
      <div className="entry-grid">
        <EntrySidebar />
        <div className="entry-card">{content}</div>
      </div>
      <footer>
        Built for independent teams · <span>Privacy by design</span>
      </footer>
    </div>
  )
}
