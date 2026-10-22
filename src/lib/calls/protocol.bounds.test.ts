import { describe, expect, it } from 'vitest'
import { MAX_OPAQUE_JSON_LENGTH, PEER_END_REASONS, parseEvent, parseSnapshot } from './protocol'
import { createNegotiation, step, type NegotiationEffect } from './negotiation'
import { CALL_PROTOCOL_VERSION } from './types'

/**
 * The commit-gate findings on the wire contract (codex + Opus, 2026-10-21): the opaque codec fields are bounded, and a
 * peer cannot put a box-only or ringing-only reason on an answered call's end.
 */
const CALL_ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const env = { v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: 'peer-key-1', tabId: 'tab-peer' }
const offer = (extra: Record<string, unknown>) => ({ ...env, kind: 'offer', negId: 1, payload: { sdp: 'v=0\r\n', ...extra } })

describe('opaque codec fields are bounded', () => {
  it('an ordinary plan and report pass', () => {
    expect(parseEvent(offer({ codecPlan: { v: 1, video: { codec: 'H264' } }, capabilities: { v: 1, codecs: [] } })).ok).toBe(true)
  })

  it('more than MAX_OPAQUE_JSON_LENGTH characters of JSON is refused — in offers, accepts and snapshots', () => {
    const big = { pad: 'x'.repeat(MAX_OPAQUE_JSON_LENGTH) }
    expect(parseEvent(offer({ codecPlan: big })).ok).toBe(false)
    expect(parseEvent(offer({ capabilities: big })).ok).toBe(false)
    expect(parseEvent({ ...env, tabId: 'box', kind: 'accepted', payload: { calleeTabId: 't', capabilities: big } }).ok).toBe(false)
    expect(parseSnapshot({ v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: 'connected', candidates: [], latestOffer: { negId: 1, sdp: 'v=0\r\n', codecPlan: big } }).ok).toBe(false)
  })

  it('nesting too deep to serialise is refused, not a crash', () => {
    let deep: unknown = {}
    for (let i = 0; i < 20_000; i++) deep = { d: deep }
    expect(parseEvent(offer({ codecPlan: deep })).ok).toBe(false)
  })
})

describe("a peer's end reason", () => {
  const endedWith = (reason: string) => {
    let { state } = createNegotiation({ role: 'caller', callId: CALL_ID, tabId: 'tab-me', instanceId: 'inst0001', peerTabId: 'tab-peer', now: 0 })
    const parsed = parseEvent({ ...env, kind: 'end', payload: { reason } })
    if (!parsed.ok) throw new Error('fixture must parse')
    const r = step(state, { type: 'remote', now: 1, event: parsed.value })
    state = r.state
    const end = r.effects.find((e): e is Extract<NegotiationEffect, { type: 'endCall' }> => e.type === 'endCall')
    return end?.reason
  }

  it('what a peer may say of its own end is believed', () => {
    for (const reason of PEER_END_REASONS) expect(endedWith(reason)).toBe(reason)
  })

  it('a ringing-only or box-only word from a peer reads as a plain hang-up', () => {
    for (const reason of ['declined', 'cancelled', 'missed', 'unavailable', 'blocked', 'kill_switch', 'cap_reached']) {
      expect(endedWith(reason), reason).toBe('hangup')
    }
  })
})
