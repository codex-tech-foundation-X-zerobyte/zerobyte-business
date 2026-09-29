import { Package, ShoppingCart, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, PageIntro, RecordFilters, TableSkeleton } from '../../components/ui'
import { downloadCsv } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { type ProductRow, type RecordTab } from '../../lib/types'

export function Records({ orgId, search }: { orgId: string; search: string }) {
  const [tab, setTab] = useState<RecordTab>('sales')
  const tabs: { id: RecordTab; label: string; icon: typeof ShoppingCart }[] = [
    { id: 'sales', label: 'Sales records', icon: ShoppingCart },
    { id: 'expenses', label: 'Expenses', icon: Wallet },
    { id: 'stock', label: 'Stock intake', icon: Package },
  ]
  return <div className="page"><PageIntro label="Records" title="Keep the paper trail together." description="Review completed sales, operating expenses, and stock received from one focused workspace. Use Sales, Expenses, or Inventory when you need to add a new record." /><div className="record-tabs" role="tablist" aria-label="Business records">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'record-tab active' : 'record-tab'} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</div>{tab === 'sales' ? <SalesRecords orgId={orgId} search={search} /> : tab === 'expenses' ? <ExpenseRecords orgId={orgId} /> : <StockRecords orgId={orgId} />}</div>
}

function SalesRecords({ orgId, search }: { orgId: string; search: string }) {
  const [rows, setRows] = useState<{ id: string; customer_id: string | null; total: number; status: string; created_at: string; customer?: { name: string }[] | null; items?: { quantity: number; unit_price: number; products?: { name: string; sku: string } | { name: string; sku: string }[] | null }[] }[]>([])
  const [error, setError] = useState(''); const [dates, setDates] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const applyDates = useCallback((next: { from: string; to: string }) => setDates(next), [])
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    let query = supabase.from('sales').select('id,customer_id,total,status,created_at,customer:customers(name),items:sale_items(quantity,unit_price,products(name,sku))').eq('organization_id', orgId).order('created_at', { ascending: false })
    if (dates.from) query = query.gte('created_at', `${dates.from}T00:00:00.000Z`)
    if (dates.to) query = query.lte('created_at', `${dates.to}T23:59:59.999Z`)
    const { data, error: result } = await query
    if (result) setError('Sales records are temporarily unavailable.')
    else setRows((data ?? []) as typeof rows)
    setLoading(false)
  }, [dates, orgId])
  useEffect(() => { void load() }, [load])
  const customerName = (row: typeof rows[number]) => row.customer?.[0]?.name ?? 'Walk-in customer'
  const productName = (item: NonNullable<typeof rows[number]['items']>[number]) => Array.isArray(item.products) ? item.products[0]?.name ?? 'Product' : item.products?.name ?? 'Product'
  const itemSummary = (row: typeof rows[number]) => row.items?.length ? row.items.map((item) => `${productName(item)} × ${item.quantity}`).join(', ') : 'Item details unavailable'
  const filtered = rows.filter((row) => `${customerName(row)} ${itemSummary(row)} ${row.status} ${row.id}`.toLowerCase().includes(search.toLowerCase()))
  const total = filtered.reduce((sum, row) => sum + Number(row.total), 0)
  return <section className="panel table-panel records-panel"><RecordFilters storageKey="zerobyte.records.sales" onChange={applyDates} /><div className="panel-heading"><div><span className="section-label">Completed activity</span><h2>{filtered.length} sale{filtered.length === 1 ? '' : 's'}</h2></div><div className="record-actions"><span className="record-count">Total ₦{total.toLocaleString('en-NG')}</span><button className="secondary" onClick={() => downloadCsv('zerobyte-sales.csv', ['Sale', 'Customer', 'Items sold', 'Status', 'Date', 'Total'], filtered.map((row) => [row.id, customerName(row), itemSummary(row), row.status, row.created_at, row.total]))} disabled={!filtered.length}>Export CSV</button></div></div>{error && <div className="form-error">{error}</div>}{loading ? <TableSkeleton /> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>What was sold</th><th>Customer</th><th>Status</th><th>Date</th><th>Total</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong className="sale-record-items">{itemSummary(row)}</strong><small className="table-sub mono">Sale #{row.id.slice(0, 8)}</small></td><td>{customerName(row)}</td><td><span className="status completed">{row.status}</span></td><td>{new Date(row.created_at).toLocaleString('en-NG')}</td><td className="amount">₦{Number(row.total).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No sales records yet" text="Completed sales will appear here after you record them." />}</section>
}

