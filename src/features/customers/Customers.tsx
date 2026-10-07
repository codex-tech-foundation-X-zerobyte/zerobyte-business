import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, PageIntro, TableSkeleton } from '../../components/ui'
import { type OfflineScope, enqueueOfflineOperation, newOfflineOperationId, readScopedCache, writeScopedCache } from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { type CustomerRow } from '../../lib/types'

export function Customers({ orgId, search, scope }: { orgId: string; search: string; scope: OfflineScope | null }) {
  const [rows, setRows] = useState<(CustomerRow & { pending?: boolean })[]>([]); const emptyForm = { name: '', email: '', phone: '', address: '' }; const [form, setForm] = useState(emptyForm); const [editingId, setEditingId] = useState<string | null>(null); const [error, setError] = useState('')
  const [balances, setBalances] = useState<Record<string, number>>({}); const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (scope) setRows(await readScopedCache<CustomerRow & { pending?: boolean }>(scope, 'customers'))
    if (!supabase || !navigator.onLine) { setLoading(false); return }
    const { data, error: result } = await supabase.from('customers').select('id,name,email,phone,address').eq('organization_id', orgId).order('created_at', { ascending: false })
    if (!result && data && scope) await writeScopedCache(scope, 'customers', data)
    if (!result) setRows(data ?? [])
    const { data: balanceData } = await supabase.rpc('get_customer_balances', { target_org: orgId })
    setBalances(Object.fromEntries((balanceData ?? []).map((row: { customer_id: string; balance: number }) => [row.customer_id, Number(row.balance)])))
    setLoading(false)
  }, [orgId, scope])
  useEffect(() => { void load() }, [load])
  async function recordPayment(customerId: string, customerName: string) {
    if (!supabase) return
    const outstanding = balances[customerId] ?? 0
    const input = window.prompt(`Record a payment from ${customerName}. Outstanding balance: ₦${outstanding.toLocaleString('en-NG')}`, outstanding > 0 ? String(outstanding) : '')
    if (!input) return
    const amount = Number(input)
    if (!(amount > 0)) { setError('Enter a payment amount greater than zero.'); return }
    setPaymentBusyId(customerId)
    const { error: result } = await supabase.rpc('record_customer_payment', { target_org: orgId, target_customer: customerId, amount, payment_note: null })
    if (result) setError(result.message)
    else void load()
    setPaymentBusyId(null)
  }
  async function add(event: React.FormEvent) {
    event.preventDefault(); if (!supabase || !scope) return
    if (editingId) {
      if (!navigator.onLine) { setError('Reconnect to edit a customer.'); return }
      // RLS limits this to owners and managers of this business; the .eq on organization_id is a second guard.
      const { data, error: updateError } = await supabase.from('customers').update({ name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, address: form.address.trim() || null }).eq('id', editingId).eq('organization_id', orgId).select('id')
      if (updateError) { setError(updateError.message); return }
      if (!data?.length) { setError('Only owners and managers can edit customers.'); return }
      setEditingId(null); setForm(emptyForm); setError(''); void load()
      return
    }
    if (!navigator.onLine) {
      const clientId = newOfflineOperationId()
      await enqueueOfflineOperation(scope, 'customer', { target_org: orgId, target_branch: null, customer_name: form.name, customer_email: form.email || null, customer_phone: form.phone || null, customer_address: form.address.trim() || null, client_id: clientId })
      const next = [...rows, { id: clientId, name: form.name.trim(), email: form.email || null, phone: form.phone || null, address: form.address.trim() || null, pending: true }]
      setRows(next); await writeScopedCache(scope, 'customers', next); setForm(emptyForm); setError('Customer saved on this device and will sync when you reconnect.')
      return
    }
    const { error: result } = await supabase.rpc('create_customer', { target_org: orgId, target_branch: null, customer_name: form.name, customer_email: form.email || null, customer_phone: form.phone || null, customer_address: form.address.trim() || null }); if (result) setError(result.message); else { setForm(emptyForm); void load() }
  }
  const filtered = rows.filter((row) => `${row.name} ${row.email ?? ''} ${row.phone ?? ''} ${row.address ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page"><PageIntro label="Customers" title="Keep people close." description="A clean customer book for repeat business and better follow-up. Sales marked 'On credit' add to a customer's running balance here." /><form className="panel record-form three" onSubmit={add}><div><label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer name" /></label></div><div><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="customer@email.com" /></label></div><div><label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label></div><div className="form-wide"><label>Address<input value={form.address} maxLength={300} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city, state (optional, shown on receipts)" /></label></div><button className="primary">{editingId ? 'Save changes' : <><Plus size={16} /> Add customer</>}</button>{editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(emptyForm); setError('') }}>Cancel</button>}{error && <div className="form-error">{error}</div>}</form><section className="panel table-panel">{loading && filtered.length === 0 ? <TableSkeleton /> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Balance owed</th><th>Actions</th></tr></thead><tbody>{filtered.map((row) => { const balance = balances[row.id] ?? 0; return <tr key={row.id}><td><strong>{row.name}</strong>{row.address && <small className="field-help">{row.address}</small>}{row.pending && <small className="field-help">Pending sync</small>}</td><td>{row.email || '—'}</td><td>{row.phone || '—'}</td><td className={balance > 0 ? 'warning-text' : ''}>₦{balance.toLocaleString('en-NG')}</td><td><button type="button" className="text-btn" disabled={row.pending} onClick={() => { setEditingId(row.id); setForm({ name: row.name, email: row.email ?? '', phone: row.phone ?? '', address: row.address ?? '' }); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Edit</button>{balance > 0 && <button type="button" className="text-btn" disabled={paymentBusyId === row.id || row.pending} onClick={() => recordPayment(row.id, row.name)}>Record payment</button>}</td></tr> })}</tbody></table></div> : <EmptyInline title="No customers yet" text="Your customer records will appear here as you add them." />}</section></div>
}
