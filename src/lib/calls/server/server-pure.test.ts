import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALLS_OFF, configFromRow, modeAdmits } from './config'
import { CLOUDFLARE_IPV4_RANGES, relayAllowList, relayServersFrom } from './relay'
import { sanitizeClientEvent } from './signal'
import { callCardText, callOutcome, formatCallDuration } from './cards'
import { counterpartOf, knownMinorByYear, threadRefusal, type ConversationForCall } from './eligibility'
import { buildSnapshot, staleReason, type CallSessionRow } from './session'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'

/**
 * The pure halves of the call server (src/lib/calls/server/*): the switch, the relay answer, the signalling
 * sanitiser, the thread record, the thread and age rules, the snapshot. The SQL halves are pinned against a real
 * Postgres in session.pg.test.ts.
 */

const CALL_ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b'

describe('the runtime switch (config.ts)', () => {
  it('fails closed: no row, an unknown mode or relay → off; a failed read is off but not "read"', () => {
    expect(configFromRow(null)).toMatchObject({ mode: 'off', readOk: true })
    expect(configFromRow({ mode: 'everyone', cohort: [], video: true, relay: 'cloudflare' }).mode).toBe('off')
    expect(configFromRow({ mode: 'all', cohort: [], video: true, relay: 'twilio' }).mode).toBe('off')
    expect(CALLS_OFF.readOk).toBe(false)
    expect(configFromRow({ mode: 'beta', cohort: ['p1'], video: false, relay: 'cloudflare' })).toMatchObject({ mode: 'beta', video: false, readOk: true })
  })

  it('who each mode admits — and nobody at all without blocking', () => {
    const cfg = (mode: 'off' | 'staff' | 'beta' | 'all') => ({ ...configFromRow({ mode, cohort: ['tester'], video: true, relay: 'cloudflare' }) })
    expect(modeAdmits(cfg('off'), 'admin', true, true)).toBe(false)
    expect(modeAdmits(cfg('staff'), 'admin', true, true)).toBe(true)
    expect(modeAdmits(cfg('staff'), 'tester', false, true)).toBe(false)
    expect(modeAdmits(cfg('beta'), 'tester', false, true)).toBe(true)
    expect(modeAdmits(cfg('beta'), 'stranger', false, true)).toBe(false)
    expect(modeAdmits(cfg('all'), 'stranger', false, true)).toBe(true)
    for (const m of ['staff', 'beta', 'all'] as const) expect(modeAdmits(cfg(m), 'admin', true, false)).toBe(false)
  })
})

describe('the relay (relay.ts)', () => {
  const cf = {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'u-123', credential: 'secret',
      },
    ],
  }

  it('keeps only the TURN credential, drops STUN and port 53, and remembers the username to revoke', () => {
    expect(relayServersFrom(cf)).toEqual({
      handle: 'u-123',
      iceServers: [{
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'u-123', credential: 'secret',
      }],
    })
  })

  it('an answer with no usable TURN entry is no relay at all', () => {
    expect(relayServersFrom({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })).toBeNull()
    expect(relayServersFrom({ iceServers: [{ urls: 'turn:x:53', username: 'u', credential: 'c' }] })).toBeNull()
    expect(relayServersFrom({ nope: true })).toBeNull()
  })

  it('the Cloudflare allow-list holds both documented TURN server addresses and no private range', () => {
    const list = relayAllowList('cloudflare')
    expect([...list]).toEqual(expect.arrayContaining([...CLOUDFLARE_IPV4_RANGES]))
    expect(list.has('141.101.64.0/18')).toBe(true) // 141.101.90.1
    expect(list.has('162.158.0.0/15')).toBe(true) // 162.159.207.1
    for (const r of list) expect(r).not.toMatch(/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/)
  })
})

