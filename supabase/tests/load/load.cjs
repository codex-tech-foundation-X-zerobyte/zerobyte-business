// Load test: N concurrent "active users", each looping through a realistic session against PostgREST + Postgres.
const http = require('http'); const crypto = require('crypto'); const fs = require('fs')
const [,, VUS_S, SECS_S, LABEL = '', RAMP_S = '8'] = process.argv
const VUS = Number(VUS_S), SECS = Number(SECS_S), RAMP = Number(RAMP_S)
const SECRET = 'local-test-secret-local-test-secret-1234'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = (sub) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', exp: 4102444800 }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}` }
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity })
const lat = {}; const status = {}; let total = 0, errors = 0
const rec = (name, ms, code) => { (lat[name] ??= []).push(ms); const k = String(code); status[k] = (status[k] ?? 0) + 1; total++; if (!(code >= 200 && code < 300)) { errors++; (rec.byName ??= {})[name] = (rec.byName[name] ?? 0) + 1 } }
const call = (name, method, path, token, body, keep = false) => new Promise((resolve) => {
  const t0 = performance.now(); const payload = body ? JSON.stringify(body) : null; let done = false
  const req = http.request({ host: '127.0.0.1', port: 3000, path, method, agent, timeout: 15000, headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => keep && chunks.push(c)); res.on('end', () => { if (done) return; done = true; rec(name, performance.now() - t0, res.statusCode); resolve(keep ? Buffer.concat(chunks).toString() : null) })
  })
  req.on('timeout', () => { if (done) return; done = true; req.destroy(); rec(name, performance.now() - t0, 'timeout'); resolve(null) })
  req.on('error', () => { if (done) return; done = true; rec(name, performance.now() - t0, 'conn_error'); resolve(null) })
  if (payload) req.write(payload); req.end()
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const think = () => sleep(1500 + Math.random() * 2000)
const pad = (n, w) => String(n).padStart(w, '0')
const uuid = () => crypto.randomUUID()
const dateTo = new Date().toISOString().slice(0, 10), dateFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)

async function user(i, stopAt) {
  const idx = (i % 300) + 1; const org = `00000000-0000-4000-b000-${pad(idx, 12)}`, uid = `00000000-0000-4000-a000-${pad(idx, 12)}`; const token = sign(uid)
  await sleep((i / VUS) * RAMP * 1000)
  while (performance.now() < stopAt) {
    // 1. open the app (the five things the dashboard/shell loads, in parallel)
    const [, , prodRaw] = await Promise.all([
      call('dashboard_metrics', 'POST', '/rpc/get_dashboard_metrics', token, { target_org: org, date_from: dateFrom, date_to: dateTo, target_branch: null }),
      call('recent_sales', 'GET', `/sales?select=id,total,created_at&organization_id=eq.${org}&order=created_at.desc&limit=6`, token),
      call('products_list', 'GET', `/products?select=*&organization_id=eq.${org}&order=created_at.desc`, token, null, true),
      call('customers_list', 'GET', `/customers?select=*&organization_id=eq.${org}&order=created_at.desc`, token),
      call('notifications', 'GET', `/notifications?select=*&user_id=eq.${uid}&organization_id=eq.${org}&order=created_at.desc&limit=30`, token),
    ])
    let products = []; try { products = JSON.parse(prodRaw ?? '[]') } catch {}
    await think()
    // 2. record a sale (70% of visits)
    if (Math.random() < 0.7 && products.length) {
      const n = 1 + Math.floor(Math.random() * 3); const items = Array.from({ length: n }, () => ({ product_id: products[Math.floor(Math.random() * products.length)].id, quantity: 1 + Math.floor(Math.random() * 3) }))
      const seen = new Set(); const uniq = items.filter((x) => !seen.has(x.product_id) && seen.add(x.product_id))
      await call('create_sale', 'POST', '/rpc/create_sale_with_operation', token, { target_org: org, target_customer: null, items: uniq, target_branch: null, target_payment_method: 'cash', discount_amount: 0, operation_id: uuid() })
      await think()
    }
    // 3. browse receipts (25% of visits): sales with their items, the heaviest read in the app
    if (Math.random() < 0.25) { await call('receipts_list', 'GET', `/sales?select=*,sale_items(*,products(name,sku))&organization_id=eq.${org}&order=created_at.desc${process.env.RECEIPTS_LIMIT ? '&limit=' + process.env.RECEIPTS_LIMIT : ''}`, token); await think() }
  }
}
const cpuOf = () => { let t = 0; for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) { try { const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); if (comm === 'postgres' || comm === 'postgrest') { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); t += Number(f[11]) + Number(f[12]) } } catch {} } return t / 100 }
;(async () => {
  const cpu0 = cpuOf(), me0 = process.cpuUsage(); const start = performance.now(); const stopAt = start + SECS * 1000
  await Promise.all(Array.from({ length: VUS }, (_, i) => user(i, stopAt)))
  const wall = (performance.now() - start) / 1000, dbCpu = cpuOf() - cpu0, me = process.cpuUsage(me0); const meCpu = (me.user + me.system) / 1e6
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
  console.log(`\n=== ${LABEL || VUS + ' concurrent users'} | ${VUS} users | ${SECS}s | ${total} requests | ${(total / wall).toFixed(0)} req/s | errors ${errors} (${(100 * errors / total).toFixed(2)}%)`)
  console.log('request              count   p50ms   p95ms   p99ms   maxms  errors')
  for (const [name, a] of Object.entries(lat)) console.log(`${name.padEnd(20)} ${String(a.length).padStart(5)} ${pct(a, .5).toFixed(0).padStart(7)} ${pct(a, .95).toFixed(0).padStart(7)} ${pct(a, .99).toFixed(0).padStart(7)} ${Math.max(...a).toFixed(0).padStart(7)} ${String(rec.byName?.[name] ?? 0).padStart(7)}`)
  console.log('status codes:', JSON.stringify(status))
  console.log(`CPU: database+API used ${dbCpu.toFixed(1)}s of ${wall.toFixed(0)}s (${(100 * dbCpu / wall).toFixed(0)}% of the one core), load generator ${meCpu.toFixed(1)}s | DB+API CPU per request: ${(1000 * dbCpu / total).toFixed(1)} ms`)
})()
