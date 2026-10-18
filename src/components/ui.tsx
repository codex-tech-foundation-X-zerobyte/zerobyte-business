import { FileText, Inbox, Package, Plus, Receipt, Store, Truck, Users, Wallet, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { compactNumber, recordDates } from '../lib/format'
import { cleanSearch } from '../lib/paging'
import { supabase } from '../lib/supabase'
import { type RecordRange } from '../lib/types'

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />
}

// Shared loading placeholder for the record tables across the workspace
// (Branches, Workforce, Customers, Sales, Receipts, Invoices, Expenses,
// Records, Reports, Inventory, Purchase Orders, User Accounts). Renders
// inside the same "panel table-panel" wrapper those pages already use, so
// swapping it in for the empty-state check is a one-line change per page.
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="table-skeleton" aria-busy="true" aria-label="Loading records">{Array.from({ length: rows }).map((_, index) => <Skeleton key={index} className="table-skeleton-row" />)}</div>
}

export function WorkspaceSkeleton() {
  return <div className="workspace-skeleton" aria-label="Loading workspace"><aside className="skeleton-sidebar"><Skeleton className="skeleton-logo" /><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /></aside><main className="skeleton-main"><Skeleton className="skeleton-heading" /><div className="skeleton-metrics">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="skeleton-card" />)}</div><Skeleton className="skeleton-chart" /><div className="skeleton-columns"><Skeleton className="skeleton-panel" /><Skeleton className="skeleton-panel" /></div></main></div>
}

