import { Search, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminSection } from './types'

type Props = {
  open: boolean
  sections: { name: AdminSection; group: string; Icon: LucideIcon }[]
  onClose: () => void
  onPick: (section: AdminSection) => void
}

/** "Jump to a section" box (Ctrl/Cmd + K). Arrow keys move, Enter opens, Esc closes. */
export function AdminCommandPalette({ open, sections, onClose, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sections.filter(
      (item) => !needle || item.name.toLowerCase().includes(needle) || item.group.toLowerCase().includes(needle),
    )
  }, [sections, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    window.setTimeout(() => input.current?.focus(), 20)
  }, [open])

  if (!open) return null
  const choose = (index: number) => {
    const item = matches[index]
    if (item) onPick(item.name)
  }
  return (
    <div className="cp-back" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="cp-box" role="dialog" aria-modal="true" aria-label="Jump to a section">
        <div className="cp-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            placeholder="Jump to a section…"
            aria-label="Jump to a section"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((value) => Math.min(value + 1, matches.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((value) => Math.max(value - 1, 0))
              } else if (event.key === 'Enter') choose(active)
            }}
          />
        </div>
        {matches.length ? (
          <ul className="cp-list" role="listbox">
            {matches.map((item, index) => (
              <li key={item.name} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={`cp-item${index === active ? ' on' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <item.Icon size={17} />
                  {item.name}
                  <small>{item.group}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cp-empty">Nothing matches “{query}”.</p>
        )}
      </div>
    </div>
  )
}
