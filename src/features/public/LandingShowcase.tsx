import { BarChart3, Package, Receipt, ShoppingCart, LayoutDashboard } from 'lucide-react'
import { useState } from 'react'
import { appPath } from '../../lib/routing'

// Real screenshots of the app (sample business, sample figures). Desktop is 1280x800, phone is 780x1688 (390x844 at 2x).
const screens = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    text: 'Today’s numbers at a glance: sales, profit and what is running low.',
  },
  { id: 'sales', label: 'Sales', icon: ShoppingCart, text: 'Record a sale in a few taps, from any phone or computer.' },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Package,
    text: 'Know what you have, what is low and what needs restocking.',
  },
  {
    id: 'receipts',
    label: 'Receipts',
    icon: Receipt,
    text: 'Every sale becomes a receipt you can open, download and share.',
  },
  { id: 'reports', label: 'Reports', icon: BarChart3, text: 'See sales, costs and profit for any period you choose.' },
] as const

export function LandingShowcase() {
  const [active, setActive] = useState(0)
  const current = screens[active]
  return (
    <section className="landing-showcase" aria-labelledby="showcase-title">
      <div className="showcase-head">
        <span className="section-label">See it in action</span>
        <h2 id="showcase-title">
          The real app,
          <br />
          on your phone and computer.
        </h2>
        <p className="landing-detail">
          These are screens from Zerøbyte Business with a sample shop. Your own records appear in the same places.
        </p>
      </div>
      <div className="showcase-tabs" role="tablist" aria-label="App pages">
        {screens.map((screen, index) => (
          <button
            key={screen.id}
            type="button"
            role="tab"
            id={`showcase-tab-${screen.id}`}
            aria-selected={index === active}
            aria-controls="showcase-panel"
            className={index === active ? 'on' : ''}
            onClick={() => setActive(index)}
          >
            <screen.icon size={16} aria-hidden="true" /> {screen.label}
          </button>
        ))}
      </div>
      <div
        className="showcase-stage"
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${current.id}`}
      >
        <div className="showcase-browser">
          <div className="showcase-bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>zerobyte.app</span>
          </div>
          <img
            key={`d-${current.id}`}
            src={appPath(`/landing/${current.id}-desktop.webp`)}
            alt={`The ${current.label} page of Zerøbyte Business on a computer`}
            width={1280}
            height={800}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="showcase-phone">
          <img
            key={`p-${current.id}`}
            src={appPath(`/landing/${current.id}-phone.webp`)}
            alt={`The ${current.label} page of Zerøbyte Business on a phone`}
            width={390}
            height={844}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <p className="showcase-caption" aria-live="polite">
        <strong>{current.label}.</strong> {current.text}
      </p>
    </section>
  )
}
