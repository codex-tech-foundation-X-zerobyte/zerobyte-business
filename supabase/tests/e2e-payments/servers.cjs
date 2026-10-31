// Fake Supabase gateway (auth + REST proxy to a real PostgREST) and fake Paystack. Test-only.
const http = require('http'); const crypto = require('crypto')
const SECRET = 'local-test-secret-local-test-secret-1234'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = (payload) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}` }
exports.sign = sign
const users = { 'tok-owner': { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@e2e.test' }, 'tok-other': { id: '00000000-0000-4000-8000-0000000000a2', email: 'other@e2e.test' } }
const read = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))) })
// ---- gateway ----
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/auth/v1/user') {
    const token = (req.headers.authorization ?? '').replace('Bearer ', ''); const u = users[token]
    res.writeHead(u ? 200 : 401, { 'content-type': 'application/json' }); return res.end(JSON.stringify(u ? { ...u, aud: 'authenticated', role: 'authenticated' } : { message: 'invalid' }))
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const body = await read(req); const headers = {}
    for (const k of ['apikey', 'authorization', 'content-type', 'prefer', 'accept', 'accept-profile', 'content-profile', 'range']) if (req.headers[k]) headers[k] = req.headers[k]
    const r = await fetch('http://127.0.0.1:3000' + url.pathname.replace('/rest/v1', '') + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body })
    const out = Buffer.from(await r.arrayBuffer()); const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v })
    res.writeHead(r.status, h); return res.end(out)
  }
  res.writeHead(404); res.end()
}).listen(54321, '127.0.0.1')
// ---- fake Paystack ----
const tx = new Map()
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (!url.pathname.startsWith('/__') && !(req.headers.authorization ?? '').startsWith('Bearer sk_test_local')) return send(401, { status: false, message: 'Invalid key' })
  if (req.method === 'POST' && url.pathname === '/transaction/initialize') {
    const b = JSON.parse((await read(req)).toString()); tx.set(b.reference, { reference: b.reference, amount: b.amount, requested_amount: b.amount, fees: 0, currency: b.currency, status: 'abandoned', id: tx.size + 1001, email: b.email })
    return send(200, { status: true, message: 'ok', data: { authorization_url: `https://checkout.paystack.com/${b.reference.slice(3, 15)}`, access_code: 'ac', reference: b.reference } })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/transaction/verify/')) {
    const t = tx.get(decodeURIComponent(url.pathname.split('/').pop())); if (!t) return send(404, { status: false, message: 'Transaction reference not found' })
    return send(200, { status: true, message: 'Verification successful', data: { ...t, channel: 'card', paid_at: t.status === 'success' ? new Date().toISOString() : null } })
  }
  if (req.method === 'POST' && url.pathname === '/__pay') { const b = JSON.parse((await read(req)).toString()); const t = tx.get(b.reference); if (!t) return send(404, { ok: false }); Object.assign(t, b.override ?? {}, { status: b.status }); return send(200, { ok: true }) }
  if (url.pathname === '/__tx') return send(200, Object.fromEntries(tx))
  send(404, { status: false })
}).listen(54400, '127.0.0.1')
console.log('servers up')
