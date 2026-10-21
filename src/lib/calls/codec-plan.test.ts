import { describe, expect, it } from 'vitest'
import {
  audioCodecPreferences,
  buildPlan,
  codecPlanSchema,
  directionsFor,
  parseCodecPlan,
  videoCodecPreferences,
  H264_MIN_HEIGHT,
  PLAN_MAX_HEIGHT,
  type CodecPlan,
  type DirectionPlan,
  type PreferredCodec,
  type RtpCodecLike,
} from './codec-plan'
import { CALL_PROTOCOL_VERSION, type CallMedia, type CapabilityReport, type CodecSupport } from './types'

/**
 * The codec plan (DESIGN §2). H.264 starts on hardware at 540p. High needs both ends power-efficient. A direction
 * falls to VP8 without a hardware encoder or below 360p. Each direction is capped at min(send, receive, 720). AV1 is
 * permission only. The setCodecPreferences orders never invent a codec the browser would throw on, and each peer
 * orders the direction it RECEIVES.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Capability reports: real device classes, as the capability probe would describe them
// ---------------------------------------------------------------------------

const V = CALL_PROTOCOL_VERSION
const HW = { encode: true, decode: true, powerEfficientEncode: true, powerEfficientDecode: true } as const
const SW = { encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: false } as const

/**
 * Helio G85-class Android phone, 3 GB, Chrome with a 32-bit renderer. MediaCodec encodes H.264 CBP in hardware but
 * not High, and decodes both in hardware. VP8 is libvpx (software). There is no AV1 ENCODER (libaom is not built for
 * arm32), but dav1d decodes AV1. HEVC is hardware. A ≤3 GB phone announces ≤540p both ways.
 */
const POTATO: CapabilityReport = deepFreeze({
  v: V,
  platform: 'android',
  app: 'browser',
  deviceMemory: 2,
  maxRecvHeight: 540,
  maxSendHeight: 540,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...HW },
    { codec: 'H264', profile: 'high', encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'AV1', encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: false },
    { codec: 'H265', ...HW },
  ],
})

/**
 * iPhone 15 Pro in the iOS app (WKWebView). VideoToolbox does H.264 (CBP and High) and HEVC in hardware both ways.
 * The A17 Pro has a hardware AV1 DECODER, and no iPhone has an AV1 encoder. VP8 is software. The phone announces
 * 1080p, which the v1 plan caps at 720.
 */
const IPHONE_15_PRO: CapabilityReport = deepFreeze({
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
    { codec: 'AV1', encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: true },
    { codec: 'H265', ...HW },
  ],
})

/** iPhone 12 in Safari: the same engine without AV1. WebKit enables WebRTC AV1 only with a hardware AV1 decoder. */
const IPHONE_12: CapabilityReport = deepFreeze({
  ...IPHONE_15_PRO,
  app: 'browser',
  codecs: IPHONE_15_PRO.codecs.map((c) => (c.codec === 'AV1' ? { ...c, decode: false, powerEfficientDecode: false } : c)),
})

/**
 * Galaxy S24-class phone in Chrome (64-bit renderer, 8 GB). H.264 CBP and High and HEVC are hardware. AV1 encodes in
 * software (arm64 builds ship libaom) and decodes in hardware. 720p both ways.
 */
const ANDROID_FLAGSHIP: CapabilityReport = deepFreeze({
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
})

/**
 * Linux desktop Chrome with no GPU video encoder. H.264 runs only through OpenH264 (software, CBP-only encode) and
 * FFmpeg decode. VP8 and VP9 are libvpx, AV1 is libaom + dav1d. No HEVC, which Chrome supports in hardware only.
 */
const LINUX_DESKTOP: CapabilityReport = deepFreeze({
  v: V,
  platform: 'desktop',
  app: 'browser',
  maxRecvHeight: 1080,
  maxSendHeight: 720,
  codecs: [
    { codec: 'H264', profile: 'cbp', ...SW },
    { codec: 'H264', profile: 'high', encode: false, decode: true, powerEfficientEncode: false, powerEfficientDecode: false },
    { codec: 'VP8', ...SW },
    { codec: 'VP9', ...SW },
    { codec: 'AV1', ...SW },
  ],
})

const DEVICES = { POTATO, IPHONE_15_PRO, IPHONE_12, ANDROID_FLAGSHIP, LINUX_DESKTOP }
/** Every ordered pair, self-pairs included: [label, caller, callee]. */
const PAIRS = Object.entries(DEVICES).flatMap(([an, a]) =>
  Object.entries(DEVICES).map(([bn, b]) => [`${an} → ${bn}`, a, b] as [string, CapabilityReport, CapabilityReport]),
)

const HW_CBP: CodecSupport = { codec: 'H264', profile: 'cbp', ...HW }
const HW_HIGH: CodecSupport = { codec: 'H264', profile: 'high', ...HW }
const SW_VP8: CodecSupport = { codec: 'VP8', ...SW }

/** A minimal report for one rule, 720p both ways unless told otherwise. */
function report(codecs: CodecSupport[], heights: Partial<Pick<CapabilityReport, 'maxRecvHeight' | 'maxSendHeight'>> = {}): CapabilityReport {
  return deepFreeze({ v: V, platform: 'other', app: 'browser', maxRecvHeight: 720, maxSendHeight: 720, codecs, ...heights })
}
/** Hardware H.264 CBP + software VP8: the everyday phone. */
const BASIC = report([HW_CBP, SW_VP8])

/** The one direction `sender → receiver`. */
const dir = (sender: CapabilityReport, receiver: CapabilityReport) => buildPlan(sender, receiver, 'video').directions.callerToCallee

const h264Plan = (h264Profile: 'high' | 'cbp', startHeight: number, startMaxBitrate: number, maxHeight: number, av1Eligible = false): DirectionPlan => ({
  codec: 'H264',
  h264Profile,
  startHeight,
  startMaxBitrate,
  maxHeight,
  av1Eligible,
  fallback: 'VP8',
})
const vp8Plan = (startHeight: number, startMaxBitrate: number, maxHeight: number, av1Eligible = false): DirectionPlan => ({
  codec: 'VP8',
  startHeight,
  startMaxBitrate,
  maxHeight,
  av1Eligible,
  fallback: 'VP8',
})

