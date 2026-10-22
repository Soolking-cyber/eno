import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * broadcast.ts + realtime.ts — a call event as the box's realtime.send() actually delivers it. The payloads below are
 * copied from realtime.messages on 2026-10-22 (the owner's first two-device test): realtime.send() had added `id` (the
 * row's own uuid) to each, every strict protocol schema refused the extra key, and no phone rang. (They carried v 1
 * then; the safety code's removal made the protocol v 2 the same day, so `v` follows CALL_PROTOCOL_VERSION here.)
 */
const h = vi.hoisted(() => ({
  onBroadcast: null as null | ((m: { payload: unknown }) => void),
  logError: vi.fn(),
}))
vi.mock('@/lib/log', () => ({ logError: h.logError }))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    realtime: { setAuth: async () => {} },
    getChannels: () => [],
    removeChannel: async () => {},
    channel: () => {
      const channel = {
        on: (_type: string, _filter: unknown, cb: (m: { payload: unknown }) => void) => { h.onBroadcast = cb; return channel },
        subscribe: () => channel,
      }
      return channel
    },
  }),
}))

import { parseEvent } from '../protocol'
import { CALL_PROTOCOL_VERSION } from '../types'
import { fromBroadcast } from './broadcast'
import { joinChannel, UNREADABLE_GAP_MS } from './realtime'

/** Verbatim from realtime.messages (the row's id is 449fe200-…, the same value realtime.send put in the payload). */
const DELIVERED_ANSWERED_ELSEWHERE = {
  v: CALL_PROTOCOL_VERSION, id: '449fe200-a68a-4b63-bfb8-4cbdbc556986', kind: 'answered_elsewhere', tabId: 'box',
  callId: 'c941774f-b162-4b6e-bafe-765025bdc550', payload: { calleeTabId: 't-f3715e58-ad7b-4a53-a8a2-7976e9482e31' },
  idempotencyKey: 'box-74e6f1c1-33f5-4823-a084-dacb95afb75a',
}
/** The ring that never rang, in the same shape. */
const DELIVERED_RING = {
  v: CALL_PROTOCOL_VERSION, id: 'e7f4689c-73f2-4c00-9d57-102805e5a85d', kind: 'ring', tabId: 'box',
  callId: '6801332d-fcba-4a72-beaf-fb3e7423b7de', payload: { media: 'audio' },
  idempotencyKey: 'box-0b9e3a52-6a43-4d0f-9d0b-6f1f3f2d8c11',
}

describe('fromBroadcast — the transport\'s id is not the protocol\'s', () => {
  // ⛔ If this starts failing, someone gave the protocol a top-level `id` — which fromBroadcast would strip (broadcast.ts).
  it('the delivered payload as it was: refused by the strict schema (the bug)', () => {
    expect(parseEvent(DELIVERED_RING).ok).toBe(false)
    expect(parseEvent(DELIVERED_ANSWERED_ELSEWHERE).ok).toBe(false)
  })

  it('without the id: a ring and an answered_elsewhere the engine can act on', () => {
    const ring = parseEvent(fromBroadcast(DELIVERED_RING))
    expect(ring.ok && ring.value).toMatchObject({ kind: 'ring', callId: DELIVERED_RING.callId, payload: { media: 'audio' } })
    const elsewhere = parseEvent(fromBroadcast(DELIVERED_ANSWERED_ELSEWHERE))
    expect(elsewhere.ok && elsewhere.value).toMatchObject({ kind: 'answered_elsewhere', callId: DELIVERED_ANSWERED_ELSEWHERE.callId })
  })

  it('touches nothing else, and passes non-objects through for the parser to refuse', () => {
    const { id: _id, ...rest } = DELIVERED_RING
    expect(fromBroadcast(DELIVERED_RING)).toEqual(rest)
    expect(DELIVERED_RING.id).toBe('e7f4689c-73f2-4c00-9d57-102805e5a85d') // not mutated
    for (const v of [null, undefined, 'ring', 7, [DELIVERED_RING]]) expect(fromBroadcast(v)).toBe(v)
  })
})

