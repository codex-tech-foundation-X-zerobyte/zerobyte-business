import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cache talks to window.localStorage, so the tests give it a tiny stand-in.
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
    ...Object.fromEntries([]),
    __keys: () => [...data.keys()],
  }
}

describe('data cache', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(async () => {
    vi.resetModules()
    store = fakeStorage()
    // Object.keys(localStorage) must list the saved keys, as a real browser does.
    const proxy = new Proxy(store, { ownKeys: () => store.__keys(), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) })
    vi.stubGlobal('window', { localStorage: proxy })
  })

  it('returns what was saved, and nothing for an unknown key', async () => {
    const { readStale, writeCache } = await import('./dataCache')
    expect(readStale('a')).toBeNull()
    writeCache('a', { rows: [1, 2, 3] })
    expect(readStale('a')).toEqual({ rows: [1, 2, 3] })
  })

  it('ignores a copy older than the limit', async () => {
    const { readStale, writeCache } = await import('./dataCache')
    writeCache('old', 'x')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 1000 * 60 * 60 * 24 * 8)
    expect(readStale('old')).toBeNull()
    vi.useRealTimers()
  })

  it('invalidates by prefix and clears everything on sign-out', async () => {
    const { clearDataCache, invalidateCache, readStale, writeCache } = await import('./dataCache')
    writeCache('inventory:org1:all', 1)
    writeCache('inventory:org1:low', 2)
    writeCache('reports:org1', 3)
    invalidateCache('inventory:org1')
    expect(readStale('inventory:org1:all')).toBeNull()
    expect(readStale('inventory:org1:low')).toBeNull()
    expect(readStale('reports:org1')).toBe(3)
    clearDataCache()
    expect(readStale('reports:org1')).toBeNull()
    expect(store.__keys()).toEqual([])
  })

  it('does not store a copy that is too large, and survives blocked storage', async () => {
    const { readStale, writeCache } = await import('./dataCache')
    writeCache('big', 'x'.repeat(300_000))
    expect(store.__keys()).toEqual([])
    expect(readStale('big')).toBe('x'.repeat(300_000)) // memory still has it for this visit
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('blocked')
      },
    })
    expect(() => writeCache('b', 1)).not.toThrow()
  })
})