// ---------------------------------------------------------------------------
// buildPlan
// ---------------------------------------------------------------------------

describe('buildPlan: the start codec of each direction', () => {
  it('potato ↔ flagship iPhone: CBP both ways at ≤540p. The potato cannot ENCODE Constrained High, so 640c is not in its sendrecv m-section and High cannot reach it either', () => {
    expect(buildPlan(POTATO, IPHONE_15_PRO, 'video')).toStrictEqual({
      v: CALL_PROTOCOL_VERSION,
      directions: {
        callerToCallee: h264Plan('cbp', 540, 1_200_000, 540),
        calleeToCaller: h264Plan('cbp', 540, 1_200_000, 540),
      },
    })
  })

  it('iPhone ↔ iPhone: High both ways, starting at 540p / 1.2 Mbps under the 720p cap', () => {
    const high = h264Plan('high', 540, 1_200_000, 720)
    expect(buildPlan(IPHONE_15_PRO, IPHONE_12, 'video').directions).toStrictEqual({ callerToCallee: high, calleeToCaller: high })
    expect(buildPlan(IPHONE_15_PRO, IPHONE_15_PRO, 'video').directions).toStrictEqual({ callerToCallee: high, calleeToCaller: high })
  })

  it('no hardware H.264 encoder → VP8 at 360p / 0.7 Mbps; the reverse keeps hardware H.264, as CBP because the desktop decodes High only in software', () => {
    expect(buildPlan(LINUX_DESKTOP, IPHONE_12, 'video').directions).toStrictEqual({
      callerToCallee: vp8Plan(360, 700_000, 720),
      calleeToCaller: h264Plan('cbp', 540, 1_200_000, 720),
    })
  })

  it('a software H.264 encoder (OpenH264, c2.android.avc) is not hardware: powerEfficientEncode false or missing means VP8', () => {
    const softwareH264 = report([{ codec: 'H264', profile: 'cbp', encode: true, decode: true }, SW_VP8])
    expect(dir(softwareH264, BASIC)).toStrictEqual(vp8Plan(360, 700_000, 720))
    expect(dir(report([{ ...HW_CBP, powerEfficientEncode: false }, SW_VP8]), BASIC)).toMatchObject({ codec: 'VP8' })
  })

  it('High only when BOTH ends report it power-efficient; otherwise CBP', () => {
    const highSender = report([HW_CBP, HW_HIGH, SW_VP8])
    const highReceiver = report([HW_CBP, HW_HIGH, SW_VP8])
    expect(dir(highSender, highReceiver)).toMatchObject({ codec: 'H264', h264Profile: 'high' })
    // The receiver can negotiate High (it encodes and decodes it), but decodes it in software.
    const softHighReceiver = report([HW_CBP, { codec: 'H264', profile: 'high', encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: false }, SW_VP8])
    expect(dir(highSender, softHighReceiver)).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    // A receiver that decodes High but cannot encode it never lists 640c on the sendrecv transceiver.
    const decodeOnlyHighReceiver = report([HW_CBP, { codec: 'H264', profile: 'high', encode: false, decode: true, powerEfficientDecode: true }, SW_VP8])
    expect(dir(highSender, decodeOnlyHighReceiver)).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    // The sender encodes High, but in software.
    const softHighSender = report([HW_CBP, { codec: 'H264', profile: 'high', encode: true, decode: true, powerEfficientEncode: false, powerEfficientDecode: true }, SW_VP8])
    expect(dir(softHighSender, highReceiver)).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    // The receiver says nothing about High.
    expect(dir(highSender, BASIC)).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
  })

  it('each profile stands on its own entries: a hardware High encoder does not make CBP hardware for a receiver without High', () => {
    const highOnlyHardware = report([{ codec: 'H264', profile: 'cbp', ...SW }, HW_HIGH, SW_VP8])
    expect(dir(highOnlyHardware, BASIC)).toMatchObject({ codec: 'VP8' })
    expect(dir(highOnlyHardware, report([HW_CBP, HW_HIGH, SW_VP8]))).toMatchObject({ codec: 'H264', h264Profile: 'high' })
  })

  it('a receiver that decodes no H.264 gets VP8, even from a hardware sender', () => {
    expect(dir(BASIC, report([SW_VP8]))).toStrictEqual(vp8Plan(360, 700_000, 720))
    expect(dir(BASIC, report([{ ...HW_CBP, decode: false, powerEfficientDecode: false }, SW_VP8]))).toMatchObject({ codec: 'VP8' })
  })

  it('an H.264 entry without a profile counts as CBP and never as High; an unknown profile or codec contributes nothing', () => {
    const unprofiled: CodecSupport = { codec: 'H264', ...HW }
    expect(dir(report([unprofiled, SW_VP8]), report([unprofiled, SW_VP8]))).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
    // A Main encoder claim (a newer build's profile) says nothing about CBP.
    const main = { codec: 'H264', profile: 'main', ...HW } as unknown as CodecSupport
    expect(dir(report([main, SW_VP8]), BASIC)).toMatchObject({ codec: 'VP8' })
    const vvc = { codec: 'VVC', ...HW } as unknown as CodecSupport
    expect(dir(report([vvc, HW_CBP, SW_VP8]), report([vvc, HW_CBP, SW_VP8]))).toMatchObject({ codec: 'H264', h264Profile: 'cbp' })
  })
})

