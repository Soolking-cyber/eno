import { describe, expect, it } from 'vitest'
import {
  audioCodecPreferences,
  buildPlan,
  directionsFor,
  parseCodecPlan,
  videoCodecPreferences,
  type CodecPlan,
  type DirectionPlan,
  type RtpCodecLike,
} from './codec-plan'
import { CALL_PROTOCOL_VERSION, type CapabilityReport, type CodecSupport } from './types'

/**
 * ADVERSARIAL REVIEW of the codec plan (2026-10-21). The module's own suite checks the plan against the REPORTS. This
 * file checks it against what the browsers will actually NEGOTIATE, because a plan that names a codec the SDP cannot
 * carry fails silently: nothing throws, the call connects, and the wrong encoder runs.
 *
 * ⚠️ THE FINDING THIS FILE EXISTS FOR: THE VIDEO TRANSCEIVER IS SENDRECV (DESIGN §3.2 step 4), AND A SENDRECV m-SECTION
 * LISTS ONLY WHAT ITS AUTHOR CAN BOTH SEND AND RECEIVE. Verified in primary sources, not reasoned:
 *   - W3C webrtc-pc, createOffer AND createAnswer: for "sendrecv", "exclude any codecs not included in the list of
 *     implemented send codecs" AND "exclude any codecs not included in the list of implemented receive codecs".
 *   - libwebrtc m150 pc/rtp_transceiver.cc UpdateCodecPreferencesCaches: a preference enters
 *     sendrecv_codec_preferences_ only `if (is_send_codec && is_recv_codec)`. Without preferences,
 *     pc/codec_vendor.cc video_sendrecv_codecs() = NegotiateCodecs(recv, send), the intersection.
 *   - media/base/codec_comparators.cc IsSameCodecSpecific: H.264 compares the PROFILE (and packetization mode), AV1 its
 *     profile. Only the level is ignored. So 640c (Constrained High) is its own codec here.
 * So a codec that one device can only DECODE (AV1 on an iPhone 15 Pro or a 32-bit potato with dav1d but no libaom;
 * Constrained High on a phone whose encoder lacks it; H.264 on a WebView that lists no H.264 encoder) is negotiated in
 * NEITHER direction. The module planned on "sender encodes + receiver decodes" alone, so it promised High into phones
 * that cannot receive it, H.264 into a WebView that cannot negotiate it, and AV1 to every iPhone 15 Pro.
 *
 * How the senders then choose is verified too. libwebrtc pc/channel.cc builds the send parameters from the REMOTE
 * description for both roles (a local answer only carries the offer-derived send codecs forward), and
 * media/engine/webrtc_video_engine.cc SelectSendVideoCodecs keeps that remote order ("ordered by receive codec
 * preference first"). RFC 3264 §6.1/§7 say the same. For audio, webrtc_voice_engine.cc uses RED only when red sits
 * BEFORE the send codec in that remote list.
 */

// ---------------------------------------------------------------------------
// Devices: the module suite's five classes, plus three capability SHAPES the review adds
// ---------------------------------------------------------------------------

const V = CALL_PROTOCOL_VERSION
const HW = { encode: true, decode: true, powerEfficientEncode: true, powerEfficientDecode: true } as const
const SW = { encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: false } as const
const DECODE_ONLY_HW = { encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: true } as const
const DECODE_ONLY_SW = { encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: false } as const

/** Same as the module suite: hardware CBP encoder, High decode only, VP8 libvpx, AV1 dav1d decode only (no libaom on arm32). */
const POTATO: CapabilityReport = {
  v: V,
  platform: 'android',
  app: 'browser',
  deviceMemory: 2,
  maxRecvHeight: 540,
  maxSendHeight: 540,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...HW },
    { codec: 'H264', profile: 'high', ...DECODE_ONLY_HW },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', ...DECODE_ONLY_HW },
    { codec: 'AV1', ...DECODE_ONLY_SW },
    { codec: 'H265', ...HW },
  ],
}

