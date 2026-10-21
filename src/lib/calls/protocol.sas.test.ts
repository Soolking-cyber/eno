import { describe, expect, it } from 'vitest'
import { parseEvent, parseSnapshot } from './protocol'
import { CALL_PROTOCOL_VERSION } from './types'

/**
 * The safety-code material on the wire (protocol.ts: 'accepted'.calleeNonce, the box's 'reveal', the snapshot's
 * calleeNonce / callerReveal). What sas.ts needs from the box, and nothing it must not take from it (no commitment
 * in a snapshot).
 */
const CALL_ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const env = { v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: 'box:1', tabId: 'box' }
const NONCE = '0123456789abcdef'.repeat(4)

describe('safety-code material in events', () => {
  it("'accepted' carries nB and refuses an accept without it", () => {
    expect(parseEvent({ ...env, kind: 'accepted', payload: { calleeTabId: 'tab-b', calleeNonce: NONCE } }).ok).toBe(true)
    expect(parseEvent({ ...env, kind: 'accepted', payload: { calleeTabId: 'tab-b' } }).ok).toBe(false)
  })

  it('a nonce is exactly 64 lowercase hex characters — the one spelling sas.ts writes', () => {
    for (const bad of [NONCE.toUpperCase(), NONCE.slice(1), `${NONCE}0`, `${NONCE.slice(0, 63)}g`, '', ` ${NONCE.slice(1)}`]) {
      expect(parseEvent({ ...env, kind: 'accepted', payload: { calleeTabId: 'tab-b', calleeNonce: bad } }).ok, bad).toBe(false)
      expect(parseEvent({ ...env, kind: 'reveal', payload: { callerNonce: bad } }).ok, bad).toBe(false)
    }
  })

  it("'reveal' is a box event with the caller's nonce and nothing else", () => {
    expect(parseEvent({ ...env, kind: 'reveal', payload: { callerNonce: NONCE } })).toEqual({
      ok: true, value: { ...env, kind: 'reveal', payload: { callerNonce: NONCE } },
    })
    expect(parseEvent({ ...env, kind: 'reveal', payload: { callerNonce: NONCE, commit: NONCE } }).ok).toBe(false)
    expect(parseEvent({ ...env, kind: 'reveal', negId: 1, payload: { callerNonce: NONCE } }).ok).toBe(false)
  })
})

describe('safety-code material in the resync snapshot', () => {
  const base = { v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: 'connected', candidates: [] }

  it('carries the nonces the box holds, or none', () => {
    expect(parseSnapshot({ ...base, calleeNonce: NONCE, callerReveal: NONCE }).ok).toBe(true)
    expect(parseSnapshot({ ...base, calleeNonce: null, callerReveal: null }).ok).toBe(true)
    expect(parseSnapshot(base).ok).toBe(true)
  })

  it("never carries the caller's commitment — the callee freezes it before accepting (sas.ts)", () => {
    expect(parseSnapshot({ ...base, commit: NONCE }).ok).toBe(false)
    expect(parseSnapshot({ ...base, callerCommit: NONCE }).ok).toBe(false)
  })

  it('refuses a malformed nonce rather than dropping it', () => {
    expect(parseSnapshot({ ...base, calleeNonce: NONCE.toUpperCase() }).ok).toBe(false)
    expect(parseSnapshot({ ...base, callerReveal: 'x' }).ok).toBe(false)
  })
})
