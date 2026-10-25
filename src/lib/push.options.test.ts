import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * push.ts — the Web Push delivery options (urgency, TTL, topic) reach webpush.sendNotification, and a push that asks
 * to skip the badge aggregates skips them. A push that asks for nothing goes out exactly as before.
 */
const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  return { sent: [] as { body: string; options: unknown }[], badgeCalls: 0 }
})
vi.mock('server-only', () => ({}))
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (_sub: unknown, body: string, options?: unknown) => { h.sent.push({ body, options }) },
  },
}))
vi.mock('./db', () => ({
  db: { pushSubscription: { findMany: async () => [{ endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' }], deleteMany: async () => ({}) } },
}))
vi.mock('./native-push', () => ({ sendNativePushToProfile: async () => {} }))
vi.mock('./unread', () => ({ badgeCountFor: async () => { h.badgeCalls++; return 7 } }))

const { sendPushToProfile, webPushOptions } = await import('./push')

beforeEach(() => { h.sent = []; h.badgeCalls = 0 })

describe('sendPushToProfile options', () => {
  it('urgency, TTL and topic reach the push service; skipBadge skips the aggregates', async () => {
    await sendPushToProfile('p1', { title: 'Lan', tag: 'call-1', ring: true }, { urgency: 'high', ttlSec: 45, topic: 'abc_DEF-123', skipBadge: true })
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].options).toEqual({ urgency: 'high', TTL: 45, topic: 'abc_DEF-123' })
    expect(JSON.parse(h.sent[0].body)).toEqual({ title: 'Lan', tag: 'call-1', ring: true })
    expect(h.badgeCalls).toBe(0)
  })

  it('a push that asks for nothing goes out as before: no options set, the badge stamped', async () => {
    await sendPushToProfile('p1', { title: 'Offer' })
    expect(h.sent[0].options).toEqual({})
    expect(JSON.parse(h.sent[0].body)).toEqual({ title: 'Offer', badge: 7 })
    expect(h.badgeCalls).toBe(1)
  })

  it('webPushOptions passes only what was asked for, with a whole, non-negative TTL', () => {
    expect(webPushOptions({})).toEqual({})
    expect(webPushOptions({ ttlSec: 0 })).toEqual({ TTL: 0 })
    expect(webPushOptions({ ttlSec: 44.7 })).toEqual({ TTL: 44 })
    expect(webPushOptions({ ttlSec: -3, skipBadge: true })).toEqual({ TTL: 0 })
  })
})
