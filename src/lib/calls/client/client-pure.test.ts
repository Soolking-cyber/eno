import { afterEach, describe, expect, it, vi } from 'vitest'
import { inboundPackets, ladderSample } from './stats'
import { CallApiError, sendSignal } from './api'
import { callEndText, callErrorText, callerRoleLine } from '@/components/calls/call-copy'

/** The pure parts of the phone side: the stats readers, the signal retry, the copy table. */

const tr = (en: string) => en

describe('stats readers (stats.ts)', () => {
  const report = (extra: object[] = []) => [
    { id: 'in-a', type: 'inbound-rtp', kind: 'audio', packetsReceived: 100 },
    { id: 'in-v', type: 'inbound-rtp', kind: 'video', packetsReceived: 50 },
    { id: 'out-v', type: 'outbound-rtp', kind: 'video', codecId: 'c1', targetBitrate: 900_000, qualityLimitationReason: 'bandwidth',
      framesPerSecond: 29, frameWidth: 540, frameHeight: 960, totalEncodeTime: 2, framesEncoded: 200, powerEfficientEncoder: true },
    { id: 'ri-v', type: 'remote-inbound-rtp', kind: 'video', fractionLost: 0.02, roundTripTime: 0.08 },
    { id: 'c1', type: 'codec', mimeType: 'video/H264' },
    { id: 'cand', type: 'local-candidate', address: '203.0.113.9', port: 3478 }, // never read
    ...extra,
  ]

  it('counts inbound packets across streams; none yet is null, not zero', () => {
    expect(inboundPackets(report())).toBe(150)
    expect(inboundPackets([{ type: 'outbound-rtp' }])).toBeNull()
    expect(inboundPackets(new Map([['a', { type: 'inbound-rtp', packetsReceived: 7 }]]))).toBe(7) // maplike
  })

  it('builds the ladder sample: short side, ms per frame from the window, codec from the codec entry', () => {
    const prev = [{ id: 'out-v', type: 'outbound-rtp', kind: 'video', totalEncodeTime: 1, framesEncoded: 100 }]
    const s = ladderSample(report(), prev, { currentCapBps: 1_200_000, canSwitchCodec: true, videoEnabled: true })
    expect(s).toMatchObject({
      targetBitrateBps: 900_000, currentCapBps: 1_200_000, qualityLimitationReason: 'bandwidth', fractionLost: 0.02,
      fps: 29, frameHeight: 540, codec: 'H264', hardwareEncoder: true, canSwitchCodec: true, videoEnabled: true,
    })
    expect(s!.rttMs).toBeCloseTo(80)
    expect(s!.encodeMsPerFrame).toBeCloseTo(10) // 1 s over 100 frames
  })

  it('unknown is NaN, never zero; no outgoing video is no sample', () => {
    const s = ladderSample([{ id: 'o', type: 'outbound-rtp', kind: 'video' }], null, { currentCapBps: Number.NaN, canSwitchCodec: false, videoEnabled: false })
    expect(Number.isNaN(s!.targetBitrateBps)).toBe(true)
    expect(Number.isNaN(s!.fractionLost)).toBe(true)
    expect(Number.isNaN(s!.encodeMsPerFrame)).toBe(true)
    expect(ladderSample([{ type: 'outbound-rtp', kind: 'audio' }], null, { currentCapBps: 1, canSwitchCodec: false, videoEnabled: true })).toBeNull()
  })
})

describe('sendSignal (api.ts): the same event until acknowledged or refused for good', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  const event = { v: 1, callId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b', idempotencyKey: 'k-1', tabId: 't', kind: 'ready', payload: {} } as const
  const respond = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response

  it('retries a network failure with the same body, then succeeds', async () => {
    vi.useFakeTimers()
    const bodies: string[] = []
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body))
      if (n++ === 0) throw new TypeError('network')
      return respond(200, { ok: true })
    }))
    const p = sendSignal(event.callId, event, () => true)
    await vi.runAllTimersAsync()
    expect(await p).toBe('ok')
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1]) // same key — the box deduplicates it
  })

  it('call_gone is final; another 4xx is a refusal; a 429 is retried', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => respond(409, { error: 'call_gone' })))
    expect(await sendSignal(event.callId, event, () => true)).toBe('gone')
    vi.stubGlobal('fetch', vi.fn(async () => respond(400, { error: 'bad_request' })))
    expect(await sendSignal(event.callId, event, () => true)).toBe('refused')
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => (n++ < 2 ? respond(429, { error: 'rate_limited' }) : respond(200, {}))))
    const p = sendSignal(event.callId, event, () => true)
    await vi.runAllTimersAsync()
    expect(await p).toBe('ok')
  })

  it('stops retrying once the call is no longer live', async () => {
    vi.useFakeTimers()
    let live = true
    const f = vi.fn(async () => { live = false; throw new TypeError('network') })
    vi.stubGlobal('fetch', f)
    const p = sendSignal(event.callId, event, () => live)
    await vi.runAllTimersAsync()
    expect(await p).toBe('refused')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('CallApiError carries the code and status', () => {
    const e = new CallApiError('call_gone', 409)
    expect([e.code, e.status, e.name]).toEqual(['call_gone', 409, 'CallApiError'])
  })
})

describe('call copy (call-copy.ts)', () => {
  it('a busy, declined or timed-out call reads the same to the caller — "No answer" — and "Missed call" to the callee', () => {
    for (const r of ['declined', 'unavailable', 'missed']) {
      expect(callEndText(r, 'caller', tr)).toBe('No answer')
      expect(callEndText(r, 'callee', tr)).toBe('Missed call')
    }
  })

  it('every refusal code the call routes emit has its own words; anything else falls back', () => {
    const codes = ['calls_not_verified', 'calls_peer_not_verified', 'calls_consent_required', 'calls_cooldown', 'call_in_progress',
      'call_gone', 'protocol_mismatch', 'relay_unavailable', 'blocked', 'media_denied', 'media_no_device', 'media_in_use', 'calls_unavailable']
    const fallback = callErrorText('something_else', tr)
    for (const c of codes) expect(callErrorText(c, tr), c).not.toBe(fallback)
  })

  it('the ring screen leads with the listing', () => {
    expect(callerRoleLine('buyer', 'Studio D3', tr)).toBe('Interested in Studio D3')
    expect(callerRoleLine(null, null, tr)).toBeNull()
  })
})
