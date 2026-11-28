const { execSync } = require('child_process'); const crypto = require('crypto'); const fs = require('fs')
const sql = (q) => { fs.writeFileSync('/tmp/q.sql', q); return execSync(`su postgres -c "psql -d zbe -At -q -f /tmp/q.sql"`, { encoding: 'utf8' }).trim() }
const KEY = 'sk_test_local_fake_key'; const SITE = 'https://zerobyte-business.vercel.app'
const U1 = '00000000-0000-4000-8000-0000000000a1', U2 = '00000000-0000-4000-8000-0000000000a2'
const O1 = '00000000-0000-4000-8000-0000000000b1', O2 = '00000000-0000-4000-8000-0000000000b2', O3 = '00000000-0000-4000-8000-0000000000b3'
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  <-- ' + detail}`) }
const call = async (port, body, token = 'tok-owner', extra = {}) => { const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) }); let j = null; try { j = await r.json() } catch {} ; return { status: r.status, json: j } }
const init = (org, planCode, interval = 'monthly', token = 'tok-owner') => call(8801, { organizationId: org, planId: sql(`select id from plans where code='${planCode}'`), interval }, token)
const verify = (reference, token = 'tok-owner') => call(8802, { reference }, token)
const pay = (reference, status, override) => fetch('http://127.0.0.1:54400/__pay', { method: 'POST', body: JSON.stringify({ reference, status, override }) })
const sub = (org) => sql(`select s.status||'|'||p.code||'|'||coalesce(s.provider,'-')||'|'||coalesce(to_char(s.current_period_end,'YYYY-MM-DD'),'-') from subscriptions s join plans p on p.id=s.plan_id where organization_id='${org}'`)
const payRow = (ref) => sql(`select status||'|'||amount_kobo||'|'||currency from payments where reference='${ref}'`)
const webhook = async (reference, sig) => { const body = JSON.stringify({ event: 'charge.success', data: { reference, amount: 1 } }); const s = sig ?? crypto.createHmac('sha512', KEY).update(body).digest('hex'); const r = await fetch('http://127.0.0.1:8803/', { method: 'POST', headers: { 'x-paystack-signature': s }, body }); return r.status }