describe('buildPlan: heights', () => {
  it('a receiver announcing 540p caps a 720p sender', () => {
    // CBP and no AV1: the potato can encode neither Constrained High nor AV1, so the sendrecv SDP carries neither.
    expect(dir(ANDROID_FLAGSHIP, POTATO)).toStrictEqual(h264Plan('cbp', 540, 1_200_000, 540))
    expect(dir(report([HW_CBP, SW_VP8], { maxSendHeight: 720 }), report([HW_CBP, SW_VP8], { maxRecvHeight: 540 }))).toMatchObject({
      maxHeight: 540,
      startHeight: 540,
    })
  })

  it("the sender's own maxSendHeight caps the direction too", () => {
    expect(dir(report([HW_CBP, SW_VP8], { maxSendHeight: 360 }), BASIC)).toStrictEqual(h264Plan('cbp', 360, 700_000, 360))
  })

  it('1080p on both ends is still 720: 1080 is outside the v1 plan', () => {
    const big = report([HW_CBP, HW_HIGH, SW_VP8], { maxRecvHeight: 1080, maxSendHeight: 1080 })
    expect(dir(big, big)).toStrictEqual(h264Plan('high', 540, 1_200_000, PLAN_MAX_HEIGHT))
    expect(PLAN_MAX_HEIGHT).toBe(720)
  })

  it('a cap between rungs is kept as-is, and the start drops to the rung below it', () => {
    expect(dir(BASIC, report([HW_CBP, SW_VP8], { maxRecvHeight: 480 }))).toStrictEqual(h264Plan('cbp', 360, 700_000, 480))
    expect(dir(BASIC, report([HW_CBP, SW_VP8], { maxRecvHeight: 360 }))).toStrictEqual(h264Plan('cbp', 360, 700_000, 360))
  })

  it('H.264 is never planned below 360p: a 240–359p cap starts VP8 at 240p / 0.3 Mbps, even from a hardware sender', () => {
    expect(dir(BASIC, report([HW_CBP, SW_VP8], { maxRecvHeight: 359 }))).toStrictEqual(vp8Plan(240, 300_000, 359))
    expect(dir(BASIC, report([HW_CBP, SW_VP8], { maxRecvHeight: 240 }))).toStrictEqual(vp8Plan(240, 300_000, 240))
    expect(H264_MIN_HEIGHT).toBe(360)
  })

  it('the VP8 start drops under a low cap too', () => {
    expect(dir(LINUX_DESKTOP, report([HW_CBP, SW_VP8], { maxRecvHeight: 300 }))).toStrictEqual(vp8Plan(240, 300_000, 300))
  })

  it.each([239, 0, -540, Number.NaN, Number.POSITIVE_INFINITY, undefined, '540'])(
    'a height of %s (below 240p, missing or not a number) plans no video that way',
    (bad) => {
      const badRecv = { ...BASIC, maxRecvHeight: bad } as unknown as CapabilityReport
      const badSend = { ...BASIC, maxSendHeight: bad } as unknown as CapabilityReport
      expect(dir(BASIC, badRecv)).toBeNull()
      expect(dir(badSend, BASIC)).toBeNull()
      // Only the direction that announced it is affected.
      expect(buildPlan(BASIC, badRecv, 'video').directions.calleeToCaller).toStrictEqual(h264Plan('cbp', 540, 1_200_000, 720))
    },
  )

  it('fractional heights are floored to whole pixels', () => {
    expect(dir(BASIC, report([HW_CBP, SW_VP8], { maxRecvHeight: 540.9 }))).toMatchObject({ maxHeight: 540, startHeight: 540 })
  })
})

describe('buildPlan: AV1 eligibility', () => {
  it('only when AV1 can be negotiated: both ends encode AND decode it (one sendrecv transceiver), which covers sender-encodes + receiver-decodes', () => {
    expect(dir(ANDROID_FLAGSHIP, LINUX_DESKTOP)?.av1Eligible).toBe(true) // libaom + dav1d at both ends
    expect(dir(LINUX_DESKTOP, ANDROID_FLAGSHIP)?.av1Eligible).toBe(true)
    expect(dir(ANDROID_FLAGSHIP, IPHONE_15_PRO)?.av1Eligible).toBe(false) // a hardware AV1 decoder, no encoder: not in its sendrecv m-section
    expect(dir(ANDROID_FLAGSHIP, IPHONE_12)?.av1Eligible).toBe(false) // no AV1 decoder
    expect(dir(IPHONE_15_PRO, ANDROID_FLAGSHIP)?.av1Eligible).toBe(false) // no AV1 encoder on any iPhone
    expect(dir(POTATO, ANDROID_FLAGSHIP)?.av1Eligible).toBe(false) // 32-bit renderer: no libaom
    expect(dir(LINUX_DESKTOP, POTATO)?.av1Eligible).toBe(false) // dav1d decodes on the potato, but nothing there encodes AV1
  })

  it('it is permission, not a choice: the start codec stays H.264 or VP8', () => {
    expect(dir(ANDROID_FLAGSHIP, LINUX_DESKTOP)).toStrictEqual(h264Plan('cbp', 540, 1_200_000, 720, true))
    expect(dir(LINUX_DESKTOP, ANDROID_FLAGSHIP)).toStrictEqual(vp8Plan(360, 700_000, 720, true))
  })

  it('a software AV1 encoder qualifies (the ladder measures it); a decode-only peer or a power-efficient flag without the capability does not', () => {
    const softwareAv1 = report([HW_CBP, SW_VP8, { codec: 'AV1', encode: true, decode: true, powerEfficientEncode: false }])
    expect(dir(softwareAv1, softwareAv1)?.av1Eligible).toBe(true)
    const av1Decoder = report([HW_CBP, SW_VP8, { codec: 'AV1', encode: false, decode: true }])
    expect(dir(softwareAv1, av1Decoder)?.av1Eligible).toBe(false)
    const flagOnly = report([HW_CBP, SW_VP8, { codec: 'AV1', encode: false, decode: false, powerEfficientEncode: true, powerEfficientDecode: true }])
    expect(dir(flagOnly, softwareAv1)?.av1Eligible).toBe(false)
    expect(dir(softwareAv1, flagOnly)?.av1Eligible).toBe(false)
  })
})

/** Every report entry for one codec (and H.264 profile; an unprofiled H.264 entry is CBP). */
function claims(r: CapabilityReport, codec: CodecSupport['codec'], profile?: 'high' | 'cbp'): CodecSupport[] {
  return r.codecs.filter((c) => c.codec === codec && (codec !== 'H264' || (c.profile ?? 'cbp') === profile))
}
const allClaim = (entries: CodecSupport[], pred: (c: CodecSupport) => boolean) => entries.length > 0 && entries.every(pred)

