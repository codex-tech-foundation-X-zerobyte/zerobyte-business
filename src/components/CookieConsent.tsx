import { useEffect, useRef, useState } from 'react'
import { Cookie, X } from 'lucide-react'
import { OPEN_SETTINGS_EVENT, setConsent, useConsent } from '../lib/consent'
import { siteConfig } from '../lib/siteConfig'
import { appPath } from '../lib/routing'

// The cookie banner and the "Cookie settings" dialog. "Reject" and "Accept" are the same size and one click each.
// Nothing optional runs before a choice is made.
export function CookieConsent({ visible }: { visible: boolean }) {
  const consent = useConsent()
  const [open, setOpen] = useState(false)
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const openSettings = () => {
      setAnalytics(consent?.analytics ?? false)
      setOpen(true)
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings)
  }, [consent])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const choose = (value: boolean) => {
    setConsent(value)
    setOpen(false)
  }
  const showBanner = visible && !consent && !open
  const hasGoogle = Boolean(siteConfig.gaMeasurementId)

  return (
    <>
      {showBanner && (
        <div className="cookie-banner" role="region" aria-label="Cookie preferences">
          <Cookie size={20} aria-hidden="true" className="cookie-icon" />
          <p>
            <strong>Your privacy choice.</strong> We always store what the site needs to work (like keeping you signed
            in).{' '}
            {hasGoogle
              ? 'With your permission we also use Google Analytics to understand how people find and use our pages.'
              : 'With your permission we also measure how people use our public pages.'}{' '}
            <a href={appPath('/cookies')}>Cookie policy</a>
          </p>
          <div className="cookie-actions">
            <button type="button" className="secondary" data-no-busy onClick={() => choose(false)}>
              Reject non-essential
            </button>
            <button
              type="button"
              className="text-btn"
              data-no-busy
              onClick={() => {
                setAnalytics(false)
                setOpen(true)
              }}
            >
              Customize
            </button>
            <button type="button" className="primary" data-no-busy onClick={() => choose(true)}>
              Accept all
            </button>
          </div>
        </div>
      )}
      {open && (
        <div className="cookie-backdrop" onClick={() => setOpen(false)}>
          <div
            className="cookie-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-title"
            tabIndex={-1}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-btn cookie-close"
              aria-label="Close"
              data-no-busy
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
            <h2 id="cookie-title">Cookie settings</h2>
            <p className="cookie-lede">
              Choose what we may store on your device. You can change this at any time from the footer.
            </p>
            <div className="cookie-row">
              <div>
                <strong>Strictly necessary</strong>
                <span>
                  Keeps you signed in and remembers your settings. The site cannot work without it, so it is always on.
                </span>
              </div>
              <span className="cookie-always">Always on</span>
            </div>
            <label className="cookie-row">
              <div>
                <strong>Analytics</strong>
                <span>
                  {hasGoogle
                    ? 'Google Analytics cookies and our own anonymous visit count. They show us which pages help people, with no names attached.'
                    : 'Our own anonymous visit count, with no cookies and no names attached.'}
                </span>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(event) => setAnalytics(event.target.checked)}
                aria-label="Allow analytics"
              />
            </label>
            <div className="cookie-actions dialog">
              <button type="button" className="secondary" data-no-busy onClick={() => choose(false)}>
                Reject non-essential
              </button>
              <button type="button" className="secondary" data-no-busy onClick={() => choose(analytics)}>
                Save my choices
              </button>
              <button type="button" className="primary" data-no-busy onClick={() => choose(true)}>
                Accept all
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
