// usage: node cssdrop.mjs <selector-regex> [--dry]   removes matching selectors from the legacy stylesheets
import postcss from 'postcss'
import fs from 'fs'
const pat = new RegExp(process.argv[2])
const dry = process.argv.includes('--dry')
const skipVars = process.argv.includes('--skip-vars') // never touch rules that define --custom-properties
const files = ['styles.css', 'design.css', 'polish.css', 'theme.css', 'layout.css', 'scroll.css']
let total = 0
for (const f of files) {
  const path = 'src/' + f
  const root = postcss.parse(fs.readFileSync(path, 'utf8'))
  let removed = 0
  root.walkRules((rule) => {
    if (skipVars && rule.nodes.some((n) => n.prop && n.prop.startsWith('--'))) return
    const keep = rule.selectors.filter((s) => !pat.test(s))
    if (keep.length === rule.selectors.length) return
    removed += rule.selectors.length - keep.length
    if (keep.length === 0) rule.remove()
    else rule.selector = keep.join(', ')
  })
  root.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) at.remove() })
  if (removed && !dry) fs.writeFileSync(path, root.toString())
  if (removed) console.log(f.padEnd(12), 'selectors removed:', removed)
  total += removed
}
console.log('TOTAL', total, dry ? '(dry run)' : '')