// Page titles are plain nouns ("Inventory", "Sales"), not slogans: people scan for where they are.
// `title` is still accepted so existing call sites compile, but it is no longer shown.
export function PageIntro({ label, description, actions }: { label: string; title?: string; description: string; actions?: ReactNode }) { return <div className="page-heading"><div><h1>{label}</h1><p className="muted">{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div> }


// An empty list is the best moment to tell someone what to do next: an icon for context, one sentence on why it
// matters, and a button that opens the form (the forms live behind "Add ..." buttons).
const emptyIcons: [RegExp, LucideIcon][] = [[/product|stock/i, Package], [/customer/i, Users], [/expense/i, Wallet], [/invoice/i, FileText], [/receipt|sales/i, Receipt], [/purchase/i, Truck], [/branch/i, Store], [/employee|worker|shift|account/i, Users]]
export function EmptyInline({ title, text, action }: { title: string; text: string; action?: string }) {
  const Icon = emptyIcons.find(([pattern]) => pattern.test(title))?.[1] ?? Inbox
  const openForm = () => {
    const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.form-disclosure-toggle[aria-expanded="false"]'))
    const toggle = toggles.find((button) => action && button.textContent?.includes(action)) ?? toggles[0]
    toggle?.click()
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.form-disclosure-body input')?.focus(), 80)
  }
  return <div className="empty-inline"><span className="empty-icon" aria-hidden="true"><Icon size={24} /></span><strong>{title}</strong><span className="empty-text">{text}</span>{action && <button type="button" className="primary" onClick={openForm}><Plus size={16} /> {action}</button>}</div>
}

// A figure that must never spill out of its box. It shrinks to fit (down to `min` of its size); if it still would
// not fit (tens of millions with kobo, say) it switches to the short form (48.2M). The full amount is always in the tooltip.
export function FitText({ text, compact, min = 0.62, className = '' }: { text: string; compact?: string; min?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [useCompact, setUseCompact] = useState(false)
  const [tick, setTick] = useState(0)
  const shown = useCompact && compact ? compact : text
  const fit = useCallback(() => {
    const el = ref.current; const box = el?.parentElement
    if (!el || !box) return
    el.style.fontSize = '1em'
    const available = box.clientWidth; const needed = el.scrollWidth
    if (!available || !needed || needed <= available) return
    const ratio = available / needed
    if (ratio < min && compact && !useCompact) { setUseCompact(true); return }
    el.style.fontSize = `${Math.max(min, ratio * 0.97)}em`
  }, [compact, min, useCompact])
  useLayoutEffect(() => { fit() }, [fit, shown, tick])
  useEffect(() => {
    const box = ref.current?.parentElement
    if (!box || typeof ResizeObserver === 'undefined') return
    let width = box.clientWidth
    const observer = new ResizeObserver(() => { if (Math.abs(box.clientWidth - width) > 1) { width = box.clientWidth; setUseCompact(false); setTick((value) => value + 1) } })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  const sign = /^-?[₦$€£]/.test(shown) ? shown.match(/^-?[₦$€£]/)![0] : ''
  return <span ref={ref} className={`fit-text ${className}`} title={useCompact ? text : undefined}>{sign.endsWith('₦') || sign.endsWith('$') || sign.endsWith('€') || sign.endsWith('£') ? <><span className="money-sign">{sign}</span>{shown.slice(sign.length)}</> : shown}</span>
}

// Money gets its own typography: the currency sign is set smaller and lighter so the figure itself leads.
export function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  const sign = /^[₦$€£]/.test(value) ? value[0] : ''
  const compact = sign && Number.isFinite(parsed) ? `${sign}${compactNumber(parsed)}` : undefined
  return <div className="metric"><span>{label}</span><strong><FitText text={value} compact={compact} /></strong><small>{note}</small></div>
}

// Creation forms used to sit above every list and push the list (the reason people open the page) below the fold.
// They now live behind a button; the form keeps its own state in the page, so closing it loses nothing.
export function FormDisclosure({ label, children, forceOpen = false }: { label: string; children: ReactNode; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (forceOpen) setOpen(true) }, [forceOpen])
  return <section className={`form-disclosure${open ? ' open' : ''}`}><button type="button" className={`form-disclosure-toggle ${open ? 'secondary' : 'primary'}`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={16} /> : <Plus size={16} />} {open ? 'Hide form' : label}</button>{open && <div className="form-disclosure-body">{children}</div>}</section>
}


export function RecordFilters({ storageKey, onChange }: { storageKey: string; onChange: (dates: { from: string; to: string }) => void }) {
  const [range, setRange] = useState<RecordRange>(() => (window.localStorage.getItem(`${storageKey}.range`) as RecordRange) || 'all')
  const [from, setFrom] = useState(() => window.localStorage.getItem(`${storageKey}.from`) || '')
  const [to, setTo] = useState(() => window.localStorage.getItem(`${storageKey}.to`) || '')
  useEffect(() => {
    const dates = recordDates(range, from, to)
    window.localStorage.setItem(`${storageKey}.range`, range); window.localStorage.setItem(`${storageKey}.from`, from); window.localStorage.setItem(`${storageKey}.to`, to)
    onChange(dates)
  }, [from, onChange, range, storageKey, to])
  return <div className="record-filter-bar"><label>Period<select value={range} onChange={(event) => setRange(event.target.value as RecordRange)}><option value="all">All time</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="year">Last 12 months</option><option value="custom">Custom range</option></select></label>{range === 'custom' && <><label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label></>}</div>
}

// "Showing 50 of 1,240" with a button for the next page. Used under every paginated list.
export function LoadMoreBar({ shown, total, hasMore, loading, onMore, noun = 'items' }: { shown: number; total?: number | null; hasMore: boolean; loading: boolean; onMore: () => void; noun?: string }) {
  if (!shown && !hasMore) return null
  return <div className="load-more"><span className="load-more-count">Showing {shown.toLocaleString('en-NG')}{total != null && total > shown ? ` of ${total > 1000 ? 'about ' : ''}${total.toLocaleString('en-NG')}` : ''} {noun}</span>{hasMore && <button type="button" className="secondary" disabled={loading} onClick={onMore}>{loading ? 'Loading…' : 'Load more'}</button>}</div>
}

export type PickedProduct = { id: string; name: string; sku: string | null; cost_price: number | null; price: number | null }

// Type-ahead product picker: asks the database for the 20 best matches instead of listing every product in the business.
export function ProductSearchSelect({ orgId, value, onChange, placeholder = 'Search products by name or SKU', required = false }: { orgId: string; value: PickedProduct | null; onChange: (product: PickedProduct | null) => void; placeholder?: string; required?: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedProduct[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open || !supabase) return
    const timer = window.setTimeout(async () => {
      setBusy(true)
      const term = cleanSearch(query)
      let request = supabase!.from('products').select('id,name,sku,cost_price,price').eq('organization_id', orgId).order('name').limit(20)
      if (term) request = request.or(`name.ilike.*${term}*,sku.ilike.*${term}*`)
      const { data } = await request
      setResults((data ?? []) as PickedProduct[]); setBusy(false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [open, orgId, query])
  if (value) return <div className="product-picked"><span><strong>{value.name}</strong>{value.sku ? <small> {value.sku}</small> : null}</span><button type="button" className="text-btn" onClick={() => { onChange(null); setQuery(''); setOpen(true) }}>Change</button></div>
  return <div className="product-search"><input required={required} value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} aria-label="Search products" autoComplete="off" />{open && <ul className="product-search-results" role="listbox">{busy && !results.length ? <li className="muted">Searching…</li> : results.length ? results.map((product) => <li key={product.id}><button type="button" role="option" aria-selected="false" onClick={() => { onChange(product); setOpen(false) }}><strong>{product.name}</strong><small>{product.sku ?? ''}</small></button></li>) : <li className="muted">No products found</li>}</ul>}</div>
}