describe('joinChannel — the real Realtime handler', () => {
  beforeEach(() => { h.logError.mockClear() })

  it('a delivered ring reaches onEvent', async () => {
    const onEvent = vi.fn()
    await joinChannel('ring:9a34852c-18e6-43fe-a60d-ee13af518791', { onEvent })
    h.onBroadcast!({ payload: DELIVERED_RING })
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ring', callId: DELIVERED_RING.callId }))
  })

  it('an unreadable event is never silent — and a burst asks the box once now, once at the end (commit-gate review)', async () => {
    vi.useFakeTimers()
    try {
      const onEvent = vi.fn()
      const onUnreadable = vi.fn()
      await joinChannel('call:cmuh33qrd000301no3mhk7h75', { onEvent, onUnreadable })
      for (let i = 0; i < 20; i++) h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } })
      expect(onEvent).not.toHaveBeenCalled()
      expect(onUnreadable).toHaveBeenCalledTimes(1) // at once
      vi.advanceTimersByTime(UNREADABLE_GAP_MS)
      expect(onUnreadable).toHaveBeenCalledTimes(2) // the trailing one: the last of the burst is answered
      vi.advanceTimersByTime(UNREADABLE_GAP_MS * 5)
      expect(onUnreadable).toHaveBeenCalledTimes(2) // and nothing more
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } })
      expect(onUnreadable).toHaveBeenCalledTimes(3) // a later one, past the gap, at once again
      expect(h.logError).toHaveBeenCalledTimes(1) // one line per channel
    } finally {
      vi.useRealTimers()
    }
  })

  it('the one log line names the topic KIND and masks anything id-like, even in a key name', async () => {
    await joinChannel('call:cmuh33qrd000301no3mhk7h75', { onEvent: vi.fn(), onUnreadable: vi.fn() })
    h.onBroadcast!({ payload: { ...DELIVERED_RING, ['k-9a34852c-18e6-43fe-a60d-ee13af518791']: 1, cmuh33qrd000301no3mhk7h75: 2, 'alice@example.com': 3 } })
    const message = String((h.logError.mock.calls[0][0] as Error).message)
    expect(message).toMatch(/^calls: unreadable call event — /)
    expect(message).not.toContain('9a34852c')
    expect(message).not.toContain('cmuh33qrd') // a cuid, not only a uuid
    expect(message).not.toContain('alice') // a key name that is not a plain identifier
    expect(message).toMatch(/Unrecognized/i) // plain words survive: the line still says what was wrong
  })

  it('a plain unknown key is named in the log — the line that would have named this bug', async () => {
    await joinChannel('ring:x', { onEvent: vi.fn(), onUnreadable: vi.fn() })
    h.onBroadcast!({ payload: { ...DELIVERED_RING, id: undefined, extra: 1 } })
    expect(String((h.logError.mock.calls[0][0] as Error).message)).toContain('Unrecognized key: "extra"')
  })

  it('a throwing handler never reaches realtime-js, and never costs the log line (commit-gate review, codex)', async () => {
    const onUnreadable = vi.fn(() => { throw new Error('handler down') })
    const onEvent = vi.fn(() => { throw new Error('engine down') })
    await joinChannel('ring:x', { onEvent, onUnreadable })
    expect(() => h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } })).not.toThrow()
    expect(() => h.onBroadcast!({ payload: DELIVERED_RING })).not.toThrow()
    const logged = h.logError.mock.calls.map(([e, ctx]) => [String((e as Error).message), (ctx as { op: string }).op])
    expect(logged).toContainEqual([expect.stringMatching(/^calls: unreadable ring event/), 'calls.unreadableEvent'])
    expect(logged).toContainEqual(['handler down', 'calls.realtimeHandler'])
    expect(logged).toContainEqual(['engine down', 'calls.realtimeHandler'])
  })

  it('a trailing answer already due is not answered twice (commit-gate review, codex)', async () => {
    vi.useFakeTimers()
    try {
      const onUnreadable = vi.fn()
      await joinChannel('call:c', { onEvent: vi.fn(), onUnreadable })
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // at once
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // schedules the trailing one
      vi.setSystemTime(Date.now() + UNREADABLE_GAP_MS + 1) // the gap passed, but the timer has not run yet
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // answered at once — and the stale timer dropped
      expect(onUnreadable).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(UNREADABLE_GAP_MS * 3)
      expect(onUnreadable).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a handler that throws on the TRAILING call is contained too (commit-gate review, codex + opus)', async () => {
    vi.useFakeTimers()
    try {
      const onUnreadable = vi.fn(() => { throw new Error('handler down') })
      await joinChannel('call:c', { onEvent: vi.fn(), onUnreadable })
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // at once — throws, contained
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // schedules the trailing one
      expect(() => vi.advanceTimersByTime(UNREADABLE_GAP_MS)).not.toThrow() // throws inside the timer, contained
      expect(onUnreadable).toHaveBeenCalledTimes(2)
      const ops = h.logError.mock.calls.filter(([, ctx]) => (ctx as { op: string }).op === 'calls.realtimeHandler')
      expect(ops).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a closed channel hands nothing on — not a late event, not a trailing answer', async () => {
    vi.useFakeTimers()
    try {
      const onEvent = vi.fn()
      const onUnreadable = vi.fn()
      const channel = await joinChannel('call:c', { onEvent, onUnreadable })
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // at once
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // trailing one scheduled
      channel.close()
      h.onBroadcast!({ payload: DELIVERED_RING }) // in flight while removeChannel finishes
      vi.advanceTimersByTime(UNREADABLE_GAP_MS * 2)
      expect(onEvent).not.toHaveBeenCalled()
      expect(onUnreadable).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a clock set back never holds the next answer longer than the gap (commit-gate review, codex)', async () => {
    vi.useFakeTimers()
    try {
      const onUnreadable = vi.fn()
      await joinChannel('call:c', { onEvent: vi.fn(), onUnreadable })
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } }) // at once
      vi.setSystemTime(Date.now() - 3_600_000) // the phone's clock goes back an hour
      h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } })
      vi.advanceTimersByTime(UNREADABLE_GAP_MS)
      expect(onUnreadable).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a throwing logger never costs the recovery', async () => {
    h.logError.mockImplementationOnce(() => { throw new Error('log down') })
    const onUnreadable = vi.fn()
    await joinChannel('ring:x', { onEvent: vi.fn(), onUnreadable })
    expect(() => h.onBroadcast!({ payload: { v: CALL_PROTOCOL_VERSION, kind: 'nonsense' } })).not.toThrow()
    expect(onUnreadable).toHaveBeenCalledTimes(1)
  })

  it('a version notice is still a version notice', async () => {
    const onVersion = vi.fn()
    const onUnreadable = vi.fn()
    await joinChannel('ring:x', { onEvent: vi.fn(), onVersion, onUnreadable })
    h.onBroadcast!({ payload: { ...DELIVERED_RING, v: 99 } })
    expect(onVersion).toHaveBeenCalledWith(99)
    expect(onUnreadable).not.toHaveBeenCalled()
  })
})
