import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Skeleton } from '../components/ui'
import { adminSupabase } from '../lib/supabase'

export function AdminPlans() {
  const [planRows, setPlanRows] = useState<{ plan_id: string; code: string; name: string; description: string; active: boolean; sort_order: number; trial_days: number; monthly_amount: number | null; currency: string; limits: Record<string, number | null>; subscriber_count: number }[]>([])
  const [planRowsLoading, setPlanRowsLoading] = useState(false)
  const [planRowsError, setPlanRowsError] = useState('')
  const [planBusyId, setPlanBusyId] = useState('')
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})

  const loadPlans = useCallback(() => {
    if (!adminSupabase) return
    setPlanRowsLoading(true); setPlanRowsError('')
    adminSupabase.rpc('admin_get_plans').then(({ data, error: result }) => {
      if (result) setPlanRowsError(result.code === 'PGRST202' ? 'Plans are not set up yet. Apply the latest Supabase migrations, then refresh.' : 'Could not load plans.')
      else setPlanRows((data ?? []) as typeof planRows)
      setPlanRowsLoading(false)
    })
  }, [])
  useEffect(() => { loadPlans() }, [loadPlans])

  async function updatePlanPrice(planId: string) {
    if (!adminSupabase) return
    const draft = priceDraft[planId]
    if (draft == null || draft === '') return
    const amount = Number(draft)
    if (!Number.isFinite(amount) || amount < 0) return
    const current = planRows.find((plan) => plan.plan_id === planId)
    if (!window.confirm(`Change ${current?.name ?? 'this plan'}'s monthly price from ₦${Number(current?.monthly_amount ?? 0).toLocaleString('en-NG')} to ₦${amount.toLocaleString('en-NG')}? Existing subscribers keep the price they signed up at.`)) return
    setPlanBusyId(planId)
    const { error: result } = await adminSupabase.rpc('admin_update_plan_price', { target_plan: planId, new_amount: amount, new_interval: 'monthly' })
    if (result) setPlanRowsError(result.message)
    else { setPriceDraft((current) => { const next = { ...current }; delete next[planId]; return next }); loadPlans() }
    setPlanBusyId('')
  }
  async function updatePlanLimit(planId: string, resource: string, value: string) {
    if (!adminSupabase) return
    const limitValue = value.trim() === '' ? null : Number(value)
    if (limitValue != null && (!Number.isFinite(limitValue) || limitValue < 0)) return
    setPlanBusyId(planId)
    const { error: result } = await adminSupabase.rpc('admin_set_plan_limit', { target_plan: planId, target_resource: resource, new_limit: limitValue })
    if (result) setPlanRowsError(result.message)
    else loadPlans()
    setPlanBusyId('')
  }
  async function togglePlanActive(planId: string, makeActive: boolean) {
    if (!adminSupabase) return
    setPlanBusyId(planId)
    const { error: result } = await adminSupabase.rpc('admin_set_plan_active', { target_plan: planId, make_active: makeActive })
    if (result) setPlanRowsError(result.message)
    else loadPlans()
    setPlanBusyId('')
  }

  return <section className="admin-card wide"><div className="admin-card-header"><div><h2>Plans & pricing</h2><p>Every price change creates a new version — existing subscribers keep the price they signed up at. No payment provider is connected yet, so changes here only affect trials and future billing.</p></div><button type="button" className="text-btn" onClick={loadPlans}><RefreshCw size={14} /> Refresh</button></div>{planRowsError && <div className="form-error" role="alert">{planRowsError}</div>}{planRowsLoading ? <div className="admin-table-skeleton">{[1, 2, 3].map((item) => <div key={item} className="admin-skeleton-row"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div> : <div className="admin-plan-grid">{planRows.map((plan) => <div key={plan.plan_id} className={`admin-plan-card ${plan.active ? '' : 'admin-plan-inactive'}`}><div className="admin-plan-card-head"><div><strong>{plan.name}</strong><small className="table-sub">{plan.code} · {plan.subscriber_count} active subscriber{plan.subscriber_count === 1 ? '' : 's'}</small></div><label className="admin-plan-toggle"><input type="checkbox" checked={plan.active} disabled={planBusyId === plan.plan_id} onChange={(event) => void togglePlanActive(plan.plan_id, event.target.checked)} /> Active</label></div><p className="muted">{plan.description}</p>{plan.code === 'enterprise' ? <p className="field-help">Enterprise pricing and limits are custom per organization.</p> : <div className="admin-plan-price-row"><span>₦</span><input type="number" min="0" placeholder={String(plan.monthly_amount ?? 0)} value={priceDraft[plan.plan_id] ?? ''} onChange={(event) => setPriceDraft((current) => ({ ...current, [plan.plan_id]: event.target.value }))} /><span>/mo</span><button type="button" className="text-btn" disabled={planBusyId === plan.plan_id || !priceDraft[plan.plan_id]} onClick={() => void updatePlanPrice(plan.plan_id)}>Update</button></div>}<div className="admin-plan-limits">{Object.entries(plan.limits).length === 0 && plan.code !== 'enterprise' && <small className="field-help">No limits configured — this plan is currently unlimited.</small>}{['products', 'customers', 'employees', 'branches', 'sales_per_month', 'storage_mb'].map((resource) => <label key={resource} className="admin-plan-limit"><span>{resource.replace(/_/g, ' ')}</span><input type="number" min="0" placeholder="Unlimited" disabled={planBusyId === plan.plan_id} defaultValue={plan.limits[resource] ?? ''} onBlur={(event) => { if (event.target.value !== String(plan.limits[resource] ?? '')) void updatePlanLimit(plan.plan_id, resource, event.target.value) }} /></label>)}</div></div>)}</div>}</section>
}
