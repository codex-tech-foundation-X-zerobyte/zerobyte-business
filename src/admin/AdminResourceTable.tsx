import { Download, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '../components/ui'
import { formatNaira } from '../lib/format'
import { fetchAdminFunction } from './api'
import { formatAdminValue } from './format'
import { type AdminRow, type AdminSection } from './types'

// Every "just show me the live records" section (Organizations, Branches,
// Inventory, Sales, Subscriptions) is the same shape: fetch
// get-platform-records?resource=<section>, render whatever columns come
// back. One component instead of five near-identical copies.
export function AdminResourceTable({ resource, emptyLabel }: { resource: AdminSection; emptyLabel?: string }) {
  const [rows, setRows] = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sessionInvalid = useRef(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [shown, setShown] = useState(25)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    let cancelled = false
    const loadRows = async () => {
      if (sessionInvalid.current) {
        setLoading(false)
        return
      }
      const { response, expired } = await fetchAdminFunction(
        `get-platform-records?resource=${encodeURIComponent(resource)}`,
      )
      if (cancelled) return
      if (!response) {
        setLoading(false)
        if (expired) sessionInvalid.current = true
        setError(
          expired
            ? 'Your admin session has expired. Sign in again.'
            : 'The admin records service timed out or is temporarily unavailable. Try again.',
        )
        return
      }
      const payload = await response.json().catch(() => null)
      if (cancelled) return
      setLoading(false)
      if (!response.ok) {
        setError(payload?.error ?? `Platform records returned ${response.status}.`)
        setRows([])
        return
      }
      setRows((payload?.rows ?? []) as unknown as AdminRow[])
    }
    void loadRows()
    return () => {
      cancelled = true
    }
  }, [resource, reloadKey])

  const columns = useMemo(
    () =>
      rows.length
        ? Object.keys(rows[0])
            .filter((key) => !['metadata', 'features'].includes(key))
            .slice(0, 7)
        : [],
    [rows],
  )
  const statuses = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows)
      if (typeof row.status === 'string') counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false
      if (!needle) return true
      return columns.some((column) =>
        String(row[column] ?? '')
          .toLowerCase()
          .includes(needle),
      )
    })
  }, [rows, columns, query, statusFilter])

  function exportCsv() {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = [
      columns.join(','),
      ...visibleRows.map((row) => columns.map((column) => escape(row[column])).join(',')),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${resource.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (loading)
    return (
      <div className="admin-table-skeleton">
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="admin-skeleton-row">
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ))}
      </div>
    )
  if (error)
    return (
      <div className="form-error" role="alert">
        {error}{' '}
        <button type="button" className="text-btn" onClick={() => setReloadKey((value) => value + 1)}>
          Try again
        </button>
      </div>
    )
  if (!rows.length)
    return <div className="admin-empty">{emptyLabel ?? `No ${resource.toLowerCase()} records found.`}</div>

  return (
    <div className="rt">
      <div className="rt-toolbar">
        <label className="rt-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setShown(25)
            }}
            placeholder={`Search ${resource.toLowerCase()}`}
            aria-label={`Search ${resource.toLowerCase()}`}
          />
        </label>
        <span className="rt-count">
          {visibleRows.length === rows.length
            ? `${rows.length.toLocaleString()} records`
            : `${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()}`}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setReloadKey((value) => value + 1)}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
        <button type="button" className="secondary rt-export" onClick={exportCsv}>
          <Download size={15} /> Export CSV
        </button>
      </div>
      {statuses.length > 1 && (
        <div className="rt-filters" role="group" aria-label="Filter by status">
          <button type="button" className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>
            All <b>{rows.length}</b>
          </button>
          {statuses.map(([status, count]) => (
            <button
              key={status}
              type="button"
              className={statusFilter === status ? 'active' : ''}
              onClick={() => {
                setStatusFilter(statusFilter === status ? '' : status)
                setShown(25)
              }}
            >
              {status.replace(/_/g, ' ')} <b>{count}</b>
            </button>
          ))}
        </div>
      )}
      {visibleRows.length ? (
        <div className="table-wrap">
          <table className="admin-table rt-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column.replace(/_/g, ' ').replace(/\bid\b/i, 'ID')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.slice(0, shown).map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {columns.map((column) => (
                    <td key={column} data-label={column.replace(/_/g, ' ')} title={String(row[column] ?? '')}>
                      <Cell column={column} value={row[column]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">Nothing matches your search.</div>
      )}
      {visibleRows.length > shown && (
        <div className="rt-more">
          <button type="button" className="secondary" onClick={() => setShown((value) => value + 25)}>
            Show 25 more ({(visibleRows.length - shown).toLocaleString()} left)
          </button>
        </div>
      )}
    </div>
  )
}

const MONEY = /^(total|price|cost_price|amount|revenue|subtotal|unit_price)$/
const GOOD = ['active', 'completed', 'paid', 'success', 'approved', 'open', 'resolved']
const WAIT = ['trialing', 'pending', 'processing', 'in_progress', 'review', 'new']
const BAD = ['canceled', 'cancelled', 'failed', 'expired', 'suspended', 'revoked', 'past_due', 'rejected', 'closed']

/** One cell, shown the way a person wants to read it: short ids, status chips, naira, and dates that say how long ago. */
function Cell({ column, value }: { column: string; value: AdminRow[string] }) {
  if (value == null || value === '') return <span className="rt-empty">—</span>
  const text = String(value)
  if (column === 'status') {
    const tone = GOOD.includes(text) ? 'good' : WAIT.includes(text) ? 'wait' : BAD.includes(text) ? 'bad' : 'quiet'
    return <span className={`ap-chip ${tone}`}>{text.replace(/_/g, ' ')}</span>
  }
  if (column === 'id' || column.endsWith('_id'))
    return (
      <code className="rt-id" title={text}>
        {text.slice(0, 8)}
      </code>
    )
  if (MONEY.test(column) && !Number.isNaN(Number(value)))
    return <span className="rt-money">{formatNaira(Number(value))}</span>
  if (/(_at|_end|_start)$/.test(column) && !Number.isNaN(new Date(text).getTime())) {
    const date = new Date(text)
    const days = Math.round((date.getTime() - Date.now()) / 86_400_000)
    const relative =
      Math.abs(days) < 1
        ? 'today'
        : days > 0
          ? `in ${days} day${days === 1 ? '' : 's'}`
          : `${-days} day${days === -1 ? '' : 's'} ago`
    return (
      <span title={date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}>
        {date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
        <small className="rt-sub">{relative}</small>
      </span>
    )
  }
  return <>{formatAdminValue(column, value)}</>
}
