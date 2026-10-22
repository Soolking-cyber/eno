import { describe, expect, it } from 'vitest'
import { ipv6Prefix64, rateKeyForIp } from './ip-key'

// Security review 2026-10-22, item 14: an IP-scoped limit keyed on the full IPv6 address gave a caller a fresh bucket
// per address in their own /64. rateKeyForIp collapses a /64 to one key and leaves IPv4 alone.
describe('rateKeyForIp', () => {
  it('keys IPv4 as is', () => {
    expect(rateKeyForIp('203.0.113.7')).toBe('203.0.113.7')
  })
  it('collapses every address in one IPv6 /64 to the same key', () => {
    const a = rateKeyForIp('2405:4803:c7fd:1::9')
    expect(rateKeyForIp('2405:4803:c7fd:1:ffff:ffff:ffff:ffff')).toBe(a)
    expect(rateKeyForIp('2405:4803:c7fd:0001:0:0:0:1')).toBe(a)
    expect(a).toBe('v6:2405:4803:c7fd:1')
  })
  it('keeps different /64s apart', () => {
    expect(rateKeyForIp('2405:4803:c7fd:2::1')).not.toBe(rateKeyForIp('2405:4803:c7fd:1::1'))
  })
  it('the moved helper behaves as before', () => {
    expect(ipv6Prefix64('2405:4803::1')).toBe('2405:4803:0:0')
  })
})
