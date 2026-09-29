export type AdminSection =
  | 'Overview' | 'Users' | 'Organizations' | 'Subscriptions' | 'Plans' | 'Promoters'
  | 'Branches' | 'Inventory' | 'Sales' | 'Notifications' | 'Messages' | 'Feedback'
  | 'Roadmap' | 'Audit log' | 'Monitoring' | 'Revenue' | 'Settings'

export type AdminRow = Record<string, string | number | null>

export type AuditEntry = {
  source: string; id: string; action: string; actor: string | null; target: string
  organizationId: string | null; metadata: Record<string, unknown>; createdAt: string
  category: string; severity: 'info' | 'warning' | 'critical'
}

export type MonitorMetric = import('../lib/monitoring').MonitorMetric

// Shared between runMonitoringChecks and the monitorRealtimeWait ref (which
// needs the type at module scope, since a ref is declared outside the
// callback that produces its value).
export type ProbeOutcome = {
  status: 'success' | 'failed' | 'unhealthy' | 'unavailable' | 'configuration'
  detail?: string; httpStatus?: number; errorCode?: string
}

export type MonitorSummary = {
  service: string; checks: number; healthy: number; failed: number; unavailable: number; configuration: number
  http_4xx_count: number; http_5xx_count: number; timeout_count: number
  uptime_percent: number | null; average_latency_ms: number | null; min_latency_ms: number | null; max_latency_ms: number | null
  p50_latency_ms: number | null; p95_latency_ms: number | null; p99_latency_ms: number | null
  last_success_at: string | null; last_failure_at: string | null; consecutive_failures: number
}
