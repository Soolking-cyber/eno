import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * NATIVE PUSH NEVER LEAVES THE FORUM BUILD (2026-10-06). Both apps render eno.vn and are published by the
 * licensed company; tokens carry no edition, so the services build must send nothing native — not even with
 * APNs configured. Fails closed: no token query, 0 sent.
 */
vi.mock('server-only', () => ({}))
const findMany = vi.fn(async () => [{ token: 't1', platform: 'ios' }])
vi.mock('./db', () => ({ db: { nativePushToken: { findMany, deleteMany: vi.fn() } } }))
vi.mock('./unread', () => ({ badgeCountFor: vi.fn(async () => 3) }))

afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); findMany.mockClear() })

describe('native push × edition', () => {
  it('services build: sends nothing and reads no token, even with APNs configured', async () => {
    vi.doMock('@/lib/edition', () => ({ IS_SERVICES: true, IS_MARKETPLACE: false }))
    vi.stubEnv('APNS_KEY_ID', 'K'); vi.stubEnv('APNS_TEAM_ID', 'T'); vi.stubEnv('APNS_KEY', 'x'); vi.stubEnv('APNS_BUNDLE_ID', 'vn.eno.app')
    const { sendNativePushToProfile, syncBadgeToProfile } = await import('./native-push')
    expect(await sendNativePushToProfile('p1', { title: 't', body: 'b', url: '/' } as never)).toBe(0)
    await syncBadgeToProfile('p1')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('marketplace build with nothing configured: still a no-op, no token read', async () => {
    vi.doMock('@/lib/edition', () => ({ IS_SERVICES: false, IS_MARKETPLACE: true }))
    const { sendNativePushToProfile } = await import('./native-push')
    expect(await sendNativePushToProfile('p1', { title: 't', body: 'b', url: '/' } as never)).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
