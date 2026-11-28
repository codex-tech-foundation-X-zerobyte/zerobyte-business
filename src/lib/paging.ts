import { useCallback, useEffect, useRef, useState } from 'react'
import { readStale, writeCache } from './dataCache'

// Shared building blocks for lists that can grow without limit.
//
// usePagedList  - a visible list: the newest page first, "load more" for the rest, search done by the database.
// loadAllRows   - for data an offline cache or a dropdown genuinely needs in full: reads it in 1,000-row chunks so
//                 nothing is silently cut off at the API's per-request row limit.
// cleanSearch   - makes typed text safe to put inside a PostgREST ilike filter.

const PAGE_SIZE = 50

export function cleanSearch(term: string) {
  return term
    .replace(/[,()*%\\:"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null; count?: number | null }

export async function loadAllRows<T>(
  fetchChunk: (from: number, to: number) => PromiseLike<PageResult<T>>,
  chunk = 1000,
  maxRows = 50000,
) {
  const all: T[] = []
  for (let from = 0; from < maxRows; from += chunk) {
    const { data, error } = await fetchChunk(from, from + chunk - 1)
    if (error) return { data: null as T[] | null, error }
    all.push(...(data ?? []))
    if (!data || data.length < chunk) break
  }
  return { data: all as T[] | null, error: null }
}

export function usePagedList<T>({
  deps,
  search = '',
  pageSize = PAGE_SIZE,
  cacheKey,
  fetchPage,
}: {
  deps: unknown[]
  search?: string
  pageSize?: number
  // Optional: when given, the newest page (with no search typed) is saved on this device and shown instantly the next
  // time the list opens, while the fresh page is fetched. Put the business id, branch and any filter in the key.
  cacheKey?: string
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

  const loadedKeys = useRef(new Set<string>())
  const reload = useCallback(async () => {
    const id = ++requestId.current
    // Show the last saved copy only the first time this list opens (or a filter changes). After a change made on this
    // screen the list keeps what it has while the fresh page loads, so an old copy never flashes back.
    const useCopy = cacheKey && !term && !loadedKeys.current.has(cacheKey)
    const copy = useCopy ? readStale<{ rows: T[]; total: number | null }>(cacheKey) : null
    if (copy) {
      setRows(copy.rows)
      setTotal(copy.total)
      setHasMore(copy.rows.length === pageSize)
      setLoading(false)
    } else {
      setLoading(true)
    }
    const result = await fetchRef.current({ from: 0, to: pageSize - 1 }, term, true)
    if (id !== requestId.current) return
    if (result.error) {
      // With a saved copy on screen, a failed refresh (for example no network) keeps the copy instead of an error.
      if (!copy) setError(result.error.message)
    } else {
      setError('')
      setRows(result.data ?? [])
      setHasMore((result.data ?? []).length === pageSize)
      setTotal(result.count ?? null)
      if (cacheKey && !term) {
        loadedKeys.current.add(cacheKey)
        writeCache(cacheKey, { rows: result.data ?? [], total: result.count ?? null })
      }
    }
    setLoading(false)
  }, [cacheKey, pageSize, term])
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const id = requestId.current
    setLoadingMore(true)
    const result = await fetchRef.current({ from: rows.length, to: rows.length + pageSize - 1 }, term, false)
    if (id !== requestId.current) {
      setLoadingMore(false)
      return
    }
    if (result.error) setError(result.error.message)
    else {
      setRows((current) => [...current, ...(result.data ?? [])])
      setHasMore((result.data ?? []).length === pageSize)
    }
    setLoadingMore(false)
  }, [hasMore, loadingMore, pageSize, rows.length, term])

  return {
    rows,
    setRows,
    total,
    loading,
    loadingMore,
    hasMore,
    error,
    setError,
    reload,
    loadMore,
    searching: term !== search,
  }
}
