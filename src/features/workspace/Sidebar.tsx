import type { View } from '../../lib/types'
import type { OrganizationRow } from '../../lib/types'
import { type NavGroup } from './navigation'
import { OrganizationSwitcher } from './OrganizationSwitcher'

type Props = {
  groups: NavGroup[]
  view: View
  onSelect: (view: View) => void
  workerMode: boolean
  organizations: OrganizationRow[]
  orgId: string
  orgName: string
  onSwitchOrganization: (id: string) => void
}

/** Desktop and tablet navigation. On a phone it is hidden and the bottom bar plus "More" sheet take over. */
export function Sidebar({
  groups,
  view,
  onSelect,
  workerMode,
  organizations,
  orgId,
  orgName,
  onSwitchOrganization,
}: Props) {
  return (
    <aside className="sh-sidebar" aria-label="Main navigation">
      <div className="sh-brand">
        <span className="sh-logo" aria-hidden="true">
          ø
        </span>
        <strong>Zerøbyte</strong>
        <small>{workerMode ? 'Worker' : 'Business'}</small>
      </div>
      <OrganizationSwitcher
        variant="card"
        organizations={organizations}
        orgId={orgId}
        orgName={orgName}
        onSwitch={onSwitchOrganization}
      />
      <nav className="sh-nav">
        {groups.map((group) => (
          <div className="sh-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map(({ name, icon: Icon }) => (
              <button
                type="button"
                key={name}
                className={`sh-nav-item${view === name ? ' active' : ''}`}
                aria-current={view === name ? 'page' : undefined}
                onClick={() => onSelect(name)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{name}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