/** Same as the module suite: VideoToolbox H.264 (CBP + High) and HEVC both ways; a hardware AV1 DECODER and no AV1 encoder. */
const IPHONE_15_PRO: CapabilityReport = {
  v: V,
  platform: 'ios',
  app: 'capacitor-ios',
  maxRecvHeight: 1080,
  maxSendHeight: 1080,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...HW },
    { codec: 'H264', profile: 'high', ...HW },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'AV1', ...DECODE_ONLY_HW },
    { codec: 'H265', ...HW },
  ],
}

const IPHONE_12: CapabilityReport = {
  ...IPHONE_15_PRO,
  app: 'browser',
  codecs: IPHONE_15_PRO.codecs.map((c) => (c.codec === 'AV1' ? { ...c, decode: false, powerEfficientDecode: false } : c)),
}

const ANDROID_FLAGSHIP: CapabilityReport = {
  v: V,
  platform: 'android',
  app: 'browser',
  deviceMemory: 8,
  maxRecvHeight: 720,
  maxSendHeight: 720,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...HW },
    { codec: 'H264', profile: 'high', ...HW },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'AV1', encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'H265', ...HW },
  ],
}

const LINUX_DESKTOP: CapabilityReport = {
  v: V,
  platform: 'desktop',
  app: 'browser',
  maxRecvHeight: 1080,
  maxSendHeight: 720,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...SW },
    { codec: 'H264', profile: 'high', ...DECODE_ONLY_SW },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', ...SW },
    { codec: 'AV1', ...SW },
  ],
}

/**
 * A WebView that DECODES H.264 but lists no H.264 ENCODER. research-codecs: ARM32 builds before M148 lacked hardware
 * H.264 in getCapabilities, and OpenH264 is not built for 32-bit ARM ("Negotiation then falls back to VP8"). A shape
 * for the rule, not a measured phone.
 */
const H264_DECODE_ONLY_WEBVIEW: CapabilityReport = {
  v: V,
  platform: 'android',
  app: 'capacitor-android',
  deviceMemory: 2,
  maxRecvHeight: 540,
  maxSendHeight: 540,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...DECODE_ONLY_HW },
    { codec: 'H264', profile: 'high', ...DECODE_ONLY_HW },
    { codec: 'VP8', ...SW },
    { codec: 'AV1', ...DECODE_ONLY_SW },
  ],
}

/** A 64-bit Android build whose hardware encoder also offers Constrained High, with libaom + dav1d. Also a shape, not a phone. */
const MID_64BIT: CapabilityReport = {
  v: V,
  platform: 'android',
  app: 'capacitor-android',
  deviceMemory: 4,
  maxRecvHeight: 720,
  maxSendHeight: 720,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...HW },
    { codec: 'H264', profile: 'high', ...HW },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', ...DECODE_ONLY_HW },
    { codec: 'AV1', ...SW },
  ],
}

/**
 * Lists a Constrained High ENCODER, but not a power-efficient one, and decodes High in hardware. High is negotiable
 * with any High-capable peer, yet only the direction INTO this device starts on High. That is the asymmetric
 * High/CBP case the receive-direction rule exists for. A shape, not a phone.
 */
const HIGH_SOFT_ENCODER: CapabilityReport = {
  v: V,
  platform: 'desktop',
  app: 'browser',
  maxRecvHeight: 720,
  maxSendHeight: 720,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...HW },
    { codec: 'H264', profile: 'high', encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'VP8', ...SW },
  ],
}

const DEVICES = { POTATO, IPHONE_15_PRO, IPHONE_12, ANDROID_FLAGSHIP, LINUX_DESKTOP, H264_DECODE_ONLY_WEBVIEW, MID_64BIT, HIGH_SOFT_ENCODER }
const PAIRS = Object.entries(DEVICES).flatMap(([an, a]) =>
  Object.entries(DEVICES).map(([bn, b]) => [`${an} → ${bn}`, a, b] as [string, CapabilityReport, CapabilityReport]),
)

// ---------------------------------------------------------------------------
// A model of the negotiation, built from the sources in the header
// ---------------------------------------------------------------------------

const vc = (subtype: string, sdpFmtpLine?: string): RtpCodecLike =>
  sdpFmtpLine === undefined ? { mimeType: `video/${subtype}`, clockRate: 90000 } : { mimeType: `video/${subtype}`, clockRate: 90000, sdpFmtpLine }
