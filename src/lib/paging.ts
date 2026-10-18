import { useCallback, useEffect, useRef, useState } from 'react'

// Shared building blocks for lists that can grow without limit.
//
// usePagedList  - a visible list: the newest page first, "load more" for the rest, search done by the database.
// loadAllRows   - for data an offline cache or a dropdown genuinely needs in full: reads it in 1,000-row chunks so
//                 nothing is silently cut off at the API's per-request row limit.
// cleanSearch   - makes typed text safe to put inside a PostgREST ilike filter.

export const PAGE_SIZE = 50

export function cleanSearch(term: string) {
  return term.replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null; count?: number | null }

export async function loadAllRows<T>(fetchChunk: (from: number, to: number) => PromiseLike<PageResult<T>>, chunk = 1000, maxRows = 50000) {
  const all: T[] = []
  for (let from = 0; from < maxRows; from += chunk) {
    const { data, error } = await fetchChunk(from, from + chunk - 1)
    if (error) return { data: null as T[] | null, error }
    all.push(...(data ?? []))
    if (!data || data.length < chunk) break
  }
  return { data: all as T[] | null, error: null }
}

export function usePagedList<T>({ deps, search = '', pageSize = PAGE_SIZE, fetchPage }: {
  deps: unknown[]
  search?: string
  pageSize?: number
  // first === true on the first page of a search: that is when the (exact) total is worth asking for.
  fetchPage: (range: { from: number; to: number }, term: string, first: boolean) => PromiseLike<PageResult<T>>
}) {
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [term, setTerm] = useState(search)
  const requestId = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage

  // Typing in the search box should not fire a request per keystroke.
  useEffect(() => {
    if (search === term) return
    const timer = window.setTimeout(() => setTerm(search), 300)
    return () => window.clearTimeout(timer)
  }, [search, term])

  const reload = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    const result = await fetchRef.current({ from: 0, to: pageSize - 1 }, term, true)
    if (id !== requestId.current) return
    if (result.error) setError(result.error.message)
    else { setError(''); setRows(result.data ?? []); setHasMore((result.data ?? []).length === pageSize); setTotal(result.count ?? null) }
    setLoading(false)
  }, [pageSize, term])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, [reload, ...deps])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const id = requestId.current
    setLoadingMore(true)
    const result = await fetchRef.current({ from: rows.length, to: rows.length + pageSize - 1 }, term, false)
    if (id !== requestId.current) { setLoadingMore(false); return }
    if (result.error) setError(result.error.message)
    else { setRows((current) => [...current, ...(result.data ?? [])]); setHasMore((result.data ?? []).length === pageSize) }
    setLoadingMore(false)
  }, [hasMore, loadingMore, pageSize, rows.length, term])

  return { rows, setRows, total, loading, loadingMore, hasMore, error, setError, reload, loadMore, searching: term !== search }
}
