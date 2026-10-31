import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  EmptyInline,
  FormDisclosure,
  LoadMoreBar,
  PageIntro,
  type PickedProduct,
  ProductSearchSelect,
  TableSkeleton,
} from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { type PurchaseOrderRow, type SupplierRow } from '../../lib/types'

export function PurchaseOrders({ orgId }: { orgId: string }) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([])
  const [lineProduct, setLineProduct] = useState<PickedProduct | null>(null)
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const [moreOrders, setMoreOrders] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', email: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [supplierError, setSupplierError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [poForm, setPoForm] = useState({ supplierId: '', notes: '' })
  const [poItems, setPoItems] = useState<{ product_id: string; quantity: number; unit_cost: number }[]>([])
  const [poLine, setPoLine] = useState({ productId: '', quantity: '1', unitCost: '' })
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('suppliers').select('id,name,phone,email').eq('organization_id', orgId).order('name'),
      supabase
        .from('purchase_orders')
        .select('id,status,total_cost,notes,created_at,received_at,suppliers(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]).then(([supplierResult, poResult]) => {
      setSuppliers(supplierResult.data ?? [])
      setOrders((poResult.data ?? []) as unknown as PurchaseOrderRow[])
      setMoreOrders((poResult.data ?? []).length === 50)
      setLoading(false)
    })
  }, [orgId])
  useEffect(() => {
    load()
  }, [load])
  async function addSupplier(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !supplierForm.name.trim()) return
    const name = supplierForm.name.trim()
    // Stops the easy double-add: the form clears after saving, so people often add the same supplier twice.
    if (suppliers.some((supplier) => supplier.name.trim().toLowerCase() === name.toLowerCase())) {
      setNotice('')
      setSupplierError(`“${name}” is already in your supplier list.`)
      return
    }
    const { error: result } = await supabase
      .from('suppliers')
      .insert({
        organization_id: orgId,
        name: supplierForm.name.trim(),
        phone: supplierForm.phone || null,
        email: supplierForm.email || null,
      })
    if (result) {
      setNotice('')
      setSupplierError(result.message)
    } else {
      setSupplierError('')
      setNotice(`Supplier “${name}” added. You can now choose it when you create a purchase order.`)
      setSupplierForm({ name: '', phone: '', email: '' })
      load()
    }
  }
  function addLine() {
    if (!poLine.productId || Number(poLine.quantity) <= 0 || Number(poLine.unitCost) < 0) return
    setPoItems((current) => [
      ...current,
      { product_id: poLine.productId, quantity: Number(poLine.quantity), unit_cost: Number(poLine.unitCost) },
    ])
    if (lineProduct) setProductNames((current) => ({ ...current, [lineProduct.id]: lineProduct.name }))
    setLineProduct(null)
    setPoLine({ productId: '', quantity: '1', unitCost: '' })
  }
  async function createOrder(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !poForm.supplierId || !poItems.length) {
      setError('Choose a supplier and add at least one line item.')
      return
    }
    const { error: result } = await supabase.rpc('create_purchase_order', {
      target_org: orgId,
      target_supplier: poForm.supplierId,
      target_branch: null,
      items: poItems,
      po_notes: poForm.notes || null,
    })
    if (result) setError(result.message)
    else {
      setPoForm({ supplierId: '', notes: '' })
      setPoItems([])
      load()
    }
  }
  async function loadMoreOrders() {
    if (!supabase || loadingOrders) return
    setLoadingOrders(true)
    const { data, error: result } = await supabase
      .from('purchase_orders')
      .select('id,status,total_cost,notes,created_at,received_at,suppliers(name)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .range(orders.length, orders.length + 49)
    if (result) setError(result.message)
    else {
      setOrders((current) => [...current, ...((data ?? []) as unknown as PurchaseOrderRow[])])
      setMoreOrders((data ?? []).length === 50)
    }
    setLoadingOrders(false)
  }
  async function receiveOrder(id: string) {
    if (!supabase || !window.confirm('Receive this purchase order? Stock and cost prices will update immediately.'))
      return
    setBusyId(id)
    const { error: result } = await supabase.rpc('receive_purchase_order', { target_org: orgId, target_po: id })
    if (result) setError(result.message)
    else load()
    setBusyId(null)
  }
  async function cancelOrder(id: string) {
    if (!supabase || !window.confirm('Cancel this purchase order?')) return
    setBusyId(id)
    const { error: result } = await supabase.rpc('cancel_purchase_order', { target_org: orgId, target_po: id })
    if (result) setError(result.message)
    else load()
    setBusyId(null)
  }
  const poTotal = poItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  return (
    <div className="page">
      <PageIntro
        label="Purchase Orders"
        title="Reorder stock from your suppliers."
        description="Order, receive, restock."
      />
      <FormDisclosure label="Add supplier">
        <form className="panel record-form" onSubmit={addSupplier}>
          <div className="section-label form-wide">Add a supplier</div>
          <label>
            Supplier name
            <input
              required
              value={supplierForm.name}
              onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              placeholder="e.g. Lagos Foods Distributors"
            />
          </label>
          <label>
            Phone
            <input
              value={supplierForm.phone}
              onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
              placeholder="080..."
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={supplierForm.email}
              onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              placeholder="orders@supplier.com"
            />
          </label>
          <button className="primary">
            <Plus size={16} /> Add supplier
          </button>
          {supplierError && <div className="form-error form-wide">{supplierError}</div>}
          {notice && (
            <div className="form-success form-wide" role="status">
              {notice}
            </div>
          )}
        </form>
      </FormDisclosure>
      <FormDisclosure featured label="New purchase order">
        <form className="panel record-form" onSubmit={createOrder}>
          <div className="section-label form-wide">New purchase order</div>
          <label>
            Supplier
            <select
              required
              value={poForm.supplierId}
              onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}
            >
              <option value="">Choose supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes (optional)
            <input
              value={poForm.notes}
              onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
              placeholder="Delivery week, PO reference…"
            />
          </label>
          <div className="form-wide sale-add-row po-add-row">
            <ProductSearchSelect
              orgId={orgId}
              value={lineProduct}
              onChange={(product) => {
                setLineProduct(product)
                setPoLine({
                  ...poLine,
                  productId: product?.id ?? '',
                  unitCost: product?.cost_price != null ? String(product.cost_price) : poLine.unitCost,
                })
              }}
            />
            <input
              type="number"
              min="1"
              value={poLine.quantity}
              onChange={(e) => setPoLine({ ...poLine, quantity: e.target.value })}
              placeholder="Qty"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={poLine.unitCost}
              onChange={(e) => setPoLine({ ...poLine, unitCost: e.target.value })}
              placeholder="Unit cost"
            />
            <button type="button" className="secondary" onClick={addLine}>
              Add line
            </button>
          </div>
          {poItems.length > 0 && (
            <div className="form-wide sale-cart">
              {poItems.map((item, index) => {
                return (
                  <div className="sale-cart-row" key={index}>
                    <div>
                      <strong>{productNames[item.product_id] ?? 'Product'}</strong>
                      <small>
                        {item.quantity} × ₦{item.unit_cost.toLocaleString('en-NG')}
                      </small>
                    </div>
                    <strong>₦{(item.quantity * item.unit_cost).toLocaleString('en-NG')}</strong>
                    <button
                      type="button"
                      className="text-btn danger-text"
                      onClick={() => setPoItems((current) => current.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
              <div className="sale-total">
                <span>Order total</span>
                <strong>₦{poTotal.toLocaleString('en-NG')}</strong>
              </div>
            </div>
          )}
          <button className="primary">
            <Plus size={16} /> Create purchase order
          </button>
          {error && <div className="form-error form-wide">{error}</div>}
        </form>
      </FormDisclosure>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="section-label">Purchase orders</span>
            <h2>
              {orders.length} order{orders.length === 1 ? '' : 's'}
            </h2>
          </div>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : orders.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th>Total cost</th>
                    <th>Placed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.suppliers?.name ?? 'Supplier'}</strong>
                        {order.notes && <small className="field-help">{order.notes}</small>}
                      </td>
                      <td>
                        <span
                          className={`status ${order.status === 'received' ? 'completed' : order.status === 'cancelled' ? 'danger-text' : ''}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="amount">₦{Number(order.total_cost).toLocaleString('en-NG')}</td>
                      <td>{new Date(order.created_at).toLocaleDateString('en-NG')}</td>
                      <td>
                        {order.status === 'ordered' && (
                          <>
                            <button
                              type="button"
                              className="text-btn"
                              disabled={busyId === order.id}
                              onClick={() => receiveOrder(order.id)}
                            >
                              Receive
                            </button>
                            <button
                              type="button"
                              className="text-btn danger-text"
                              disabled={busyId === order.id}
                              onClick={() => cancelOrder(order.id)}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LoadMoreBar
              shown={orders.length}
              hasMore={moreOrders}
              loading={loadingOrders}
              onMore={() => void loadMoreOrders()}
              noun="purchase orders"
            />
          </>
        ) : (
          <EmptyInline
            title="No purchase orders yet"
            text="Order stock from a supplier, then receive it straight into Inventory."
            action="New purchase order"
          />
        )}
      </section>
      <section className="panel supplier-list" aria-labelledby="supplier-list-heading">
        <h2 id="supplier-list-heading">Suppliers</h2>
        {suppliers.length === 0 ? (
          <p className="muted">No suppliers yet. Add one to start ordering stock.</p>
        ) : (
          <ul>
            {suppliers.map((supplier) => (
              <li key={supplier.id}>
                <strong>{supplier.name}</strong>
                <span>{[supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