describe('the signalling sanitiser (signal.ts)', () => {
  const sdp = readFileSync(join(__dirname, '..', '__fixtures__', 'chrome-offer.sdp'), 'utf8')
  const env = { v: 1 as const, callId: CALL_ID, idempotencyKey: 'abcd1234:1', tabId: 'tab-a' }
  const offer = { ...env, kind: 'offer' as const, negId: 1, payload: { sdp } }

  it('a description from an allowed relay passes with its candidates rebuilt', () => {
    const r = sanitizeClientEvent(offer, new Set(['203.0.113.0/24']))
    expect(r.ok).toBe(true)
    if (!r.ok || !r.event || r.event.kind !== 'offer') throw new Error('expected an offer')
    expect(r.after).toBe(3) // the IPv6 candidate is not on the list
    expect(r.event.payload.sdp).toMatch(/a=candidate:\S+ 1 udp \d+ 203\.0\.113\.10 50002 typ relay raddr 0\.0\.0\.0 rport 0/)
    expect(r.lostAll).toBe(false)
  })

  it('⛔ the wrong allow-list drops EVERY candidate — reported, not silent', () => {
    const r = sanitizeClientEvent(offer, new Set(['198.51.100.0/24']))
    expect(r).toMatchObject({ ok: true, before: 4, after: 0, lostAll: true })
  })

  it('a description the guard refuses is invalid_sdp, never repaired', () => {
    const decoy = readFileSync(join(__dirname, '..', '__fixtures__', 'malicious-session-decoy.sdp'), 'utf8')
    expect(sanitizeClientEvent({ ...offer, payload: { sdp: decoy } }, new Set(['203.0.113.0/24']))).toEqual({ ok: false, error: 'invalid_sdp' })
  })

  it('candidates: rebuilt or dropped; the end-of-candidates marker never relayed; none left → nothing to relay', () => {
    const good = { candidate: 'candidate:1 1 udp 41885439 203.0.113.10 50002 typ relay raddr 192.168.1.5 rport 51000', sdpMid: '0', sdpMLineIndex: 0 }
    const host = { candidate: 'candidate:2 1 udp 2122260223 192.168.1.5 51000 typ host', sdpMid: '0', sdpMLineIndex: 0 }
    const ev = { ...env, kind: 'candidates' as const, negId: 1, payload: { candidates: [good, host, { candidate: '' }] } }
    const r = sanitizeClientEvent(ev, new Set(['203.0.113.0/24']))
    if (!r.ok || !r.event || r.event.kind !== 'candidates') throw new Error('expected candidates')
    expect(r.event.payload.candidates).toHaveLength(1)
    expect(r.event.payload.candidates[0].candidate).toContain('raddr 0.0.0.0 rport 0') // the stranger's LAN address is gone
    const none = sanitizeClientEvent({ ...ev, payload: { candidates: [host] } }, new Set(['203.0.113.0/24']))
    expect(none).toMatchObject({ ok: true, event: null, lostAll: true })
  })

  it('other kinds pass through untouched', () => {
    const ready = { ...env, kind: 'ready' as const, payload: {} }
    expect(sanitizeClientEvent(ready, new Set())).toEqual({ ok: true, event: ready, before: 0, after: 0, lostAll: false })
  })
})

describe('the thread record (cards.ts)', () => {
  it('busy, declined, cancelled and timed out all read "missed" — a stranger learns nothing from the thread', () => {
    for (const reason of ['missed', 'declined', 'unavailable', 'cancelled'] as const) {
      expect(callOutcome({ state: 'ringing', connected_at: null }, reason)).toBe('missed')
    }
    expect(callOutcome({ state: 'accepted', connected_at: null }, 'lost')).toBe('failed')
    expect(callOutcome({ state: 'connected', connected_at: new Date() }, 'hangup')).toBe('completed')
    expect(callOutcome({ state: 'connected', connected_at: new Date() }, 'lost')).toBe('completed')
  })

  it('durations and bilingual copy', () => {
    expect([0, 42.9, 192, 3723, -5, Number.NaN].map(formatCallDuration)).toEqual(['0:00', '0:42', '3:12', '1:02:03', '0:00', '0:00'])
    expect(callCardText('audio', 'completed', 192)).toBe('📞 Cuộc gọi thoại · Voice call · 3:12')
    expect(callCardText('video', 'missed', 0)).toBe('🎥 Cuộc gọi video nhỡ · Missed video call')
    expect(callCardText('audio', 'failed', 0)).toBe("📞 Cuộc gọi không kết nối được · Call didn't connect")
  })
})

describe('the thread rules (eligibility.ts)', () => {
  const convo = (o: Partial<ConversationForCall> = {}): ConversationForCall => ({
    id: 'c1', buyerProfileId: 'buyer', sellerProfileId: 'seller', sellerId: 'shop', listingId: 'l1', visaApplicationId: null, listingType: null, ...o,
  })

  it('only the two people in a listing thread with a claimed counterpart', () => {
    expect(threadRefusal(convo(), 'buyer', [])).toBeNull()
    expect(threadRefusal(convo(), 'seller', [])).toBeNull()
    expect(threadRefusal(convo(), 'stranger', [])).toEqual({ error: 'not_participant', status: 403 })
    expect(threadRefusal(convo({ sellerProfileId: null }), 'buyer', [])).toEqual({ error: 'calls_thread_unavailable', status: 403 })
    expect(threadRefusal(convo({ sellerProfileId: 'buyer' }), 'buyer', [])).toEqual({ error: 'calls_thread_unavailable', status: 403 })
  })

  it('never a support, desk, listing-less or visa-bound thread', () => {
    expect(threadRefusal(convo({ listingId: null }), 'buyer', [])?.error).toBe('calls_thread_unavailable')
    expect(threadRefusal(convo({ visaApplicationId: 'v1' }), 'buyer', [])?.error).toBe('calls_thread_unavailable')
    expect(threadRefusal(convo({ sellerId: 'desk' }), 'buyer', ['desk'])?.error).toBe('calls_thread_unavailable')
    expect(threadRefusal(convo({ sellerId: SUPPORT_SELLER_ID }), 'buyer', [])?.error).toBe('calls_thread_unavailable') // this edition's desk
  })

  it('counterparts', () => {
    expect(counterpartOf(convo(), 'buyer')).toBe('seller')
    expect(counterpartOf(convo(), 'seller')).toBe('buyer')
    expect(counterpartOf(convo(), 'x')).toBeNull()
  })

  it('a birth year proves under-18 only when no birthday can rescue it; unknown is not a minor', () => {
    expect(knownMinorByYear(2010, 2026)).toBe(true)
    expect(knownMinorByYear(2008, 2026)).toBe(true) // 17 or 18 this year: counted as under 18
    expect(knownMinorByYear(2007, 2026)).toBe(false)
    expect(knownMinorByYear(null, 2026)).toBe(false)
    expect(knownMinorByYear(2010.5, 2026)).toBe(false)
  })
})