describe('buildPlan: never a codec one side lacks', () => {
  it.each(PAIRS)('%s: every planned direction rests on claims both reports make', (_, sender, receiver) => {
    const d = dir(sender, receiver)
    expect(d).not.toBeNull() // every real device class can call every other
    if (!d) return
    expect(['H264', 'VP8']).toContain(d.codec)
    if (d.codec === 'H264') {
      expect(allClaim(claims(sender, 'H264', d.h264Profile), (c) => c.encode && c.powerEfficientEncode === true)).toBe(true)
      expect(allClaim(claims(receiver, 'H264', d.h264Profile), (c) => c.decode)).toBe(true)
      if (d.h264Profile === 'high') expect(allClaim(claims(receiver, 'H264', 'high'), (c) => c.powerEfficientDecode === true)).toBe(true)
      expect(d.startHeight).toBeGreaterThanOrEqual(H264_MIN_HEIGHT)
    } else {
      expect('h264Profile' in d).toBe(false)
    }
    // The fallback is shared by both.
    expect(allClaim(claims(sender, 'VP8'), (c) => c.encode) && allClaim(claims(receiver, 'VP8'), (c) => c.decode)).toBe(true)
    if (d.av1Eligible) {
      expect(allClaim(claims(sender, 'AV1'), (c) => c.encode) && allClaim(claims(receiver, 'AV1'), (c) => c.decode)).toBe(true)
    }
    expect(d.startHeight).toBeLessThanOrEqual(d.maxHeight)
    expect(d.maxHeight).toBeLessThanOrEqual(Math.min(sender.maxSendHeight, receiver.maxRecvHeight, PLAN_MAX_HEIGHT))
  })

  it('VP8 is the floor: without VP8 sent AND received at both ends there is no plan, even with hardware H.264 at both ends', () => {
    expect(dir(report([HW_CBP]), BASIC)).toBeNull()
    expect(dir(BASIC, report([HW_CBP]))).toBeNull()
    expect(dir(report([HW_CBP, { ...SW_VP8, encode: false }]), BASIC)).toBeNull()
    expect(dir(BASIC, report([HW_CBP, { ...SW_VP8, decode: false }]))).toBeNull()
    // A side that cannot SEND VP8 leaves it out of its sendrecv m-section, so VP8 is negotiated in neither direction.
    expect(buildPlan(report([HW_CBP, { ...SW_VP8, encode: false }]), BASIC, 'video').directions.calleeToCaller).toBeNull()
  })

  it('a report that contradicts itself gets the weaker claim, in either entry order', () => {
    const vp8Both: CodecSupport[] = [SW_VP8, { ...SW_VP8, encode: false }]
    expect(dir(report([HW_CBP, ...vp8Both]), BASIC)).toBeNull()
    expect(dir(report([HW_CBP, ...[...vp8Both].reverse()]), BASIC)).toBeNull()
    const cbpBoth: CodecSupport[] = [HW_CBP, { ...HW_CBP, powerEfficientEncode: false }]
    expect(dir(report([...cbpBoth, SW_VP8]), BASIC)).toMatchObject({ codec: 'VP8' })
    expect(dir(report([...[...cbpBoth].reverse(), SW_VP8]), BASIC)).toMatchObject({ codec: 'VP8' })
  })
})

describe('buildPlan: audio-only', () => {
  it.each(PAIRS)('%s: no video in either direction', (_, caller, callee) => {
    expect(buildPlan(caller, callee, 'audio')).toStrictEqual({ v: CALL_PROTOCOL_VERSION, directions: { callerToCallee: null, calleeToCaller: null } })
  })

  it('any media value other than "video" (from the wire) is audio-only: it fails closed', () => {
    for (const media of ['VIDEO', '', null, undefined, 'screen']) {
      expect(buildPlan(BASIC, BASIC, media as unknown as CallMedia).directions).toStrictEqual({ callerToCallee: null, calleeToCaller: null })
    }
  })
})

describe('buildPlan: deterministic, so the plan the caller sends is THE plan', () => {
  it.each(PAIRS)('%s: the same reports give the same plan, and it survives JSON (the offer metadata) unchanged', (_, a, b) => {
    const plan = buildPlan(a, b, 'video')
    expect(buildPlan(a, b, 'video')).toStrictEqual(plan)
    expect(JSON.parse(JSON.stringify(plan))).toStrictEqual(plan)
    expect(buildPlan(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 'video')).toStrictEqual(plan)
  })

  it.each(PAIRS)('%s: the order a report lists its codecs in changes nothing', (_, a, b) => {
    const reversed = (r: CapabilityReport) => ({ ...r, codecs: [...r.codecs].reverse() })
    const rotated = (r: CapabilityReport) => ({ ...r, codecs: [...r.codecs.slice(2), ...r.codecs.slice(0, 2)] })
    const plan = buildPlan(a, b, 'video')
    expect(buildPlan(reversed(a), rotated(b), 'video')).toStrictEqual(plan)
    expect(buildPlan(rotated(a), reversed(b), 'video')).toStrictEqual(plan)
  })

  it('device-tier hints (deviceMemory, socModel, platform, app) change nothing: the announced heights carry the tier', () => {
    const plan = buildPlan(POTATO, IPHONE_15_PRO, 'video')
    const disguised: CapabilityReport = { ...POTATO, deviceMemory: 8, socModel: 'SM8650', platform: 'desktop', app: 'capacitor-ios' }
    const bare: CapabilityReport = { ...IPHONE_15_PRO, platform: 'other', app: 'browser' }
    expect(buildPlan(disguised, bare, 'video')).toStrictEqual(plan)
  })

  it.each(PAIRS)('%s: swapping caller and callee swaps the directions and nothing else', (_, a, b) => {
    const ab = buildPlan(a, b, 'video').directions
    const ba = buildPlan(b, a, 'video').directions
    expect(ba.calleeToCaller).toStrictEqual(ab.callerToCallee)
    expect(ba.callerToCallee).toStrictEqual(ab.calleeToCaller)
  })

  it('never mutates the reports (all fixtures are deep-frozen; this pins it explicitly)', () => {
    const a = structuredClone(POTATO)
    const b = structuredClone(IPHONE_15_PRO)
    const before = structuredClone([a, b])
    buildPlan(deepFreeze(a), deepFreeze(b), 'video')
    expect([a, b]).toStrictEqual(before)
  })
})

