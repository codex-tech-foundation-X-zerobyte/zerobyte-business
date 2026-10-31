import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, FormDisclosure, LoadMoreBar, PageIntro, TableSkeleton } from '../../components/ui'
import { cleanSearch, usePagedList } from '../../lib/paging'
import {
  type OfflineScope,
  enqueueOfflineOperation,
  newOfflineOperationId,
  readScopedCache,
  writeScopedCache,
} from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { type CustomerRow } from '../../lib/types'

export function Customers({ orgId, search, scope }: { orgId: string; search: string; scope: OfflineScope | null }) {
  const emptyForm = { name: '', email: '', phone: '', address: '' }
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null)
  type CustomerListRow = CustomerRow & { pending?: boolean }
  // A page of customers at a time, searched by the database. Offline, the same screen reads the copy kept on this device.
  const list = usePagedList<CustomerListRow>({
    deps: [orgId, scope],
    search,
    fetchPage: async ({ from, to }, term, first) => {
      if (!supabase || !navigator.onLine) {
        const cached = scope ? await readScopedCache<CustomerListRow>(scope, 'customers') : []
        const needle = term.trim().toLowerCase()
        const hits = cached.filter(
          (row) =>
            !needle ||
            `${row.name} ${row.email ?? ''} ${row.phone ?? ''} ${row.address ?? ''}`.toLowerCase().includes(needle),
        )
        return { data: hits.slice(from, to + 1), error: null, count: hits.length }
      }
      let request = supabase
        .from('customers')
        .select('id,name,email,phone,address', { count: first ? 'estimated' : undefined })
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
      const needle = cleanSearch(term)
      if (needle)
        request = request.or(
          `name.ilike.*${needle}*,email.ilike.*${needle}*,phone.ilike.*${needle}*,address.ilike.*${needle}*`,
        )
      return request.range(from, to)
    },
  })
  const rows = list.rows
  // Balances are only asked for the customers on screen.
  const loadBalances = useCallback(
    async (ids: string[]) => {
      if (!supabase || !navigator.onLine || !ids.length) return
      const { data } = await supabase.rpc('get_customer_balances', { target_org: orgId, target_customers: ids })
      setBalances((current) => ({
        ...current,
        ...Object.fromEntries(
          (data ?? []).map((row: { customer_id: string; balance: number }) => [row.customer_id, Number(row.balance)]),
        ),
      }))
    },
    [orgId],
  )
  useEffect(() => {
    void loadBalances(rows.filter((row) => !row.pending && !(row.id in balances)).map((row) => row.id))
  }, [rows, balances, loadBalances])
  async function recordPayment(customerId: string, customerName: string) {
    if (!supabase) return
    const outstanding = balances[customerId] ?? 0
    const input = window.prompt(
      `Record a payment from ${customerName}. Outstanding balance: ₦${outstanding.toLocaleString('en-NG')}`,
      outstanding > 0 ? String(outstanding) : '',
    )
    if (!input) return
    const amount = Number(input)
    if (!(amount > 0)) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    setPaymentBusyId(customerId)
    const { error: result } = await supabase.rpc('record_customer_payment', {
      target_org: orgId,
      target_customer: customerId,
      amount,
      payment_note: null,
    })
    if (result) setError(result.message)
    else {
      setBalances((current) => {
        const next = { ...current }
        delete next[customerId]
        return next
      })
    }
    setPaymentBusyId(null)
  }
  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !scope) return
    if (editingId) {
      if (!navigator.onLine) {
        setError('Reconnect to edit a customer.')
        return
      }
      // RLS limits this to owners and managers of this business; the .eq on organization_id is a second guard.
      const { data, error: updateError } = await supabase
        .from('customers')
        .update({
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
        })
        .eq('id', editingId)
        .eq('organization_id', orgId)
        .select('id')
      if (updateError) {
        setError(updateError.message)
        return
      }
      if (!data?.length) {
        setError('Only owners and managers can edit customers.')
        return
      }
      setEditingId(null)
      setForm(emptyForm)
      setError('')
      void list.reload()
      return
    }
    if (!navigator.onLine) {
      const clientId = newOfflineOperationId()
      await enqueueOfflineOperation(scope, 'customer', {
        target_org: orgId,
        target_branch: null,
        customer_name: form.name,
        customer_email: form.email || null,
        customer_phone: form.phone || null,
        customer_address: form.address.trim() || null,
        client_id: clientId,
      })
      const cached = await readScopedCache<CustomerListRow>(scope, 'customers')
      await writeScopedCache(scope, 'customers', [
        {
          id: clientId,
          name: form.name.trim(),
          email: form.email || null,
          phone: form.phone || null,
          address: form.address.trim() || null,
          pending: true,
        },
        ...cached,
      ])
      void list.reload()
      setForm(emptyForm)
      setError('Customer saved on this device and will sync when you reconnect.')
      return
    }
    const { error: result } = await supabase.rpc('create_customer', {
      target_org: orgId,
      target_branch: null,
      customer_name: form.name,
      customer_email: form.email || null,
      customer_phone: form.phone || null,
      customer_address: form.address.trim() || null,
    })
    if (result) setError(result.message)
    else {
      setForm(emptyForm)
      void list.reload()
    }
  }
  return (
    <div className="page">
      <PageIntro
        label="Customers"
        title="Keep people close."
        description="Know who you serve."
      />
      <FormDisclosure featured label="Add customer" forceOpen={editingId !== null}>
        <form className="panel record-form three" onSubmit={add}>
          <div>
            <label>
              Full name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Customer name"
              />
            </label>
          </div>
          <div>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="customer@email.com"
              />
            </label>
          </div>
          <div>
            <label>
              Phone number
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+234..."
              />
            </label>
          </div>
          <div className="form-wide">
            <label>
              Address
              <input
                value={form.address}
                maxLength={300}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Street, city, state (optional, shown on receipts)"
              />
            </label>
          </div>
          <button className="primary">
            {editingId ? (
              'Save changes'
            ) : (
              <>
                <Plus size={16} /> Add customer
              </>
            )}
          </button>
          {editingId && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditingId(null)
                setForm(emptyForm)
                setError('')
              }}
            >
              Cancel
            </button>
          )}
          {error && <div className="form-error">{error}</div>}
        </form>
      </FormDisclosure>
      <section className="panel table-panel">
        {list.error && (
          <div className="form-error" role="alert">
            {list.error}
          </div>
        )}
        {list.loading && rows.length === 0 ? (
          <TableSkeleton />
        ) : rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Balance owed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const balance = balances[row.id] ?? 0
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.name}</strong>
                          {row.address && <small className="field-help">{row.address}</small>}
                          {row.pending && <small className="field-help">Pending sync</small>}
                        </td>
                        <td>{row.email || '—'}</td>
                        <td>{row.phone || '—'}</td>
                        <td className={balance > 0 ? 'warning-text' : ''}>₦{balance.toLocaleString('en-NG')}</td>
                        <td>
                          <button
                            type="button"
                            className="text-btn"
                            disabled={row.pending}
                            onClick={() => {
                              setEditingId(row.id)
                              setForm({
                                name: row.name,
                                email: row.email ?? '',
                                phone: row.phone ?? '',
                                address: row.address ?? '',
                              })
                              setError('')
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                          >
                            Edit
                          </button>
                          {balance > 0 && (
                            <button
                              type="button"
                              className="text-btn"
                              disabled={paymentBusyId === row.id || row.pending}
                              onClick={() => recordPayment(row.id, row.name)}
                            >
                              Record payment
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <LoadMoreBar
              shown={rows.length}
              total={list.total}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onMore={() => void list.loadMore()}
              noun="customers"
            />
          </>
        ) : (
          <EmptyInline
            title={search.trim() ? 'No matching customers' : 'No customers yet'}
            text="Add the people you sell to, so their name, phone and address appear on their receipts."
            action="Add customer"
          />
        )}
      </section>
    </div>
  )
}
