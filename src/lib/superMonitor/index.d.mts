// Types for index.mjs (the Codex Super Monitor client). Only what this project uses is described.
export const SDK_NAME: string
export const SDK_VERSION: string
export function fingerprintOf(name: string, message: string, topFrame?: string): string
export interface MonitorOptions {
  endpoint: string
  key: string
  environment?: string
  release?: string
  heartbeatSeconds?: number
  flushIntervalMs?: number
  maxBatch?: number
  maxQueue?: number
  fetch?: typeof fetch
  onAuthFailure?: () => void
  onDrop?: (dropped: number) => void
}
export interface Monitor {
  captureError(error: unknown, context?: { fatal?: boolean; route?: string }): void
  message(text: string, level?: 'info' | 'warning' | 'error' | 'fatal', context?: { route?: string }): void
  latency(route: string, ms: number, statusCode?: number): void
  heartbeat(): void
  flush(): Promise<{ sent: number; retry?: boolean; revoked?: boolean; ok?: boolean }>
  pending(): number
  start(options?: { target?: unknown; heartbeat?: boolean }): void
  stop(): void
}
export function createMonitor(options: MonitorOptions): Monitor
