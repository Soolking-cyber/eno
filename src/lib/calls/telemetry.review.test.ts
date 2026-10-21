import { describe, expect, it } from 'vitest'
import {
  CALL_TELEMETRY_VERSION,
  CallTelemetrySummary,
  TELEMETRY_AUDIO_CODECS,
  TELEMETRY_CANDIDATE_TYPES,
  TELEMETRY_QUALITY_LIMITATIONS,
  TELEMETRY_READ_FIELDS,
  TELEMETRY_RELAY_PROTOCOLS,
  TELEMETRY_VIDEO_CODECS,
  containsIpLikeString,
  summarizeStats,
  type CallTelemetryContext,
} from './telemetry'

/**
 * Adversarial review of telemetry.ts (DESIGN.md v3 §3.6). The module's own suite pins the happy paths and the main
 * privacy property; this file attacks what it left open:
 *   · the SERVER side of the schema — a body built by hand, not by summarizeStats. zod's .strict() skips one key,
 *     "__proto__", while looking for unknown ones, so "an extra key is a reject" was not true of every key;
 *   · the module's own rules applied where its tests did not look: a stale gauge from a window that heard nothing,
 *     heights in codec-plan's vocabulary (the frame's SHORT side), counters that lie, an engine that passes the wrong
 *     prev;
 *   · the allowlist reader under garbage (every entry behind a Proxy, seeded fuzz), and the guard against slow inputs.
 */

type Stat = Record<string, unknown>

const CALL_ID = '0b7e9c2a-51d4-4f3e-8a6b-9c1d2e3f4a5b'
const T0 = 1_761_100_000_000
const T1 = T0 + 30_000

const ctx = (over: Partial<CallTelemetryContext> = {}): CallTelemetryContext => ({
  callId: CALL_ID,
  role: 'callee',
  seq: 5,
  tSec: 150,
  final: false,
  restarts: 1,
  held: false,
  ...over,
})

/** The cumulative counters of one snapshot; the gauges ride along. */
interface N {
  aSent: number
  aRecv: number
  aPkts: number
  aLost: number
  aSamples: number
  aConcealed: number
  jitter: number
  vSent: number
  vFramesSent: number
  vFramesEnc: number
  vEncT: number
  vRecv: number
  vFramesDec: number
  vDecT: number
  vFreeze: number
  vPkts: number
  sendW: number
  sendH: number
  recvW: number
  recvH: number
}

const AT0: N = {
  aSent: 100_000, aRecv: 90_000, aPkts: 1_000, aLost: 10, aSamples: 960_000, aConcealed: 9_600, jitter: 0.02,
  vSent: 3_000_000, vFramesSent: 600, vFramesEnc: 600, vEncT: 3, vRecv: 2_000_000, vFramesDec: 500, vDecT: 2.5, vFreeze: 0, vPkts: 2_000,
  sendW: 960, sendH: 540, recvW: 640, recvH: 360,
}
// +30 s: +150 kB sent (40 kbit/s), +1 500 packets heard with 15 lost (≈0.99%), +900 frames sent (30 fps).
const AT1: N = {
  ...AT0,
  aSent: 250_000, aRecv: 225_000, aPkts: 2_500, aLost: 25, aSamples: 2_400_000, aConcealed: 24_000, jitter: 0.015,
  vSent: 7_500_000, vFramesSent: 1_500, vFramesEnc: 1_500, vEncT: 7.5, vRecv: 5_000_000, vFramesDec: 1_250, vDecT: 6.25, vFreeze: 1, vPkts: 5_000,
}

