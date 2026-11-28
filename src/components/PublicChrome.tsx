import { ArrowRight } from 'lucide-react'
import { openCookieSettings } from '../lib/consent'
import { appPath } from '../lib/routing'
import { siteConfig } from '../lib/siteConfig'
import { BrandMark } from './BrandMark'
import { BuiltBy } from './BuiltBy'

// The header and footer of every public page (home, guide, support, status, promoters, about, privacy, terms, cookies), so
// all of them look and read the same: one brand lockup, the same links in the same order, the same footer.

export function PublicHeader({
  navigate,
  promotersHref,
}: {
  navigate: (path: string) => void
  /** The home page points this at its own Promoters section. */
  promotersHref?: string
}) {
  return (
    <header className="landing-nav">
      <a
        className="brand"
        href={appPath('/')}
        aria-label="Zerøbyte Business home"
        onClick={(event) => {
          event.preventDefault()
          navigate('/')
        }}
      >
        <BrandMark />
        <span>Zerøbyte</span>
        <small>Business</small>
      </a>
      <nav className="landing-nav-actions" aria-label="Main">
        <a className="landing-nav-link" href={promotersHref ?? appPath('/promoters')}>
          Promoters
        </a>
        <a className="landing-nav-link" href={appPath('/guide')}>
          Guide
        </a>
        <a className="landing-nav-link" href={appPath('/support')}>
          Support
        </a>
        <button className="text-btn" onClick={() => navigate('/auth')}>
          Sign in <ArrowRight size={14} />
        </button>
      </nav>
    </header>
  )
}

export function PublicFooter({ onStart }: { onStart: () => void }) {
  return (
    <footer className="landing-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-logo">
            <BrandMark />
            <strong>{siteConfig.productName}</strong>
          </span>
          <p>Run the work. Keep the signal.</p>
          <button type="button" className="footer-cta" onClick={onStart}>
            Start free trial <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        <nav className="footer-col" aria-label="Product">
          <h3>Product</h3>
          <a href={appPath('/guide')}>User guide</a>
          <a href={appPath('/support')}>Support</a>
          <a href={appPath('/status')}>Status</a>
          <a href={appPath('/promoters')}>Promoters</a>
          <a href={appPath('/about')}>About</a>
        </nav>
        <nav className="footer-col" aria-label="Legal">
          <h3>Legal</h3>
          <a href={appPath('/privacy')}>Privacy</a>
          <a href={appPath('/terms')}>Terms</a>
          <a href={appPath('/cookies')}>Cookies</a>
          <button type="button" onClick={openCookieSettings}>
            Cookie settings
          </button>
        </nav>
      </div>
      <div className="footer-base">
        <small>
          © {new Date().getFullYear()} {siteConfig.companyName}. All rights reserved.
        </small>
        <small>Made for Nigerian businesses.</small>
        <BuiltBy />
      </div>
    </footer>
  )
}
