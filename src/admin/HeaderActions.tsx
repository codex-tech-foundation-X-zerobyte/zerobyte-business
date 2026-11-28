import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Puts buttons into the top-right of the console page header (next to the title) instead of inside the page body. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('av-header-actions')), [])
  return slot ? createPortal(children, slot) : null
}

/** The "Last 7 days / Last 30 days / …" switch used across the console. */
export function PeriodTabs<T extends string | number>({
  value,
  options,
  onChange,
  label = 'Period',
}: {
  value: T
  options: { value: T; full: string; short?: string }[]
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <div className="ov-tabs" role="tablist" aria-label={label}>
      {options.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? 'on' : ''}
          onClick={() => onChange(item.value)}
        >
          <span className="full">{item.full}</span>
          <span className="short">{item.short ?? item.full}</span>
        </button>
      ))}
    </div>
  )
}
