import { describe, expect, it } from 'vitest'
import { computeOverallHealth, evaluateHealth, slowServiceHints, statusLabel } from './monitoring'

describe('evaluateHealth', () => {
  it('grades a fast successful response as healthy', () => {
    expect(evaluateHealth(0).status).toBe('healthy')
    expect(evaluateHealth(200).status).toBe('healthy')
    expect(evaluateHealth(500).status).toBe('healthy')
  })

  it('grades a successful response just over 500ms as degraded', () => {
    expect(evaluateHealth(501).status).toBe('degraded')
    expect(evaluateHealth(1000).status).toBe('degraded')
  })

  it('grades a successful response between 1001ms and 2000ms as slow', () => {
    expect(evaluateHealth(1001).status).toBe('slow')
    expect(evaluateHealth(2000).status).toBe('slow')
  })

  it('grades a successful response over 2000ms as critical', () => {
    expect(evaluateHealth(2001).status).toBe('critical')
    expect(evaluateHealth(9999).status).toBe('critical')
  })

  it('treats a null latency (nothing to time) as healthy', () => {
    expect(evaluateHealth(null).status).toBe('healthy')
  })

  it('grades a definite error as unhealthy regardless of how fast it arrived', () => {
    // The spec this was built against is explicit: a fast HTTP 500 is still
    // a failure, not a "healthy" result that happened to be quick.
    expect(evaluateHealth(50, { definiteError: true }).status).toBe('unhealthy')
    expect(evaluateHealth(5000, { definiteError: true }).status).toBe('unhealthy')
  })

  it('never reports every successful response as uniformly "Healthy"', () => {
    // This is the specific defect the health-tier work was fixing: every
    // HTTP 200 being labelled Healthy no matter how slow it was.
    const statuses = [100, 700, 1500, 3000].map((latency) => evaluateHealth(latency).status)
    expect(new Set(statuses).size).toBeGreaterThan(1)
  })
})

describe('statusLabel', () => {
  it('gives every status a distinct, human-readable label', () => {
    const statuses = ['healthy', 'degraded', 'slow', 'critical', 'unhealthy', 'failed', 'unavailable', 'configuration'] as const
    const labels = statuses.map((status) => statusLabel(status))
    expect(new Set(labels).size).toBe(statuses.length)
    expect(labels).not.toContain(undefined)
  })

  it('never uses the phrase "Healthy response" for every successful check', () => {
    expect(statusLabel('degraded')).not.toMatch(/healthy/i)
    expect(statusLabel('slow')).not.toMatch(/healthy/i)
  })
})

describe('slowServiceHints', () => {
  it('has diagnostic hints for every service the monitoring page checks', () => {
    const checkedServices = ['API', 'Database', 'Storage', 'Realtime', 'Edge Functions', 'GitHub', 'Vercel', 'Frontend']
    for (const service of checkedServices) {
      expect(slowServiceHints[service]?.length).toBeGreaterThan(0)
    }
  })

  it('phrases hints as possibilities, not assertions', () => {
    for (const hints of Object.values(slowServiceHints)) {
      for (const hint of hints) {
        expect(hint.toLowerCase()).not.toMatch(/^(is|was|caused by)\b/)
      }
    }
  })
})

describe('computeOverallHealth', () => {
  it('reports monitoring incomplete when no checks have run', () => {
    expect(computeOverallHealth([]).label).toBe('Monitoring incomplete')
  })

  it('reports operational when everything is healthy', () => {
    const metrics = [{ name: 'API', status: 'healthy' as const }, { name: 'Database', status: 'healthy' as const }]
    expect(computeOverallHealth(metrics).label).toBe('Operational')
  })

  it('reports a major outage when a core service is down', () => {
    const metrics = [{ name: 'API', status: 'failed' as const }, { name: 'Database', status: 'healthy' as const }]
    expect(computeOverallHealth(metrics).label).toBe('Major outage')
  })

  it('reports a major outage when three or more services are down, even if none are core', () => {
    const metrics = [
      { name: 'GitHub', status: 'failed' as const },
      { name: 'Vercel', status: 'unhealthy' as const },
      { name: 'Storage', status: 'failed' as const },
    ]
    expect(computeOverallHealth(metrics).label).toBe('Major outage')
  })

  it('reports a partial outage for a single non-core failure', () => {
    const metrics = [{ name: 'API', status: 'healthy' as const }, { name: 'GitHub', status: 'failed' as const }]
    expect(computeOverallHealth(metrics).label).toBe('Partial outage')
  })

  it('reports degraded when a service is critically slow but nothing has failed outright', () => {
    const metrics = [{ name: 'API', status: 'healthy' as const }, { name: 'Edge Functions', status: 'critical' as const }]
    expect(computeOverallHealth(metrics).label).toBe('Degraded')
  })

  it('reports operational with warnings for a merely slow or unconfirmed service', () => {
    const metrics = [{ name: 'API', status: 'healthy' as const }, { name: 'Storage', status: 'degraded' as const }]
    expect(computeOverallHealth(metrics).label).toBe('Operational with warnings')
  })

  it('never claims fully operational when a service could not be confirmed', () => {
    const metrics = [{ name: 'API', status: 'healthy' as const }, { name: 'Realtime', status: 'unavailable' as const }]
    expect(computeOverallHealth(metrics).label).not.toBe('Operational')
  })
})
