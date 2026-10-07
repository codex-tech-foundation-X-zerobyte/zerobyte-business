import { useEffect, useState } from 'react'
import { recordDates } from '../lib/format'
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

export function PageIntro({ label, title, description }: { label: string; title: string; description: string }) { return <div className="page-heading"><div><span className="section-label">{label}</span><h1>{title}</h1><p className="muted">{description}</p></div></div> }

export function EmptyInline({ title, text }: { title: string; text: string }) { return <div className="empty-inline"><strong>{title}</strong><span>{text}</span></div> }

export function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div> }

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
