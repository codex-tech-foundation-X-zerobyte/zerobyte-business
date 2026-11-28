import { describe, expect, it } from 'vitest'
import { crc32, createZip } from './zip'

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('createZip', () => {
  it('writes entries a ZIP reader can find again, with UTF-8 names', () => {
    const zip = createZip([
      { name: 'products.csv', data: 'name,price\r\nRice,5000\r\n' },
      { name: 'notes/éàü.txt', data: new Uint8Array([1, 2, 3]) },
    ])
    const view = new DataView(zip.buffer)
    // End of central directory is the last 22 bytes.
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    let at = view.getUint32(end + 16, true)
    const found: { name: string; size: number; crc: number; start: number }[] = []
    for (let index = 0; index < 2; index++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50)
      const nameLength = view.getUint16(at + 28, true)
      found.push({
        name: new TextDecoder().decode(zip.slice(at + 46, at + 46 + nameLength)),
        size: view.getUint32(at + 24, true),
        crc: view.getUint32(at + 16, true),
        start: view.getUint32(at + 42, true),
      })
      at += 46 + nameLength
    }
    expect(found.map((entry) => entry.name)).toEqual(['products.csv', 'notes/éàü.txt'])
    const first = found[0]
    const nameLength = view.getUint16(first.start + 26, true)
    const body = zip.slice(first.start + 30 + nameLength, first.start + 30 + nameLength + first.size)
    expect(new TextDecoder().decode(body)).toBe('name,price\r\nRice,5000\r\n')
    expect(crc32(body)).toBe(first.crc)
  })
})