const h264 = (profileLevelId: string, mode: 0 | 1) =>
  vc('H264', `level-asymmetry-allowed=1;packetization-mode=${mode};profile-level-id=${profileLevelId}`)

type FormatKey = 'H264:cbp' | 'H264:high' | 'VP8' | 'VP9' | 'AV1' | 'H265'
/** The getCapabilities entries one report claim stands for. */
const FORMATS: Record<FormatKey, readonly RtpCodecLike[]> = {
  'H264:cbp': [h264('42e01f', 1), h264('42e01f', 0)],
  'H264:high': [h264('640c1f', 1), h264('640c1f', 0)],
  VP8: [vc('VP8')],
  VP9: [vc('VP9', 'profile-id=0')],
  AV1: [vc('AV1', 'level-idx=5;profile=0;tier=0')],
  H265: [vc('H265', 'level-id=93;profile-id=1;tier-flag=0;tx-mode=SRST')],
}
const REPAIR: readonly RtpCodecLike[] = [vc('rtx'), vc('red'), vc('ulpfec')]
/** Engines list in different orders; the plan must not depend on it. Chrome offers VP8 first, Safari H.264 High first. */
const CHROME_ORDER: readonly FormatKey[] = ['VP8', 'H264:cbp', 'AV1', 'VP9', 'H264:high', 'H265']
const SAFARI_ORDER: readonly FormatKey[] = ['H264:high', 'H264:cbp', 'H265', 'VP8', 'VP9', 'AV1']

const keyOf = (c: CodecSupport): string => (c.codec === 'H264' ? `H264:${c.profile ?? 'cbp'}` : c.codec)
/** A report claim, read the way the module reads it: every entry for the key must say so. */
const claims = (r: CapabilityReport, key: FormatKey, side: 'encode' | 'decode'): boolean => {
  const entries = r.codecs.filter((c) => keyOf(c) === key)
  return entries.length > 0 && entries.every((c) => c[side] === true)
}

interface Caps {
  /** RTCRtpSender.getCapabilities('video').codecs: the list of implemented send codecs. */
  send: RtpCodecLike[]
  /** RTCRtpReceiver.getCapabilities('video').codecs: the list of implemented receive codecs. */
  recv: RtpCodecLike[]
}
function capsOf(r: CapabilityReport, order: readonly FormatKey[]): Caps {
  const list = (side: 'encode' | 'decode') => [...order.filter((k) => claims(r, k, side)).flatMap((k) => FORMATS[k]), ...REPAIR]
  return { send: list('encode'), recv: list('decode') }
}

const subOf = (c: RtpCodecLike) => c.mimeType.slice(c.mimeType.indexOf('/') + 1).toLowerCase()
const paramsOf = (c: RtpCodecLike) =>
  new Map(
    (c.sdpFmtpLine ?? '')
      .split(';')
      .map((p) => p.split('=').map((s) => s.trim().toLowerCase()))
      .filter((kv): kv is [string, string] => kv.length === 2),
  )
const isMedia = (c: RtpCodecLike) => !/^(rtx|red|ulpfec|flexfec.*)$/.test(subOf(c))

/** libwebrtc IsSameRtpCodecIgnoringLevel, for the formats above: H.264 by profile + packetization mode, AV1/VP9 by profile. */
function sameCodec(a: RtpCodecLike, b: RtpCodecLike): boolean {
  if (a.mimeType.toLowerCase() !== b.mimeType.toLowerCase() || a.clockRate !== b.clockRate || a.channels !== b.channels) return false
  const pa = paramsOf(a)
  const pb = paramsOf(b)
  switch (subOf(a)) {
    case 'h264':
      return (
        (pa.get('profile-level-id') ?? '42000a').slice(0, 4) === (pb.get('profile-level-id') ?? '42000a').slice(0, 4) &&
        (pa.get('packetization-mode') ?? '0') === (pb.get('packetization-mode') ?? '0')
      )
    case 'vp9':
      return (pa.get('profile-id') ?? '0') === (pb.get('profile-id') ?? '0')
    case 'av1':
      return (pa.get('profile') ?? '0') === (pb.get('profile') ?? '0')
    case 'vp8':
    case 'h265':
      return true
    default:
      return (a.sdpFmtpLine ?? '') === (b.sdpFmtpLine ?? '')
  }
}
const inList = (list: readonly RtpCodecLike[], c: RtpCodecLike) => list.some((x) => sameCodec(x, c))