// ---------------------------------------------------------------------------
// The wire contract
// ---------------------------------------------------------------------------

describe('parseCodecPlan: the callee reads the plan another build computed', () => {
  it.each(PAIRS)('%s: every plan buildPlan makes reads back unchanged (video and audio)', (_, a, b) => {
    for (const media of ['video', 'audio'] as const) {
      const plan = buildPlan(a, b, media)
      expect(parseCodecPlan(JSON.parse(JSON.stringify(plan)))).toStrictEqual(plan)
    }
  })

  const VALID = buildPlan(POTATO, IPHONE_15_PRO, 'video')
  type Raw = { v: unknown; directions: Record<string, Record<string, unknown> | null>; [k: string]: unknown }
  const variant = (mutate: (p: Raw) => void): unknown => {
    const p = structuredClone(VALID) as unknown as Raw
    mutate(p)
    return p
  }
  const c2c = (p: Raw) => p.directions.callerToCallee as Record<string, unknown>

  it.each<[string, (p: Raw) => void]>([
    ['an unknown top-level key', (p) => void (p.extra = 1)],
    ['an unknown direction key', (p) => void (c2c(p).fps = 30)],
    ['a missing direction', (p) => void delete p.directions.calleeToCaller],
    ['H.264 without a profile', (p) => void delete c2c(p).h264Profile],
    ['VP8 carrying an H.264 profile', (p) => void (c2c(p).codec = 'VP8')],
    ['a start codec v1 never plans (AV1)', (p) => void (c2c(p).codec = 'AV1')],
    ['an unknown H.264 profile', (p) => void (c2c(p).h264Profile = 'main')],
    ['maxHeight above 720', (p) => void (c2c(p).maxHeight = 1080)],
    ['startHeight above maxHeight', (p) => Object.assign(c2c(p), { startHeight: 540, maxHeight: 360 })],
    ['a height below 240', (p) => void (c2c(p).startHeight = 180)],
    ['a fractional height', (p) => void (c2c(p).startHeight = 359.5)],
    ['a NaN height', (p) => void (c2c(p).maxHeight = Number.NaN)],
    ['an effectively uncapped bitrate', (p) => void (c2c(p).startMaxBitrate = 1e12)],
    ['a zero bitrate', (p) => void (c2c(p).startMaxBitrate = 0)],
    ['a fallback other than VP8', (p) => void (c2c(p).fallback = 'H264')],
    ['a non-boolean av1Eligible', (p) => void (c2c(p).av1Eligible = 'yes')],
    ['another protocol version', (p) => void (p.v = CALL_PROTOCOL_VERSION + 1)],
  ])('refuses %s', (_, mutate) => {
    expect(parseCodecPlan(variant(mutate))).toBeNull()
    expect(codecPlanSchema.safeParse(variant(mutate)).success).toBe(false)
  })

  it('returns null and never throws on garbage', () => {
    for (const raw of [null, undefined, 'plan', 42, [], {}, { v: CALL_PROTOCOL_VERSION }, { v: CALL_PROTOCOL_VERSION, directions: null }]) {
      expect(parseCodecPlan(raw)).toBeNull()
    }
  })
})

describe('directionsFor', () => {
  it('the caller sends callerToCallee and receives calleeToCaller; the callee the reverse', () => {
    const plan = buildPlan(POTATO, IPHONE_15_PRO, 'video')
    expect(directionsFor(plan, 'caller')).toStrictEqual({ send: plan.directions.callerToCallee, receive: plan.directions.calleeToCaller })
    expect(directionsFor(plan, 'callee')).toStrictEqual({ send: plan.directions.calleeToCaller, receive: plan.directions.callerToCallee })
    const audio: CodecPlan = buildPlan(POTATO, IPHONE_15_PRO, 'audio')
    expect(directionsFor(audio, 'callee')).toStrictEqual({ send: null, receive: null })
  })
})

// ---------------------------------------------------------------------------
// setCodecPreferences orders
// ---------------------------------------------------------------------------

const vc = (subtype: string, sdpFmtpLine?: string): RtpCodecLike =>
  sdpFmtpLine === undefined ? { mimeType: `video/${subtype}`, clockRate: 90000 } : { mimeType: `video/${subtype}`, clockRate: 90000, sdpFmtpLine }
const h264 = (profileLevelId: string, mode: 0 | 1) =>
  vc('H264', `level-asymmetry-allowed=1;packetization-mode=${mode};profile-level-id=${profileLevelId}`)

/**
 * Chrome on Android with hardware H.264. VP8 comes first, as Chrome offers it. H.264 appears at five
 * profile-level-ids (Baseline 42001f, CBP 42e01f, Main 4d001f, Constrained High 640c1f, plain High 64001f), each in
 * packetization-mode 1 and 0. The rtx entries carry apt (per-codec rtx). Then red, ulpfec and flexfec-03.
 */
const CHROME_ANDROID_VIDEO = deepFreeze([
  vc('VP8'),
  vc('rtx', 'apt=96'),
  h264('42001f', 1),
  h264('42001f', 0),
  h264('42e01f', 1),
  vc('rtx', 'apt=102'),
  h264('42e01f', 0),
  h264('4d001f', 1),
  h264('4d001f', 0),
  h264('640c1f', 1),
  vc('rtx', 'apt=108'),
  h264('640c1f', 0),
  vc('AV1', 'level-idx=5;profile=0;tier=0'),
  vc('rtx', 'apt=45'),
  vc('VP9', 'profile-id=0'),
  vc('VP9', 'profile-id=2'),
  h264('64001f', 1),
  h264('64001f', 0),
  vc('H265', 'level-id=93;profile-id=1;tier-flag=0;tx-mode=SRST'),
  vc('red'),
  vc('rtx', 'apt=117'),
  vc('ulpfec'),
  vc('flexfec-03', 'repair-window=10000000'),
])

