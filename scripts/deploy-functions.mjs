// Deploys every Edge Function in supabase/functions with one command: npm run supabase:functions:deploy
// (add --with-codex to include the three optional codex-* functions). Each function checks the caller itself, so they
// are all deployed with --no-verify-jwt, exactly as the individual scripts did.
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'

const withCodex = process.argv.includes('--with-codex')
const names = readdirSync('supabase/functions').filter(
  (name) =>
    !name.startsWith('_') &&
    statSync(`supabase/functions/${name}`).isDirectory() &&
    (withCodex || !name.startsWith('codex-')),
)
let failed = 0
for (const name of names) {
  console.log(`\n> deploying ${name}`)
  const result = spawnSync('supabase', ['functions', 'deploy', name, '--no-verify-jwt'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) failed += 1
}
if (failed) {
  console.error(`\n${failed} function(s) failed to deploy.`)
  process.exit(1)
}
console.log(`\nDeployed ${names.length} functions.`)