;(async () => {
  sql(`insert into auth.users(id,email) values ('${U1}','owner@e2e.test'),('${U2}','other@e2e.test') on conflict do nothing;
       insert into organizations(id,name,slug) values ('${O1}','E2E One','e2e-one'),('${O2}','E2E Two','e2e-two'),('${O3}','E2E Three','e2e-three') on conflict do nothing;
       insert into organization_members(organization_id,user_id,role) values ('${O1}','${U1}','owner'),('${O3}','${U1}','owner'),('${O2}','${U2}','owner') on conflict do nothing;`)
  sql(`delete from payment_events; delete from payments; update subscriptions set plan_id=(select id from plans where code='free'), status='active', trial_start=null, trial_end=null, current_period_start=now(), current_period_end=null, provider=null, provider_subscription_id=null where organization_id in ('${O1}','${O2}','${O3}'); delete from subscription_events where organization_id in ('${O1}','${O2}','${O3}')`)
  // The state described in the bug report: a business that is on a TRIAL of the plan it then pays for.
  sql(`update subscriptions set plan_id=(select id from plans where code='pro'), status='trialing', trial_start=now(), trial_end=now()+interval '7 days', current_period_start=now(), current_period_end=now()+interval '7 days', provider=null where organization_id='${O1}'`)
  console.log('start state O1:', sub(O1))

  console.log('\n--- 1. initialize'); const a = await init(O1, 'pro'); ok('initialize returns a paystack checkout url', a.status === 200 && /^https:\/\/checkout\.paystack\.com\//.test(a.json?.authorizationUrl ?? ''), JSON.stringify(a)); const ref = a.json?.reference
  ok('payment stored with SERVER price (800000 kobo), pending', payRow(ref) === 'pending|800000|NGN', payRow(ref))
  ok('client cannot choose the amount (extra field ignored)', (await call(8801, { organizationId: O1, planId: sql(`select id from plans where code='pro'`), interval: 'monthly', amount: 1, amountKobo: 1 })).status === 200 && sql(`select min(amount_kobo) from payments where organization_id='${O1}'`) === '800000')

  console.log('\n--- 2. verify BEFORE the customer pays must not activate'); const early = await verify(ref); ok('unpaid (abandoned) -> reported as abandoned, not activated', early.status === 200 && early.json?.outcome === 'abandoned', JSON.stringify(early)); ok('abandoned payment stays OPEN (not marked failed) so it can still be paid', payRow(ref).startsWith('pending'), payRow(ref)); ok('subscription still trial', sub(O1).startsWith('trialing'), sub(O1))
  console.log('\n--- 3. customer pays; browser returns; verify'); await pay(ref, 'success'); const v1 = await verify(ref); ok('verify -> activated', v1.json?.outcome === 'activated', JSON.stringify(v1)); const after1 = sub(O1); ok('subscription now ACTIVE pro via paystack', after1.startsWith('active|pro|paystack|'), after1); ok('payment row success', payRow(ref) === 'success|800000|NGN', payRow(ref))
  console.log('\n--- 4. repeated verification is idempotent'); const v2 = await verify(ref); ok('second verify -> already_settled', v2.json?.outcome === 'already_settled', JSON.stringify(v2)); ok('period not extended by repeat', sub(O1) === after1, sub(O1) + ' vs ' + after1)
  console.log('\n--- 5. webhook'); ok('webhook with bad signature rejected (401)', await webhook(ref, 'deadbeef') === 401); ok('valid webhook after verify accepted (200)', await webhook(ref) === 200); ok('still exactly one activation event', sql(`select count(*) from subscription_events where organization_id='${O1}' and event_type='activated'`) === '1'); ok('period unchanged after webhook replay', sub(O1) === after1)

  console.log('\n--- 6. webhook-only settlement (customer closed the tab)'); const b = await init(O3, 'basic'); await pay(b.json.reference, 'success'); ok('valid webhook settles it', await webhook(b.json.reference) === 200 && sub(O3).startsWith('active|basic|paystack'), sub(O3))
  console.log('\n--- 7. mismatches never activate'); sql(`update subscriptions set plan_id=(select id from plans where code='free'), status='active', provider=null, current_period_end=null where organization_id='${O3}'`)
  const m = await init(O3, 'pro'); await pay(m.json.reference, 'success', { amount: 100 }); const mv = await verify(m.json.reference); ok('wrong amount -> mismatch', mv.json?.outcome === 'mismatch', JSON.stringify(mv)); ok('wrong amount did not activate', sub(O3).startsWith('active|free'), sub(O3)); ok('payment flagged mismatch', payRow(m.json.reference).startsWith('mismatch'))
  const c = await init(O3, 'pro'); await pay(c.json.reference, 'success', { currency: 'USD' }); ok('wrong currency -> mismatch, not activated', (await verify(c.json.reference)).json?.outcome === 'mismatch' && sub(O3).startsWith('active|free'))
  const f = await init(O3, 'pro'); await pay(f.json.reference, 'failed'); ok('failed -> failed, not activated', (await verify(f.json.reference)).json?.outcome === 'failed' && sub(O3).startsWith('active|free'))
  const pnd = await init(O3, 'pro'); await pay(pnd.json.reference, 'ongoing'); ok('pending/ongoing -> pending, not activated', (await verify(pnd.json.reference)).json?.outcome === 'pending' && sub(O3).startsWith('active|free'))

  console.log('\n--- 7b. Paystack fees (the production bug: customer bears the fee, so amount = price + fee)')
  const fb = await init(O2, 'basic', 'monthly', 'tok-other'); const fbRef = fb.json.reference; const exp = Number(sql(`select amount_kobo from payments where reference='${fbRef}'`))
  await pay(fbRef, 'success', { amount: exp + 7500, fees: 7500 }); const fv = await verify(fbRef, 'tok-other')
  ok('price + Paystack fee is accepted and activates the plan', fv.json?.outcome === 'activated' && sub(O2).startsWith('active|basic|paystack'), JSON.stringify(fv) + ' ' + sub(O2))
  ok('the plan price stays the recorded amount; the fee is stored separately', sql(`select amount_kobo||'|'||paid_amount_kobo||'|'||fees_kobo from payments where reference='${fbRef}'`) === `${exp}|${exp + 7500}|7500`, sql(`select amount_kobo||'|'||paid_amount_kobo||'|'||fees_kobo from payments where reference='${fbRef}'`))
  const periodBefore = sub(O2)
  for (const [label, override] of [['overpaid with no fee to explain it', { amount: exp + 5000, fees: 0 }], ['overpaid by more than the fee', { amount: exp + 9000, fees: 7500 }], ['requested amount does not match the plan price', { amount: exp, requested_amount: exp - 100, fees: 0 }], ['underpaid even with a fee', { amount: exp - 1000, fees: 500 }]]) {
    const x = await init(O2, 'basic', 'monthly', 'tok-other'); await pay(x.json.reference, 'success', override); const xv = await verify(x.json.reference, 'tok-other')
    ok(`${label} -> mismatch, nothing activated`, xv.json?.outcome === 'mismatch' && sub(O2) === periodBefore, JSON.stringify(xv))
  }
  ok('the mismatch records what Paystack reported, for support', /Paystack reported NGN/.test(sql(`select failure_reason from payments where organization_id='${O2}' and status='mismatch' limit 1`)))
  console.log('\n--- 8. wrong people / wrong references'); ok('another business owner cannot settle my reference (404)', (await verify(ref, 'tok-other')).status === 404); ok('another owner cannot start a payment for my org (403)', (await init(O1, 'pro', 'monthly', 'tok-other')).status === 403); ok('no token -> 401', (await call(8802, { reference: ref }, null)).status === 401); ok('garbage reference -> 400', (await verify('zb_notreal')).status === 400); ok('well-formed but unknown reference -> 404', (await verify('zb_' + 'a'.repeat(32))).status === 404)
  console.log('\n--- 9. cannot overwrite a paid plan'); ok('switching plans mid-period is refused (409)', (await init(O1, 'pro_plus')).status === 409)

  console.log('\n--- 11. diagnostics'); const ev = sql(`select string_agg(source||':'||coalesce(outcome,'?'), ',' order by id) from payment_events where reference='${ref}'`); ok('every check left a payment_events row (return + webhook)', /return:abandoned/.test(ev) && /return:activated/.test(ev) && /webhook:already_settled/.test(ev), ev)
  const ghost = 'zb_' + 'c'.repeat(32); sql(`insert into payments(reference,organization_id,plan_id,price_version_id,billing_interval,amount_kobo,initiated_by) select '${ghost}','${O1}',p.id,v.id,'monthly',800000,'${U1}' from plans p join plan_price_versions v on v.plan_id=p.id and v.billing_interval='monthly' and v.status='active' where p.code='pro'`)
  const g = await verify(ghost); ok('reference unknown to Paystack -> pending, never activated', g.json?.outcome === 'pending' && sub(O1).startsWith('active|pro'), JSON.stringify(g)); ok('and the reason is logged (paystack_no_transaction + HTTP status)', /paystack_no_transaction/.test(sql(`select string_agg(outcome||' '||error, '; ') from payment_events where reference='${ghost}'`)))
  console.log('\n--- 12. database settlement failure must not report success'); sql(`alter function settle_paystack_payment(text,text,bigint,text,text,text,timestamptz,bigint,bigint) rename to settle_paystack_payment_off`)
  const d = await init(O3, 'pro'); await pay(d.json.reference, 'success'); const dv = await verify(d.json.reference); sql(`alter function settle_paystack_payment_off(text,text,bigint,text,text,text,timestamptz,bigint,bigint) rename to settle_paystack_payment`)
  ok('RPC failure -> HTTP 502 with code settle_failed (no false success)', dv.status === 502 && dv.json?.code === 'settle_failed' && !dv.json?.outcome, JSON.stringify(dv)); ok('failure is logged with the database error', /settle_error/.test(sql(`select string_agg(outcome||' '||coalesce(error,''), '; ') from payment_events where reference='${d.json.reference}'`)) && sub(O3).startsWith('active|free'))
  ok('and a retry after the fix activates it', (await verify(d.json.reference)).json?.outcome === 'activated' && sub(O3).startsWith('active|pro|paystack'), sub(O3))
  console.log('\n--- 10. CORS preflight from the live site'); const pf = await fetch('http://127.0.0.1:8802/', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,x-client-info,apikey,content-type' } }); ok('preflight allows the live site and supabase-js headers', pf.headers.get('access-control-allow-origin') === SITE && /x-client-info/.test(pf.headers.get('access-control-allow-headers') ?? ''))
  const pf2 = await fetch('http://127.0.0.1:8802/', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } }); console.log(`INFO  preflight from http://localhost:5173 -> allow-origin header: ${pf2.headers.get('access-control-allow-origin') ?? '(none: blocked)'}  (SITE_URL is set, so localhost is blocked unless ALLOWED_ORIGINS lists it)`)
  console.log('\n--- 13. discounts (granted by the super admin) are applied by the SERVER')
  const basicPrice = Number(sql(`select (amount*100)::bigint from plan_price_versions v join plans p on p.id=v.plan_id where p.code='basic' and v.status='active' and v.billing_interval='monthly'`))
  const off = Math.round((basicPrice * 75) / 100)
  const noDisc = await init(O2, 'basic', 'monthly', 'tok-other'); ok('no discount -> the normal price', payRow(noDisc.json.reference) === `pending|${basicPrice}|NGN` && noDisc.json.discountPercent === undefined, payRow(noDisc.json.reference))
  sql(`insert into subscription_discounts(organization_id, plan_code, percent, uses_left, reason) values ('${O2}','basic',25,1,'e2e test discount')`)
  const wrongPlan = await init(O2, 'pro', 'monthly', 'tok-other').catch(() => ({ status: 0 })); ok('a basic-only discount does not touch another plan (the plan switch is still refused)', wrongPlan.status === 409, JSON.stringify(wrongPlan))
  const d1 = await init(O2, 'basic', 'monthly', 'tok-other'); ok('with a discount -> the discounted price is charged', d1.status === 200 && d1.json.discountPercent === 25 && payRow(d1.json.reference) === `pending|${off}|NGN`, JSON.stringify(d1.json) + ' ' + payRow(d1.json.reference))
  ok('the list price and the discount are recorded on the payment', sql(`select list_amount_kobo||'|'||discount_percent from payments where reference='${d1.json.reference}'`) === `${basicPrice}|25`)
  ok('starting a payment does not use the discount up', sql(`select uses_left from subscription_discounts where organization_id='${O2}'`) === '1')
  await pay(d1.json.reference, 'success'); const dv1 = await verify(d1.json.reference, 'tok-other'); ok('the discounted payment is accepted at the discounted amount', dv1.json?.outcome === 'activated', JSON.stringify(dv1))
  ok('a successful payment uses the discount up', sql(`select uses_left from subscription_discounts where organization_id='${O2}'`) === '0')
  const d2 = await init(O2, 'basic', 'monthly', 'tok-other'); ok('afterwards the normal price is back', payRow(d2.json.reference) === `pending|${basicPrice}|NGN` && d2.json.discountPercent === undefined, payRow(d2.json.reference))
  console.log('\n--- 14. Codex Customer Service callback: signed, applied once, forged requests refused')
  const crypto = require('crypto')
  const CONV = '00000000-0000-4000-8000-0000000000c1'
  sql(`delete from support_messages where conversation_id='${CONV}'; delete from support_conversations where id='${CONV}'; delete from codex_callback_events;
       insert into support_conversations(id, organization_id, user_id) values ('${CONV}','${O1}','${U1}');
       insert into support_messages(conversation_id, sender_id, sender_role, body) values ('${CONV}','${U1}','customer','Cannot log in');`)
  const post = (raw, signature, eventId) => fetch('http://127.0.0.1:8804/', { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-codex-signature': signature } : {}), ...(eventId ? { 'x-codex-event-id': eventId } : {}) }, body: raw })
  const sign = (raw, t = Math.floor(Date.now() / 1000), secret = 'a'.repeat(64)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`
  const replyRaw = JSON.stringify({ event: 'ticket.reply', sequence: 1, ticket_ref: 'TCK-000001', external_ref: `ZB-${CONV}`, occurred_at: new Date().toISOString(), message: { body: 'Please clear the cache and try again.', at: new Date().toISOString() } })
  const count = () => sql(`select count(*) from support_messages where conversation_id='${CONV}' and source='codex'`)
  let r = await post(replyRaw, sign(replyRaw), 'evt-e2e-1'); ok('a correctly signed staff reply is accepted (204)', r.status === 204, String(r.status))
  ok('and it appears in the customer chat as technical support', count() === '1')
  r = await post(replyRaw, sign(replyRaw), 'evt-e2e-1'); ok('Codex retrying the same event is accepted but not applied twice', r.status === 204 && count() === '1', `${r.status} ${count()}`)
  r = await post(replyRaw, sign(replyRaw, undefined, 'b'.repeat(64)), 'evt-e2e-2'); ok('a wrong secret is refused (401) and nothing is added', r.status === 401 && count() === '1', String(r.status))
  r = await post(replyRaw + ' ', sign(replyRaw), 'evt-e2e-3'); ok('a body changed after signing is refused (401)', r.status === 401 && count() === '1', String(r.status))
  r = await post(replyRaw, sign(replyRaw, Math.floor(Date.now() / 1000) - 3600), 'evt-e2e-4'); ok('an old (replayed) signature is refused (401)', r.status === 401 && count() === '1', String(r.status))
  r = await post(replyRaw, null, 'evt-e2e-5'); ok('no signature is refused (401)', r.status === 401, String(r.status))
  const unknownRaw = JSON.stringify({ event: 'ticket.reply', sequence: 1, external_ref: 'ORD-77', message: { body: 'hi' } })
  r = await post(unknownRaw, sign(unknownRaw), 'evt-e2e-6'); ok('a ticket that is not ours is accepted and ignored (so Codex does not retry forever)', r.status === 204 && count() === '1', String(r.status))
  const statusRaw = (status, sequence) => JSON.stringify({ event: 'ticket.status', sequence, external_ref: `ZB-${CONV}`, status })
  let sr = statusRaw('resolved', 3); r = await post(sr, sign(sr), 'evt-e2e-7'); ok('a status change is applied', r.status === 204 && sql(`select codex_status from support_conversations where id='${CONV}'`) === 'resolved')
  sr = statusRaw('in_progress', 2); r = await post(sr, sign(sr), 'evt-e2e-8'); ok('an older status arriving late does not overwrite the newer one', sql(`select codex_status from support_conversations where id='${CONV}'`) === 'resolved')
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
