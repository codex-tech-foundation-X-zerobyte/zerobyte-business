import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyInline, TableSkeleton } from '../../components/ui'
import { databaseMessage } from '../../lib/csv'
import { formatNaira } from '../../lib/format'
import { supabase } from '../../lib/supabase'

type CountProduct = {
  id: string
  name: string
  sku: string
  category: string | null
  stock: number
  cost_price: number | null
}
type Stage = 'start' | 'counting' | 'review' | 'done'
type Summary = {
  items_counted: number
  items_changed: number
  units_over: number
  units_short: number
  value_over: number
  value_short: number
}
type Draft = { counts: Record<string, string>; note: string; blind: boolean }

const PAGE = 1000
const MAX_PRODUCTS = 3000
const units = (value: number) => `${value.toLocaleString('en-NG')} unit${value === 1 ? '' : 's'}`

const draftKey = (orgId: string, branchId: string | null) => `zerobyte.stockcount.${orgId}.${branchId ?? 'all'}`
function readDraft(key: string): Draft {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<Draft> | null
    return { counts: saved?.counts ?? {}, note: saved?.note ?? '', blind: saved?.blind ?? true }
  } catch {
    return { counts: {}, note: '', blind: true }
  }
}

/**
 * A physical stock count: walk the shelves, type what is really there, review the differences, then apply. Every
 * difference becomes an ADJUSTMENT in the stock history, and the count itself is kept for later review.
 * Unfinished counts are kept on this device so a phone call or a closed tab never loses the work.
 */
