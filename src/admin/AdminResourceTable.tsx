import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '../components/ui'
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

  useEffect(() => {
    setLoading(true)
    setError('')
    let cancelled = false
    const loadRows = async () => {
      if (sessionInvalid.current) { setLoading(false); return }
      const { response, expired } = await fetchAdminFunction(`get-platform-records?resource=${encodeURIComponent(resource)}`)
      if (cancelled) return
      if (!response) {
        setLoading(false)
        if (expired) sessionInvalid.current = true
        setError(expired ? 'Your admin session has expired. Sign in again.' : 'The admin records service timed out or is temporarily unavailable. Try again.')
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
    return () => { cancelled = true }
  }, [resource])

  if (loading) return <div className="admin-table-skeleton">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div>
  if (error) return <div className="form-error" role="alert">{error}</div>
  if (!rows.length) return <div className="admin-empty">{emptyLabel ?? `No ${resource.toLowerCase()} records found.`}</div>
  const columns = Object.keys(rows[0]).filter((key) => !['metadata', 'features'].includes(key)).slice(0, 7)
  return <div className="table-wrap"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{formatAdminValue(column, row[column])}</td>)}</tr>)}</tbody></table></div>
}
