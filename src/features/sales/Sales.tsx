import { ArrowRight, Check, Plus, UserRound, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageIntro } from '../../components/ui'
import { type OfflineScope, clearSaleDraft, enqueueOfflineOperation, readSaleDraft, readScopedCache, saveSaleDraft, writeScopedCache } from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { type CustomerRow, type ProductRow } from '../../lib/types'

export function Sales({ orgId, scope }: { orgId: string; scope: OfflineScope | null }) {
  const [products, setProducts] = useState<ProductRow[]>([]); const [customers, setCustomers] = useState<(CustomerRow & { pending?: boolean })[]>([]); const [selected, setSelected] = useState(''); const [customer, setCustomer] = useState(''); const [quantity, setQuantity] = useState('1'); const [cart, setCart] = useState<{ product_id: string; quantity: number }[]>([]); const [message, setMessage] = useState(''); const [draftLoaded, setDraftLoaded] = useState(false); const [paymentMethod, setPaymentMethod] = useState('cash'); const [discount, setDiscount] = useState('')
  useEffect(() => {
    if (!scope) return
    setDraftLoaded(false)
    let active = true
    void Promise.all([readScopedCache<ProductRow>(scope, 'products'), readScopedCache<CustomerRow & { pending?: boolean }>(scope, 'customers'), readSaleDraft(scope)]).then(([cachedProducts, cachedCustomers, draft]) => {
      if (!active) return
      setProducts(cachedProducts); setCustomers(cachedCustomers); if (draft) { setCart(draft.cart); setCustomer(draft.customer) }; setDraftLoaded(true)
    })
    if (!supabase || !navigator.onLine) return () => { active = false }
    void Promise.all([supabase.from('products').select('id,name,sku,stock,price,cost_price').eq('organization_id', orgId).gt('stock', 0).order('name'), supabase.from('customers').select('id,name,email,phone').eq('organization_id', orgId).order('name')]).then(async ([productResult, customerResult]) => {
      if (!active) return
      if (!productResult.error && productResult.data) { setProducts(productResult.data); await writeScopedCache(scope, 'products', productResult.data) }
      if (!customerResult.error && customerResult.data) { setCustomers(customerResult.data); await writeScopedCache(scope, 'customers', customerResult.data) }
    })
    return () => { active = false }
  }, [orgId, scope])
  useEffect(() => { if (scope && draftLoaded) void saveSaleDraft(scope, { cart, customer }) }, [cart, customer, draftLoaded, scope])
  const selectedCustomer = customers.find((row) => row.id === customer)
  const customerReady = Boolean(customer) && !selectedCustomer?.pending
  const customerName = selectedCustomer?.name ?? 'Selected customer'
  function addToCart() {
    if (!customerReady) {
      setMessage('Choose a customer before adding items.')
      return
    }
    const item = products.find((product) => product.id === selected && product.stock > 0)
    const count = Number(quantity)
    if (!item) return
    if (count < 1 || count > item.stock) { setMessage(`Only ${item.stock} units are available.`); return }
    setCart((current) => {
      const existing = current.find((line) => line.product_id === item.id)
      return existing ? current.map((line) => line.product_id === item.id ? { ...line, quantity: Math.min(item.stock, line.quantity + count) } : line) : [...current, { product_id: item.id, quantity: count }]
    })
    setSelected('')
    setQuantity('1')
    setMessage('Item added to sale.')
  }
  function chooseCustomer(value: string) {
    setCustomer(value)
    setMessage(value ? 'Customer selected. Add products to this sale.' : '')
  }
  function changeCustomer() {
    if (cart.length && !window.confirm('Changing the customer will clear every item in this sale. Continue?')) return
    setCustomer('')
    setSelected('')
    setQuantity('1')
    setCart([])
    setPaymentMethod('cash'); setDiscount('')
    setMessage('Sale cleared. Choose a customer to begin again.')
  }
  async function complete(event: React.FormEvent) {
    event.preventDefault()
    if (!customerReady) { setMessage('Choose a customer before completing the sale.'); return }
    if (!supabase || !scope || !cart.length) return
    if (!navigator.onLine) {
      await enqueueOfflineOperation(scope, 'sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: paymentMethod })
      setMessage('Sale saved offline. It will sync when you reconnect and the server will re-check stock and totals.')
      const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product })
      setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts)
      setCart([]); setCustomer(''); setPaymentMethod('cash'); setDiscount(''); await clearSaleDraft(scope); return
    }
    const { error } = await supabase.rpc('create_sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: paymentMethod, discount_amount: Number(discount) || 0 })
    if (error) {
      if (/network|fetch|offline|failed to send/i.test(error.message)) {
        await enqueueOfflineOperation(scope, 'sale', { target_org: orgId, target_customer: customer, items: cart, target_branch: null, target_payment_method: paymentMethod })
        setMessage('Connection lost. Sale saved offline and will sync automatically.')
        const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product })
        setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts); setCart([]); setCustomer(''); setPaymentMethod('cash'); setDiscount(''); await clearSaleDraft(scope)
      } else setMessage(error.message)
    } else { setMessage('Sale completed and stock updated.'); const nextProducts = products.map((product) => { const line = cart.find((entry) => entry.product_id === product.id); return line ? { ...product, stock: product.stock - line.quantity } : product }); setProducts(nextProducts); await writeScopedCache(scope, 'products', nextProducts); setCart([]); setCustomer(''); setPaymentMethod('cash'); setDiscount(''); await clearSaleDraft(scope) }
  }
  const total = cart.reduce((sum, line) => sum + (products.find((product) => product.id === line.product_id)?.price ?? 0) * line.quantity, 0)
  const netTotal = Math.max(0, total - (Number(discount) || 0))
  return <div className="page"><PageIntro label="Sales" title="Build the sale, then confirm." description="Choose the customer once, add as many products as you need, and keep the draft safe until you submit." /><section className="sales-layout"><form className="panel sale-form" onSubmit={complete}><section className="sale-customer-step" aria-labelledby="sale-customer-heading"><div className="sale-step-heading"><span className="sale-step-badge">1</span><div><span className="section-label">Customer first</span><h2 id="sale-customer-heading">Who is this sale for?</h2></div></div>{!customer ? <><label htmlFor="sale-customer">Customer (required)<select id="sale-customer" required value={customer} onChange={(e) => chooseCustomer(e.target.value)}><option value="">Choose a customer</option>{customers.filter((row) => !row.pending).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><p className="field-help">Select the customer once. Their name stays attached while you add multiple products.</p>{cart.length > 0 && <div className="sale-draft-note"><UserRound size={15} /><span>This saved draft has {cart.length} item{cart.length === 1 ? '' : 's'}. Choose a customer to continue.</span></div>}</> : <div className="sale-customer-lock"><div className="sale-customer-identity"><span className="sale-step-badge sale-step-badge-complete"><Check size={14} /></span><div><strong>{customerName}</strong><small>{selectedCustomer?.pending ? 'Still syncing — choose another customer' : 'Selected for this sale'}</small></div></div><button type="button" className="secondary" onClick={changeCustomer}><Users size={16} /> Change customer</button></div>}</section>{customer && <section className={`sale-items-step ${!customerReady ? 'sale-items-step-disabled' : ''}`} aria-labelledby="sale-items-heading"><div className="sale-step-heading"><span className="sale-step-badge">2</span><div><span className="section-label">Item cart</span><h2 id="sale-items-heading">Add products for {customerName}</h2></div></div><div className="sale-add-row"><label>Product<select value={selected} disabled={!customerReady} onChange={(e) => setSelected(e.target.value)}><option value="">Choose a product</option>{products.filter((product) => product.stock > 0).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock} available</option>)}</select></label><label>Quantity<input type="number" min="1" value={quantity} disabled={!customerReady} onChange={(e) => setQuantity(e.target.value)} /></label><button type="button" className="secondary" disabled={!selected || !customerReady} onClick={addToCart}><Plus size={16} /> Add item</button></div>{cart.length > 0 && <div className="sale-cart"><div className="section-label">Items in this sale</div>{cart.map((line) => { const product = products.find((entry) => entry.id === line.product_id); return <div className="sale-cart-row" key={line.product_id}><div><strong>{product?.name}</strong><small>{line.quantity} × ₦{Number(product?.price ?? 0).toLocaleString('en-NG')}</small></div><strong>₦{Number((product?.price ?? 0) * line.quantity).toLocaleString('en-NG')}</strong><button type="button" className="text-btn danger-text" onClick={() => setCart((current) => current.filter((entry) => entry.product_id !== line.product_id))}>Remove</button></div>})}</div>}<label htmlFor="sale-payment-method">Payment method<select id="sale-payment-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="mixed">Mixed / split payment</option><option value="credit">On credit (pay later)</option><option value="other">Other</option></select></label>{paymentMethod === 'credit' && <small className="field-help form-wide">This sale will be added to the customer's running balance on the Customers page.</small>}<label htmlFor="sale-discount">Discount (optional)<input id="sale-discount" type="number" min="0" max={total} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="₦0.00" /></label><div className="sale-total"><span>Subtotal</span><strong>₦{total.toLocaleString('en-NG')}</strong></div>{Number(discount) > 0 && <div className="sale-total"><span>Discount</span><strong>-₦{Math.min(Number(discount), total).toLocaleString('en-NG')}</strong></div>}<div className="sale-total sale-total-grand"><span>Total</span><strong>₦{netTotal.toLocaleString('en-NG')}</strong></div>{message && <div className="form-success" role="status" aria-live="polite">{message}</div>}<button className="primary" disabled={!cart.length || !customerReady}>Complete sale <ArrowRight size={16} /></button></section>}{!customer && message && <div className="form-success" role="status" aria-live="polite">{message}</div>}</form><section className="panel sale-note"><span className="section-label">Trusted calculation</span><h2>Stock changes on the server.</h2><p>Your browser never decides the final total or bypasses inventory checks. Online sales use the secure Supabase RPC; queued offline sales use an idempotent server operation when connectivity returns.</p></section></section></div>
}
