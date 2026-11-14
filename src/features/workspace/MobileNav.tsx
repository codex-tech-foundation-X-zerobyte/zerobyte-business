import { ChevronRight, LogOut, MoreHorizontal, X } from 'lucide-react'
import { useEffect } from 'react'
import type { View } from '../../lib/types'
import { type NavGroup, type NavItem } from './navigation'

type TabsProps = {
  tabs: NavItem[]
  view: View
  moreOpen: boolean
  onSelect: (view: View) => void
  onOpenMore: () => void
}

/** Phone bottom bar: four pages plus "More". Hidden on tablet and desktop, where the sidebar is always visible. */
export function MobileTabs({ tabs, view, moreOpen, onSelect, onOpenMore }: TabsProps) {
  const inTabs = tabs.some((tab) => tab.name === view)
  return (
    <nav className="sh-tabbar" aria-label="Quick navigation">
      {tabs.map(({ name, icon: Icon }) => (
        <button
          type="button"
          key={name}
          className={`sh-tab${view === name && !moreOpen ? ' active' : ''}`}
          aria-current={view === name ? 'page' : undefined}
          onClick={() => onSelect(name)}
        >
          <Icon size={22} aria-hidden="true" />
          <span>{name}</span>
        </button>
      ))}
      <button type="button" className={`sh-tab${moreOpen || !inTabs ? ' active' : ''}`} onClick={onOpenMore}>
        <MoreHorizontal size={22} aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  )
}

type SheetProps = {
  groups: NavGroup[]
  open: boolean
  onClose: () => void
  onSelect: (view: View) => void
  onSignOut: () => void
}

/** The phone "More" sheet: every page that is not on the bottom bar, grouped like the sidebar, plus Sign out. */
export function MoreSheet({ groups, open, onClose, onSelect, onSignOut }: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sh-sheet-root">
      <button type="button" className="sh-sheet-backdrop" aria-label="Close menu" onClick={onClose} />
      <div className="sh-sheet" role="dialog" aria-modal="true" aria-label="More">
        <header>
          <h2>More</h2>
          <button type="button" className="sh-sheet-close" aria-label="Close menu" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="sh-sheet-body">
          {groups.map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map(({ name, icon: Icon }) => (
                  <li key={name}>
                    <button type="button" onClick={() => onSelect(name)}>
                      <span>
                        <Icon size={19} aria-hidden="true" />
                        {name}
                      </span>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <button type="button" className="sh-signout" onClick={onSignOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
