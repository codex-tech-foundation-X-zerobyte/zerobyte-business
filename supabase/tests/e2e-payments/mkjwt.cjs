const crypto = require('crypto'); const SECRET = 'local-test-secret-local-test-secret-1234'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = (payload) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}` }
console.log(sign({ role: process.argv[2], iss: 'supabase', exp: 4102444800 }))
