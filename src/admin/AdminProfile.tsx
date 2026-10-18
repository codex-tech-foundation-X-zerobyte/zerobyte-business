import { useEffect, useState } from 'react'
import { adminSupabase } from '../lib/supabase'

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin', PLATFORM_ADMIN: 'Platform admin', FINANCE_ADMIN: 'Finance admin',
  SUPPORT_ADMIN: 'Support admin (customer care)', MODERATION_ADMIN: 'Moderation admin',
}

export function AdminProfile() {
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [form, setForm] = useState({ full_name: '', phone: '' })
  const [saved, setSaved] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!adminSupabase) return
    adminSupabase.rpc('get_my_admin_profile').then(({ data }) => {
      const profile = (data ?? [])[0]
      if (profile) { setRole(profile.role); setEmail(profile.email) }
    })
    adminSupabase.auth.getUser().then(({ data }) => {
      const user = data.user
      if (!user || !adminSupabase) return
      adminSupabase.from('profiles').select('full_name,phone').eq('id', user.id).maybeSingle().then(({ data: profile }) => {
        if (profile) setForm({ full_name: profile.full_name ?? '', phone: profile.phone ?? '' })
      })
    })
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!adminSupabase) return
    setBusy(true); setError(''); setSaved(false)
    const { data: userData } = await adminSupabase.auth.getUser()
    const user = userData.user
    if (!user) { setBusy(false); return }
    const { error: result } = await adminSupabase.from('profiles').upsert({ id: user.id, full_name: form.full_name.trim(), phone: form.phone.trim() || null, updated_at: new Date().toISOString() })
    setBusy(false)
    if (result) setError(result.message)
    else { setSaved(true); window.setTimeout(() => setSaved(false), 2500) }
  }

  return <section className="admin-card wide"><div className="admin-card-header"><div><h2>My profile</h2><p>Your personal admin identity — separate from any business account you may also have.</p></div></div><form className="admin-form" onSubmit={save}><label>Full name<input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label><label>Phone number<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+234..." /></label><label>Email<input value={email} disabled /></label><label>Admin role<input value={ROLE_LABELS[role] ?? role} disabled /></label><button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>{saved && <p className="muted" role="status">Saved.</p>}{error && <div className="form-error" role="alert">{error}</div>}</form></section>
}
