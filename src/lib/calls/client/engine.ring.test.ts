import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * engine.ts recheckIncoming — when ring:<me> carried something this build could not read, the ring on screen is asked
 * about BY ITS OWN ID: stopped if the box says it is over, kept if it still rings, and never a ring that began while
 * the question was out (commit-gate review, opus: asking for "a ringing call" can start a ring but never stop one).
 */
const h = vi.hoisted(() => ({ details: vi.fn(), ringingCall: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()), getCallDetails: h.details, getRingingCall: h.ringingCall,
}))

import { callEngine } from './engine'
import { CallApiError } from './api'
import { CALL_PROTOCOL_VERSION } from '../types'

let n = 0
const details = (callId: string, state: string, endReason: string | null = null) => ({
  callId, conversationId: 'cmuh33qrd000301no3mhk7h75', media: 'audio', role: 'callee', state, endReason,
  protocolVersion: CALL_PROTOCOL_VERSION, ringingAt: new Date().toISOString(), ringTimeoutSec: 45, ringRemainingMs: 40_000, connectedAt: null,
  peer: { name: 'Peer', avatarUrl: null, verified: true, memberSince: null, side: 'seller' }, listing: null,
})

/** A fresh LOADED ring on screen, returning its id. */
async function ringingCall(): Promise<string> {
  const callId = `call-${++n}`
  h.details.mockResolvedValueOnce(details(callId, 'ringing'))
  await callEngine.onRing(callId)
  return callId
}

/** A fresh ring on screen, under a call id no earlier test used (the engine is one per page). */
async function ringing(): Promise<string> {
  const callId = `call-${++n}`
  h.details.mockResolvedValueOnce(details(callId, 'ringing'))
  await callEngine.onRing(callId)
  expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId })
  return callId
}

describe('recheckIncoming', () => {
  beforeEach(() => { h.details.mockReset() })

  it('the caller hung up: the ring stops as cancelled, with who rang still on the card', async () => {
    const callId = await ringing()
    h.details.mockResolvedValueOnce(details(callId, 'ended', 'cancelled'))
    await callEngine.recheckIncoming()
    expect(callEngine.getView()).toMatchObject({ phase: 'ended', endReason: 'cancelled', callId, role: 'callee', peer: { name: 'Peer' } })
  })

  it('the box timed it out: missed, not cancelled (commit-gate review, codex)', async () => {
    const callId = await ringing()
    h.details.mockResolvedValueOnce(details(callId, 'ended', 'missed'))
    await callEngine.recheckIncoming()
    expect(callEngine.getView()).toMatchObject({ phase: 'ended', endReason: 'missed', callId })
  })

  it('declined, or answered and already over, on another of my devices: the ring just goes', async () => {
    for (const reason of ['declined', 'hangup']) {
      const callId = await ringing()
      h.details.mockResolvedValueOnce(details(callId, 'ended', reason))
      await callEngine.recheckIncoming()
      expect(callEngine.getView().phase).toBe('idle')
    }
  })

  it('answered on another tab of mine: the ring just goes', async () => {
    const callId = await ringing()
    h.details.mockResolvedValueOnce(details(callId, 'accepted'))
    await callEngine.recheckIncoming()
    expect(callEngine.getView().phase).toBe('idle')
  })

  it('still ringing at the box: still ringing here', async () => {
    const callId = await ringing()
    h.details.mockResolvedValueOnce(details(callId, 'ringing'))
    await callEngine.recheckIncoming()
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId })
    callEngine.stopRinging(callId, 'missed')
  })

  it('the box cannot be asked: nothing is stopped on a guess', async () => {
    const callId = await ringing()
    h.details.mockRejectedValueOnce(new Error('offline'))
    await callEngine.recheckIncoming()
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId })
    callEngine.stopRinging(callId, 'missed')
  })

  it('a ring that began while the question was out is never the one stopped', async () => {
    const first = await ringing()
    let answer: (v: unknown) => void = () => {}
    h.details.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    const pending = callEngine.recheckIncoming() // asks about `first`
    callEngine.stopRinging(first, 'cancelled') // …which a readable cancel ends meanwhile
    const second = await ringing() // and a new call rings
    answer(details(first, 'ended'))
    await pending
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: second })
    callEngine.stopRinging(second, 'missed')
  })

  it('no ring on screen: nothing is asked', async () => {
    await callEngine.recheckIncoming()
    expect(h.details).not.toHaveBeenCalled()
  })
})

