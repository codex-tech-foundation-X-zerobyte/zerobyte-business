// Types for support-client.mjs (the Codex Customer Service client). Only what this project uses is described.
export class SupportError extends Error {
  status: number
  retryAfterSeconds?: number
  constructor(status: number, message: string, extra?: Record<string, unknown>)
}
export interface TicketReport {
  external_ref: string
  customer_ref?: string
  customer_name?: string
  subject: string
  description: string
  category?: 'bug' | 'billing' | 'account' | 'how_to' | 'feedback' | 'other'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}
export interface SupportClient {
  createTicket(report: TicketReport): Promise<{ ticket: string | null; duplicate: boolean }>
  getTicket(externalRef: string): Promise<{ ticket?: Record<string, unknown>; messages?: { from: 'support' | 'customer'; body: string; at: string }[]; attachments?: unknown[] }>
  reply(externalRef: string, body: string): Promise<{ ok: true }>
  rate(externalRef: string, rating: number, note?: string): Promise<{ ok: true }>
  attachmentLink(externalRef: string, attachmentId: string): Promise<{ url: string; expires_in: number }>
}
export function createSupportClient(options: {
  baseUrl: string
  key: string
  fetch?: typeof fetch
  timeoutMs?: number
  retries?: number
  wait?: (ms: number) => Promise<void>
}): SupportClient
export function verifyCallback(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  options?: { nowSeconds?: number; toleranceSeconds?: number },
): Promise<boolean>
