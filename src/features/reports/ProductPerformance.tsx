import { useEffect, useState } from 'react'
import { EmptyInline, TableSkeleton } from '../../components/ui'
import { readStale, writeCache } from '../../lib/dataCache'
import { formatNaira } from '../../lib/format'
import { supabase } from '../../lib/supabase'

type Row = {
  kind: 'best' | 'slow'
  product_id: string
  name: string
  sku: string
  units: number | string
  revenue: number | string
  profit: number | string
  stock: number
  last_sold: string | null
}

const num = (value: number | string) => Number(value) || 0

/** Which products earn the money and which ones sit on the shelf, for the period chosen on the Reports page. */
export function ProductPerformance({
  orgId,
  dateFrom,
  dateTo,
  branchId,
}: {
  orgId: string
  dateFrom: string
  dateTo: string
  branchId: string | null
}) {
  const key = `${orgId}|${dateFrom}|${dateTo}|${branchId ?? ''}`
  const [answer, setAnswer] = useState<{ key: string; rows: Row[]; error: string } | null>(null)
  useEffect(() => {
    if (!supabase) return
    let alive = true
    // Show the last saved rankings for this range at once; the fresh ones replace them below.
    const cacheKey = `performance:${key}`
    const saved = readStale<Row[]>(cacheKey)
    if (saved) setAnswer({ key, rows: saved, error: '' })
    void Promise.resolve(
      supabase.rpc('get_product_performance', {
        target_org: orgId,
        date_from: dateFrom,
        date_to: dateTo,
        target_branch: branchId,
        max_rows: 8,
      }),
    ).then(({ data, error }) => {
      if (!alive) return
      if (error && saved) return
      if (!error) writeCache(cacheKey, (data ?? []) as Row[])
      setAnswer({
        key,
        rows: error ? [] : ((data ?? []) as Row[]),
        error: error
          ? error.code === 'PGRST202'
            ? 'Product rankings are not available yet. Please try again shortly.'
            : 'Product rankings are temporarily unavailable.'
          : '',
      })
    })
    return () => {
      alive = false
    }
  }, [orgId, dateFrom, dateTo, branchId, key])

  const current = answer?.key === key ? answer : null
  const best = (current?.rows ?? []).filter((row) => row.kind === 'best')
  const slow = (current?.rows ?? []).filter((row) => row.kind === 'slow')
  return (
    <div className="product-performance">
      {current?.error && (
        <div className="form-error" role="alert">
          {current.error}
        </div>
      )}
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="section-label">Products</span>
            <h2>Best sellers</h2>
          </div>
        </div>
        {!current ? (
          <TableSkeleton rows={3} />
        ) : best.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="amount">Sold</th>
                  <th className="amount">Sales</th>
                  <th className="amount">Profit</th>
                </tr>
              </thead>
              <tbody>
                {best.map((row, index) => (
                  <tr key={row.product_id}>
                    <td>
                      <strong>
                        {index + 1}. {row.name}
                      </strong>
                      <small className="adm-email">{row.sku}</small>
                    </td>
                    <td className="amount" data-label="Sold">
                      {num(row.units).toLocaleString('en-NG')}
                    </td>
                    <td className="amount" data-label="Sales">
                      {formatNaira(num(row.revenue))}
                    </td>
                    <td className={`amount ${num(row.profit) < 0 ? 'danger-text' : ''}`} data-label="Profit">
                      {formatNaira(num(row.profit))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyInline
            title="No sales in this period"
            text="Pick a longer period, or record a sale to see what sells best."
          />
        )}
      </section>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="section-label">Products</span>
            <h2>Slow movers</h2>
          </div>
        </div>
        {!current ? (
          <TableSkeleton rows={3} />
        ) : slow.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="amount">In stock</th>
                  <th className="amount">Last sold</th>
                </tr>
              </thead>
              <tbody>
                {slow.map((row) => (
                  <tr key={row.product_id}>
                    <td>
                      <strong>{row.name}</strong>
                      <small className="adm-email">{row.sku}</small>
                    </td>
                    <td className="amount" data-label="In stock">
                      {row.stock.toLocaleString('en-NG')}
                    </td>
                    <td className="amount" data-label="Last sold">
                      {row.last_sold
                        ? new Date(`${row.last_sold.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-NG', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyInline
            title="Nothing is sitting unsold"
            text="Every product you hold sold at least once in this period."
          />
        )}
        <p className="field-help report-note">
          Best sellers are ranked by units sold (completed sales only). Sales are the item prices before any discount
          given on a whole sale. Slow movers are products you still hold that did not sell at all in this period, with
          the most money tied up first.
        </p>
      </section>
    </div>
  )
}
