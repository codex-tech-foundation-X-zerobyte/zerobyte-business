import {
  FileText,
  Inbox,
  Package,
  Plus,
  Receipt,
  Search,
  Store,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PageSearchContext } from './pageSearchContext'
import { compactNumber, recordDates } from '../lib/format'
import { cleanSearch } from '../lib/paging'
import { supabase } from '../lib/supabase'
import { type RecordRange } from '../lib/types'

/** One shimmering placeholder bar. The colours follow the light/dark theme automatically. */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />
}

// Bar widths repeat in a fixed pattern so loading tables look like real data, not a wall of identical stripes.
const CELL_WIDTHS = [64, 78, 52, 70, 46, 60]

/**
 * Loading placeholder for the record tables (Inventory, Customers, Expenses, Invoices, Receipts, Records, Branches,
 * Purchase Orders, ...). It copies the real table: a header row, then rows whose first column is wider, exactly like
 * the data that replaces it, so nothing jumps when the records arrive.
 */
export function TableSkeleton({ rows = 4, columns = 5 }: { rows?: number; columns?: number }) {
  const template = { gridTemplateColumns: `2.2fr repeat(${Math.max(columns - 1, 1)}, minmax(0, 1fr))` }
  const cells = Array.from({ length: columns })
  return (
    <div className="sk-table" role="status" aria-busy="true" aria-label="Loading records">
      <div className="sk-table-head" style={template}>
        {cells.map((_, column) => (
          <Skeleton key={column} className="sk-th" style={{ width: `${40 + (column % 3) * 12}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="sk-table-row" style={template}>
          {cells.map((__, column) => (
            <Skeleton
              key={column}
              className="sk-td"
              style={{ width: `${CELL_WIDTHS[(row + column * 2) % CELL_WIDTHS.length]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** One metric tile (label, big number, caption). Uses the real `.metric` classes so it is exactly the same size. */
export function MetricSkeleton() {
  return (
    <div className="metric sk-metric" aria-hidden="true">
      <Skeleton className="sk-label" />
      <Skeleton className="sk-value" />
      <Skeleton className="sk-note" />
    </div>
  )
}

/**
 * Full-screen loader shown while the app signs in and loads. It is a picture of the real workspace: sidebar with its
 * business card and three menu groups, top bar, page heading, the metrics panel and two content panels, plus the
 * bottom bar on phones. When the real page appears, the layout stays where it was.
 */
export function WorkspaceSkeleton() {
  const groups = [5, 5, 4]
  return (
    <div className="sk-shell" role="status" aria-busy="true" aria-label="Loading workspace">
      <aside className="sk-side" aria-hidden="true">
        <div className="sk-brand">
          <Skeleton className="sk-logo" />
          <Skeleton className="sk-wordmark" />
        </div>
        <Skeleton className="sk-org" />
        {groups.map((count, group) => (
          <div key={group} className="sk-group">
            <Skeleton className="sk-group-label" />
            {Array.from({ length: count }).map((_, item) => (
              <Skeleton
                key={item}
                className="sk-nav-item"
                style={{ width: `${58 + ((item * 11 + group * 7) % 30)}%` }}
              />
            ))}
          </div>
        ))}
      </aside>
      <div className="sk-main" aria-hidden="true">
        <div className="sk-topbar">
          <Skeleton className="sk-crumb" />
          <div className="sk-top-actions">
            <Skeleton className="sk-icon-btn" />
            <Skeleton className="sk-icon-btn" />
            <Skeleton className="sk-pill" />
          </div>
        </div>
        <div className="sk-content">
          <div className="sk-page-head">
            <div className="sk-page-titles">
              <Skeleton className="sk-title" />
              <Skeleton className="sk-sub" />
            </div>
            <Skeleton className="sk-action" />
          </div>
          <div className="sk-metrics-panel">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="sk-metric-cell">
                <Skeleton className="sk-label" />
                <Skeleton className="sk-value" />
                <Skeleton className="sk-note" />
              </div>
            ))}
          </div>
          <div className="sk-columns">
            <div className="sk-panel">
              <Skeleton className="sk-panel-title" />
              {[1, 2, 3].map((item) => (
                <Skeleton key={item} className="sk-line" style={{ width: `${96 - item * 9}%` }} />
              ))}
            </div>
            <div className="sk-panel">
              <Skeleton className="sk-panel-title" />
              {[1, 2, 3].map((item) => (
                <Skeleton key={item} className="sk-line" style={{ width: `${92 - item * 12}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <nav className="sk-bottom" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="sk-bottom-item" />
        ))}
      </nav>
    </div>
  )
}

// Page titles are plain nouns ("Inventory", "Sales"), not slogans: people scan for where they are.
// `title` is still accepted so existing call sites compile, but it is no longer shown.
export function PageIntro({
  label,
  description,
  actions,
}: {
  label: string
  title?: string
  description: string
  actions?: ReactNode
}) {
  const pageSearch = useContext(PageSearchContext)
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{label}</h1>
          <p className="muted">{description}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {pageSearch && (
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={pageSearch.value}
            onChange={(event) => pageSearch.onChange(event.target.value)}
            placeholder={pageSearch.placeholder}
            aria-label={pageSearch.placeholder}
          />
        </label>
      )}
    </>
  )
}

// An empty list is the best moment to tell someone what to do next: an icon for context, one sentence on why it
// matters, and a button that opens the form (the forms live behind "Add ..." buttons).
const emptyIcons: [RegExp, LucideIcon][] = [
  [/product|stock/i, Package],
  [/customer/i, Users],
  [/expense/i, Wallet],
  [/invoice/i, FileText],
  [/receipt|sales/i, Receipt],
  [/purchase/i, Truck],
  [/branch/i, Store],
  [/employee|worker|shift|account/i, Users],
]
export function EmptyInline({ title, text, action }: { title: string; text: string; action?: string }) {
  const Icon = emptyIcons.find(([pattern]) => pattern.test(title))?.[1] ?? Inbox
  const openForm = () => {
    const toggles = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.form-disclosure-toggle[aria-expanded="false"]'),
    )
    const toggle = toggles.find((button) => action && button.textContent?.includes(action)) ?? toggles[0]
    toggle?.click()
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.form-disclosure-body input')?.focus(), 80)
  }
  return (
    <div className="empty-inline">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <strong>{title}</strong>
      <span className="empty-text">{text}</span>
      {action && (
        <button type="button" className="primary" onClick={openForm}>
          <Plus size={16} /> {action}
        </button>
      )}
    </div>
  )
}

// A figure that must never spill out of its box. It shrinks to fit (down to `min` of its size); if it still would
// not fit (tens of millions with kobo, say) it switches to the short form (48.2M). The full amount is always in the tooltip.
export function FitText({
  text,
  compact,
  min = 0.62,
  className = '',
}: {
  text: string
  compact?: string
  min?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [useCompact, setUseCompact] = useState(false)
  const [tick, setTick] = useState(0)
  const shown = useCompact && compact ? compact : text
  const fit = useCallback(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    el.style.fontSize = '1em'
    // keep a little air around the figure: it is fitted to 94% of its box, never edge to edge
    const available = Math.floor(box.clientWidth * 0.94)
    const needed = el.scrollWidth
    if (!available || !needed || needed <= available) return
    const ratio = available / needed
    if (ratio < min && compact && !useCompact) {
      setUseCompact(true)
      return
    }
    el.style.fontSize = `${Math.max(min, ratio * 0.97)}em`
  }, [compact, min, useCompact])
  useLayoutEffect(() => {
    fit()
  }, [fit, shown, tick])
  useEffect(() => {
    const box = ref.current?.parentElement
    if (!box || typeof ResizeObserver === 'undefined') return
    let width = box.clientWidth
    const observer = new ResizeObserver(() => {
      if (Math.abs(box.clientWidth - width) > 1) {
        width = box.clientWidth
        setUseCompact(false)
        setTick((value) => value + 1)
      }
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  const sign = /^-?[₦$€£]/.test(shown) ? shown.match(/^-?[₦$€£]/)![0] : ''
  return (
    <span ref={ref} className={`fit-text ${className}`} title={useCompact ? text : undefined}>
      {sign.endsWith('₦') || sign.endsWith('$') || sign.endsWith('€') || sign.endsWith('£') ? (
        <>
          <span className="money-sign">{sign}</span>
          {shown.slice(sign.length)}
        </>
      ) : (
        shown
      )}
    </span>
  )
}

// Money gets its own typography: the currency sign is set smaller and lighter so the figure itself leads.
export function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  const sign = /^[₦$€£]/.test(value) ? value[0] : ''
  const compact = sign && Number.isFinite(parsed) ? `${sign}${compactNumber(parsed)}` : undefined
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        <FitText text={value} compact={compact} />
      </strong>
      <small>{note}</small>
    </div>
  )
}

// Creation forms used to sit above every list and push the list (the reason people open the page) below the fold.
// They now live behind a button; the form keeps its own state in the page, so closing it loses nothing.
type FormDisclosureProps = {
  label: string
  /** Heading inside the card. Defaults to the button label. */
  title?: string
  children: ReactNode
  /** Opens the form (phone) or expands it (toggle mode), for example while editing a row. */
  forceOpen?: boolean
  /**
   * "side" (default): on desktop the form is always visible in a card beside the list, with the label as its title.
   * "toggle": the form stays hidden behind a button on every screen size, for long forms such as a new product.
   * On a phone both modes become a floating button that opens the form full-screen.
   */
  mode?: 'side' | 'toggle'
  /** The page's main action. On a phone it floats above the content; other forms become ordinary buttons. */
  featured?: boolean
}

export function FormDisclosure({ label, title, children, forceOpen = false, mode = 'side', featured = false }: FormDisclosureProps) {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  // After a save the form should get out of the way: on a phone it is a full-screen sheet, and in toggle mode it is an
  // opened panel. The forms handle their own saving, so we wait a moment and close only if no error appeared.
  const closeAfterSave = () => {
    const fullScreen = window.matchMedia('(max-width: 819px)').matches
    if (!open || !(fullScreen || mode === 'toggle')) return
    window.setTimeout(() => {
      if (!bodyRef.current?.querySelector('.form-error, [role="alert"]')) setOpen(false)
    }, 1200)
  }
  return (
    <section className={`form-disclosure form-${mode}${featured ? ' featured' : ''}${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`form-disclosure-toggle ${open ? 'secondary' : 'primary'}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={16} /> : <Plus size={16} />} {open ? 'Close' : label}
      </button>
      <div className="form-disclosure-body" ref={bodyRef} onSubmitCapture={closeAfterSave}>
        <h2 className="form-disclosure-title">{title ?? label}</h2>
        {children}
      </div>
    </section>
  )
}

export function RecordFilters({
  storageKey,
  onChange,
}: {
  storageKey: string
  onChange: (dates: { from: string; to: string }) => void
}) {
  const [range, setRange] = useState<RecordRange>(
    () => (window.localStorage.getItem(`${storageKey}.range`) as RecordRange) || 'all',
  )
  const [from, setFrom] = useState(() => window.localStorage.getItem(`${storageKey}.from`) || '')
  const [to, setTo] = useState(() => window.localStorage.getItem(`${storageKey}.to`) || '')
  useEffect(() => {
    const dates = recordDates(range, from, to)
    window.localStorage.setItem(`${storageKey}.range`, range)
    window.localStorage.setItem(`${storageKey}.from`, from)
    window.localStorage.setItem(`${storageKey}.to`, to)
    onChange(dates)
  }, [from, onChange, range, storageKey, to])
  return (
    <div className="record-filter-bar">
      <label>
        Period
        <select value={range} onChange={(event) => setRange(event.target.value as RecordRange)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="year">Last 12 months</option>
          <option value="custom">Custom range</option>
        </select>
      </label>
      {range === 'custom' && (
        <>
          <label>
            From
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </label>
        </>
      )}
    </div>
  )
}

// "Showing 50 of 1,240" with a button for the next page. Used under every paginated list.
export function LoadMoreBar({
  shown,
  total,
  hasMore,
  loading,
  onMore,
  noun = 'items',
}: {
  shown: number
  total?: number | null
  hasMore: boolean
  loading: boolean
  onMore: () => void
  noun?: string
}) {
  if (!shown && !hasMore) return null
  return (
    <div className="load-more">
      <span className="load-more-count">
        Showing {shown.toLocaleString('en-NG')}
        {total != null && total > shown
          ? ` of ${total > 1000 ? 'about ' : ''}${total.toLocaleString('en-NG')}`
          : ''}{' '}
        {noun}
      </span>
      {hasMore && (
        <button type="button" className="secondary" disabled={loading} onClick={onMore}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}

export type PickedProduct = {
  id: string
  name: string
  sku: string | null
  cost_price: number | null
  price: number | null
}

// Type-ahead product picker: asks the database for the 20 best matches instead of listing every product in the business.
export function ProductSearchSelect({
  orgId,
  value,
  onChange,
  placeholder = 'Search products by name or SKU',
  required = false,
}: {
  orgId: string
  value: PickedProduct | null
  onChange: (product: PickedProduct | null) => void
  placeholder?: string
  required?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedProduct[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open || !supabase) return
    const timer = window.setTimeout(async () => {
      setBusy(true)
      const term = cleanSearch(query)
      let request = supabase!
        .from('products')
        .select('id,name,sku,cost_price,price')
        .eq('organization_id', orgId)
        .order('name')
        .limit(20)
      if (term) request = request.or(`name.ilike.*${term}*,sku.ilike.*${term}*`)
      const { data } = await request
      setResults((data ?? []) as PickedProduct[])
      setBusy(false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [open, orgId, query])
  if (value)
    return (
      <div className="product-picked">
        <span>
          <strong>{value.name}</strong>
          {value.sku ? <small> {value.sku}</small> : null}
        </span>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            onChange(null)
            setQuery('')
            setOpen(true)
          }}
        >
          Change
        </button>
      </div>
    )
  return (
    <div className="product-search">
      <input
        required={required}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        aria-label="Search products"
        autoComplete="off"
      />
      {open && (
        <ul className="product-search-results" role="listbox">
          {busy && !results.length ? (
            <li className="muted">Searching…</li>
          ) : results.length ? (
            results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    onChange(product)
                    setOpen(false)
                  }}
                >
                  <strong>{product.name}</strong>
                  <small>{product.sku ?? ''}</small>
                </button>
              </li>
            ))
          ) : (
            <li className="muted">No products found</li>
          )}
        </ul>
      )}
    </div>
  )
}
