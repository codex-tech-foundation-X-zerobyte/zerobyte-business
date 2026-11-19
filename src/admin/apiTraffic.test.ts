import { describe, expect, it } from 'vitest'
import {
  bucketMinutesFor,
  overallSql,
  seriesSql,
  servicesSql,
  summarize,
  toIsoUtc,
} from '../../supabase/functions/_shared/apiTraffic'

const now = new Date('2026-11-17T10:30:30Z')

describe('API traffic helpers', () => {
  it('uses wider buckets for longer windows', () => {
    expect(bucketMinutesFor(15)).toBe(1)
    expect(bucketMinutesFor(360)).toBe(5)
    expect(bucketMinutesFor(1440)).toBe(15)
  })

  it('reads ClickHouse times as UTC', () => {
    expect(toIsoUtc('2026-11-17 10:29:00')).toBe('2026-11-17T10:29:00.000Z')
    expect(toIsoUtc('2026-11-17T10:29:00Z')).toBe('2026-11-17T10:29:00.000Z')
    expect(toIsoUtc('nonsense')).toBe('')
  })

  it('builds queries the logs endpoint accepts (no select *, no count(*))', () => {
    for (const sql of [seriesSql(5), servicesSql(), overallSql()]) {
      expect(sql).not.toMatch(/select\s+\*/i)
      expect(sql).not.toMatch(/count\(\s*\*\s*\)/i)
      expect(sql).toContain("source = 'edge_logs'")
      expect(sql).toMatch(/limit \d+/)
    }
    expect(seriesSql(5)).toContain('INTERVAL 5 MINUTE')
  })

  it('turns rows into totals, a filled series and the last full minute', () => {
    const snapshot = summarize(
      15,
      [
        { minute: '2026-11-17 10:28:00', requests: '120', errors_5xx: '1' },
        { minute: '2026-11-17 10:29:00', requests: '60', errors_5xx: '0' },
        { minute: '2026-11-17 10:30:00', requests: '5', errors_5xx: '0' },
      ],
      [
        { service: 'rest', requests: '150', errors_5xx: '1', errors_4xx: '4', avg_ms: '41.6', p95_ms: '120' },
        { service: 'auth', requests: '35', errors_5xx: '0', errors_4xx: '0', avg_ms: '80', p95_ms: '200' },
      ],
      [{ requests: '185', avg_ms: '50', p95_ms: '180' }],
      now,
    )
    expect(snapshot.requests).toBe(185)
    expect(snapshot.errors_5xx).toBe(1)
    expect(snapshot.error_rate).toBe(0.54)
    expect(snapshot.rps_now).toBe(1) // 10:29 is the latest finished minute: 60 requests / 60 s
    expect(snapshot.rps_peak).toBe(2)
    expect(snapshot.p95_ms).toBe(180)
    expect(snapshot.series).toHaveLength(16)
    expect(snapshot.series.filter((point) => point.requests === 0).length).toBe(13)
  })

  it('is all zeros, not an error, when nothing was logged', () => {
    const snapshot = summarize(60, [], [], [], now)
    expect(snapshot.requests).toBe(0)
    expect(snapshot.rps_now).toBe(0)
    expect(snapshot.p95_ms).toBe(0)
  })
})
