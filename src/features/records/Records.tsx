import { Package, ShoppingCart, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, LoadMoreBar, PageIntro, RecordFilters, TableSkeleton } from '../../components/ui'
import { loadAllRows, usePagedList } from '../../lib/paging'
import { downloadCsv } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { type RecordTab } from '../../lib/types'

export function Records({ orgId, search }: { orgId: string; search: string }) {
  const [tab, setTab] = useState<RecordTab>('sales')
  const tabs: { id: RecordTab; label: string; icon: typeof ShoppingCart }[] = [
    { id: 'sales', label: 'Sales records', icon: ShoppingCart },
    { id: 'expenses', label: 'Expenses', icon: Wallet },
    { id: 'stock', label: 'Stock intake', icon: Package },
  ]
  return (
    <div className="page">
      <PageIntro
        label="Records"
        title="Keep the paper trail together."
        description="Everything that was recorded."
      />
      <div className="record-tabs" role="tablist" aria-label="Business records">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'record-tab active' : 'record-tab'}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {tab === 'sales' ? (
        <SalesRecords orgId={orgId} search={search} />
      ) : tab === 'expenses' ? (
        <ExpenseRecords orgId={orgId} />
      ) : (
        <StockRecords orgId={orgId} />
      )}
    </div>
  )
}

type Dates = { from: string; to: string }
const money = (value: number) => `₦${value.toLocaleString('en-NG')}`
// Header figures (count and total) are computed by the database for the whole filtered set, not just the loaded rows.
function useRecordTotals(orgId: string, kind: 'sales' | 'expenses' | 'stock', dates: Dates, refreshKey: unknown) {
  const [totals, setTotals] = useState<{ count: number; total: number } | null>(null)
  useEffect(() => {
    if (!supabase) return
    void supabase
      .rpc('get_record_totals', {
        target_org: orgId,
        record_kind: kind,
        date_from: dates.from || null,
        date_to: dates.to || null,
      })
      .then(({ data }) => {
        const row = (data ?? [])[0] as { row_count: number; total: number } | undefined
        setTotals(row ? { count: Number(row.row_count), total: Number(row.total) } : null)
      })
  }, [orgId, kind, dates.from, dates.to, refreshKey])
  return totals
}
const dayStart = (date: string) => `${date}T00:00:00.000Z`
const dayEnd = (date: string) => `${date}T23:59:59.999Z`

type SaleRecord = {
  id: string
  customer_id: string | null
  total: number
  status: string
  created_at: string
  customer?: { name: string }[] | { name: string } | null
  items?: {
    quantity: number
    unit_price: number
    products?: { name: string; sku: string } | { name: string; sku: string }[] | null
  }[]
}
const SALE_COLUMNS =
  'id,customer_id,total,status,created_at,customer:customers(name),items:sale_items(quantity,unit_price,products(name,sku))'
const saleCustomer = (row: SaleRecord) =>
  (Array.isArray(row.customer) ? row.customer[0]?.name : row.customer?.name) ?? 'Walk-in customer'
const saleProduct = (item: NonNullable<SaleRecord['items']>[number]) =>
  Array.isArray(item.products) ? (item.products[0]?.name ?? 'Product') : (item.products?.name ?? 'Product')
const saleItems = (row: SaleRecord) =>
  row.items?.length
    ? row.items.map((item) => `${saleProduct(item)} × ${item.quantity}`).join(', ')
    : 'Item details unavailable'