/**
 * Chrome on a desktop without hardware H.264 (OpenH264 + FFmpeg), as RTCRtpReceiver.getCapabilities returns it: one
 * bare rtx, and High only as plain 64001f / f4001f. There is no 640c entry, so a 'high' plan cannot be honoured
 * here.
 */
const CHROME_DESKTOP_VIDEO = deepFreeze([
  vc('VP8'),
  vc('rtx'),
  h264('42001f', 1),
  h264('42001f', 0),
  h264('42e01f', 1),
  h264('42e01f', 0),
  h264('4d001f', 1),
  h264('4d001f', 0),
  vc('AV1', 'level-idx=5;profile=0;tier=0'),
  vc('VP9', 'profile-id=0'),
  vc('VP9', 'profile-id=2'),
  h264('64001f', 1),
  h264('64001f', 0),
  h264('f4001f', 1),
  h264('f4001f', 0),
  vc('red'),
  vc('ulpfec'),
  vc('flexfec-03', 'repair-window=10000000'),
])

/**
 * Safari / WKWebView on an iPhone 15 Pro: H.264 Constrained High and CBP first (VideoToolbox), each in modes 1 and 0,
 * then HEVC, VP8, VP9 and AV1 (hardware decoder), one bare rtx, red and ulpfec.
 */
const SAFARI_VIDEO = deepFreeze([
  h264('640c1f', 1),
  vc('rtx'),
  h264('42e01f', 1),
  h264('640c1f', 0),
  h264('42e01f', 0),
  vc('H265', 'level-id=90;profile-id=1;tier-flag=0;tx-mode=SRST'),
  vc('VP8'),
  vc('VP9', 'profile-id=0'),
  vc('VP9', 'profile-id=2'),
  vc('AV1'),
  vc('red'),
  vc('ulpfec'),
])

const VIDEO_LISTS = { CHROME_ANDROID_VIDEO, CHROME_DESKTOP_VIDEO, SAFARI_VIDEO }

/** A readable name per entry, so a failing order prints as a list of codecs. */
function label(c: RtpCodecLike): string {
  const sub = c.mimeType.slice(c.mimeType.indexOf('/') + 1).toLowerCase()
  const params = new Map(
    (c.sdpFmtpLine ?? '')
      .split(';')
      .filter((p) => p.includes('='))
      .map((p) => p.split('=').map((s) => s.trim().toLowerCase()) as [string, string]),
  )
  if (c.mimeType.toLowerCase().startsWith('audio/')) return `${sub}/${c.clockRate}`
  if (sub === 'h264') return `H264 ${params.get('profile-level-id')} pm${params.get('packetization-mode') ?? '-'}`
  if (sub === 'vp9') return `VP9 p${params.get('profile-id')}`
  if (sub === 'rtx') return params.has('apt') ? `rtx apt=${params.get('apt')}` : 'rtx'
  return ['vp8', 'av1', 'h265'].includes(sub) ? sub.toUpperCase() : sub
}
const labels = (list: readonly RtpCodecLike[]) => list.map(label)

/** The strongest form of "nothing added, nothing dropped": the same objects, each exactly as often. */
function expectPermutation<T>(out: readonly T[], input: readonly T[]) {
  expect(out).not.toBe(input)
  expect(out).toHaveLength(input.length)
  const pool = [...input]
  for (const c of out) {
    const at = pool.indexOf(c)
    expect(at, 'an entry that is not in the input').toBeGreaterThanOrEqual(0)
    pool.splice(at, 1)
  }
  expect(pool).toHaveLength(0)
}

const isRepairCodec = (c: RtpCodecLike) => /^(rtx|red|ulpfec|flexfec.*)$/i.test(c.mimeType.split('/')[1])

