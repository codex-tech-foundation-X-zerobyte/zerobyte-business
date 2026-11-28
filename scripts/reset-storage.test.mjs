import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyBucket, listAllFiles } from './reset-storage.mjs'

// A stand-in for Supabase Storage: nested folders, paging of 100 per request, and a log of what was removed.
function fakeStorage(tree) {
  const removed = []
  const entries = (prefix) => {
    const node = prefix ? prefix.split('/').reduce((n, part) => n[part], tree) : tree
    return Object.entries(node).map(([name, value]) =>
      typeof value === 'object' ? { name, id: null } : { name, id: `id-${name}` },
    )
  }
  return {
    removed,
    from: () => ({
      list: async (prefix, { limit, offset }) => ({ data: entries(prefix).slice(offset, offset + limit), error: null }),
      remove: async (paths) => {
        removed.push(...paths)
        return { error: null }
      },
    }),
  }
}

const bigFolder = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`logo-${i}.png`, 'file']))
const tree = () => ({
  'org-1': { 'logo.png': 'file', nested: { 'deep.webp': 'file' } },
  'org-2': bigFolder,
  'loose.png': 'file',
})

test('finds every file in nested folders and across pages', async () => {
  const files = await listAllFiles(fakeStorage(tree()), 'business-logos')
  assert.equal(files.length, 1 + 1 + 1 + 250)
  assert.ok(files.includes('org-1/nested/deep.webp'))
  assert.ok(files.includes('org-2/logo-249.png'))
  assert.ok(files.includes('loose.png'))
})

test('preview mode deletes nothing', async () => {
  const storage = fakeStorage(tree())
  const result = await emptyBucket(storage, 'business-logos', { dryRun: true })
  assert.equal(result.found, 253)
  assert.equal(result.removed, 0)
  assert.equal(storage.removed.length, 0)
})

test('delete mode removes everything, in batches of at most 100', async () => {
  const storage = fakeStorage(tree())
  const result = await emptyBucket(storage, 'business-logos', { dryRun: false })
  assert.equal(result.removed, 253)
  assert.equal(new Set(storage.removed).size, 253)
})

test('defaults to preview when no option is given (safe by default)', async () => {
  const storage = fakeStorage(tree())
  const result = await emptyBucket(storage, 'business-logos')
  assert.equal(result.removed, 0)
  assert.equal(storage.removed.length, 0)
})

test('an API error stops the run instead of pretending it worked', async () => {
  const storage = fakeStorage(tree())
  storage.from = () => ({
    list: async () => ({ data: null, error: { message: 'boom' } }),
    remove: async () => ({ error: null }),
  })
  await assert.rejects(() => emptyBucket(storage, 'business-logos', { dryRun: false }), /boom/)
})