function SalesRecords({ orgId, search }: { orgId: string; search: string }) {
  const [dates, setDates] = useState<Dates>({ from: '', to: '' })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const applyDates = useCallback((next: Dates) => setDates(next), [])
  const query = (from: number, to: number, count?: 'estimated') => {
    let request = supabase!
      .from('sales')
      .select(SALE_COLUMNS, { count })
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .order('id')
    if (dates.from) request = request.gte('created_at', dayStart(dates.from))
    if (dates.to) request = request.lte('created_at', dayEnd(dates.to))
    return request.range(from, to)
  }
  const list = usePagedList<SaleRecord>({
    deps: [orgId, dates.from, dates.to],
    fetchPage: async ({ from, to }, _term, first) =>
      supabase
        ? ((await query(from, to, first ? 'estimated' : undefined)) as unknown as {
            data: SaleRecord[] | null
            error: { message: string } | null
            count: number | null
          })
        : { data: [], error: null },
  })
  const totals = useRecordTotals(orgId, 'sales', dates, list.total)
  const needle = search.trim().toLowerCase()
  // Search looks through the sales already loaded; "Load more" brings older ones in.
  const shown = needle
    ? list.rows.filter((row) =>
        `${saleCustomer(row)} ${saleItems(row)} ${row.status} ${row.id}`.toLowerCase().includes(needle),
      )
    : list.rows
  async function exportAll() {
    if (!supabase) return
    setExporting(true)
    setExportError('')
    const { data, error } = await loadAllRows<SaleRecord>(
      (from, to) =>
        query(from, to) as unknown as PromiseLike<{ data: SaleRecord[] | null; error: { message: string } | null }>,
    )
    setExporting(false)
    if (error || !data) {
      setExportError('Could not prepare the export. Please try again.')
      return
    }
    downloadCsv(
      'zerobyte-sales.csv',
      ['Sale', 'Customer', 'Items sold', 'Status', 'Date', 'Total'],
      data.map((row) => [row.id, saleCustomer(row), saleItems(row), row.status, row.created_at, row.total]),
    )
  }
  const count = totals?.count ?? list.total ?? list.rows.length
  return (
    <section className="panel table-panel records-panel">
      <RecordFilters storageKey="zerobyte.records.sales" onChange={applyDates} />
      <div className="panel-heading">
        <div>
          <span className="section-label">Completed activity</span>
          <h2>
            {count.toLocaleString('en-NG')} sale{count === 1 ? '' : 's'}
          </h2>
        </div>
        <div className="record-actions">
          <span className="record-count">
            Total {money(totals?.total ?? list.rows.reduce((sum, row) => sum + Number(row.total), 0))}
          </span>
          <button className="secondary" onClick={() => void exportAll()} disabled={!count || exporting}>
            {exporting ? 'Preparing export…' : 'Export CSV'}
          </button>
        </div>
      </div>
      {(list.error || exportError) && (
        <div className="form-error">{list.error ? 'Sales records are temporarily unavailable.' : exportError}</div>
      )}
      {list.loading ? (
        <TableSkeleton />
      ) : shown.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>What was sold</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong className="sale-record-items">{saleItems(row)}</strong>
                      <small className="table-sub mono">Sale #{row.id.slice(0, 8)}</small>
                    </td>
                    <td>{saleCustomer(row)}</td>
                    <td>
                      <span className="status completed">{row.status}</span>
                    </td>
                    <td>{new Date(row.created_at).toLocaleString('en-NG')}</td>
                    <td className="amount">{money(Number(row.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMoreBar
            shown={list.rows.length}
            total={list.total}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            onMore={() => void list.loadMore()}
            noun="sales"
          />
          {needle && list.hasMore && (
            <p className="field-help records-search-note">
              Search covers the sales loaded so far. Load more to search older ones.
            </p>
          )}
        </>
      ) : (
        <EmptyInline
          title={needle ? 'No matching sales' : 'No sales records yet'}
          text={
            needle && list.hasMore
              ? 'Nothing loaded matches. Load more to search older sales.'
              : 'Completed sales will appear here after you record them.'
          }
        />
      )}
    </section>
  )
}

type ExpenseRecord = { id: string; title: string; category: string; amount: number; expense_date: string }
function ExpenseRecords({ orgId }: { orgId: string }) {
  const [dates, setDates] = useState<Dates>({ from: '', to: '' })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const applyDates = useCallback((next: Dates) => setDates(next), [])
  const query = (from: number, to: number, count?: 'estimated') => {
    let request = supabase!
      .from('expenses')
      .select('id,title,category,amount,expense_date', { count })
      .eq('organization_id', orgId)
      .order('expense_date', { ascending: false })
      .order('id')
    if (dates.from) request = request.gte('expense_date', dates.from)
    if (dates.to) request = request.lte('expense_date', dates.to)
    return request.range(from, to)
  }
  const list = usePagedList<ExpenseRecord>({
    deps: [orgId, dates.from, dates.to],
    fetchPage: async ({ from, to }, _term, first) =>
      supabase
        ? ((await query(from, to, first ? 'estimated' : undefined)) as unknown as {
            data: ExpenseRecord[] | null
            error: { message: string } | null
            count: number | null
          })
        : { data: [], error: null },
  })
  const totals = useRecordTotals(orgId, 'expenses', dates, list.total)
  async function exportAll() {
    setExporting(true)
    setExportError('')
    const { data, error } = await loadAllRows<ExpenseRecord>(
      (from, to) =>
        query(from, to) as unknown as PromiseLike<{ data: ExpenseRecord[] | null; error: { message: string } | null }>,
    )
    setExporting(false)
    if (error || !data) {
      setExportError('Could not prepare the export. Please try again.')
      return
    }
    downloadCsv(
      'zerobyte-expenses.csv',
      ['Expense', 'Category', 'Date', 'Amount'],
      data.map((row) => [row.title, row.category, row.expense_date, row.amount]),
    )
  }
  const rows = list.rows
  const count = totals?.count ?? list.total ?? rows.length
  return (
    <section className="panel table-panel records-panel">
      <RecordFilters storageKey="zerobyte.records.expenses" onChange={applyDates} />
      <div className="panel-heading">
        <div>
          <span className="section-label">Operating history</span>
          <h2>
            {count.toLocaleString('en-NG')} expense{count === 1 ? '' : 's'}
          </h2>
        </div>
        <div className="record-actions">
          <span className="record-count">
            Total {money(totals?.total ?? rows.reduce((sum, row) => sum + Number(row.amount), 0))}
          </span>
          <button className="secondary" onClick={() => void exportAll()} disabled={!count || exporting}>
            {exporting ? 'Preparing export…' : 'Export CSV'}
          </button>
        </div>
      </div>
      {(list.error || exportError) && (
        <div className="form-error">{list.error ? 'Expense records are temporarily unavailable.' : exportError}</div>
      )}
      {list.loading ? (
        <TableSkeleton />
      ) : rows.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.title}</strong>
                    </td>
                    <td>{row.category}</td>
                    <td>{row.expense_date}</td>
                    <td className="amount">{money(Number(row.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMoreBar
            shown={rows.length}
            total={list.total}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            onMore={() => void list.loadMore()}
            noun="expenses"
          />
        </>
      ) : (
        <EmptyInline title="No expense records yet" text="Expenses you add from the Expenses page will appear here." />
      )}
    </section>
  )
}

type StockRecord = {
  id: string
  product_id: string
  quantity: number
  movement_type: string
  created_at: string
  products?: { name: string } | { name: string }[] | null
}
const stockName = (row: StockRecord) =>
  (Array.isArray(row.products) ? row.products[0]?.name : row.products?.name) || 'Product'
function StockRecords({ orgId }: { orgId: string }) {
  const [dates, setDates] = useState<Dates>({ from: '', to: '' })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const applyDates = useCallback((next: Dates) => setDates(next), [])
  const query = (from: number, to: number, count?: 'estimated') => {
    let request = supabase!
      .from('stock_movements')
      .select('id,product_id,quantity,movement_type,created_at,products(name)', { count })
      .eq('organization_id', orgId)
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .order('id')
    if (dates.from) request = request.gte('created_at', dayStart(dates.from))
    if (dates.to) request = request.lte('created_at', dayEnd(dates.to))
    return request.range(from, to)
  }
  const list = usePagedList<StockRecord>({
    deps: [orgId, dates.from, dates.to],
    fetchPage: async ({ from, to }, _term, first) =>
      supabase
        ? ((await query(from, to, first ? 'estimated' : undefined)) as unknown as {
            data: StockRecord[] | null
            error: { message: string } | null
            count: number | null
          })
        : { data: [], error: null },
  })
  const totals = useRecordTotals(orgId, 'stock', dates, list.total)
  async function exportAll() {
    setExporting(true)
    setExportError('')
    const { data, error } = await loadAllRows<StockRecord>(
      (from, to) =>
        query(from, to) as unknown as PromiseLike<{ data: StockRecord[] | null; error: { message: string } | null }>,
    )
    setExporting(false)
    if (error || !data) {
      setExportError('Could not prepare the export. Please try again.')
      return
    }
    downloadCsv(
      'zerobyte-stock-intake.csv',
      ['Product', 'Movement', 'Quantity', 'Date'],
      data.map((row) => [stockName(row), row.movement_type, row.quantity, row.created_at]),
    )
  }
  const rows = list.rows
  const count = totals?.count ?? list.total ?? rows.length
  return (
    <section className="panel table-panel records-panel">
      <RecordFilters storageKey="zerobyte.records.stock" onChange={applyDates} />
      <div className="panel-heading">
        <div>
          <span className="section-label">Inventory history</span>
          <h2>
            {count.toLocaleString('en-NG')} intake record{count === 1 ? '' : 's'}
          </h2>
        </div>
        <div className="record-actions">
          <span className="record-count">
            {(totals?.total ?? rows.reduce((sum, row) => sum + Number(row.quantity), 0)).toLocaleString('en-NG')} units
            received
          </span>
          <button className="secondary" onClick={() => void exportAll()} disabled={!count || exporting}>
            {exporting ? 'Preparing export…' : 'Export CSV'}
          </button>
        </div>
      </div>
      {(list.error || exportError) && (
        <div className="form-error">{list.error ? 'Stock records are temporarily unavailable.' : exportError}</div>
      )}
      {list.loading ? (
        <TableSkeleton />
      ) : rows.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Movement</th>
                  <th>Quantity</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{stockName(row)}</td>
                    <td>
                      <span className="status completed">{row.movement_type}</span>
                    </td>
                    <td className="stock-low">+{row.quantity}</td>
                    <td>{new Date(row.created_at).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMoreBar
            shown={rows.length}
            total={list.total}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            onMore={() => void list.loadMore()}
            noun="records"
          />
        </>
      ) : (
        <EmptyInline
          title="No stock-intake records yet"
          text="Stock you receive from the Inventory page will appear here."
        />
      )}
    </section>
  )
}
