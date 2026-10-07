import { whatsappUrl } from '../../lib/whatsapp'
import { Check, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyInline, PageIntro, TableSkeleton } from '../../components/ui'
import { getCurrentUserContext } from '../../lib/identity'
import { supabase } from '../../lib/supabase'

export function Workforce({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; employee_id: string; full_name: string; email: string | null; phone: string | null; job_title: string | null; department: string | null; employment_status: string; monthly_salary: number | null; branch_id: string | null; hired_on: string | null; user_id: string | null }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [self, setSelf] = useState<{ id: string; full_name: string; branch_id: string | null } | null>(null)
  const [attendance, setAttendance] = useState<{ id: string; work_date: string; clocked_in_at: string | null; clocked_out_at: string | null } | null>(null)
  const [form, setForm] = useState({ employee_id: '', full_name: '', email: '', phone: '', job_title: '', department: '', hired_on: new Date().toISOString().slice(0, 10), monthly_salary: '', branch_id: '' })
  const [error, setError] = useState(''); const [temporaryPassword, setTemporaryPassword] = useState('')
  const [copyState, setCopyState] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!supabase) return
    try {
      const context = await getCurrentUserContext(supabase)
      const peopleQuery = context.employee
        ? supabase.from('employee_profiles_self').select('id,employee_id,full_name,email,phone,job_title,department,employment_status,branch_id,hired_on,user_id').eq('organization_id', orgId)
        : supabase.from('employee_profiles_manager').select('id,employee_id,full_name,email,phone,job_title,department,employment_status,monthly_salary,branch_id,hired_on,user_id').eq('organization_id', orgId)
      const [people, branchResult] = await Promise.all([
        peopleQuery.order('created_at', { ascending: false }),
        supabase.from('branches').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name'),
      ])
      if (people.error) throw people.error
      const rowsWithSafeSalary = (people.data ?? []).map((person) => ({
        ...person,
        monthly_salary: Number((person as { monthly_salary?: number | null }).monthly_salary ?? 0) || null,
      }))
      setRows(rowsWithSafeSalary as typeof rows)
      setBranches(branchResult.data ?? [])
      const own = rowsWithSafeSalary.find((person) => person.user_id === context.userId)
      setSelf(own ? { id: own.id, full_name: own.full_name, branch_id: own.branch_id } : null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load workforce records.')
    } finally {
      setLoading(false)
    }
  }, [orgId])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!supabase || !self) return; supabase.from('attendance').select('id,work_date,clocked_in_at,clocked_out_at').eq('employee_id', self.id).eq('work_date', new Date().toISOString().slice(0, 10)).maybeSingle().then(({ data }) => setAttendance(data)) }, [self])
  async function add(event: React.FormEvent) { event.preventDefault(); if (!supabase) return; setError(''); setTemporaryPassword(''); const { data: sessionData } = await supabase.auth.getSession(); if (!sessionData.session) { setError('Your owner session has expired. Sign in again.'); return } const { data: payload, error: invokeError } = await supabase.functions.invoke('provision-worker', { body: { organizationId: orgId, employeeId: form.employee_id.trim(), fullName: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null, jobTitle: form.job_title.trim() || null, department: form.department.trim() || null, hiredOn: form.hired_on || null, monthlySalary: form.monthly_salary || null, branchId: form.branch_id || null } }); if (invokeError) { let detail = invokeError.message; try { const context = (invokeError as { context?: Response }).context; if (context) { const body = await context.clone().json() as { error?: string }; detail = body.error ?? detail } } catch { /* Keep the function error when the response is not JSON. */ } setError(detail || 'Could not create the worker account.'); return } setTemporaryPassword((payload as { temporaryPassword: string }).temporaryPassword); setCopyState(''); setForm({ employee_id: '', full_name: '', email: '', phone: '', job_title: '', department: '', hired_on: new Date().toISOString().slice(0, 10), monthly_salary: '', branch_id: '' }); load() }
  async function setWorkerStatus(id: string, action: 'ban' | 'unban') {
    if (!supabase) return
    if (!window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this staff account?`)) return
    setError('')
    const { error: result } = await supabase.functions.invoke('deactivate-worker', { body: { organizationId: orgId, employeeId: id, action } })
    if (result) setError(result.message)
    else load()
  }
  const [mySchedule, setMySchedule] = useState<{ weekday: number; starts_at: string; ends_at: string }[]>([])
  useEffect(() => { if (!supabase || !self) return; supabase.from('work_schedules').select('weekday,starts_at,ends_at').eq('employee_id', self.id).order('weekday').then(({ data }) => setMySchedule(data ?? [])) }, [self])
  // Routed through clock_in/clock_out RPCs rather than a direct table
  // update -- there is no RLS policy letting a worker UPDATE their own
  // attendance row (only INSERT, for clocking in), so a raw client-side
  // update() call here would have failed for every non-manager worker
  // trying to clock out. The RPCs also compute late/early-departure status
  // against work_schedules server-side, which a client-side computation
  // couldn't be trusted to do honestly.
  async function clock(kind: 'in' | 'out') {
    if (!supabase) return
    setError('')
    const { error: result } = kind === 'in' ? await supabase.rpc('clock_in', { target_org: orgId }) : await supabase.rpc('clock_out', { target_org: orgId })
    if (result) setError(result.message)
    else load()
  }
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (self) return <div className="page"><PageIntro label="Workforce" title={`Your shift, ${self.full_name}.`} description="Attendance is part of your worker profile and stays scoped to your assigned branch." /><section className="panel record-form three"><div><span className="section-label">Today</span><strong>{attendance?.clocked_in_at ? `Clocked in at ${new Date(attendance.clocked_in_at).toLocaleTimeString('en-NG')}` : 'Not clocked in yet'}</strong></div><button className="primary" disabled={Boolean(attendance?.clocked_in_at)} onClick={() => clock('in')}><Check size={16} /> Clock in</button><button className="secondary" disabled={!attendance?.clocked_in_at || Boolean(attendance.clocked_out_at)} onClick={() => clock('out')}>Clock out</button>{error && <div className="form-error">{error}</div>}</section>{mySchedule.length > 0 && <section className="panel table-panel"><div className="panel-heading"><div><span className="section-label">Your weekly schedule</span><h2>Set by your manager</h2></div></div><div className="table-wrap"><table><thead><tr><th>Day</th><th>Starts</th><th>Ends</th></tr></thead><tbody>{mySchedule.map((slot, index) => <tr key={index}><td>{weekdayNames[slot.weekday]}</td><td>{slot.starts_at.slice(0, 5)}</td><td>{slot.ends_at.slice(0, 5)}</td></tr>)}</tbody></table></div></section>}</div>
  return <div className="page"><PageIntro label="Workforce" title="Keep your team in view." description="Create the employee record and secure application account together. The temporary password is shown once." /><form className="panel record-form three" onSubmit={add}><label>Employee ID<input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="EMP-001" /></label><label>Full name<input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Employee name" /></label><label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="worker@business.com" /></label><label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." /></label><label>Job role/title<input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Sales associate" /></label><label>Department<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Sales floor" /></label><label>Branch<select required value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Hire date<input required type="date" value={form.hired_on} onChange={(e) => setForm({ ...form, hired_on: e.target.value })} /></label><label>Monthly salary<input type="number" min="0" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} placeholder="Optional" /></label><button className="primary"><Plus size={16} /> Create worker account</button>{error && <div className="form-error">{error}</div>}</form>{temporaryPassword && <section className="panel temporary-password"><h2>Worker account created</h2><p>Copy this temporary password now. It is not stored and will not be shown again.</p><code>{temporaryPassword}</code><button className="secondary" onClick={() => { void navigator.clipboard?.writeText(temporaryPassword); setCopyState('Copied') }}>{copyState || 'Copy temporary password'}</button></section>}<section className="panel table-panel">{loading ? <TableSkeleton /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Role</th><th>Branch</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.full_name}</strong><small className="table-sub">{row.employee_id}</small></td><td>{row.email || '—'}<small className="table-sub">{row.phone || ''}</small></td><td>{row.job_title || '—'}{row.department && <small className="table-sub">{row.department}</small>}</td><td>{branches.find((branch) => branch.id === row.branch_id)?.name || '—'}</td><td><span className={`status ${row.employment_status === 'archived' ? 'refunded' : 'completed'}`}>{row.employment_status}</span></td><td>{row.employment_status !== 'archived' ? <button className="text-btn danger-text" type="button" onClick={() => void setWorkerStatus(row.id, 'ban')}>Ban</button> : <button className="text-btn" type="button" onClick={() => void setWorkerStatus(row.id, 'unban')}>Unban</button>}</td></tr>)}</tbody></table></div> : <EmptyInline title="No employees yet" text="Create the first worker account above." />}</section><ShiftScheduler orgId={orgId} employees={rows} /></div>
}

function ShiftScheduler({ orgId, employees }: { orgId: string; employees: { id: string; full_name: string; employment_status: string }[] }) {
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const [schedules, setSchedules] = useState<{ id: string; employee_id: string; weekday: number; starts_at: string; ends_at: string }[]>([])
  const [form, setForm] = useState({ employeeId: '', weekday: '1', startsAt: '09:00', endsAt: '17:00' }); const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const activeEmployees = employees.filter((employee) => employee.employment_status === 'active')
  const load = useCallback(() => { if (!supabase) return; supabase.from('work_schedules').select('id,employee_id,weekday,starts_at,ends_at').eq('organization_id', orgId).order('weekday').then(({ data }) => { setSchedules(data ?? []); setLoading(false) }) }, [orgId])
  useEffect(() => { load() }, [load])
  async function addSchedule(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !form.employeeId) return
    // work_schedules already has manager-scoped RLS ("managers manage work
    // schedules"), so this writes directly -- no new RPC needed for a plain
    // metadata table that isn't touching stock, sales, or attendance state.
    const { error: result } = await supabase.from('work_schedules').insert({ organization_id: orgId, employee_id: form.employeeId, weekday: Number(form.weekday), starts_at: form.startsAt, ends_at: form.endsAt })
    if (result) setError(result.message)
    else { setForm({ ...form, employeeId: '' }); load() }
  }
  async function removeSchedule(id: string) { if (!supabase) return; const { error: result } = await supabase.from('work_schedules').delete().eq('id', id); if (result) setError(result.message); else load() }
  return <section className="panel table-panel">
    <div className="panel-heading"><div><span className="section-label">Weekly shift schedule</span><h2>Assign recurring shifts</h2></div></div>
    <form className="record-form three" onSubmit={addSchedule}>
      <label>Worker<select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Choose worker</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
      <label>Day<select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>{weekdayNames.map((name, index) => <option key={index} value={index}>{name}</option>)}</select></label>
      <label>Starts<input required type="time" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
      <label>Ends<input required type="time" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
      <button className="secondary"><Plus size={16} /> Add shift</button>
      {error && <div className="form-error form-wide">{error}</div>}
    </form>
    {loading ? <TableSkeleton rows={2} /> : schedules.length ? <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Day</th><th>Starts</th><th>Ends</th><th /></tr></thead><tbody>
      {schedules.map((schedule) => <tr key={schedule.id}><td>{employees.find((employee) => employee.id === schedule.employee_id)?.full_name ?? 'Worker'}</td><td>{weekdayNames[schedule.weekday]}</td><td>{schedule.starts_at.slice(0, 5)}</td><td>{schedule.ends_at.slice(0, 5)}</td><td><button type="button" className="text-btn danger-text" onClick={() => removeSchedule(schedule.id)}>Remove</button></td></tr>)}
    </tbody></table></div> : <EmptyInline title="No shifts scheduled yet" text="Assign a worker's recurring weekly shift above. Clocking in will be checked against it." />}
  </section>
}

export function UserAccounts({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<{ id: string; employee_id: string; full_name: string; email: string | null; job_title: string | null; employment_status: string; branch_id: string | null; created_at: string; user_id: string | null }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [resetInfo, setResetInfo] = useState<{ name: string; employeeId: string; phone: string | null; password: string } | null>(null)
  async function resetWorkerPassword(id: string) {
    if (!supabase) return
    if (!window.confirm('Reset this worker\'s password? Their current password stops working immediately and they must choose a new one at next sign-in.')) return
    setError(''); setResetInfo(null)
    const { data, error: invokeError } = await supabase.functions.invoke('reset-worker-password', { body: { employeeProfileId: id } })
    if (invokeError) {
      let detail = invokeError.message
      try { const context = (invokeError as { context?: Response }).context; if (context) { const body = await context.json(); detail = body?.error ?? detail } } catch { /* keep the default message */ }
      setError(detail)
      return
    }
    const result = data as { temporaryPassword: string; employeeId: string; fullName: string; phone: string | null }
    setResetInfo({ name: result.fullName, employeeId: result.employeeId, phone: result.phone, password: result.temporaryPassword })
  }
  async function setStatus(id: string, action: 'ban' | 'unban') {
    if (!supabase || !window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} this staff account?`)) return
    const { error: result } = await supabase.functions.invoke('deactivate-worker', { body: { organizationId: orgId, employeeId: id, action } })
    if (result) setError(result.message)
    else setRows((current) => current.map((row) => row.id === id ? { ...row, employment_status: action === 'ban' ? 'archived' : 'active' } : row))
  }
  useEffect(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('employee_profiles').select('id,employee_id,full_name,email,job_title,employment_status,branch_id,created_at,user_id').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('branches').select('id,name').eq('organization_id', orgId),
    ]).then(([accounts, branchResult]) => { if (accounts.error) setError(accounts.error.message); setRows(accounts.data ?? []); setBranches(branchResult.data ?? []); setLoading(false) })
  }, [orgId])
  return <div className="page"><PageIntro label="User accounts" title="Know who can sign in." description="Organization accounts are linked to employee records. Platform administrator accounts remain separate and are never managed here." />
{resetInfo && <section className="panel temporary-password"><h2>Password reset for {resetInfo.name}</h2><p>Copy this temporary password now. It is not stored and will not be shown again. {resetInfo.name.split(' ')[0]} must choose a new password the next time they sign in.</p><code>{resetInfo.password}</code><div className="promoter-share-row"><button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(resetInfo.password) }}>Copy password</button>{resetInfo.phone && <a className="secondary promoter-share-button" href={whatsappUrl(`Hello ${resetInfo.name.split(' ')[0]}, your sign-in password was reset.\nEmployee ID: ${resetInfo.employeeId}\nTemporary password: ${resetInfo.password}\nYou will be asked to choose your own password when you sign in.`, resetInfo.phone)} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}<button type="button" className="text-btn" onClick={() => setResetInfo(null)}>Done</button></div></section>}{error && <div className="form-error" role="alert">{error}</div>}<section className="panel table-panel">{loading ? <TableSkeleton /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Employee ID</th><th>Role</th><th>Branch</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.full_name}</strong></td><td>{row.email || '—'}</td><td className="mono">{row.employee_id}</td><td>{row.job_title || 'Worker'}</td><td>{branches.find((branch) => branch.id === row.branch_id)?.name || '—'}</td><td><span className={`status ${row.employment_status === 'active' ? 'completed' : 'refunded'}`}>{row.employment_status}</span></td><td>{new Date(row.created_at).toLocaleDateString('en-NG')}</td><td>{row.employment_status === 'active' ? <><button className="text-btn" onClick={() => void resetWorkerPassword(row.id)}>Reset password</button><button className="text-btn danger-text" onClick={() => void setStatus(row.id, 'ban')}>Ban</button></> : <button className="text-btn" onClick={() => void setStatus(row.id, 'unban')}>Unban</button>}</td></tr>)}</tbody></table></div> : <EmptyInline title="No linked accounts yet" text="Create a worker from Workforce to provision an account safely." />}</section></div>
}
