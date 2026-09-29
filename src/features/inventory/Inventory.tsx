import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, PageIntro, TableSkeleton } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { type ProductRow } from '../../lib/types'

export function Inventory({ orgId, search }: { orgId: string; search: string }) {
  const [rows, setRows] = useState<ProductRow[]>([]); const [form, setForm] = useState({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }); const [receive, setReceive] = useState({ productId: '', quantity: '', cost: '', selling: '' }); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState('')
  const [movements, setMovements] = useState<{ id: string; product_id: string; movement_type: string; quantity: number; created_at: string }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]); const [transferBusyId, setTransferBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => { if (!supabase) return; Promise.all([supabase.from('products').select('id,name,sku,stock,price,cost_price,category,reorder_point,branch_id').eq('organization_id', orgId).order('created_at', { ascending: false }), supabase.from('stock_movements').select('id,product_id,movement_type,quantity,created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20), supabase.from('branches').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name')]).then(([productResult, movementResult, branchResult]) => { setRows((productResult.data ?? []) as ProductRow[]); setMovements(movementResult.data ?? []); setBranches(branchResult.data ?? []); setLoading(false) }) }, [orgId])
  useEffect(() => { load() }, [load])
  async function transferBranch(productId: string, destinationBranchId: string) {
    if (!supabase) return
    setTransferBusyId(productId)
    const { error: result } = await supabase.rpc('transfer_product_branch', { target_org: orgId, target_product: productId, destination_branch: destinationBranchId || null })
    if (result) setError(result.message)
    else load()
    setTransferBusyId(null)
  }
  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    const openingStock = Number(form.stock)
    const reorderPoint = Math.max(0, Number(form.reorderPoint) || 0)
    const payload = { name: form.name, sku: form.sku, category: form.category || 'Uncategorized', price: Number(form.price) }
    if (editing) {
      const result = await supabase.rpc('update_product_catalog', {
        target_org: orgId,
        target_product: editing,
        product_name: payload.name,
        product_sku: payload.sku,
        product_category: payload.category,
        selling_price: payload.price,
        target_reorder_point: reorderPoint,
      })
      if (result.error) setError(result.error.code === '23505' ? 'That SKU is already in use in this workspace.' : result.error.message)
      else { setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }); setEditing(null); load() }
      return
    }
    const result = await supabase.from('products').insert({ organization_id: orgId, ...payload, cost_price: Number(form.cost), stock: 0, reorder_point: reorderPoint }).select('id').single()
    if (result.error || !result.data) {
      setError(result.error?.code === '23505' ? 'That SKU is already in use in this workspace.' : result.error?.message ?? 'Could not create the product.')
      return
    }
    if (openingStock > 0) {
      const movement = await supabase.rpc('initialize_stock', { target_org: orgId, target_product: result.data.id, opening_quantity: openingStock })
      if (movement.error) { setError(movement.error.message); return }
    }
    setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }); load()
  }
  async function remove(id: string) { if (!supabase || !window.confirm('Delete this product? This cannot be undone.')) return; const { error: result } = await supabase.from('products').delete().eq('id', id).eq('organization_id', orgId); if (result) setError(result.message); else load() }
  async function receiveStock(event: React.FormEvent) { event.preventDefault(); if (!navigator.onLine) { setError('Inventory receiving is online-only. Reconnect before adding stock.'); return } if (!supabase) return; const { error: result } = await supabase.rpc('receive_stock', { target_org: orgId, target_product: receive.productId, quantity_to_add: Number(receive.quantity), new_cost: receive.cost ? Number(receive.cost) : null, new_selling: receive.selling ? Number(receive.selling) : null, target_branch: null }); if (result) setError(result.message); else { setReceive({ productId: '', quantity: '', cost: '', selling: '' }); load() } }
  function edit(row: ProductRow) { setEditing(row.id); setForm({ name: row.name, sku: row.sku, category: row.category ?? '', price: String(row.price), cost: String(row.cost_price ?? 0), stock: String(row.stock), reorderPoint: String(row.reorder_point ?? 5) }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const filtered = rows.filter((row) => `${row.name} ${row.sku} ${row.category}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page"><PageIntro label="Inventory" title="Know what is in stock." description="Edit product details, receive new stock through a server transaction, and keep a traceable catalog." /><form className="panel record-form inventory-product-form" onSubmit={add}><label>Product name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 5kg Rice" /></label><label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="RICE-005" /></label><label>Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Groceries" /></label><label>Cost price<input required type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="₦0.00" /></label><label>Selling price<input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="₦0.00" /></label><label>{editing ? 'Current stock (read-only)' : 'Opening stock'}<input required type="number" min="0" readOnly={Boolean(editing)} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" /></label><label>Reorder alert level<input required type="number" min="0" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} placeholder="5" /><small className="field-help">You'll be notified when stock falls to or below this level.</small></label><button className="primary"><Plus size={16} /> {editing ? 'Save product' : 'Add product'}</button>{editing && <><small className="field-help form-wide">Cost price changes for existing products are made through Stock receiving so every change is recorded.</small><button type="button" className="secondary" onClick={() => { setEditing(null); setForm({ name: '', sku: '', category: '', price: '', cost: '', stock: '', reorderPoint: '5' }) }}>Cancel</button></>}{error && <div className="form-error">{error}</div>}</form><form className="panel receive-form" onSubmit={receiveStock}><div className="receive-heading"><span className="section-label">Stock receiving · Online only</span><h2>Add stock without duplicating the product</h2><p>Stock receiving needs a live server transaction. Reconnect before receiving inventory.</p></div><label>Product<select required value={receive.productId} onChange={(e) => setReceive({ ...receive, productId: e.target.value })}><option value="">Choose product</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.stock} units</option>)}</select></label><label>Quantity<input required type="number" min="1" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} /></label><label>New cost (optional)<input type="number" min="0" step="0.01" value={receive.cost} onChange={(e) => setReceive({ ...receive, cost: e.target.value })} placeholder="Keep current" /></label><label>New selling price (optional)<input type="number" min="0" step="0.01" value={receive.selling} onChange={(e) => setReceive({ ...receive, selling: e.target.value })} placeholder="Keep current" /></label><button className="secondary" disabled={!navigator.onLine}>Receive stock</button></form><section className="panel table-panel catalog-panel"><div className="panel-heading"><div><span className="section-label">Your catalog</span><h2>{rows.length} product{rows.length === 1 ? '' : 's'}</h2></div></div>{loading ? <TableSkeleton /> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Cost price</th><th>Selling price</th>{branches.length > 0 && <th>Branch</th>}<th>Actions</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td className="mono">{row.sku}</td><td>{row.category}</td><td className={row.stock <= (row.reorder_point ?? 5) ? 'warning-text' : ''}>{row.stock}</td><td className="amount">₦{Number(row.cost_price).toLocaleString('en-NG')}</td><td className="amount">₦{Number(row.price).toLocaleString('en-NG')}</td>{branches.length > 0 && <td><select value={row.branch_id ?? ''} disabled={transferBusyId === row.id} onChange={(e) => transferBranch(row.id, e.target.value)}><option value="">Shared (all branches)</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></td>}<td><button type="button" className="text-btn" onClick={() => edit(row)}>Edit</button><button type="button" className="text-btn danger-text" onClick={() => remove(row.id)}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyInline title="No products yet" text="Add your first product above. It will become available to sales and stock workflows." />}</section><section className="panel table-panel stock-history"><div className="panel-heading"><div><span className="section-label">Stock history</span><h2>Recent movements</h2></div></div>{loading ? <TableSkeleton rows={3} /> : movements.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Movement</th><th>Quantity</th><th>Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{rows.find((row) => row.id === movement.product_id)?.name || 'Product'}</td><td><span className="status completed">{movement.movement_type}</span></td><td className={movement.quantity < 0 ? 'danger-text' : 'stock-low'}>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td><td>{new Date(movement.created_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div> : <EmptyInline title="No stock movements yet" text="Receiving stock and completing sales will create an auditable history here." />}</section></div>
}