describe('videoCodecPreferences', () => {
  it('Chrome / Android receiving High: Constrained High (mode 1 first) → CBP → VP8 → the rest as listed → rtx/red/ulpfec/flexfec', () => {
    expect(labels(videoCodecPreferences(CHROME_ANDROID_VIDEO, { codec: 'H264', h264Profile: 'high' }))).toEqual([
      'H264 640c1f pm1',
      'H264 640c1f pm0',
      'H264 42e01f pm1',
      'H264 42e01f pm0',
      'VP8',
      'H264 42001f pm1',
      'H264 42001f pm0',
      'H264 4d001f pm1',
      'H264 4d001f pm0',
      'AV1',
      'VP9 p0',
      'VP9 p2',
      'H264 64001f pm1',
      'H264 64001f pm0',
      'H265',
      'rtx apt=96',
      'rtx apt=102',
      'rtx apt=108',
      'rtx apt=45',
      'red',
      'rtx apt=117',
      'ulpfec',
      'flexfec-03',
    ])
  })

  it('Chrome / Android receiving CBP: CBP leads, and Constrained High drops back among the rest', () => {
    expect(labels(videoCodecPreferences(CHROME_ANDROID_VIDEO, { codec: 'H264', h264Profile: 'cbp' })).slice(0, 8)).toEqual([
      'H264 42e01f pm1',
      'H264 42e01f pm0',
      'VP8',
      'H264 42001f pm1',
      'H264 42001f pm0',
      'H264 4d001f pm1',
      'H264 4d001f pm0',
      'H264 640c1f pm1',
    ])
  })

  it('Safari receiving High, CBP or VP8', () => {
    const tail = ['H265', 'VP9 p0', 'VP9 p2', 'AV1', 'rtx', 'red', 'ulpfec']
    expect(labels(videoCodecPreferences(SAFARI_VIDEO, { codec: 'H264', h264Profile: 'high' }))).toEqual([
      'H264 640c1f pm1',
      'H264 640c1f pm0',
      'H264 42e01f pm1',
      'H264 42e01f pm0',
      'VP8',
      ...tail,
    ])
    expect(labels(videoCodecPreferences(SAFARI_VIDEO, { codec: 'H264', h264Profile: 'cbp' }))).toEqual([
      'H264 42e01f pm1',
      'H264 42e01f pm0',
      'VP8',
      'H264 640c1f pm1',
      'H264 640c1f pm0',
      ...tail,
    ])
    expect(labels(videoCodecPreferences(SAFARI_VIDEO, { codec: 'VP8' }))).toEqual([
      'VP8',
      'H264 42e01f pm1',
      'H264 42e01f pm0',
      'H264 640c1f pm1',
      'H264 640c1f pm0',
      ...tail,
    ])
  })

  it('a planned codec the list lacks is not invented: High into Chrome desktop (plain 64001f only) starts at CBP', () => {
    const asCbp = videoCodecPreferences(CHROME_DESKTOP_VIDEO, { codec: 'H264', h264Profile: 'cbp' })
    const asHigh = videoCodecPreferences(CHROME_DESKTOP_VIDEO, { codec: 'H264', h264Profile: 'high' })
    expect(asHigh).toEqual(asCbp)
    expect(labels(asHigh).slice(0, 3)).toEqual(['H264 42e01f pm1', 'H264 42e01f pm0', 'VP8'])
    expect(labels(asHigh).some((l) => l.includes('640c'))).toBe(false)
    const noAv1 = SAFARI_VIDEO.filter((c) => label(c) !== 'AV1')
    const out = videoCodecPreferences(noAv1, { codec: 'AV1' })
    expect(labels(out)).not.toContain('AV1')
    expectPermutation(out, noAv1)
  })

  it('profiles match by profile-level-id PREFIX: any level counts, and plain High, Main or Baseline never stand in for High or CBP', () => {
    const list = [h264('42e034', 1), h264('64001f', 1), h264('4d0032', 1), h264('640c34', 1), h264('42001f', 1), vc('VP8'), h264('42e02a', 1)]
    expect(labels(videoCodecPreferences(list, { codec: 'H264', h264Profile: 'high' }))).toEqual([
      'H264 640c34 pm1',
      'H264 42e034 pm1',
      'H264 42e02a pm1',
      'VP8',
      'H264 64001f pm1',
      'H264 4d0032 pm1',
      'H264 42001f pm1',
    ])
  })

  it('matching ignores case and spacing in the MIME type and the fmtp line', () => {
    const odd: RtpCodecLike = { mimeType: 'VIDEO/h264', clockRate: 90000, sdpFmtpLine: ' Profile-Level-Id = 640C1F ; packetization-mode=1' }
    const out = videoCodecPreferences([vc('VP8'), h264('42e01f', 1), odd], { codec: 'H264', h264Profile: 'high' })
    expect(out[0]).toBe(odd)
  })

  it('packetization-mode=1 leads within each H.264 profile, even when the engine lists mode 0 (or no mode, which means 0) first', () => {
    const list = [h264('42e01f', 0), vc('H264', 'profile-level-id=42e01f'), h264('42e01f', 1), vc('VP8')]
    expect(labels(videoCodecPreferences(list, { codec: 'H264', h264Profile: 'cbp' }))).toEqual([
      'H264 42e01f pm1',
      'H264 42e01f pm0',
      'H264 42e01f pm-',
      'VP8',
    ])
  })

  it('an H.264 plan into a list with no H.264 at all puts VP8 first', () => {
    expect(labels(videoCodecPreferences([vc('VP9', 'profile-id=0'), vc('rtx'), vc('VP8')], { codec: 'H264', h264Profile: 'high' }))).toEqual([
      'VP8',
      'VP9 p0',
      'rtx',
    ])
  })

  it('no planned direction (null): the same order without a planned head', () => {
    expect(videoCodecPreferences(SAFARI_VIDEO, null)).toEqual(videoCodecPreferences(SAFARI_VIDEO, { codec: 'H264', h264Profile: 'cbp' }))
    expect(labels(videoCodecPreferences(CHROME_DESKTOP_VIDEO, null)).slice(0, 3)).toEqual(['H264 42e01f pm1', 'H264 42e01f pm0', 'VP8'])
  })

  const plannedDirections = PAIRS.flatMap(([, a, b]) => Object.values(buildPlan(a, b, 'video').directions))
  const WANTS: (PreferredCodec | null)[] = [
    null,
    { codec: 'H264', h264Profile: 'high' },
    { codec: 'H264', h264Profile: 'cbp' },
    { codec: 'H264' },
    { codec: 'VP8' },
    { codec: 'VP9' },
    { codec: 'AV1' },
    { codec: 'H265' },
    ...plannedDirections,
  ]

  it.each(Object.entries(VIDEO_LISTS))('%s: never adds or drops a codec, keeps the browser’s own objects, repair codecs last in their given order', (_, list) => {
    for (const want of WANTS) {
      const out = videoCodecPreferences(list, want)
      expectPermutation(out, list)
      const firstRepair = out.findIndex(isRepairCodec)
      expect(out.slice(firstRepair).every(isRepairCodec)).toBe(true)
      expect(out.filter(isRepairCodec)).toStrictEqual(list.filter(isRepairCodec))
      expect(list.filter(isRepairCodec).every((c) => out.includes(c))).toBe(true)
    }
  })

  it('an empty list stays empty (setCodecPreferences([]) restores the default)', () => {
    expect(videoCodecPreferences([], { codec: 'VP8' })).toEqual([])
  })
})

const ac = (subtype: string, clockRate: number, channels: number, sdpFmtpLine?: string): RtpCodecLike =>
  sdpFmtpLine === undefined ? { mimeType: `audio/${subtype}`, clockRate, channels } : { mimeType: `audio/${subtype}`, clockRate, channels, sdpFmtpLine }

/** Chrome's audio capabilities: opus, then red (listed AFTER opus, so inert until moved), the narrowband codecs, CN, DTMF. */
const CHROME_AUDIO = deepFreeze([
  ac('opus', 48000, 2, 'minptime=10;useinbandfec=1'),
  ac('red', 48000, 2, '111/111'),
  ac('G722', 8000, 1),
  ac('PCMU', 8000, 1),
  ac('PCMA', 8000, 1),
  ac('CN', 8000, 1),
  ac('telephone-event', 48000, 1),
  ac('telephone-event', 8000, 1),
])
/**
 * A list with no red (whether WebKit offers RED is unverified, research-codecs.md). If red were invented here,
 * setCodecPreferences would throw.
 */