export function StockCount({
  orgId,
  branchId,
  branchName,
  onDone,
}: {
  orgId: string
  branchId: string | null
  branchName: string
  onDone: () => void
}) {
  const key = draftKey(orgId, branchId)
  const [draft, setDraft] = useState<Draft>(() => readDraft(key))
  const [stage, setStage] = useState<Stage>('start')
  const [products, setProducts] = useState<CountProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [tooMany, setTooMany] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [show, setShow] = useState<'all' | 'uncounted'>('all')
  const [summary, setSummary] = useState<Summary | null>(null)

  // A different branch is a different count: load that branch's saved work.
  useEffect(() => {
    setDraft(readDraft(key))
    setStage('start')
    setProducts([])
  }, [key])

  const save = useCallback(
    (next: Draft) => {
      setDraft(next)
      try {
        const empty = !Object.keys(next.counts).length && !next.note
        if (empty) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Storage can be blocked; the count still works until the page is closed.
      }
    },
    [key],
  )

  async function start() {
    if (!supabase) return
    setError('')
    setLoading(true)
    const loaded: CountProduct[] = []
    for (let from = 0; from < MAX_PRODUCTS; from += PAGE) {
      let request = supabase
        .from('products')
        .select('id,name,sku,category,stock,cost_price')
        .eq('organization_id', orgId)
        .order('name')
        .order('id')
      if (branchId) request = request.eq('branch_id', branchId)
      const { data, error: failure } = await request.range(from, from + PAGE - 1)
      if (failure) {
        setError(failure.message)
        setLoading(false)
        return
      }
      loaded.push(...((data ?? []) as CountProduct[]))
      if ((data?.length ?? 0) < PAGE) break
    }
    setTooMany(loaded.length >= MAX_PRODUCTS)
    setProducts(loaded)
    setLoading(false)
    setStage('counting')
  }

  const categories = useMemo(
    () =>
      [...new Set(products.map((product) => product.category || 'Uncategorized'))].sort((a, b) => a.localeCompare(b)),
    [products],
  )
  const counted = (id: string) => (draft.counts[id] ?? '') !== ''
  const countedTotal = products.filter((product) => counted(product.id)).length
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return products.filter((product) => {
      if (category && (product.category || 'Uncategorized') !== category) return false
      if (show === 'uncounted' && (draft.counts[product.id] ?? '') !== '') return false
      return !needle || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle)
    })
  }, [products, search, category, show, draft.counts])

  function setCount(id: string, value: string) {
    if (!/^\d{0,9}$/.test(value)) return
    const counts = { ...draft.counts }
    if (value === '') delete counts[id]
    else counts[id] = value
    save({ ...draft, counts })
  }

  const rows = useMemo(
    () =>
      products
        .filter((product) => counted(product.id))
        .map((product) => {
          const countedNumber = Number(draft.counts[product.id])
          const difference = countedNumber - product.stock
          return { product, counted: countedNumber, difference, value: difference * Number(product.cost_price ?? 0) }
        })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || Math.abs(b.difference) - Math.abs(a.difference)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, draft.counts],
  )
  const different = rows.filter((row) => row.difference !== 0)
  const over = different.filter((row) => row.difference > 0)
  const short = different.filter((row) => row.difference < 0)
  const sum = (list: typeof rows, pick: (row: (typeof rows)[number]) => number) =>
    list.reduce((total, row) => total + pick(row), 0)

  async function apply() {
    if (!supabase || !rows.length) return
    setError('')
    if (!navigator.onLine) {
      setError('Applying a count needs a connection. Your numbers are saved on this device. Reconnect and try again.')
      return
    }
    if (rows.length > 2000) {
      setError('Apply up to 2,000 products at a time. Count a category first, apply it, then continue.')
      return
    }
    setBusy(true)
    const { data, error: failure } = await supabase.rpc('apply_stock_count', {
      target_org: orgId,
      items: rows.map((row) => ({ product_id: row.product.id, counted: row.counted })),
      count_note: draft.note.trim() || null,
      target_branch: branchId,
    })
    setBusy(false)
    if (failure) {
      setError(
        failure.code === 'PGRST202'
          ? 'Stock counts are not available yet. Please try again shortly.'
          : databaseMessage(failure, 'The count could not be applied. Nothing was changed.'),
      )
      return
    }
    setSummary(data as Summary)
    save({ counts: {}, note: '', blind: draft.blind })
    setStage('done')
    onDone()
  }

  const where = branchId ? branchName : 'all products'

  if (stage === 'start')
    return (
      <div className="panel stock-count-panel">
        <p>
          Count what is really on your shelves for <strong>{where}</strong>. You type what you find, review the
          differences and then apply them. Every change appears in your stock history with the reason “Stock count”.
        </p>
        {countedTotal === 0 && Object.keys(draft.counts).length > 0 && (
          <p className="field-help">
            You have an unfinished count saved on this device ({Object.keys(draft.counts).length} counted).
          </p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="import-actions">
          <button type="button" className="primary" disabled={loading} onClick={() => void start()}>
            {loading ? 'Loading products…' : Object.keys(draft.counts).length ? 'Continue the count' : 'Start a count'}
          </button>
        </div>
      </div>
    )

  if (stage === 'done' && summary)
    return (
      <div className="panel stock-count-panel" role="status">
        <h3>Count applied</h3>
        <p>
          {summary.items_counted.toLocaleString('en-NG')} products counted,{' '}
          {summary.items_changed.toLocaleString('en-NG')} changed.
          {summary.units_short > 0 && (
            <>
              {' '}
              Missing: {units(summary.units_short)} ({formatNaira(Number(summary.value_short))} at cost).
            </>
          )}
          {summary.units_over > 0 && (
            <>
              {' '}
              Extra: {units(summary.units_over)} ({formatNaira(Number(summary.value_over))} at cost).
            </>
          )}
        </p>
        <div className="import-actions">
          <button type="button" className="secondary" onClick={() => setStage('start')}>
            Done
          </button>
        </div>
      </div>
    )

  if (stage === 'review')
    return (
      <div className="panel stock-count-panel">
        <h3>Review before you apply</h3>
        <p>
          <strong>{rows.length.toLocaleString('en-NG')}</strong> products counted.{' '}
          <strong>{different.length.toLocaleString('en-NG')}</strong> differ from the system
          {short.length > 0 && (
            <>
              ; missing <strong className="danger-text">{units(-sum(short, (row) => row.difference))}</strong> (
              {formatNaira(-sum(short, (row) => row.value))} at cost)
            </>
          )}
          {over.length > 0 && (
            <>
              ; extra <strong>{units(sum(over, (row) => row.difference))}</strong> (
              {formatNaira(sum(over, (row) => row.value))} at cost)
            </>
          )}
          .
        </p>
        {different.length === 0 ? (
          <p className="field-help">
            Everything you counted matches the system. Applying records the count and changes no stock.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="amount">System</th>
                  <th className="amount">Counted</th>
                  <th className="amount">Difference</th>
                  <th className="amount">At cost</th>
                </tr>
              </thead>
              <tbody>
                {different.slice(0, 200).map((row) => (
                  <tr key={row.product.id}>
                    <td>
                      <strong>{row.product.name}</strong>
                      <small className="adm-email">{row.product.sku}</small>
                    </td>
                    <td className="amount">{row.product.stock}</td>
                    <td className="amount">{row.counted}</td>
                    <td className={`amount ${row.difference < 0 ? 'danger-text' : ''}`}>
                      {row.difference > 0 ? '+' : ''}
                      {row.difference}
                    </td>
                    <td className="amount">{formatNaira(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {different.length > 200 && (
          <p className="field-help">
            Showing the 200 biggest differences of {different.length.toLocaleString('en-NG')}.
          </p>
        )}
        <label>
          Note (optional)
          <input
            maxLength={200}
            value={draft.note}
            onChange={(event) => save({ ...draft, note: event.target.value })}
            placeholder="e.g. End of month count, shop floor"
          />
        </label>
        <p className="field-help">
          The count replaces the system number for the products you counted. Sales recorded while you were counting are
          not subtracted, so count when the shop is quiet or add those sales back to your numbers. Products you did not
          count are left alone.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="import-actions">
          <button type="button" className="primary" disabled={busy || !rows.length} onClick={() => void apply()}>
            {busy
              ? 'Applying…'
              : different.length
                ? `Apply ${different.length.toLocaleString('en-NG')} changes`
                : 'Record the count'}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setStage('counting')}>
            Back to counting
          </button>
        </div>
      </div>
    )

  return (
    <div className="panel stock-count-panel">
      <div className="count-toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or SKU"
          aria-label="Search products to count"
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={show}
          onChange={(event) => setShow(event.target.value as 'all' | 'uncounted')}
          aria-label="Which products to show"
        >
          <option value="all">Show everything</option>
          <option value="uncounted">Only products not counted yet</option>
        </select>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={draft.blind}
          onChange={(event) => save({ ...draft, blind: event.target.checked })}
        />
        Hide the system stock while I count (counting without looking is more accurate)
      </label>
      <p className="field-help">
        <strong>
          {countedTotal.toLocaleString('en-NG')} of {products.length.toLocaleString('en-NG')}
        </strong>{' '}
        counted. Leave a product empty if you did not count it; type 0 if the shelf is empty.
      </p>
      {tooMany && (
        <p className="field-help">
          You have more than {MAX_PRODUCTS.toLocaleString('en-NG')} products, so only the first{' '}
          {MAX_PRODUCTS.toLocaleString('en-NG')} are listed. Count in parts by branch, apply, then continue.
        </p>
      )}
      {loading ? (
        <TableSkeleton />
      ) : visible.length ? (
        <div className="table-wrap count-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                {!draft.blind && <th className="amount">System</th>}
                <th className="amount">Counted</th>
                {!draft.blind && <th className="amount">Difference</th>}
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map((product) => {
                const value = draft.counts[product.id] ?? ''
                const difference = value === '' ? null : Number(value) - product.stock
                return (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <small className="adm-email">
                        {product.sku}
                        {product.category ? ` · ${product.category}` : ''}
                      </small>
                    </td>
                    {!draft.blind && <td className="amount">{product.stock}</td>}
                    <td className="amount">
                      <input
                        className="count-input"
                        inputMode="numeric"
                        value={value}
                        onChange={(event) => setCount(product.id, event.target.value)}
                        aria-label={`Counted ${product.name}`}
                      />
                    </td>
                    {!draft.blind && (
                      <td className={`amount ${difference !== null && difference < 0 ? 'danger-text' : ''}`}>
                        {difference === null ? '' : `${difference > 0 ? '+' : ''}${difference}`}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyInline title="Nothing to show" text="Change the search or the filters above." />
      )}
      {visible.length > 300 && (
        <p className="field-help">
          Showing the first 300 of {visible.length.toLocaleString('en-NG')}. Use the search or the category to find the
          rest.
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="import-actions">
        <button type="button" className="primary" disabled={!countedTotal} onClick={() => setStage('review')}>
          Review {countedTotal.toLocaleString('en-NG')} counted
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (!countedTotal || window.confirm('Discard everything you have counted so far?')) {
              save({ counts: {}, note: '', blind: draft.blind })
              setStage('start')
            }
          }}
        >
          Discard count
        </button>
      </div>
    </div>
  )
}

type CountRow = {
  id: string
  created_at: string
  note: string | null
  items_counted: number
  items_changed: number
  units_over: number
  units_short: number
  value_over: number
  value_short: number
}
type CountItem = { product_name: string; sku: string | null; expected: number; counted: number; difference: number }

/** The counts done so far, newest first, each opening into the products that differed. */
export function StockCountHistory({ orgId, refreshKey }: { orgId: string; refreshKey: number }) {
  const [rows, setRows] = useState<CountRow[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, CountItem[]>>({})
  useEffect(() => {
    if (!supabase) return
    let alive = true
    void Promise.resolve(
      supabase
        .from('stock_counts')
        .select('id,created_at,note,items_counted,items_changed,units_over,units_short,value_over,value_short')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
    ).then(({ data }) => {
      if (alive) setRows((data ?? []) as CountRow[])
    })
    return () => {
      alive = false
    }
  }, [orgId, refreshKey])

  async function toggle(id: string) {
    if (open === id) return setOpen(null)
    setOpen(id)
    if (items[id] || !supabase) return
    const { data } = await supabase
      .from('stock_count_items')
      .select('product_name,sku,expected,counted,difference')
      .eq('count_id', id)
      .order('product_name')
      .limit(1000)
    setItems((current) => ({ ...current, [id]: (data ?? []) as CountItem[] }))
  }

  return (
    <section className="panel table-panel stock-history">
      <div className="panel-heading">
        <div>
          <span className="section-label">Stock control</span>
          <h2>Stock counts</h2>
        </div>
      </div>
      {rows === null ? (
        <TableSkeleton rows={2} />
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="amount">Counted</th>
                <th className="amount">Changed</th>
                <th className="amount">Missing</th>
                <th className="amount">Extra</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FragmentRow
                  key={row.id}
                  row={row}
                  open={open === row.id}
                  items={items[row.id]}
                  onToggle={() => void toggle(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyInline
          title="No stock counts yet"
          text="Count your shelves now and then. Every difference is explained here."
        />
      )}
    </section>
  )
}

function FragmentRow({
  row,
  open,
  items,
  onToggle,
}: {
  row: CountRow
  open: boolean
  items?: CountItem[]
  onToggle: () => void
}) {
  return (
    <>
      <tr>
        <td>
          <strong>
            {new Date(row.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
          </strong>
          {row.note && <small className="adm-email">{row.note}</small>}
        </td>
        <td className="amount">{row.items_counted}</td>
        <td className="amount">{row.items_changed}</td>
        <td className="amount">
          {row.units_short ? `${row.units_short} · ${formatNaira(Number(row.value_short))}` : '—'}
        </td>
        <td className="amount">
          {row.units_over ? `${row.units_over} · ${formatNaira(Number(row.value_over))}` : '—'}
        </td>
        <td>
          <button type="button" className="text-btn" onClick={onToggle}>
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="record-day-row">
          <td colSpan={6}>
            {!items ? (
              'Loading…'
            ) : (
              <ul className="count-details">
                {items
                  .filter((item) => item.difference !== 0)
                  .map((item, position) => (
                    <li key={`${item.sku}-${position}`}>
                      {item.product_name}: system {item.expected}, counted {item.counted} (
                      {item.difference > 0 ? '+' : ''}
                      {item.difference})
                    </li>
                  ))}
                {items.every((item) => item.difference === 0) && <li>Everything counted matched the system.</li>}
                {items.filter((item) => item.difference === 0).length > 0 &&
                  items.some((item) => item.difference !== 0) && (
                    <li>{items.filter((item) => item.difference === 0).length} other products matched.</li>
                  )}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
