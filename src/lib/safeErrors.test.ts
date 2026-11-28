import { describe, expect, it } from 'vitest'
import { safeMessage, withSafeErrors } from './safeErrors'

describe('safeMessage', () => {
  it('keeps messages written for people', () => {
    expect(safeMessage('Not enough stock for Indomie carton.')).toBe('Not enough stock for Indomie carton.')
    expect(safeMessage('UNAUTHORIZED: Health center access required')).toBe('UNAUTHORIZED: Health center access required')
  })
  it('replaces database wording', () => {
    expect(safeMessage('new row for relation "products" violates check constraint "products_stock_check"', '23514')).toBe('That value is not allowed.')
    expect(safeMessage('duplicate key value violates unique constraint "products_org_sku_key"', '23505')).toBe('That already exists.')
    expect(safeMessage('Could not find the function public.admin_get_x in the schema cache', 'PGRST202')).toBe('Something went wrong. Please try again.')
    expect(safeMessage('JWT expired', 'PGRST301')).toBe('Your session has expired. Please sign in again.')
  })
})

describe('withSafeErrors', () => {
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  it('cleans an error body but keeps the code', async () => {
    const wrapped = withSafeErrors(async () => json({ code: '23505', message: 'duplicate key value violates unique constraint "x"', details: 'Key (sku)=(A) already exists.', hint: null }, 409))
    const response = await wrapped('https://example.test/rest/v1/products')
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe('23505')
    expect(body.message).toBe('That already exists.')
    expect(body.details).toBeUndefined()
  })
  it('leaves successful responses alone', async () => {
    const wrapped = withSafeErrors(async () => json({ ok: 'relation' }, 200))
    expect(await (await wrapped('https://example.test')).json()).toEqual({ ok: 'relation' })
  })
})

import { scrubMessage } from './errorReporting'
describe('scrubMessage', () => {
  it('removes personal details before an error is reported', () => {
    const out = scrubMessage('Could not load Ada owner@shop.ng id 3a226e5e-1617-49f4-b05c-88581661fd20 at https://x.test/a phone 08035550142')
    expect(out).not.toContain('owner@shop.ng')
    expect(out).not.toContain('3a226e5e')
    expect(out).not.toContain('https://')
    expect(out).not.toContain('08035550142')
  })
})
