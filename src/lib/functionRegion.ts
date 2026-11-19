// Supabase runs an Edge Function in the region closest to the caller by default. Our functions then make several
// calls to the database and Auth, which live in ONE region, so a function running far from the database pays the long
// trip on every call (a visitor in Lagos hitting a function in one place and a database in eu-west-1, for example).
// Setting VITE_FUNCTIONS_REGION to the database's region (Supabase > Project Settings shows it) runs the functions next
// to the database instead. It goes in the address (?forceFunctionRegion=), which needs no extra CORS header.
const REGIONS = new Set([
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
  'us-east-1',
  'us-west-1',
  'us-west-2',
])

const configured = String(import.meta.env.VITE_FUNCTIONS_REGION ?? '').trim()
export const functionsRegion = REGIONS.has(configured) ? configured : ''

/** Adds the region to an Edge Function address. Anything else (tables, Auth, storage) is returned unchanged. */
export function withFunctionRegion(input: string, region = functionsRegion) {
  if (!region || !input.includes('/functions/v1/')) return input
  try {
    const url = new URL(input)
    if (!url.searchParams.has('forceFunctionRegion')) url.searchParams.set('forceFunctionRegion', region)
    return url.toString()
  } catch {
    return input
  }
}

/** A fetch that applies withFunctionRegion; passed to the Supabase clients so every functions.invoke call uses it. */
export function regionalFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!functionsRegion) return fetch(input, init)
  if (typeof input === 'string') return fetch(withFunctionRegion(input), init)
  if (input instanceof URL) return fetch(withFunctionRegion(input.toString()), init)
  const rewritten = withFunctionRegion(input.url)
  return fetch(rewritten === input.url ? input : new Request(rewritten, input), init)
}