/** A compact Chrome-shaped report, with every address-bearing field filled in. */
function report(t: number, n: N): Stat[] {
  return [
    { id: 'T', type: 'transport', timestamp: t, selectedCandidatePairId: 'CP', iceLocalUsernameFragment: 'u1Fx' },
    {
      id: 'CP', type: 'candidate-pair', timestamp: t, localCandidateId: 'L', remoteCandidateId: 'R', state: 'succeeded', nominated: true,
      totalRoundTripTime: t === T0 ? 0.5 : 2, responsesReceived: t === T0 ? 10 : 40, currentRoundTripTime: 0.05, availableOutgoingBitrate: 1_500_000,
    },
    { id: 'L', type: 'local-candidate', timestamp: t, candidateType: 'relay', relayProtocol: 'udp', address: '104.30.149.48', port: 3478, url: 'turn:198.51.100.20:3478?transport=udp', relatedAddress: '192.168.1.23', relatedPort: 5000, foundation: '9', usernameFragment: 'u1Fx' },
    { id: 'R', type: 'remote-candidate', timestamp: t, candidateType: 'relay', address: '172.64.149.23', port: 3478, relatedAddress: '113.161.72.10', relatedPort: 6000 },
    { id: 'CA', type: 'codec', timestamp: t, mimeType: 'audio/opus' },
    { id: 'CV', type: 'codec', timestamp: t, mimeType: 'video/H264' },
    { id: 'OA', type: 'outbound-rtp', kind: 'audio', timestamp: t, codecId: 'CA', bytesSent: n.aSent, remoteId: 'RIA', active: true },
    {
      id: 'IA', type: 'inbound-rtp', kind: 'audio', timestamp: t, codecId: 'CA', bytesReceived: n.aRecv, packetsReceived: n.aPkts, packetsLost: n.aLost,
      jitter: n.jitter, totalSamplesReceived: n.aSamples, concealedSamples: n.aConcealed,
    },
    { id: 'RIA', type: 'remote-inbound-rtp', kind: 'audio', timestamp: t, localId: 'OA', roundTripTime: 0.07, totalRoundTripTime: t === T0 ? 0.6 : 1.8, roundTripTimeMeasurements: t === T0 ? 10 : 30 },
    {
      id: 'OV', type: 'outbound-rtp', kind: 'video', timestamp: t, codecId: 'CV', bytesSent: n.vSent, framesSent: n.vFramesSent, framesEncoded: n.vFramesEnc,
      totalEncodeTime: n.vEncT, frameWidth: n.sendW, frameHeight: n.sendH, active: true, qualityLimitationReason: 'none', powerEfficientEncoder: true,
    },
    {
      id: 'IV', type: 'inbound-rtp', kind: 'video', timestamp: t, codecId: 'CV', bytesReceived: n.vRecv, packetsReceived: n.vPkts, packetsLost: 0,
      framesDecoded: n.vFramesDec, totalDecodeTime: n.vDecT, frameWidth: n.recvW, frameHeight: n.recvH, freezeCount: n.vFreeze,
    },
  ]
}

const edit = (r: Stat[], id: string, patch: Stat): Stat[] => r.map((s) => (s.id === id ? { ...s, ...patch } : s))
const drop = (r: Stat[], id: string, keys: readonly string[]): Stat[] =>
  r.map((s) => (s.id === id ? Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k))) : s))

function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) stringLeaves(x, out)
  return out
}
function numberLeaves(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v)
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) numberLeaves(x, out)
  return out
}

/** A valid summary as the server receives it: a JSON text, parsed. */
const wire = () => JSON.parse(JSON.stringify(summarizeStats(report(T1, AT1), report(T0, AT0), ctx()))) as Record<string, any>

// ---------------------------------------------------------------------------
// The schema as the SERVER uses it — on a body nobody vouches for
// ---------------------------------------------------------------------------