/** W3C createOffer/createAnswer for direction "sendrecv": keep, in order, only what the device can BOTH send and receive. */
const sendrecvOnly = (prefs: readonly RtpCodecLike[], caps: Caps) => prefs.filter((c) => inList(caps.send, c) && inList(caps.recv, c))

/**
 * One offer/answer on the call's single sendrecv video transceiver. Each peer calls setCodecPreferences with
 * videoCodecPreferences(receiver capabilities, <the direction its rule picks>). The answer keeps the answerer's order
 * (it has preferences). The offerer sends the answer's first codec it can encode (RFC 3264 §7, SelectSendVideoCodecs),
 * and the answerer sends the offer's first codec that the answer also lists (§6.1).
 */
function negotiate(caller: CapabilityReport, callee: CapabilityReport, plan: CodecPlan, rule: 'receive' | 'send' = 'receive') {
  const a = capsOf(caller, caller.platform === 'ios' ? SAFARI_ORDER : CHROME_ORDER)
  const b = capsOf(callee, callee.platform === 'ios' ? SAFARI_ORDER : CHROME_ORDER)
  const offer = sendrecvOnly(videoCodecPreferences(a.recv, directionsFor(plan, 'caller')[rule]), a)
  const answer = sendrecvOnly(videoCodecPreferences(b.recv, directionsFor(plan, 'callee')[rule]), b).filter((c) => inList(offer, c))
  const negotiated = answer.filter(isMedia)
  return {
    negotiated,
    callerToCallee: negotiated.find((c) => inList(a.send, c)) ?? null,
    calleeToCaller: offer.filter(isMedia).find((c) => inList(negotiated, c) && inList(b.send, c)) ?? null,
  }
}

function nameOf(c: RtpCodecLike | null): string {
  if (!c) return 'nothing'
  if (subOf(c) !== 'h264') return subOf(c).toUpperCase()
  const p = paramsOf(c)
  const pli = p.get('profile-level-id') ?? ''
  return `H264 ${pli.startsWith('640c') ? 'high' : pli.startsWith('42e0') ? 'cbp' : pli} pm${p.get('packetization-mode') ?? '0'}`
}
const plannedName = (d: DirectionPlan) => (d.codec === 'H264' ? `H264 ${d.h264Profile} pm1` : 'VP8')

// ---------------------------------------------------------------------------
// D1 + D2 + D3: the plan must be what the sendrecv transceiver can carry
// ---------------------------------------------------------------------------

