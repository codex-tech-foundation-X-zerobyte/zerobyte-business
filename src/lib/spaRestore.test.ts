import { describe, expect, it } from 'vitest'
import { restoreSpaPath } from './spaRestore'

const run = (saved: string | null, base = '/') => {
  const store = new Map<string, string>(saved === null ? [] : [['zb-spa-restore', saved]])
  const calls: string[] = []
  const done = restoreSpaPath(
    { getItem: (key) => store.get(key) ?? null, removeItem: (key) => void store.delete(key) },
    { replaceState: (_data, _title, url) => void calls.push(String(url)) },
    base,
  )
  return { done, calls, left: store.size }
}

describe('restoreSpaPath', () => {
  it('puts a saved app or admin address back, once', () => {
    expect(run('/app/user-accounts')).toEqual({ done: true, calls: ['/app/user-accounts'], left: 0 })
    expect(run('/admin/users?page=2').calls).toEqual(['/admin/users?page=2'])
  })
  it('ignores anything else and clears it', () => {
    for (const bad of ['https://evil.example/app/x', '//evil.example', '/auth', '/app/../x', 'javascript:alert(1)'])
      expect(run(bad)).toEqual({ done: false, calls: [], left: 0 })
  })
  it('does nothing when nothing was saved or the site is not at the root', () => {
    expect(run(null).done).toBe(false)
    expect(run('/app/overview', '/zerobyte/')).toEqual({ done: false, calls: [], left: 1 })
  })
})
