import { useState } from 'react'
import { BookOpen, PlayCircle, Printer } from 'lucide-react'
import { START_TOUR_EVENT } from '../onboarding/startTour'
import { GUIDE_SECTIONS } from './guideContent'
import { printGuide } from './printGuide'

export function UserGuide({
  embedded = false,
  canReplayTour = false,
}: {
  embedded?: boolean
  canReplayTour?: boolean
}) {
  const [active, setActive] = useState(GUIDE_SECTIONS[0].id)
  return (
    <div className={`user-guide${embedded ? ' embedded' : ''}`}>
      <header className="guide-header">
        <div>
          <span className="section-label">
            <BookOpen size={14} /> User guide
          </span>
          <h1>How to use Zerøbyte Business</h1>
          <p>Step-by-step help with screenshots. Jump to a topic on the left, or read it top to bottom.</p>
        </div>
        <div className="guide-header-actions">
          {canReplayTour && (
            <button
              type="button"
              className="secondary"
              onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}
            >
              <PlayCircle size={16} /> Take the product tour
            </button>
          )}
          <button type="button" className="secondary guide-print" onClick={printGuide}>
            <Printer size={16} /> Download as PDF
          </button>
        </div>
      </header>
      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Guide topics">
          {GUIDE_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#guide-${section.id}`}
              className={active === section.id ? 'active' : ''}
              onClick={() => setActive(section.id)}
            >
              {section.title}
            </a>
          ))}
        </nav>
        <div className="guide-body">
          {GUIDE_SECTIONS.map((section) => (
            <section key={section.id} id={`guide-${section.id}`} className="guide-section">
              <h2>{section.title}</h2>
              <p className="guide-summary">{section.summary}</p>
              {section.image && (
                <figure>
                  <img src={section.image} alt={section.alt ?? section.title} loading="lazy" />
                  <figcaption>{section.alt}</figcaption>
                </figure>
              )}
              <ol>
                {section.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
              {section.tip && (
                <p className="guide-tip">
                  <strong>Tip:</strong> {section.tip}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

// Public page at /guide, readable without signing in (and shareable with new staff).
export function GuidePage({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div className="legal-shell guide-page">
      <header className="legal-nav">
        <button type="button" className="brand-link" onClick={() => navigate('/')}>
          <span className="brand-mark">ø</span> <strong>Zerøbyte</strong>
        </button>
        <button type="button" className="secondary" onClick={() => navigate('/auth')}>
          Sign in
        </button>
      </header>
      <main className="legal-main guide-main">
        <UserGuide />
      </main>
    </div>
  )
}