describe('⛔ the schema on a hand-built body: an extra key is a reject — "__proto__" included', () => {
  it('the happy path survives the hardening: a real summary, through JSON and back, parses to an equal object', () => {
    const body = wire()
    const r = CallTelemetrySummary.safeParse(body)
    expect(r.success).toBe(true)
    expect(r.data).toEqual(body) // the pre-check hands the body on untouched; .data is the parsed summary
  })

  it('an own "__proto__" key from JSON.parse is rejected at the top level — zod skips that one key on its own', () => {
    // JSON.parse makes "__proto__" an OWN data property (not the prototype). zod's unknown-key scan skips it and drops
    // it from the output, so without the module's own check this body passed .strict() with an IP riding along.
    const body = JSON.stringify(wire()).replace(/^\{/, '{"__proto__":{"address":"192.168.1.23","port":54400},')
    const parsed = JSON.parse(body)
    expect(Object.keys(parsed)).toContain('__proto__')
    const r = CallTelemetrySummary.safeParse(parsed)
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].code).toBe('unrecognized_keys')
  })

  it.each(['audio', 'video', 'transport'])('… and inside %s', (block) => {
    const text = JSON.stringify(wire()).replace(`"${block}":{`, `"${block}":{"__proto__":"turn:198.51.100.20:3478",`)
    const parsed = JSON.parse(text)
    expect(Object.keys(parsed[block])).toContain('__proto__')
    const r = CallTelemetrySummary.safeParse(parsed)
    expect(r.success, block).toBe(false)
    expect(r.error?.issues[0].path, block).toEqual([block])
  })

  it('a harmless value under "__proto__" is still a reject: the key itself is the extra key', () => {
    for (const v of ['null', '{}', '1', '"x"', '[]']) {
      const parsed = JSON.parse(JSON.stringify(wire()).replace(/^\{/, `{"__proto__":${v},`))
      expect(CallTelemetrySummary.safeParse(parsed).success, v).toBe(false)
    }
  })

  it('the other Object.prototype names are rejected as extra keys at every level (regression guard)', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
      for (const block of [null, 'audio', 'video', 'transport']) {
        const s = wire()
        ;(block === null ? s : s[block])[key] = '10.0.0.1'
        expect(CallTelemetrySummary.safeParse(s).success, `${block}.${key}`).toBe(false)
      }
    }
  })

  it('a non-object body is a reject, never a crash', () => {
    for (const body of [null, 'x', 42, true, [], [wire()]]) expect(CallTelemetrySummary.safeParse(body).success).toBe(false)
  })

  it.each(['unknown', 'srflx', 'host', 'prflx'] as const)('relayProtocol on a %s path is a reject (not only on host)', (candidateType) => {
    const s = wire()
    s.transport = { candidateType, relayProtocol: 'tcp', rttMs: 10, availableOutgoingKbps: 500 }
    expect(CallTelemetrySummary.safeParse(s).success).toBe(false)
  })

  it('the guard sees an IP riding under "__proto__" in the JSON.parse result (the order the route must use)', () => {
    const parsed = JSON.parse('{"v":1,"__proto__":{"ip":"203.0.113.7"}}')
    expect(containsIpLikeString(parsed)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The module's own rules, where its tests did not look
// ---------------------------------------------------------------------------

describe('a window that heard nothing reports no stale health gauge', () => {
  it('jitter is null when no packet arrived in the window — RFC 3550 jitter only moves when one does', () => {
    // Same counters 30 s apart: the inbound path is dead. The browser still lists the last jitter it computed.
    const s = summarizeStats(report(T1, { ...AT0, jitter: 0.015 }), report(T0, AT0), ctx())
    expect(s.audio?.recvKbps).toBe(0)
    expect(s.audio?.packetsLostPct).toBeNull()
    expect(s.audio?.jitterMs).toBeNull()
  })

  it('… but it is reported for a live window, for a first sample, and when liveness cannot be told', () => {
    expect(summarizeStats(report(T1, AT1), report(T0, AT0), ctx()).audio?.jitterMs).toBe(15)
    expect(summarizeStats(report(T0, AT0), undefined, ctx()).audio?.jitterMs).toBe(20)
    // A replaced stream (packetsReceived went backwards): the jitter belongs to the live stream, so it stands.
    expect(summarizeStats(report(T1, { ...AT0, aPkts: 10, jitter: 0.03 }), report(T0, AT0), ctx()).audio?.jitterMs).toBe(30)
    // No packetsReceived at all: nothing says the path is dead, so the gauge stands.
    const blind = (r: Stat[]) => drop(r, 'IA', ['packetsReceived'])
    expect(summarizeStats(blind(report(T1, AT1)), blind(report(T0, AT0)), ctx()).audio?.jitterMs).toBe(15)
  })

  it('a stream that has received nothing at all (first sample) has no jitter either', () => {
    const s = summarizeStats(report(T0, { ...AT0, aPkts: 0, aLost: 0, jitter: 0 }), undefined, ctx())
    expect(s.audio?.jitterMs).toBeNull()
  })
})

describe('heights are the frame\'s SHORT side — codec-plan\'s vocabulary', () => {
  it('a portrait 540×960 frame reads 540 both ways, not 960', () => {
    const portrait = { ...AT1, sendW: 540, sendH: 960, recvW: 360, recvH: 640 }
    const s = summarizeStats(report(T1, portrait), report(T0, AT0), ctx())
    expect(s.video?.sendHeight).toBe(540)
    expect(s.video?.recvHeight).toBe(360)
  })

  it('landscape is unchanged; no width → the height alone; no height → null', () => {
    expect(summarizeStats(report(T1, AT1), undefined, ctx()).video).toMatchObject({ sendHeight: 540, recvHeight: 360 })
    const noWidth = drop(drop(report(T1, { ...AT1, sendH: 960, recvH: 640 }), 'OV', ['frameWidth']), 'IV', ['frameWidth'])
    expect(summarizeStats(noWidth, undefined, ctx()).video).toMatchObject({ sendHeight: 960, recvHeight: 640 })
    const noHeight = drop(drop(report(T1, AT1), 'OV', ['frameHeight']), 'IV', ['frameHeight'])
    expect(summarizeStats(noHeight, undefined, ctx()).video).toMatchObject({ sendHeight: null, recvHeight: null })
  })

  it('a nonsense width (0, negative, NaN) cannot drag the height down to it', () => {
    for (const w of [0, -540, Number.NaN]) {
      const r = edit(report(T1, AT1), 'OV', { frameWidth: w })
      expect(summarizeStats(r, undefined, ctx()).video?.sendHeight, String(w)).toBe(540)
    }
  })

  it('a portrait 8K frame (4320×7680) is in range as its short side', () => {
    const r = edit(report(T1, AT1), 'OV', { frameWidth: 4320, frameHeight: 7680 })
    expect(summarizeStats(r, undefined, ctx()).video?.sendHeight).toBe(4320)
  })
})

describe('counters that lie, and an engine that passes the wrong prev', () => {
  it('concealment larger than the samples it is part of is null, never > 100%', () => {
    const r = edit(report(T1, AT1), 'IA', { concealedSamples: 3_000_000, totalSamplesReceived: 2_400_000 })
    expect(summarizeStats(r, undefined, ctx()).audio?.concealedPct).toBeNull()
  })

  it('negative cumulative counters are null, not negative rates or ratios', () => {
    const r = edit(edit(report(T1, AT1), 'OA', { bytesSent: -1 }), 'OV', { framesEncoded: -5, totalEncodeTime: -1 })
    const s = summarizeStats(r, report(T0, AT0), ctx())
    expect(s.audio?.sendKbps).toBeNull()
    expect(s.video?.encodeMsPerFrame).toBeNull()
    expect(CallTelemetrySummary.safeParse(s).success).toBe(true)
  })

  it('a loss counter missing from prev (but present now) gives no loss share rather than a cumulative one', () => {
    const s = summarizeStats(report(T1, AT1), drop(report(T0, AT0), 'IA', ['packetsLost']), ctx())
    expect(s.audio?.packetsLostPct).toBeNull()
    expect(s.audio?.recvKbps).toBe(36) // the rest of the stream's window is intact
  })

  it('no frames encoded in the window: ms per frame is null, not 0 and not Infinity', () => {
    const r = report(T1, { ...AT1, vFramesEnc: AT0.vFramesEnc, vEncT: AT0.vEncT, vFramesDec: AT0.vFramesDec, vDecT: AT0.vDecT })
    const s = summarizeStats(r, report(T0, AT0), ctx())
    expect(s.video?.encodeMsPerFrame).toBeNull()
    expect(s.video?.decodeMsPerFrame).toBeNull()
  })

  it('prev === report (the same report twice): no rates, no ratios, still schema-valid', () => {
    const r = report(T1, AT1)
    const s = summarizeStats(r, r, ctx())
    expect(s.audio).toMatchObject({ sendKbps: null, recvKbps: null, packetsLostPct: null, concealedPct: null, rttMs: null, jitterMs: null })
    expect(s.video).toMatchObject({ sendFps: null, recvFps: null, encodeMsPerFrame: null, decodeMsPerFrame: null })
    expect(s.transport.rttMs).toBeNull()
    expect(CallTelemetrySummary.safeParse(s).success).toBe(true)
  })

  it('report and prev swapped (prev is the NEWER one): every window value is null, nothing negative', () => {
    const s = summarizeStats(report(T0, AT0), report(T1, AT1), ctx())
    expect(s.audio).toMatchObject({ sendKbps: null, recvKbps: null, packetsLostPct: null, concealedPct: null })
    expect(s.video).toMatchObject({ sendFps: null, recvFps: null, freezeCount: null, encodeMsPerFrame: null })
    for (const n of numberLeaves(s)) expect(n).toBeGreaterThanOrEqual(0)
  })

  it('a re-iterable prev (Map / array) gives the same summary every time it is reused', () => {
    const asMap = (r: Stat[]) => new Map(r.map((s) => [String(s.id), s]))
    const prev = asMap(report(T0, AT0))
    const a = summarizeStats(asMap(report(T1, AT1)), prev, ctx())
    const b = summarizeStats(asMap(report(T1, AT1)), prev, ctx())
    expect(b).toEqual(a)
    expect(a.audio?.sendKbps).toBe(40)
  })

  it('unbundled transports: the first one with a resolvable selected pair wins, a dangling one is skipped', () => {
    const r: Stat[] = [
      { id: 'T0', type: 'transport', selectedCandidatePairId: 'gone' },
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P2' },
      { id: 'P2', type: 'candidate-pair', localCandidateId: 'L2', state: 'succeeded', nominated: true },
      { id: 'L2', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'tls', address: '104.30.149.48' },
    ]
    expect(summarizeStats(r, undefined, ctx()).transport).toMatchObject({ candidateType: 'relay', relayProtocol: 'tls' })
  })

  it('a relay candidate without relayProtocol never borrows another candidate\'s', () => {
    const r = drop(report(T1, AT1), 'L', ['relayProtocol']).concat([
      { id: 'L9', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'tcp', address: '198.51.100.20' },
    ])
    expect(summarizeStats(r, undefined, ctx()).transport).toMatchObject({ candidateType: 'relay', relayProtocol: null })
  })
})

// ---------------------------------------------------------------------------
// The allowlist reader under garbage
// ---------------------------------------------------------------------------

describe('⛔ the allowlist holds under garbage — every entry behind a Proxy, seeded fuzz', () => {
  const ALLOWED_STRINGS = new Set<string>([
    CALL_ID, 'caller', 'callee', ...TELEMETRY_AUDIO_CODECS, ...TELEMETRY_VIDEO_CODECS, ...TELEMETRY_CANDIDATE_TYPES,
    ...TELEMETRY_RELAY_PROTOCOLS, ...TELEMETRY_QUALITY_LIMITATIONS,
  ])

  function watch(entries: Stat[]) {
    const bad: string[] = []
    const allowed = new Set<string>(TELEMETRY_READ_FIELDS)
    const wrapped = entries.map(
      (target, i) =>
        new Proxy(target, {
          get(t, key, recv) {
            if (typeof key !== 'string' || !allowed.has(key)) bad.push(`#${i} get ${String(key)}`)
            return Reflect.get(t, key, recv)
          },
          has(t, key) {
            bad.push(`#${i} has ${String(key)}`)
            return Reflect.has(t, key)
          },
          ownKeys(t) {
            bad.push(`#${i} ownKeys`)
            return Reflect.ownKeys(t)
          },
          getOwnPropertyDescriptor(t, key) {
            bad.push(`#${i} descriptor ${String(key)}`)
            return Reflect.getOwnPropertyDescriptor(t, key)
          },
          set(_t, key) {
            bad.push(`#${i} set ${String(key)}`)
            return true
          },
          defineProperty(_t, key) {
            bad.push(`#${i} define ${String(key)}`)
            return true
          },
          deleteProperty(_t, key) {
            bad.push(`#${i} delete ${String(key)}`)
            return true
          },
          getPrototypeOf(t) {
            bad.push(`#${i} getPrototypeOf`)
            return Reflect.getPrototypeOf(t)
          },
        }),
    )
    return { wrapped, bad }
  }

  it('no read outside TELEMETRY_READ_FIELDS, no enumeration, no write — on 600 corrupted reports', () => {
    let seed = 0x0dd_ba11
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
    const NASTY: unknown[] = [
      '192.168.1.23', 'fe80::1', '__proto__', 'constructor', 'relay', 'tls', 'audio', 'video', 'audio/opus', 'video/VP8',
      'transport', 'candidate-pair', 'local-candidate', 'outbound-rtp', 'inbound-rtp', 'remote-inbound-rtp', 'codec',
      'CP', 'L', 'OA', 'OV', 'IA', 'IV', 'RIA', 'CA', 'CV', 'T', 'succeeded',
      NaN, Infinity, -Infinity, -1, 0, 0.5, 1e9, 1e308, -0, 2 ** 53, true, false, null, undefined, {}, [], ['a', 'b'],
    ]
    const fields = [...TELEMETRY_READ_FIELDS, 'address', 'url', 'relatedAddress', 'foundation', 'usernameFragment']
    let deep = 0 // iterations that really walked pair → local candidate and the streams, behind the Proxies
    for (let i = 0; i < 600; i++) {
      const base = pick([report(T1, AT1), report(T0, AT0), []])
      const cur = base.map((s) => {
        if (rnd() > 0.5) return s
        const e = { ...s }
        for (let k = 0; k < 3; k++) e[pick(fields)] = pick(NASTY)
        return e
      })
      const junk = Array.from({ length: Math.floor(rnd() * 4) }, () => ({ id: pick(NASTY), type: pick(NASTY), kind: pick(NASTY) }) as Stat)
      const a = watch([...cur, ...junk])
      const b = watch(pick([report(T0, AT0), cur, []]))
      const shape = pick(['array', 'map', 'pairs'] as const)
      const asInput = (w: Stat[]) =>
        shape === 'array' ? w : shape === 'map' ? new Map(w.map((e, j) => [`k${j}`, e])) : w.map((e, j) => [`k${j}`, e] as const)
      const s = summarizeStats(asInput(a.wrapped), asInput(b.wrapped), ctx({ seq: i }))
      expect(a.bad, `iteration ${i}`).toEqual([])
      expect(b.bad, `iteration ${i}`).toEqual([])
      expect(CallTelemetrySummary.safeParse(s).success, `iteration ${i}`).toBe(true)
      expect(containsIpLikeString(s), `iteration ${i}`).toBe(false)
      for (const v of stringLeaves(s)) expect(ALLOWED_STRINGS.has(v), `iteration ${i}: ${v}`).toBe(true)
      if (s.audio !== null && s.video !== null && s.transport.candidateType === 'relay') deep++
    }
    expect(deep, 'the fuzz must reach the deep paths, or "no bad read" is vacuous').toBeGreaterThan(60)
  })

  it('the summary shares no object with its inputs and survives a JSON round trip unchanged', () => {
    const r = report(T1, AT1)
    const p = report(T0, AT0)
    const c = ctx()
    const s = summarizeStats(r, p, c)
    const inputs = new Set<unknown>([...r, ...p, c])
    const objects: unknown[] = [s, s.audio, s.video, s.transport]
    for (const o of objects) expect(inputs.has(o)).toBe(false)
    for (const o of objects) if (o !== null) expect(Object.getPrototypeOf(o)).toBe(Object.prototype)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('junk items inside an otherwise real report are skipped, not read and not fatal', () => {
    const junk: unknown[] = [1, 'local-candidate', null, undefined, true, [], [1, 2, 3], ['k', 42], ['k', null], ['k', 'x']]
    const s = summarizeStats([...junk, ...report(T1, AT1)], [...junk, ...report(T0, AT0)], ctx())
    expect(s).toEqual(summarizeStats(report(T1, AT1), report(T0, AT0), ctx()))
  })

  it('the input is left exactly as it was', () => {
    const r = report(T1, AT1)
    const before = JSON.stringify(r)
    summarizeStats(r, report(T0, AT0), ctx())
    expect(JSON.stringify(r)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('containsIpLikeString — more shapes, and no slow path on hostile input', () => {
  it.each([
    '::ffff:c0a8:117', // IPv4-mapped, hex form
    '64:ff9b::c000:221', // NAT64
    'turns:[2001:db8::7]:443?transport=tcp',
    '{"192\\u002e168\\u002e1\\u002e23":1}', // escaped dots in a KEY: only the re-parse sees it
    'a.b.c.d 10.0.0.255',
    'fd12:3456:789a:1:2:3:4:5',
  ])('flags %s', (s) => {
    expect(containsIpLikeString(s)).toBe(true)
  })

  it('never flags the largest legal summary (every number at its bound)', () => {
    const s = summarizeStats(report(T1, AT1), report(T0, AT0), ctx({ seq: 10_000, tSec: 14_400, restarts: 1_000, final: true, held: true }))
    const maxed = {
      ...s,
      audio: { codec: 'other', sendKbps: 1999.9, recvKbps: 2000, packetsLostPct: 99.99, jitterMs: 9999.9, concealedPct: 100, rttMs: 10000 },
      video: { ...s.video, sendHeight: 4320, recvHeight: 4320, sendFps: 239.9, recvFps: 240, freezeCount: 10000, encodeMsPerFrame: 9999.9, decodeMsPerFrame: 0.1 },
      transport: { candidateType: 'relay', relayProtocol: 'tls', rttMs: 0.1, availableOutgoingKbps: 1_000_000 },
    }
    expect(CallTelemetrySummary.safeParse(maxed).success).toBe(true)
    expect(containsIpLikeString(maxed)).toBe(false)
    expect(containsIpLikeString(JSON.stringify(maxed))).toBe(false)
  })

  it('runs in linear time on ~1 MB of near-miss input (the route calls it on bodies nobody vouches for)', () => {
    const inputs = [
      '1'.repeat(1_000_000),
      '1.'.repeat(500_000),
      'aaaaa:'.repeat(170_000),
      ':a'.repeat(500_000),
      'a.'.repeat(500_000) + 'loca',
      `"${'\\u0031'.repeat(150_000)}"`,
    ]
    for (const s of inputs) {
      const t = performance.now()
      containsIpLikeString(s)
      expect(performance.now() - t, s.slice(0, 12)).toBeLessThan(1_500)
    }
  })

  it('a value whose serialisation throws is treated as containing an address (fails closed)', () => {
    const hostile = { get v() { throw new Error('boom') } }
    expect(containsIpLikeString(hostile)).toBe(true)
    expect(containsIpLikeString({ toJSON() { return '10.1.2.3' } })).toBe(true)
  })
})

describe('the version marker', () => {
  it('a summary always carries the telemetry version, never the call protocol version', () => {
    expect(summarizeStats([], undefined, ctx()).v).toBe(CALL_TELEMETRY_VERSION)
  })
})
