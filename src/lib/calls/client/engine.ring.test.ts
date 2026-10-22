import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * engine.ts recheckIncoming — when ring:<me> carried something this build could not read, the ring on screen is asked
 * about BY ITS OWN ID: stopped if the box says it is over, kept if it still rings, and never a ring that began while
 * the question was out (commit-gate review, opus: asking for "a ringing call" can start a ring but never stop one).
 */
const h = vi.hoisted(() => ({ details: vi.fn() }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), getCallDetails: h.details }))

import { callEngine } from './engine'
import { CALL_PROTOCOL_VERSION } from '../types'

let n = 0
const details = (callId: string, state: string, endReason: string | null = null) => ({
  callId, conversationId: 'cmuh33qrd000301no3mhk7h75', media: 'audio', role: 'callee', state, endReason,
  protocolVersion: CALL_PROTOCOL_VERSION, ringingAt: new Date().toISOString(), ringTimeoutSec: 45, ringRemainingMs: 40_000, connectedAt: null,
  peer: { name: 'Peer', avatarUrl: null, verified: true, memberSince: null, side: 'seller' }, listing: null,
})

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
