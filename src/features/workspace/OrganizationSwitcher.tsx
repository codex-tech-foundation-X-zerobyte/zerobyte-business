import { ChevronDown, ChevronRight } from 'lucide-react'
import type { OrganizationRow } from '../../lib/types'

type Props = {
  organizations: OrganizationRow[]
  orgId: string
  orgName: string
  onSwitch: (id: string) => void
  /** "card" is the sidebar block, "title" is the phone header title. */
  variant: 'card' | 'title'
}

/**
 * Shows which business you are in. With more than one business, the whole control is a native select laid invisibly
 * over the label, so it is fully keyboard and screen-reader accessible and opens the phone's own picker.
 */
export function OrganizationSwitcher({ organizations, orgId, orgName, onSwitch, variant }: Props) {
  const canSwitch = organizations.length > 1
  const Chevron = variant === 'card' ? ChevronRight : ChevronDown
  return (
    <div className={`sh-org sh-org-${variant}`}>
      <span className="sh-org-name">{orgName}</span>
      {canSwitch && <Chevron size={variant === 'card' ? 16 : 18} aria-hidden="true" />}
      {canSwitch && (
        <select aria-label="Switch business" value={orgId} onChange={(event) => onSwitch(event.target.value)}>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
