import { describe, expect, it } from 'vitest'
import { withFunctionRegion } from './functionRegion'

describe('withFunctionRegion', () => {
  it('adds the region to Edge Function addresses only', () => {
    expect(withFunctionRegion('https://abc.supabase.co/functions/v1/list-platform-users?page=1', 'eu-west-1')).toBe(
      'https://abc.supabase.co/functions/v1/list-platform-users?page=1&forceFunctionRegion=eu-west-1',
    )
    expect(withFunctionRegion('https://abc.supabase.co/rest/v1/profiles', 'eu-west-1')).toBe(
      'https://abc.supabase.co/rest/v1/profiles',
    )
  })
  it('does nothing without a region and never doubles the parameter', () => {
    expect(withFunctionRegion('https://abc.supabase.co/functions/v1/x', '')).toBe(
      'https://abc.supabase.co/functions/v1/x',
    )
    const once = withFunctionRegion('https://abc.supabase.co/functions/v1/x', 'eu-west-1')
    expect(withFunctionRegion(once, 'eu-west-1')).toBe(once)
  })
})
