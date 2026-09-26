import { existsSync, readFileSync } from 'node:fs'

const envPath = '.env.local'
if (!existsSync(envPath)) {
  console.error('Missing .env.local. Copy .env.example to .env.local and add your Supabase URL and anon key.')
  process.exit(1)
}

const values = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1).trim()]
    }),
)

const url = values.VITE_SUPABASE_URL
const key = values.VITE_SUPABASE_ANON_KEY
const validUrl = url && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)
const looksLikeJwt = key && key.split('.').length === 3

if (!validUrl || !looksLikeJwt) {
  console.error('Invalid Supabase configuration. Expected a https://<project-ref>.supabase.co URL and a publishable/anon JWT.')
  process.exit(1)
}

console.log(`Supabase environment ready for ${new URL(url).hostname}.`)
console.log('The browser uses the anon key only; service-role credentials must remain server-side.')
