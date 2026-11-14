import { ChevronRight, CircleHelp, LogOut } from 'lucide-react'
import { NotificationCenter } from '../notifications/NotificationCenter'
import type { OrganizationRow, View } from '../../lib/types'
import { OrganizationSwitcher } from './OrganizationSwitcher'

type Props = {
  view: View
  orgName: string
  orgId: string
  userId: string
  organizations: OrganizationRow[]
  dark: boolean
  onToggleTheme: () => void
  onHelp: () => void
  onSignOut: () => void
  onSwitchOrganization: (id: string) => void
  /** Hide the help button for staff, who have no Settings page. */
  showHelp: boolean
}

/**
 * One top bar for every screen size. On desktop it shows the breadcrumb and the help / bell / theme buttons; on a
 * phone it shows the page title (or the business name with a switcher on Overview) and just the bell.
 */
export function Topbar(props: Props) {
  const { view, orgName, orgId, userId, organizations, dark } = props
  return (
    <header className="sh-topbar">
      <nav className="sh-crumbs" aria-label="Breadcrumb">
        <span>{orgName}</span>
        <ChevronRight size={14} aria-hidden="true" />
        <strong>{view}</strong>
      </nav>
      <div className="sh-phone-title">
        {view === 'Overview' ? (
          <OrganizationSwitcher
            variant="title"
            organizations={organizations}
            orgId={orgId}
            orgName={orgName}
            onSwitch={props.onSwitchOrganization}
          />
        ) : (
          <h1>{view}</h1>
        )}
      </div>
      <div className="sh-actions">
        {props.showHelp && (
          <button
            type="button"
            className="sh-icon-btn sh-desktop-only"
            aria-label="Help and guide"
            onClick={props.onHelp}
          >
            <CircleHelp size={19} aria-hidden="true" />
          </button>
        )}
        <NotificationCenter userId={userId} orgId={orgId} />
        <button type="button" className="sh-pill-btn sh-desktop-only" onClick={props.onToggleTheme}>
          {dark ? 'Light' : 'Dark'} mode
        </button>
        <button
          type="button"
          className="sh-icon-btn sh-desktop-only"
          aria-label="Sign out"
          title="Sign out"
          onClick={props.onSignOut}
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