describe('the ring shows at once; who is calling follows; Answer waits for it (2026-10-25)', () => {
  beforeEach(() => { h.details.mockReset(); callEngine.reset() })

  /** A details request that answers only when the test says so. */
  const deferred = () => {
    let answer: (v: unknown) => void = () => {}
    let fail: (e: unknown) => void = () => {}
    const promise = new Promise((resolve, reject) => { answer = resolve; fail = reject })
    return { promise, answer, fail }
  }

  it('the incoming screen is up before the details; ringReady (Answer) only once they are in', async () => {
    const callId = `call-${++n}`
    const d = deferred()
    h.details.mockReturnValueOnce(d.promise)
    const loading = callEngine.onRing(callId, 'video')
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId, ringReady: false, peer: null })
    d.answer(details(callId, 'ringing'))
    await loading
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId, ringReady: true, peer: { name: 'Peer' } })
    callEngine.stopRinging(callId, 'missed')
  })

  it('a cancel while the details load clears the ring with no card — never "Cancelled" from nobody', async () => {
    const callId = `call-${++n}`
    const d = deferred()
    h.details.mockReturnValueOnce(d.promise)
    const loading = callEngine.onRing(callId)
    callEngine.stopRinging(callId, 'cancelled')
    expect(callEngine.getView().phase).toBe('idle')
    d.answer(details(callId, 'ringing'))
    await loading
    expect(callEngine.getView().phase).toBe('idle') // the late details never bring it back
    expect(callEngine.busy).toBe(false)
  })

  it('⛔ a REAL ring shut out while another loaded comes back once the loading one is cancelled', async () => {
    const a = `call-${++n}`
    const b = `call-${++n}`
    const d = deferred()
    h.details.mockReturnValueOnce(d.promise)
    const loading = callEngine.onRing(a)
    await callEngine.onRing(b) // skipped: busy with a's ring
    expect(callEngine.getView().callId).toBe(a)
    h.ringingCall.mockResolvedValueOnce(b)
    h.details.mockResolvedValueOnce(details(b, 'ringing'))
    callEngine.stopRinging(a, 'cancelled')
    await vi.waitFor(() => expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: b, ringReady: true }))
    d.answer(details(a, 'ringing'))
    await loading
    expect(callEngine.getView().callId).toBe(b) // a's late details never take the screen back
    callEngine.stopRinging(b, 'missed')
    callEngine.reset()
  })

  it('details that say it is not ringing any more drop it quietly — no "missed call" card', async () => {
    const callId = `call-${++n}`
    h.details.mockResolvedValueOnce(details(callId, 'ended', 'cancelled'))
    await callEngine.onRing(callId)
    expect(callEngine.getView().phase).toBe('idle')
    expect(callEngine.busy).toBe(false)
  })

  it('an account change while the details load drops the ring; the late details are ignored', async () => {
    const callId = `call-${++n}`
    const d = deferred()
    h.details.mockReturnValueOnce(d.promise)
    const loading = callEngine.onRing(callId)
    callEngine.shutdown()
    expect(callEngine.getView().phase).toBe('idle')
    d.answer(details(callId, 'ringing'))
    await loading
    expect(callEngine.getView().phase).toBe('idle')
  })

  it('⛔ a ring the box refuses (404: not this person\'s, or gone) is dropped AT ONCE — no 45 s ring, no card', async () => {
    const callId = `call-${++n}`
    h.details.mockRejectedValueOnce(new CallApiError('not_found', 404))
    await callEngine.onRing(callId)
    expect(callEngine.getView().phase).toBe('idle')
    expect(callEngine.busy).toBe(false)
    expect(h.details).toHaveBeenCalledTimes(1)
  })

  it('details that never arrive end the ring quietly at the deadline — never "Missed call" from nobody', async () => {
    vi.useFakeTimers()
    try {
      const callId = `call-${++n}`
      h.details.mockRejectedValue(new Error('offline'))
      await callEngine.onRing(callId)
      await vi.advanceTimersByTimeAsync(46_000)
      expect(callEngine.getView().phase).toBe('idle')
      expect(callEngine.busy).toBe(false)
    } finally {
      vi.useRealTimers()
      h.details.mockReset()
    }
  })

  it('a details request that HANGS ends the ring quietly at the deadline too', async () => {
    vi.useFakeTimers()
    try {
      const callId = `call-${++n}`
      h.details.mockReturnValueOnce(new Promise(() => {}))
      void callEngine.onRing(callId)
      expect(callEngine.getView()).toMatchObject({ phase: 'incoming', ringReady: false })
      await vi.advanceTimersByTimeAsync(46_000)
      expect(callEngine.getView().phase).toBe('idle')
      expect(callEngine.busy).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 401 (a woken tab refreshing its session) is retried, not taken as "not yours"', async () => {
    vi.useFakeTimers()
    try {
      const callId = `call-${++n}`
      h.details.mockRejectedValueOnce(new CallApiError('unauthorized', 401)).mockResolvedValueOnce(details(callId, 'ringing'))
      await callEngine.onRing(callId)
      expect(callEngine.getView()).toMatchObject({ phase: 'incoming', ringReady: false })
      await vi.advanceTimersByTimeAsync(600)
      expect(callEngine.getView()).toMatchObject({ phase: 'incoming', ringReady: true })
      callEngine.stopRinging(callId, 'missed')
      callEngine.reset()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a lock-screen Answer during a retry pause fetches AT ONCE — never waits the pause out', async () => {
    const callId = `call-${++n}`
    h.details.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(details(callId, 'ringing'))
    await callEngine.onRing(callId) // first load failed: the retry waits 500 ms
    const answering = callEngine.accept(callId)
    await vi.waitFor(() => expect(h.details).toHaveBeenCalledTimes(2), { timeout: 300 })
    await answering // no microphone in this test: it ends as a media failure, which is fine here
    h.details.mockReset()
    callEngine.reset()
  })

  it.each([
    ['taken on another device', (a: string) => callEngine.stopRinging(a, 'answered_elsewhere')],
    ['declined here', () => { void callEngine.decline() }],
    ['dismissed here', () => callEngine.dismissRing()],
  ])('⛔ a ring shut out by a LOADED ring comes back when that one is %s', async (_how, clear) => {
    const a = await ringingCall()
    const b = `call-${++n}`
    await callEngine.onRing(b) // skipped: busy
    // The box's one answer is the ring just cleared (dismissed, or its decline still on the wire): b comes back anyway.
    h.ringingCall.mockResolvedValue(a)
    h.details.mockResolvedValueOnce(details(b, 'ringing'))
    clear(a)
    await vi.waitFor(() => expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: b, ringReady: true }))
    callEngine.stopRinging(b, 'missed')
    h.ringingCall.mockReset(); h.ringingCall.mockResolvedValue(null)
    callEngine.reset()
  })

  it('⛔ a waiting ring that ended while it waited is skipped — the one behind it still comes', async () => {
    const a = await ringingCall()
    const b = `call-${++n}`
    const c = `call-${++n}`
    await callEngine.onRing(b) // waits
    await callEngine.onRing(c) // waits, newest
    callEngine.stopRinging(c, 'cancelled') // its caller hung up while it waited
    h.details.mockResolvedValueOnce(details(b, 'ringing'))
    callEngine.dismissRing()
    await vi.waitFor(() => expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: b, ringReady: true }))
    expect(callEngine.getView().callId).not.toBe(a)
    callEngine.stopRinging(b, 'missed')
    callEngine.reset()
  })

  it('⛔ Decline before the details: the waiting ring offered in its place stays on screen, answerable', async () => {
    const a = `call-${++n}`
    const x = `call-${++n}`
    const d = deferred()
    h.details.mockReturnValueOnce(d.promise)
    void callEngine.onRing(a)
    await callEngine.onRing(x) // waits behind a, still loading
    h.details.mockResolvedValueOnce(details(x, 'ringing'))
    void callEngine.decline()
    await vi.waitFor(() => expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: x, ringReady: true }))
    d.answer(details(a, 'ringing'))
    await Promise.resolve()
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: x })
    callEngine.stopRinging(x, 'missed')
    callEngine.reset()
  })

  it('⛔ a lock-screen Answer for ANOTHER call keeps the ring on screen waiting — offered again if it still rings', async () => {
    const a = await ringingCall()
    const b = `call-${++n}`
    let whileLoading: unknown = null
    h.details.mockImplementationOnce(async () => {
      whileLoading = { ...callEngine.getView() }
      return details(b, 'ringing')
    })
    await callEngine.accept(b) // no microphone in this test: b ends as a media failure
    // while b's details loaded, its "Answering…" screen carried nobody's name — never a's
    expect(whileLoading).toMatchObject({ phase: 'preparing', callId: b, peer: null })
    expect(callEngine.getView()).toMatchObject({ phase: 'ended', callId: b })
    h.details.mockResolvedValueOnce(details(a, 'ringing'))
    callEngine.reset() // b's end screen closes
    await vi.waitFor(() => expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId: a, ringReady: true }))
    callEngine.stopRinging(a, 'missed')
    callEngine.reset()
  })

  it('a failed load is retried during the ring — one slow GET never leaves Answer disabled to the end', async () => {
    vi.useFakeTimers()
    try {
      const callId = `call-${++n}`
      h.details.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(details(callId, 'ringing'))
      await callEngine.onRing(callId)
      expect(callEngine.getView()).toMatchObject({ phase: 'incoming', ringReady: false })
      await vi.advanceTimersByTimeAsync(600)
      expect(callEngine.getView()).toMatchObject({ phase: 'incoming', ringReady: true, peer: { name: 'Peer' } })
      callEngine.stopRinging(callId, 'missed')
    } finally {
      vi.useRealTimers()
    }
  })
})