const SAFARI_AUDIO = deepFreeze([
  ac('opus', 48000, 2, 'minptime=10;useinbandfec=1'),
  ac('G722', 8000, 1),
  ac('PCMU', 8000, 1),
  ac('PCMA', 8000, 1),
  ac('CN', 8000, 1),
  ac('telephone-event', 48000, 1),
  ac('telephone-event', 8000, 1),
])
const REST = ['g722/8000', 'pcmu/8000', 'pcma/8000', 'cn/8000', 'telephone-event/48000', 'telephone-event/8000']

describe('audioCodecPreferences', () => {
  it('RED off: opus first, red kept behind it (inert, ready for a later switch), the rest in order', () => {
    expect(labels(audioCodecPreferences(CHROME_AUDIO, { useRed: false }))).toEqual(['opus/48000', 'red/48000', ...REST])
  })

  it('RED on: red, then opus, then the rest', () => {
    expect(labels(audioCodecPreferences(CHROME_AUDIO, { useRed: true }))).toEqual(['red/48000', 'opus/48000', ...REST])
  })

  it('RED on without red in the list: opus first, and no red appears', () => {
    expect(labels(audioCodecPreferences(SAFARI_AUDIO, { useRed: true }))).toEqual(['opus/48000', ...REST])
  })

  it('opus leads even when the engine lists red or a narrowband codec first', () => {
    const list = [ac('PCMU', 8000, 1), ac('red', 48000, 2), ac('opus', 48000, 2), ac('CN', 8000, 1)]
    expect(labels(audioCodecPreferences(list, { useRed: false }))).toEqual(['opus/48000', 'pcmu/8000', 'red/48000', 'cn/8000'])
    expect(labels(audioCodecPreferences(list, { useRed: true }))).toEqual(['red/48000', 'opus/48000', 'pcmu/8000', 'cn/8000'])
  })

  it('red never leads without opus to protect: a list with no opus comes back unchanged', () => {
    const list = [ac('PCMU', 8000, 1), ac('red', 48000, 2), ac('PCMA', 8000, 1)]
    expect(audioCodecPreferences(list, { useRed: true })).toEqual(list)
  })

  it.each(Object.entries({ CHROME_AUDIO, SAFARI_AUDIO }))('%s: never adds or drops a codec, keeps the browser’s own objects', (_, list) => {
    for (const useRed of [false, true]) expectPermutation(audioCodecPreferences(list, { useRed }), list)
  })
})

// ---------------------------------------------------------------------------
// Why each peer orders the direction it RECEIVES: a model of RFC 3264 offer/answer as libwebrtc applies it
// ---------------------------------------------------------------------------

describe('the receive-direction rule, end to end (RFC 3264 model)', () => {
  /** One codec across two engines' lists: subtype, plus the H.264 profile prefix and the packetization mode. */
  const key = (c: RtpCodecLike) => {
    const l = label(c)
    return l.startsWith('H264') ? l.slice(0, 'H264 xxxx'.length) + l.slice(l.lastIndexOf(' ')) : l
  }
  /** The answer lists the offered codecs the answerer accepts, in the ANSWERER's preference order. */
  const answerFrom = (offer: readonly RtpCodecLike[], answererPrefs: readonly RtpCodecLike[]) =>
    answererPrefs.filter((c) => offer.some((o) => key(o) === key(c)))
  /** Can this device encode this list entry, per its report? */
  const encodes = (r: CapabilityReport, c: RtpCodecLike): boolean => {
    const l = label(c)
    if (l.startsWith('H264 42e0')) return allClaim(claims(r, 'H264', 'cbp'), (e) => e.encode)
    if (l.startsWith('H264 640c')) return allClaim(claims(r, 'H264', 'high'), (e) => e.encode)
    return l === 'VP8' && allClaim(claims(r, 'VP8'), (e) => e.encode)
  }
  /** A sender uses the first codec of the REMOTE description it can encode (§6.1 for the answerer, §7 for the offerer). */
  const sent = (remote: readonly RtpCodecLike[], sender: CapabilityReport, alsoIn: readonly RtpCodecLike[] = remote) =>
    remote.find((c) => encodes(sender, c) && alsoIn.some((x) => key(x) === key(c)))

  // This model leaves out the sendrecv filter (each m-section lists only what its author can both send and receive).
  // It makes no difference for the pair below. codec-plan.review.test.ts runs the filtered model over every device pair.
  it('a desktop with no hardware H.264 (Chrome) calls an iPhone (Safari): each ordering what it receives lands VP8 one way and hardware CBP the other', () => {
    const plan = buildPlan(LINUX_DESKTOP, IPHONE_12, 'video')
    const offer = videoCodecPreferences(CHROME_DESKTOP_VIDEO, directionsFor(plan, 'caller').receive)
    const answer = answerFrom(offer, videoCodecPreferences(SAFARI_VIDEO, directionsFor(plan, 'callee').receive))
    expect(label(sent(answer, LINUX_DESKTOP)!)).toBe('VP8') // callerToCallee: VP8
    expect(label(sent(offer, IPHONE_12, answer)!)).toBe('H264 42e01f pm1') // calleeToCaller: hardware CBP
  })

  it('ordering the SEND direction instead lands both directions on the wrong codec: software H.264 on the desktop, software VP8 on the iPhone', () => {
    const plan = buildPlan(LINUX_DESKTOP, IPHONE_12, 'video')
    const offer = videoCodecPreferences(CHROME_DESKTOP_VIDEO, directionsFor(plan, 'caller').send)
    const answer = answerFrom(offer, videoCodecPreferences(SAFARI_VIDEO, directionsFor(plan, 'callee').send))
    expect(label(sent(answer, LINUX_DESKTOP)!)).toBe('H264 42e01f pm1')
    expect(label(sent(offer, IPHONE_12, answer)!)).toBe('VP8')
  })
})