describe('review: every planned codec is the one the browsers actually negotiate and send', () => {
  it.each(PAIRS)('%s: planned codec = sent codec both ways; av1Eligible = AV1 negotiated; the VP8 fallback negotiated', (_, caller, callee) => {
    const plan = buildPlan(caller, callee, 'video')
    const wire = negotiate(caller, callee, plan)
    const sides = [
      [plan.directions.callerToCallee, wire.callerToCallee],
      [plan.directions.calleeToCaller, wire.calleeToCaller],
    ] as const
    for (const [planned, sent] of sides) {
      expect(planned).not.toBeNull() // every device here shares VP8 both ways
      if (!planned) continue
      expect(nameOf(sent)).toBe(plannedName(planned))
      expect(planned.av1Eligible).toBe(wire.negotiated.some((c) => subOf(c) === 'av1'))
      expect(wire.negotiated.some((c) => subOf(c) === 'vp8')).toBe(true)
    }
  })

  it('D1: no AV1 permission toward a peer that decodes AV1 but cannot encode it: its sendrecv m-section never lists AV1', () => {
    // The iPhone 15 Pro has a hardware AV1 DECODER and no encoder; the potato has dav1d and no libaom.
    expect(buildPlan(ANDROID_FLAGSHIP, IPHONE_15_PRO, 'video').directions.callerToCallee?.av1Eligible).toBe(false)
    expect(buildPlan(LINUX_DESKTOP, POTATO, 'video').directions.callerToCallee?.av1Eligible).toBe(false)
    expect(buildPlan(ANDROID_FLAGSHIP, POTATO, 'video').directions.callerToCallee?.av1Eligible).toBe(false)
    // Where both ends encode AND decode AV1, the permission stands, and it is the same both ways (one transceiver).
    const both = buildPlan(ANDROID_FLAGSHIP, MID_64BIT, 'video').directions
    expect([both.callerToCallee?.av1Eligible, both.calleeToCaller?.av1Eligible]).toEqual([true, true])
    expect(buildPlan(LINUX_DESKTOP, ANDROID_FLAGSHIP, 'video').directions.callerToCallee?.av1Eligible).toBe(true)
  })

  it('D2: High is never planned into a phone that cannot ENCODE Constrained High (640c is absent from its sendrecv m-section)', () => {
    expect(buildPlan(IPHONE_15_PRO, POTATO, 'video').directions.callerToCallee).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    expect(buildPlan(ANDROID_FLAGSHIP, POTATO, 'video').directions.callerToCallee).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    // A receiver that encodes and decodes 640c (in hardware) still gets High from a hardware High sender.
    expect(buildPlan(IPHONE_15_PRO, MID_64BIT, 'video').directions.callerToCallee).toMatchObject({ codec: 'H264', h264Profile: 'high' })
  })

  it('D3: a WebView that decodes H.264 but lists no H.264 encoder gets VP8 at 360p, not the H.264 540p start it can never negotiate', () => {
    expect(buildPlan(IPHONE_15_PRO, H264_DECODE_ONLY_WEBVIEW, 'video').directions).toStrictEqual({
      callerToCallee: { codec: 'VP8', startHeight: 360, startMaxBitrate: 700_000, maxHeight: 540, av1Eligible: false, fallback: 'VP8' },
      calleeToCaller: { codec: 'VP8', startHeight: 360, startMaxBitrate: 700_000, maxHeight: 540, av1Eligible: false, fallback: 'VP8' },
    })
  })

  it('High one way and CBP the other, when only one end encodes High in hardware; the browsers deliver exactly that', () => {
    const plan = buildPlan(IPHONE_15_PRO, HIGH_SOFT_ENCODER, 'video')
    expect(plan.directions.callerToCallee).toMatchObject({ codec: 'H264', h264Profile: 'high' })
    expect(plan.directions.calleeToCaller).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    const wire = negotiate(IPHONE_15_PRO, HIGH_SOFT_ENCODER, plan)
    expect([nameOf(wire.callerToCallee), nameOf(wire.calleeToCaller)]).toEqual(['H264 high pm1', 'H264 cbp pm1'])
  })

  it('the SENDER needs the decode half too: a codec it can encode but not decode is missing from its own sendrecv m-section', () => {
    const encodeOnly = (r: CapabilityReport, key: string): CapabilityReport => ({
      ...r,
      codecs: r.codecs.map((c) => (keyOf(c) === key ? { ...c, decode: false, powerEfficientDecode: false } : c)),
    })
    expect(buildPlan(encodeOnly(ANDROID_FLAGSHIP, 'AV1'), MID_64BIT, 'video').directions.callerToCallee?.av1Eligible).toBe(false)
    expect(buildPlan(encodeOnly(IPHONE_15_PRO, 'H264:high'), MID_64BIT, 'video').directions.callerToCallee).toMatchObject({ h264Profile: 'cbp' })
    // Into the potato High is not negotiable, so CBP is the only H.264 left, and without the decode half it is gone too.
    expect(buildPlan(encodeOnly(IPHONE_15_PRO, 'H264:cbp'), POTATO, 'video').directions.callerToCallee).toMatchObject({ codec: 'VP8' })
    expect(buildPlan(encodeOnly(IPHONE_15_PRO, 'VP8'), IPHONE_12, 'video').directions).toStrictEqual({ callerToCallee: null, calleeToCaller: null })
  })

  it('the VP8 fallback must work both ways too: a side that cannot SEND VP8 leaves VP8 out of the SDP, so neither direction is planned', () => {
    const noVp8Send: CapabilityReport = { ...ANDROID_FLAGSHIP, codecs: ANDROID_FLAGSHIP.codecs.map((c) => (c.codec === 'VP8' ? { ...c, encode: false } : c)) }
    expect(buildPlan(noVp8Send, IPHONE_12, 'video').directions).toStrictEqual({ callerToCallee: null, calleeToCaller: null })
  })

  it('the rule is the transceiver, not the report order: reversed codec lists give the same plan', () => {
    for (const [, a, b] of PAIRS) {
      const reversed = (r: CapabilityReport) => ({ ...r, codecs: [...r.codecs].reverse() })
      expect(buildPlan(reversed(a), reversed(b), 'video')).toStrictEqual(buildPlan(a, b, 'video'))
    }
  })
})

