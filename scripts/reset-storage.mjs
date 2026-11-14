// Erases the FILES (business logos) as part of a full reset. SQL is not allowed to delete storage files, so this goes
// through Supabase's own Storage API.  See docs/RESET.md.
//
//   Preview (deletes nothing):  node scripts/reset-storage.mjs
//   Really delete:              node scripts/reset-storage.mjs --yes
//
// Needs two values in the environment, set only for this command and never saved in a file or committed:
//   SUPABASE_URL                 e.g. https://abcdxyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    Dashboard -> Project Settings -> API -> service_role (a secret: it can do anything)
import { pathToFileURL } from 'node:url'

export const BUCKETS = ['business-logos']

/** Every file path in a bucket, walking into folders (a folder shows up as an entry with no id). */
export async function listAllFiles(storage, bucket, prefix = '') {
  const files = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage
      .from(bucket)
      .list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`Could not list ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null || entry.id === undefined) files.push(...(await listAllFiles(storage, bucket, path)))
      else files.push(path)
    }
    if (data.length < 100) break
  }
  return files
}

/** Deletes every file in a bucket (or only counts them when dryRun is true). Returns how many were found and removed. */
export async function emptyBucket(storage, bucket, { dryRun = true } = {}) {
  const files = await listAllFiles(storage, bucket)
  let removed = 0
  if (!dryRun) {
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100)
      const { error } = await storage.from(bucket).remove(batch)
      if (error) throw new Error(`Could not delete from ${bucket}: ${error.message}`)
      removed += batch.length
    }
  }
  return { found: files.length, removed }
}

async function main() {
  const url = (process.env.SUPABASE_URL ?? '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const really = process.argv.includes('--yes')
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !key) {
    console.error(
      'Set SUPABASE_URL (https://<project>.supabase.co) and SUPABASE_SERVICE_ROLE_KEY first. See docs/RESET.md.',
    )
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  console.log(`Project: ${new URL(url).host}`)
  console.log(
    really ? 'MODE: DELETE (you passed --yes)\n' : 'MODE: preview only. Nothing is deleted. Add --yes to delete.\n',
  )
  for (const bucket of BUCKETS) {
    const { found, removed } = await emptyBucket(client.storage, bucket, { dryRun: !really })
    console.log(`${bucket}: ${found} file(s) found${really ? `, ${removed} deleted` : ''}`)
  }
  console.log(really ? '\nDone.' : '\nIf the project name above is the right one, run again with --yes.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
