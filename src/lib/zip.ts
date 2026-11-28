// A minimal ZIP writer (no compression, UTF-8 file names) so the whole business can be downloaded as ONE file that opens
// everywhere, without adding a library to the app. Every ZIP reader (Windows, macOS, Android, Excel's own) opens it.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: string | Uint8Array; modified?: Date }

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true)
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true)

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const when = entry.modified ?? new Date()
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2)
    const date = ((Math.max(when.getFullYear(), 1980) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20) // version needed
    u16(lv, 6, 0x0800) // flag: names are UTF-8
    u16(lv, 8, 0) // stored, not compressed
    u16(lv, 10, time)
    u16(lv, 12, date)
    u32(lv, 14, crc)
    u32(lv, 18, data.length)
    u32(lv, 22, data.length)
    u16(lv, 26, name.length)
    u16(lv, 28, 0)
    local.set(name, 30)

    const header = new Uint8Array(46 + name.length)
    const hv = new DataView(header.buffer)
    u32(hv, 0, 0x02014b50)
    u16(hv, 4, 20)
    u16(hv, 6, 20)
    u16(hv, 8, 0x0800)
    u16(hv, 10, 0)
    u16(hv, 12, time)
    u16(hv, 14, date)
    u32(hv, 16, crc)
    u32(hv, 20, data.length)
    u32(hv, 24, data.length)
    u16(hv, 28, name.length)
    u32(hv, 42, offset)
    header.set(name, 46)

    parts.push(local, data)
    central.push(header)
    offset += local.length + data.length
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  u32(ev, 0, 0x06054b50)
  u16(ev, 8, entries.length)
  u16(ev, 10, entries.length)
  u32(ev, 12, centralSize)
  u32(ev, 16, offset)

  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...parts, ...central, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}