describe('review: why each peer orders the direction it RECEIVES (now with the sendrecv filter in the model)', () => {
  it('desktop without hardware H.264 ↔ iPhone: VP8 one way, hardware CBP the other, each exactly as planned', () => {
    const plan = buildPlan(LINUX_DESKTOP, IPHONE_12, 'video')
    expect([plan.directions.callerToCallee?.codec, plan.directions.calleeToCaller?.codec]).toEqual(['VP8', 'H264'])
    const wire = negotiate(LINUX_DESKTOP, IPHONE_12, plan, 'receive')
    expect([nameOf(wire.callerToCallee), nameOf(wire.calleeToCaller)]).toEqual(['VP8', 'H264 cbp pm1'])
  })

  it('ordering the SEND direction instead lands BOTH directions on the wrong codec: software H.264 on the desktop, software VP8 on the iPhone', () => {
    const plan = buildPlan(LINUX_DESKTOP, IPHONE_12, 'video')
    const wire = negotiate(LINUX_DESKTOP, IPHONE_12, plan, 'send')
    expect([nameOf(wire.callerToCallee), nameOf(wire.calleeToCaller)]).toEqual(['H264 cbp pm1', 'VP8'])
  })
})

// ---------------------------------------------------------------------------
// D4: the wire contract never throws
// ---------------------------------------------------------------------------

