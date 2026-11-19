import { ArrowLeft, ChevronRight, type LucideIcon } from 'lucide-react'

type HubItem = { id: string; title: string; description: string; icon: LucideIcon; note?: string }

/** A page that first asks "what do you want to open?" and shows one tidy card per area. */
export function HubGrid({
  items,
  onOpen,
  label,
}: {
  items: readonly HubItem[]
  onOpen: (id: string) => void
  label: string
}) {
  return (
    <nav className="hub-grid" aria-label={label}>
      {items.map(({ id, title, description, icon: Icon, note }) => (
        <button key={id} type="button" className="hub-card" onClick={() => onOpen(id)}>
          <span className="hub-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className="hub-text">
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
          {note && <span className="hub-note">{note}</span>}
          <ChevronRight size={18} className="hub-chevron" aria-hidden="true" />
        </button>
      ))}
    </nav>
  )
}

/** The way back to the list of areas, shown above an opened area. */
export function HubBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="hub-back" onClick={onClick}>
      <ArrowLeft size={16} aria-hidden="true" /> {label}
    </button>
  )
}
