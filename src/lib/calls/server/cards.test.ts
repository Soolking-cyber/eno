import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * cards.ts + finish.ts — what a call leaves behind, what a BLOCKED or KILLED call must not, and that no lock screen
 * keeps an "Incoming call" once the ring is over (round-5 review).
 */
type Push = { to: string; title: string; body?: string; tag?: string; silent?: boolean; ring?: boolean; opts?: Record<string, unknown> }
const h = vi.hoisted(() => ({
  inserted: [] as string[],
  bells: [] as string[],
  pushes: [] as Push[],
  revoked: [] as (string | null)[],
  liveState: 'ringing' as string | null,
  /** States loadCall answers first, one per call, before falling back to liveState. */
  states: [] as (string | null)[],
  thread: true,
}))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => (h.thread ? { id: 'c1', buyerProfileId: 'a', sellerProfileId: 'b', listingId: 'l1' } : null) },
    profile: { findUnique: async () => ({ displayName: 'Lan', email: null }) },
    notification: { create: async ({ data }: { data: { type: string } }) => { h.bells.push(data.type); return {} } },
  },
}))
vi.mock('@/lib/messages', () => ({ insertMessage: async (_c: unknown, _s: string, text: string) => { h.inserted.push(text); return {} } }))
vi.mock('@/lib/push', () => ({
  sendPushToProfile: async (to: string, p: Omit<Push, 'to' | 'opts'>, opts?: Record<string, unknown>) => { h.pushes.push({ to, ...p, opts }); return 1 },
}))
vi.mock('./session', () => ({
  RING_TIMEOUT_S: 45,
  loadCall: async () => { const s = h.states.length ? h.states.shift() : h.liveState; return s ? { state: s } : null },
}))
vi.mock('./relay', () => ({ revokeRelayCredential: async (_p: string, handle: string | null) => { h.revoked.push(handle) } }))

const { ANSWERED_TEXT, RING_OVER_TEXT, callNotificationTag, callPushTopic, replaceRingPush, sendRingPush, writeCallRecord, writeCallRequest } = await import('./cards')
const { afterCallEnded } = await import('./finish')
const row = (o: Record<string, unknown> = {}) => ({
  id: 'call-1', conversation_id: 'c1', caller_id: 'a', callee_id: 'b', media: 'audio', state: 'ringing', connected_at: null, connected_secs: null,
  relay_provider: 'cloudflare', caller_relay_user: 'ru-a', callee_relay_user: 'ru-b', ...o,
}) as never

beforeEach(() => { h.inserted = []; h.bells = []; h.pushes = []; h.revoked = []; h.liveState = 'ringing'; h.states = []; h.thread = true })

describe('ring push priority — urgency, lifetime and ONE topic per call', () => {
  it('the ring: high urgency, lives no longer than the ring, no badge aggregates, marked as a ring', async () => {
    await sendRingPush(row())
    expect(h.pushes).toMatchObject([{ ring: true, opts: { urgency: 'high', ttlSec: 45, topic: callPushTopic('call-1'), skipBadge: true } }])
  })

  it('⛔ the ring, its replacement and the missed-call push share ONE topic (a delayed ring never lands after its end)', async () => {
    await sendRingPush(row())
    await replaceRingPush(row(), ANSWERED_TEXT, true)
    await writeCallRecord(row(), 'missed')
    const topics = h.pushes.map((p) => p.opts?.topic)
    expect(topics).toHaveLength(3)
    expect(new Set(topics)).toEqual(new Set([callPushTopic('call-1')]))
    // Only the ring is a ring; the lines that end it are urgent too, with the default lifetime.
    expect(h.pushes.map((p) => p.ring === true)).toEqual([true, false, false])
    expect(h.pushes.slice(1).map((p) => [p.opts?.urgency, p.opts?.ttlSec])).toEqual([['high', undefined], ['high', undefined]])
  })

  it('answered while the ring was on its way: "Answered" goes out again AFTER the ring, so no sticky ring sits over a live call', async () => {
    h.states = ['ringing', 'accepted']
    await sendRingPush(row())
    expect(h.pushes.map((p) => [p.body, p.ring === true, p.silent === true])).toEqual([['Cuộc gọi đến · Incoming call', true, false], [ANSWERED_TEXT, false, true]])
  })

  it('a ring that ENDED meanwhile is not re-replaced — its missed-call / "call ended" push stands', async () => {
    h.states = ['ringing', 'ended']
    await sendRingPush(row())
    h.states = ['ringing', 'ringing']
    await sendRingPush(row())
    expect(h.pushes.map((p) => p.ring === true)).toEqual([true, true])
  })

  it('the topic is ≤ 32 URL-safe base64 characters, stable per call, different between calls', () => {
    const t = callPushTopic('cmuh33qrd000301no3mhk7h75-a-long-call-id-0000000000000000')
    expect(t).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(callPushTopic('call-1')).toBe(callPushTopic('call-1'))
    expect(callPushTopic('call-1')).not.toBe(callPushTopic('call-2'))
  })
})