describe('review: parseCodecPlan on hostile input', () => {
  it('D4: never throws, even on objects JSON cannot produce (a throwing getter, a revoked Proxy), as its doc promises', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const hostile: unknown[] = [
      {
        get v(): number {
          throw new Error('boom')
        },
      },
      revoked.proxy,
      { v: CALL_PROTOCOL_VERSION, directions: revoked.proxy },
    ]
    for (const raw of hostile) {
      expect(() => parseCodecPlan(raw)).not.toThrow()
      expect(parseCodecPlan(raw)).toBeNull()
    }
  })

  it('a JSON "__proto__" key is dropped (zod skips it rather than rejecting it): no pollution, and the plan is otherwise intact', () => {
    const plan = buildPlan(IPHONE_15_PRO, IPHONE_12, 'video')
    const json = JSON.stringify(plan)
      .replace('{"v"', '{"__proto__":{"polluted":true},"v"')
      .replace('"callerToCallee":{', '"callerToCallee":{"__proto__":{"codec":"AV1","polluted":true},')
    const parsed = parseCodecPlan(JSON.parse(json))
    expect(parsed).toStrictEqual(plan)
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(parsed?.directions.callerToCallee)).toBe(Object.prototype)
    expect((parsed as unknown as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a well-formed hostile plan cannot make the preference list invent a codec: High into a receiver list with no 640c starts at CBP', () => {
    const hostile = parseCodecPlan({
      v: CALL_PROTOCOL_VERSION,
      directions: {
        callerToCallee: { codec: 'H264', h264Profile: 'high', startHeight: 720, startMaxBitrate: 2_500_000, maxHeight: 720, av1Eligible: true, fallback: 'VP8' },
        calleeToCaller: null,
      },
    })
    expect(hostile).not.toBeNull()
    const receiverCaps = [vc('VP8'), h264('42e01f', 1), vc('rtx')]
    const out = videoCodecPreferences(receiverCaps, directionsFor(hostile!, 'callee').receive)
    expect(out.map(nameOf)).toEqual(['H264 cbp pm1', 'VP8', 'RTX'])
    expect(out.every((c) => receiverCaps.includes(c))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The audio rule, pinned: useRed is about the audio this peer RECEIVES
// ---------------------------------------------------------------------------

const ac = (subtype: string, clockRate: number, channels: number, sdpFmtpLine?: string): RtpCodecLike =>
  sdpFmtpLine === undefined ? { mimeType: `audio/${subtype}`, clockRate, channels } : { mimeType: `audio/${subtype}`, clockRate, channels, sdpFmtpLine }
const CHROME_AUDIO = [
  ac('opus', 48000, 2, 'minptime=10;useinbandfec=1'),
  ac('red', 48000, 2, '111/111'),
  ac('G722', 8000, 1),
  ac('PCMU', 8000, 1),
  ac('CN', 8000, 1),
  ac('telephone-event', 48000, 1),
]

describe('review: useRed asks for RED on the audio this peer RECEIVES', () => {
  /** webrtc_voice_engine.cc SetSendCodecs: a sender protects with RED only when red sits BEFORE opus in the REMOTE list. */
  const senderUsesRed = (remote: readonly RtpCodecLike[]) => {
    const opus = remote.findIndex((c) => subOf(c) === 'opus')
    return opus > 0 && remote.slice(0, opus).some((c) => subOf(c) === 'red')
  }

  it('A sets useRed (it hears loss on its INBOUND audio): B starts sending RED to A, and A keeps sending plain Opus', () => {
    const aSdp = audioCodecPreferences(CHROME_AUDIO, { useRed: true })
    const bSdp = audioCodecPreferences(CHROME_AUDIO, { useRed: false })
    expect(senderUsesRed(aSdp)).toBe(true) // B reads A's SDP
    expect(senderUsesRed(bSdp)).toBe(false) // A reads B's SDP
  })
})

// ---------------------------------------------------------------------------
// Preference orders on a list shape the module suite does not cover
// ---------------------------------------------------------------------------

describe('review: videoCodecPreferences on a Firefox-shaped list', () => {
  /** Firefox: VP8/VP9 carry max-fs/max-fr, the second H.264 entries omit packetization-mode (= 0), per-codec rtx. */
  const FIREFOX_VIDEO = [
    vc('VP8', 'max-fs=12288;max-fr=60'),
    vc('rtx', 'apt=120'),
    vc('VP9', 'max-fs=12288;max-fr=60'),
    vc('rtx', 'apt=121'),
    vc('AV1'),
    vc('H264', 'profile-level-id=42e01f;level-asymmetry-allowed=1;packetization-mode=1'),
    vc('rtx', 'apt=126'),
    vc('H264', 'profile-level-id=42e01f;level-asymmetry-allowed=1'),
    vc('H264', 'profile-level-id=42001f;level-asymmetry-allowed=1;packetization-mode=1'),
    vc('H264', 'profile-level-id=42001f;level-asymmetry-allowed=1'),
    vc('red'),
    vc('ulpfec'),
  ]

  it('VP8 with fmtp still counts as VP8; mode-less CBP sorts after mode 1; nothing added or dropped', () => {
    const toVp8 = videoCodecPreferences(FIREFOX_VIDEO, { codec: 'VP8' })
    expect(toVp8[0]).toBe(FIREFOX_VIDEO[0])
    const toCbp = videoCodecPreferences(FIREFOX_VIDEO, { codec: 'H264', h264Profile: 'cbp' })
    expect(toCbp.slice(0, 3)).toEqual([FIREFOX_VIDEO[5], FIREFOX_VIDEO[7], FIREFOX_VIDEO[0]])
    for (const out of [toVp8, toCbp]) {
      expect(out).toHaveLength(FIREFOX_VIDEO.length)
      expect(new Set(out)).toEqual(new Set(FIREFOX_VIDEO))
      expect(out.slice(-5).every((c) => !isMedia(c))).toBe(true)
    }
  })
})