function ExpenseRecords({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; title: string; category: string; amount: number; expense_date: string }[]>([])
  const [error, setError] = useState(''); const [dates, setDates] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const applyDates = useCallback((next: { from: string; to: string }) => setDates(next), [])
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    let query = supabase.from('expenses').select('id,title,category,amount,expense_date').eq('organization_id', orgId).order('expense_date', { ascending: false })
    if (dates.from) query = query.gte('expense_date', dates.from)
    if (dates.to) query = query.lte('expense_date', dates.to)
    const { data, error: result } = await query
    if (result) setError('Expense records are temporarily unavailable.')
    else setRows(data ?? [])
    setLoading(false)
  }, [dates, orgId])
  useEffect(() => { void load() }, [load])
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0)
  return <section className="panel table-panel records-panel"><RecordFilters storageKey="zerobyte.records.expenses" onChange={applyDates} /><div className="panel-heading"><div><span className="section-label">Operating history</span><h2>{rows.length} expense{rows.length === 1 ? '' : 's'}</h2></div><div className="record-actions"><span className="record-count">Total ₦{total.toLocaleString('en-NG')}</span><button className="secondary" onClick={() => downloadCsv('zerobyte-expenses.csv', ['Expense', 'Category', 'Date', 'Amount'], rows.map((row) => [row.title, row.category, row.expense_date, row.amount]))} disabled={!rows.length}>Export CSV</button></div></div>{error && <div className="form-error">{error}</div>}{loading ? <TableSkeleton /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong></td><td>{row.category}</td><td>{row.expense_date}</td><td className="amount">₦{Number(row.amount).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No expense records yet" text="Expenses you add from the Expenses page will appear here." />}</section>
}

function StockRecords({ orgId }: { orgId: string }) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [movements, setMovements] = useState<{ id: string; product_id: string; quantity: number; movement_type: string; created_at: string }[]>([])
  const [error, setError] = useState(''); const [dates, setDates] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const applyDates = useCallback((next: { from: string; to: string }) => setDates(next), [])
  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const [productResult, movementResult] = await Promise.all([
      supabase.from('products').select('id,name,sku,stock,price,cost_price').eq('organization_id', orgId).order('name'),
      (() => { let query = supabase.from('stock_movements').select('id,product_id,quantity,movement_type,created_at').eq('organization_id', orgId).gt('quantity', 0).order('created_at', { ascending: false }); if (dates.from) query = query.gte('created_at', `${dates.from}T00:00:00.000Z`); if (dates.to) query = query.lte('created_at', `${dates.to}T23:59:59.999Z`); return query })(),
    ])
    if (productResult.error || movementResult.error) setError('Stock records are temporarily unavailable.')
    setProducts(productResult.data ?? []); setMovements(movementResult.data ?? [])
    setLoading(false)
  }, [dates, orgId])
  useEffect(() => { void load() }, [load])
  const total = movements.reduce((sum, movement) => sum + Number(movement.quantity), 0)
  return <section className="panel table-panel records-panel"><RecordFilters storageKey="zerobyte.records.stock" onChange={applyDates} /><div className="panel-heading"><div><span className="section-label">Inventory history</span><h2>{movements.length} intake record{movements.length === 1 ? '' : 's'}</h2></div><div className="record-actions"><span className="record-count">{total} units received</span><button className="secondary" onClick={() => downloadCsv('zerobyte-stock-intake.csv', ['Product', 'Movement', 'Quantity', 'Date'], movements.map((movement) => [products.find((product) => product.id === movement.product_id)?.name || 'Product', movement.movement_type, movement.quantity, movement.created_at]))} disabled={!movements.length}>Export CSV</button></div></div>{error && <div className="form-error">{error}</div>}{loading ? <TableSkeleton /> : movements.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Movement</th><th>Quantity</th><th>Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{products.find((product) => product.id === movement.product_id)?.name || 'Product'}</td><td><span className="status completed">{movement.movement_type}</span></td><td className="stock-low">+{movement.quantity}</td><td>{new Date(movement.created_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No stock-intake records yet" text="Stock you receive from the Inventory page will appear here." />}</section>
}