describe('writeCallRecord', () => {
  it('a missed call: the record, a bell and a push to the callee that replaces the ring (true)', async () => {
    expect(await writeCallRecord(row(), 'missed')).toBe(true)
    expect(h.inserted).toEqual(['📞 Cuộc gọi nhỡ · Missed call'])
    expect(h.bells).toEqual(['call_missed'])
    expect(h.pushes).toMatchObject([{ to: 'b', tag: callNotificationTag('call-1') }])
  })

  it('⛔ a BLOCKED call leaves nothing — no row authored by the blocked person, no bell, no push naming them', async () => {
    expect(await writeCallRecord(row(), 'blocked')).toBe(false)
    expect([h.inserted, h.bells, h.pushes]).toEqual([[], [], []])
  })

  it('the kill switch and a decline write the record but ring no bell', async () => {
    expect(await writeCallRecord(row(), 'kill_switch')).toBe(false)
    expect(await writeCallRecord(row(), 'declined')).toBe(false)
    expect(h.inserted).toHaveLength(2)
    expect([h.bells, h.pushes]).toEqual([[], []])
  })

  it('a completed call carries its SQL-measured length; an erased account gets nothing', async () => {
    await writeCallRecord(row({ state: 'connected', connected_at: new Date(), connected_secs: 192.4 }), 'hangup')
    expect(h.inserted).toEqual(['📞 Cuộc gọi · Call · 3:12'])
    expect(await writeCallRecord(row({ caller_id: null }), 'missed')).toBe(false)
    expect(h.inserted).toHaveLength(1)
  })
})

describe('the ring on the lock screen', () => {
  it('rings only a call that is STILL ringing when the push goes out', async () => {
    await sendRingPush(row())
    expect(h.pushes).toMatchObject([{ to: 'b', title: 'Lan', tag: callNotificationTag('call-1') }])
    h.pushes = []
    for (const s of ['accepted', 'ended', null]) {
      h.liveState = s
      await sendRingPush(row())
    }
    expect(h.pushes).toEqual([])
  })

  it('a replacement is SILENT, under the same tag; unnamed it says "eno" and never the caller', async () => {
    await replaceRingPush(row(), ANSWERED_TEXT, true)
    await replaceRingPush(row(), RING_OVER_TEXT, false)
    await replaceRingPush(row({ caller_id: null }), RING_OVER_TEXT, true)
    expect(h.pushes.map(({ opts: _opts, ...p }) => p)).toEqual([
      { to: 'b', title: 'Lan', body: ANSWERED_TEXT, url: '/messages/c1', tag: callNotificationTag('call-1'), silent: true },
      { to: 'b', title: 'eno', body: RING_OVER_TEXT, url: '/messages/c1', tag: callNotificationTag('call-1'), silent: true },
      { to: 'b', title: 'eno', body: RING_OVER_TEXT, url: '/messages/c1', tag: callNotificationTag('call-1'), silent: true },
    ])
  })

  it('every ring that ends is replaced exactly once: by the missed-call push, else by "call ended" (blocked: unnamed)', async () => {
    const tags = () => h.pushes.map((p) => [p.title, p.body, p.silent === true])
    await afterCallEnded(row(), 'missed')
    expect(tags()).toEqual([['Lan', 'Cuộc gọi nhỡ · Missed call', false]])
    for (const [reason, title] of [['declined', 'Lan'], ['kill_switch', 'Lan'], ['blocked', 'eno']] as const) {
      h.pushes = []
      await afterCallEnded(row(), reason)
      expect(tags()).toEqual([[title, RING_OVER_TEXT, true]])
    }
    // A call that ended after it was answered has no ring left to replace (the accept replaced it).
    h.pushes = []
    await afterCallEnded(row({ state: 'connected', connected_at: new Date(), connected_secs: 5 }), 'hangup')
    expect(h.pushes).toEqual([])
    expect(h.revoked).toContain('ru-a')
    expect(h.revoked).toContain('ru-b')
  })

  it('an erased caller (id taken off the row): no record, and the callee\'s ring is replaced without a name', async () => {
    await afterCallEnded(row({ caller_id: null }), 'hangup')
    expect(h.inserted).toEqual([])
    expect(h.pushes).toMatchObject([{ to: 'b', title: 'eno', body: RING_OVER_TEXT, silent: true }])
  })
})

describe('writeCallRequest', () => {
  it('true once the card is written; false — nothing written — when the thread is gone', async () => {
    expect(await writeCallRequest('c1', 'a', 'b')).toBe(true)
    expect(h.inserted).toEqual(['📞 Muốn gọi cho bạn · Would like to call you'])
    h.thread = false
    expect(await writeCallRequest('c1', 'a', 'b')).toBe(false)
    expect(h.inserted).toHaveLength(1)
  })
})