describe('the resync snapshot (session.ts buildSnapshot)', () => {
  const row = (o: Partial<CallSessionRow> = {}): CallSessionRow => ({
    id: CALL_ID, conversation_id: 'c1', caller_id: 'a', callee_id: 'b', caller_hash: 'x'.repeat(64), callee_hash: 'y'.repeat(64),
    caller_tag: null, callee_tag: null,
    media: 'audio', state: 'connected', end_reason: null, protocol_version: 1, edition: 'marketplace', relay_provider: 'cloudflare',
    caller_tab: 'tab-a', callee_tab: 'tab-b', caller_commit: 'c'.repeat(64), callee_nonce: 'b'.repeat(64), caller_reveal: null,
    caller_hold: true, caller_hold_seq: 3, callee_hold: null, callee_hold_seq: null, caller_relay_user: 'r1', callee_relay_user: 'r2',
    caller_caps: null, callee_caps: null, ringing_at: new Date(), accepted_at: new Date(), ready_at: null, connected_at: new Date(),
    ended_at: null, caller_heartbeat_at: new Date(), callee_heartbeat_at: new Date(), ...o,
  })
  const cand = (n: number) => ({ candidate: `candidate:${n} 1 udp 1 203.0.113.${n} 3478 typ relay raddr 0.0.0.0 rport 0` })
  const negs = [
    { neg_id: 2, offer_sdp: 'v=0\r\no=2\r\n', offer_meta: { codecPlan: { p: 2 } }, answer_sdp: null, caller_candidates: [cand(1)], callee_candidates: [] },
    { neg_id: 1, offer_sdp: 'v=0\r\no=1\r\n', offer_meta: null, answer_sdp: 'v=0\r\na=1\r\n', caller_candidates: [], callee_candidates: [cand(2)] },
  ]

  it("each side sees the OTHER's candidates, tab and hold; the newest offer and answer by negId; never the commitment", () => {
    const forCallee = buildSnapshot(row(), 'callee', negs)
    expect(forCallee).toMatchObject({
      callState: 'connected', peerTabId: 'tab-a', peerHold: { held: true, seq: 3 },
      latestOffer: { negId: 2, sdp: 'v=0\r\no=2\r\n', codecPlan: { p: 2 } }, latestAnswer: { negId: 1, sdp: 'v=0\r\na=1\r\n' },
      candidates: [{ negId: 2, candidates: [cand(1)] }], calleeNonce: 'b'.repeat(64), callerReveal: null,
    })
    expect(JSON.stringify(forCallee)).not.toContain('c'.repeat(64))
    const forCaller = buildSnapshot(row(), 'caller', negs)
    expect(forCaller).toMatchObject({ peerTabId: 'tab-b', peerHold: null, candidates: [{ negId: 1, candidates: [cand(2)] }] })
  })

  it('an ended call says so, with its reason', () => {
    expect(buildSnapshot(row({ state: 'ended', end_reason: 'hangup' }), 'caller', [])).toMatchObject({ callState: 'ended', endReason: 'hangup', latestOffer: null })
  })

  it('stale reasons', () => {
    expect(staleReason({ state: 'ringing', capped: false })).toBe('missed')
    expect(staleReason({ state: 'connected', capped: true })).toBe('cap_reached')
    expect(staleReason({ state: 'accepted', capped: false })).toBe('lost')
    // answered, never connected, past the connect deadline — "Call didn't connect", heartbeats or not (round-7 review)
    expect(staleReason({ state: 'ready', capped: false, unconnected: true })).toBe('media_failed')
  })
})

describe('the commitment ids (session.ts commitTag)', () => {
  it('a canonical UUID sas.ts accepts, stable per person, distinct between people, never the profile id', async () => {
    const { commitTag } = await import('./session')
    const { uuidToBytes } = await import('../sas')
    const a = commitTag('11111111-1111-4111-8111-111111111111', 'c1')
    const b = commitTag('22222222-2222-4222-8222-222222222222', 'c1')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(() => uuidToBytes(a)).not.toThrow()
    expect(commitTag('11111111-1111-4111-8111-111111111111', 'c1')).toBe(a)
    expect(a).not.toBe(b)
    expect(a).not.toBe('11111111-1111-4111-8111-111111111111')
    // ⚠️ Per conversation: the same person is a different tag in another thread — no cross-thread linking.
    expect(commitTag('11111111-1111-4111-8111-111111111111', 'c2')).not.toBe(a)
  })
})
