import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PageIntro } from '../../components/ui'
import {
  type OfflineScope,
  clearSaleDraft,
  enqueueOfflineOperation,
  newOfflineOperationId,
  readSaleDraft,
  readScopedCache,
  saveSaleDraft,
  writeScopedCache,
} from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { type CustomerRow, type ProductRow } from '../../lib/types'
import { loadAllRows } from '../../lib/paging'

// Sentinel for "no registered customer". It is never sent to the server: the sale is saved with a NULL customer_id.
const WALK_IN = 'walk-in'

// Seven choices read better as tiles with an icon than as a dropdown: one tap, and the choice stays visible.
const PAYMENT_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'credit', label: 'On credit' },
  { value: 'mixed', label: 'Split payment' },
  { value: 'other', label: 'Other' },
]

export function Sales({ orgId, scope }: { orgId: string; scope: OfflineScope | null }) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [customers, setCustomers] = useState<(CustomerRow & { pending?: boolean })[]>([])
  const [selected, setSelected] = useState('')
  const [customer, setCustomer] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [cart, setCart] = useState<{ product_id: string; quantity: number }[]>([])
  const [message, setMessage] = useState('')
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [discount, setDiscount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const operationRef = useRef<ReturnType<typeof newOfflineOperationId> | null>(null)
  // A new cart/customer/discount/payment is a new sale, so it gets a new operation id.
  useEffect(() => {
    operationRef.current = null
  }, [cart, customer, discount, paymentMethod])
  useEffect(() => {
    if (!scope) return
    setDraftLoaded(false)
    let active = true
    // The device copy can finish reading after the live lists arrive; it must never replace them.
    let liveListsArrived = false
    void Promise.all([
      readScopedCache<ProductRow>(scope, 'products'),
      readScopedCache<CustomerRow & { pending?: boolean }>(scope, 'customers'),
      readSaleDraft(scope),
    ]).then(([cachedProducts, cachedCustomers, draft]) => {
      if (!active) return
      if (!liveListsArrived) {
        setProducts(cachedProducts)
        setCustomers(cachedCustomers)
      }
      if (draft) {
        setCart(draft.cart)
        setCustomer(draft.customer)
      }
      setDraftLoaded(true)
    })
    if (!supabase || !navigator.onLine)
      return () => {
        active = false
      }
    // The sale screen needs the whole catalogue on the device (it also powers offline selling), so it reads it in
    // 1,000-row chunks rather than one request that the API would silently cut off at 1,000 rows.
    const client = supabase
    void Promise.all([
      loadAllRows((from, to) =>
        client
          .from('products')
          .select('id,name,sku,stock,price,cost_price')
          .eq('organization_id', orgId)
          .gt('stock', 0)
          .order('name')
          .order('id')
          .range(from, to),
      ),
      loadAllRows((from, to) =>
        client
          .from('customers')
          .select('id,name,email,phone')
          .eq('organization_id', orgId)
          .order('name')
          .order('id')
          .range(from, to),
      ),
    ]).then(async ([productResult, customerResult]) => {
      if (!active) return
      liveListsArrived = true
      if (!productResult.error && productResult.data) {
        setProducts(productResult.data)
        await writeScopedCache(scope, 'products', productResult.data)
      }
      if (!customerResult.error && customerResult.data) {
        setCustomers(customerResult.data)
        await writeScopedCache(scope, 'customers', customerResult.data)
      }
    })
    return () => {
      active = false
    }
  }, [orgId, scope])
  useEffect(() => {
    if (scope && draftLoaded) void saveSaleDraft(scope, { cart, customer })
  }, [cart, customer, draftLoaded, scope])
  useEffect(() => {
    if (draftLoaded && !customer) setCustomer(WALK_IN)
  }, [draftLoaded, customer])
  const selectedCustomer = customers.find((row) => row.id === customer)
  const customerReady = Boolean(customer) && !selectedCustomer?.pending
  // 'On credit' adds to a registered customer's running balance, so it cannot be used without one.
  const creditNeedsCustomer = paymentMethod === 'credit' && customer === WALK_IN
  function addToCart() {
    if (!customerReady) {
      setMessage('Choose a customer before adding items.')
      return
    }
    const item = products.find((product) => product.id === selected && product.stock > 0)
    const count = Number(quantity)
    if (!item) return
    if (count < 1 || count > item.stock) {
      setMessage(`Only ${item.stock} units are available.`)
      return
    }
    setCart((current) => {
      const existing = current.find((line) => line.product_id === item.id)
      return existing
        ? current.map((line) =>
            line.product_id === item.id ? { ...line, quantity: Math.min(item.stock, line.quantity + count) } : line,
          )
        : [...current, { product_id: item.id, quantity: count }]
    })
    setSelected('')
    setQuantity('1')
    setMessage('Item added to sale.')
  }
  function chooseCustomer(value: string) {
    setCustomer(value)
    setMessage('')
  }
  async function complete(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return
    if (!customerReady) {
      setMessage('Choose a customer, or Walk-in customer, before completing the sale.')
      return
    }
    if (creditNeedsCustomer) {
      setMessage('Credit sales need a registered customer. Choose a customer or change the payment method.')
      return
    }
    if (!supabase || !scope || !cart.length) return
    submittingRef.current = true
    setSubmitting(true)
    // One operation id per sale attempt. Retries and the offline queue reuse it, so a
    // double-tap or a request that succeeded but lost its response can never record the sale twice.
    const operationId = operationRef.current ?? newOfflineOperationId()
    operationRef.current = operationId
    const discountAmount = Math.min(Math.max(Number(discount) || 0, 0), total)
    const payload = {
      target_org: orgId,
      target_customer: customer === WALK_IN ? null : customer,
      items: cart,
      target_branch: null,
      target_payment_method: paymentMethod,
      discount_amount: discountAmount,
    }
    const finish = async (text: string) => {
      const nextProducts = products.map((product) => {
        const line = cart.find((entry) => entry.product_id === product.id)
        return line ? { ...product, stock: product.stock - line.quantity } : product
      })
      setProducts(nextProducts)
      await writeScopedCache(scope, 'products', nextProducts)
      setCart([])
      setCustomer('')
      setPaymentMethod('cash')
      setDiscount('')
      await clearSaleDraft(scope)
      operationRef.current = null
      setMessage(text)
    }
    try {
      if (!navigator.onLine) {
        await enqueueOfflineOperation(scope, 'sale', payload, operationId)
        await finish(
          'Sale saved offline. It will sync when you reconnect and the server will re-check stock and totals.',
        )
        return
      }
      const { error } = await supabase.rpc('create_sale_with_operation', { ...payload, operation_id: operationId })
      if (!error) {
        await finish('Sale completed and stock updated.')
        return
      }
      if (/network|fetch|offline|failed to send/i.test(error.message)) {
        await enqueueOfflineOperation(scope, 'sale', payload, operationId)
        await finish('Connection lost. Sale saved offline and will sync automatically.')
        return
      }
      setMessage(error.message)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  const total = cart.reduce(
    (sum, line) => sum + (products.find((product) => product.id === line.product_id)?.price ?? 0) * line.quantity,
    0,
  )
  const netTotal = Math.max(0, total - (Number(discount) || 0))
  return (
    <div className="page sales-page">
      <PageIntro label="Sales" description="Record a sale in a few taps. Your draft is saved if you leave." />
      <form className="sale-layout" onSubmit={complete}>
        <div className="sale-main">
          <section className="panel sale-card" aria-labelledby="sale-customer-heading">
            <h2 id="sale-customer-heading">Who is this sale for?</h2>
            <label htmlFor="sale-customer">
              Customer
              <select id="sale-customer" value={customer} onChange={(e) => chooseCustomer(e.target.value)}>
                <option value={WALK_IN}>Walk-in customer</option>
                {customers
                  .filter((row) => !row.pending)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
            {selectedCustomer?.pending && (
              <p className="field-help">This customer is still syncing. Choose another customer or wait a moment.</p>
            )}
          </section>

          <section className="panel sale-card" aria-labelledby="sale-items-heading">
            <h2 id="sale-items-heading">Add products</h2>
            <div className="sale-add-row">
              <label>
                Product
                <select value={selected} disabled={!customerReady} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">Choose product</option>
                  {products
                    .filter((product) => product.stock > 0)
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {product.stock} available
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  disabled={!customerReady}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              <button type="button" className="secondary" disabled={!selected || !customerReady} onClick={addToCart}>
                <Plus size={16} /> Add to sale
              </button>
            </div>
            {cart.length > 0 && (
              <ul className="sale-cart" aria-label="Items in this sale">
                {cart.map((line) => {
                  const product = products.find((entry) => entry.id === line.product_id)
                  const price = Number(product?.price ?? 0)
                  return (
                    <li className="sale-cart-row" key={line.product_id}>
                      <div>
                        <strong>
                          {product?.name} ×{line.quantity}
                        </strong>
                        <small>₦{price.toLocaleString('en-NG')} each</small>
                      </div>
                      <strong className="sale-line-total">₦{(price * line.quantity).toLocaleString('en-NG')}</strong>
                      <button
                        type="button"
                        className="sale-remove"
                        aria-label={`Remove ${product?.name ?? 'item'}`}
                        onClick={() => setCart((current) => current.filter((entry) => entry.product_id !== line.product_id))}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="panel sale-summary" aria-labelledby="sale-summary-heading">
          <h2 id="sale-summary-heading">Sale summary</h2>
          <label htmlFor="sale-discount">
            Discount (optional)
            <input
              id="sale-discount"
              type="number"
              min="0"
              max={total}
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="₦0.00"
            />
          </label>
          <fieldset className="pay-options" role="radiogroup" aria-label="Payment method">
            <legend>Payment method</legend>
            {PAYMENT_OPTIONS.map((option) => (
              <label key={option.value} className={`pay-option${paymentMethod === option.value ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="sale-payment-method"
                  value={option.value}
                  checked={paymentMethod === option.value}
                  onChange={() => setPaymentMethod(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          {paymentMethod === 'credit' && (
            <small className="field-help">
              {customer === WALK_IN
                ? 'Credit sales need a registered customer. Choose one, or change the payment method.'
                : "This sale will be added to the customer's running balance on the Customers page."}
            </small>
          )}
          {Number(discount) > 0 && (
            <div className="sale-total">
              <span>Subtotal</span>
              <strong>₦{total.toLocaleString('en-NG')}</strong>
            </div>
          )}
          {Number(discount) > 0 && (
            <div className="sale-total">
              <span>Discount</span>
              <strong>-₦{Math.min(Number(discount), total).toLocaleString('en-NG')}</strong>
            </div>
          )}
          <div className="sale-total sale-total-grand">
            <span>Total</span>
            <strong>₦{netTotal.toLocaleString('en-NG')}</strong>
          </div>
          {message && (
            <div className="form-success" role="status" aria-live="polite">
              {message}
            </div>
          )}
          <button
            className="primary"
            disabled={!cart.length || !customerReady || submitting || creditNeedsCustomer}
            aria-busy={submitting}
          >
            {submitting ? 'Completing…' : 'Complete sale'}
          </button>
        </aside>
      </form>
    </div>
  )
}
