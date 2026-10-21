import { z } from 'zod'
import {
  CALL_PROTOCOL_VERSION,
  type CallMedia,
  type CallRole,
  type CapabilityReport,
  type CodecName,
  type CodecSupport,
} from './types'

/**
 * THE CODEC PLAN: which video codec each direction of a 1:1 call STARTS on, at what height and bitrate, and how
 * high it may climb. Also the setCodecPreferences orders that make the browsers actually negotiate it
 * (design: ~/eno-calls-research-2026-10/DESIGN.md v3 §2 Video + Audio).
 *
 * WHY H.264 FIRST AND NOT CHROME'S DEFAULT VP8. Every MediaTek / Unisoc / Snapdragon phone and every iPhone encodes
 * H.264 in hardware, while VP8 runs in software on all of them (research-codecs.md). Chrome offers VP8 first, so
 * without an explicit order a potato phone spends its CPU on libvpx. So a direction starts on H.264 at 540p /
 * 1.2 Mbps when its SENDER reports a power-efficient (= hardware) H.264 encoder and its RECEIVER decodes H.264. It
 * uses High profile (640c1f: CABAC, 10–20% fewer bits) only when the sender's High encoder AND the receiver's High
 * decoder are both power-efficient, and Constrained Baseline otherwise. With no hardware H.264 the direction starts
 * on VP8 at 360p / 0.7 Mbps. Below 360p it is VP8 either way: Android hardware H.264 is worse than software at low
 * resolution, and MediaTek / Unisoc encoders have no temporal layers (review-refute-quality.md).
 *
 * ⚠️ ONE SENDRECV TRANSCEIVER: A CODEC MUST WORK BOTH WAYS BEFORE EITHER DIRECTION CAN USE IT. The call has one video
 * transceiver, and it is sendrecv (DESIGN §3.2 step 4). A sendrecv m-section lists only what its author can both SEND
 * and RECEIVE. W3C webrtc-pc createOffer/createAnswer exclude codecs missing from either implemented list, and
 * libwebrtc m150 does the same (rtp_transceiver.cc UpdateCodecPreferencesCaches keeps a preference only
 * `if (is_send_codec && is_recv_codec)`; codec_vendor.cc video_sendrecv_codecs is the intersection). H.264 is matched
 * by PROFILE there, and AV1 by profile; only the level is ignored. So a codec that one phone can only DECODE is
 * negotiated in NEITHER direction. That covers AV1 on an iPhone 15 Pro (hardware decoder, no encoder), dav1d without
 * libaom on a 32-bit potato, Constrained High on a phone whose encoder lacks it, and H.264 on a WebView that lists no
 * H.264 encoder. Every rule below therefore starts from negotiable(): both reports encode AND decode the codec. On
 * top of that, the per-direction part is only which end has the hardware. Planning on "sender encodes + receiver
 * decodes" alone promised High, H.264 and AV1 that the SDP then silently dropped. If the engine ever moves to a
 * sendonly + recvonly transceiver pair per direction, negotiable() is the one function to relax.
 *
 * WHY THE PLAN ONLY BOUNDS AND THE LADDER DECIDES. Device-tier guesses (deviceMemory, cores, AV1-in-caps, socModel)
 * are NOT reliable: Safari exposes none of them, and octa-core A53 potatoes report "8 cores". So the plan reads only
 * codec support and the two announced heights, starts conservative, and leaves promotion to the live-stats ladder.
 * `av1Eligible` is permission, not a decision: the ladder still has to MEASURE a fast encode before it sends AV1.
 *
 * ⚠️ ONE SIDE DECIDES. Peers run different builds for days (Capacitor remote mode, long-open tabs). So the CALLER
 * computes the plan once and sends it in the offer metadata, and the callee applies it (parseCodecPlan) without
 * ever computing its own. buildPlan is therefore a pure function of its inputs: no clock, no randomness, and no
 * dependence on the order in which a report lists its codecs.
 *
 * ⚠️ A CODEC LIST SAYS WHAT ITS AUTHOR WANTS TO RECEIVE. An SDP m-line lists the formats its writer accepts, best
 * first, and a sender uses the first entry of the REMOTE description it can encode (RFC 3264 §6.1 / §7: the answerer
 * sends the offer's top common format, the offerer the answer's first). So each peer hands videoCodecPreferences
 * the direction it RECEIVES (directionsFor(plan, role).receive). That is also how an asymmetric plan works on
 * Safari, which has no encodings[0].codec: a desktop with no hardware H.264 sends VP8 to an iPhone, and the iPhone
 * sends hardware CBP back. Pass the SEND direction instead and both directions land on the wrong codec (software
 * H.264 on the desktop, software VP8 on the iPhone). Nothing errors.
 *
 * ⚠️ REORDER, NEVER BUILD. setCodecPreferences throws InvalidModificationError on any entry that is in neither
 * RTCRtpSender.getCapabilities(kind) nor RTCRtpReceiver.getCapabilities(kind) (`red`, for one, is not offered
 * everywhere). So both preference functions return a PERMUTATION of the list they are given: nothing added and
 * nothing dropped. Dropping is a bug too, because a mid-call switch (encodings[0].codec → VP8 or AV1) only works for
 * a codec the SDP negotiated.
 *
 * ⚠️ H.264 PROFILES MATCH BY PREFIX. A profile-level-id is profile_idc + constraint flags + LEVEL. The level byte
 * differs by device (42e01f vs 42e034) and is negotiable (level-asymmetry-allowed), so '42e0' is Constrained
 * Baseline and '640c' is Constrained High at any level. '6400' (plain High) and '4d00' (Main) are DIFFERENT profiles
 * to libwebrtc's negotiation, not substitutes. They stay in the list, but never take High's place.
 *
 * ⚠️ HEIGHTS ARE THE FRAME'S SHORT SIDE. 540 means 960×540 landscape or 540×960 portrait: the receiver's memory cost
 * is the same for both. Applying a cap to the long side of a portrait phone frame would shrink it by almost half.
 *
 * Not here: the ladder (mid-call promotion and demotion, the encodings[0].codec switches), the audio bitrate
 * (setParameters), and the HEVC A/B. v1 plans start on H.264 or VP8 only.
 */

/**
 * The two H.264 profiles a plan can name (types.ts CodecSupport.profile). CBP is everywhere (RFC 7742). Constrained
 * High exists only where an engine lists a 640c entry: Firefox lists none, and neither does Chrome without a hardware
 * H.264 codec.
 */
export type H264Profile = 'high' | 'cbp'

/** v1 starts every direction on one of these. AV1 is only reached mid-call, by the ladder, through av1Eligible. */
export type PlanCodec = 'H264' | 'VP8'

interface DirectionCommon {
  /** The ladder rung the direction starts on. Always ≤ maxHeight. */
  startHeight: number
  /** RTCRtpEncodingParameters.maxBitrate for that rung, in bits per second (the unit setParameters takes). */
  startMaxBitrate: number
  /** This direction's ceiling: min(sender.maxSendHeight, receiver.maxRecvHeight, PLAN_MAX_HEIGHT). */
  maxHeight: number
  /**
   * May the ladder TRY AV1 here? True only when AV1 can be negotiated at all: both ends encode AND decode it (the
   * sendrecv rule in the header). That includes "the sender encodes, the receiver decodes". It is therefore the same
   * in both directions. The ladder still has to measure the encode time first.
   */
  av1Eligible: boolean
  /**
   * What a Chromium sender switches to below 360p, or on a lossy single-layer hardware stream (DESIGN §2). VP8 is
   * mandatory for every WebRTC browser (RFC 7742), and buildPlan plans no direction unless both ends can send AND
   * receive VP8, so the SDP always carries it.
   */
  fallback: 'VP8'
}

/**
 * One direction of a video call. A discriminated union, so an H.264 plan cannot lack its profile and a VP8 plan
 * cannot carry one. `h264Profile?: undefined` on VP8 keeps a flat `dir.h264Profile` read legal.
 */
export type DirectionPlan =
  | (DirectionCommon & { codec: 'H264'; h264Profile: H264Profile })
  | (DirectionCommon & { codec: 'VP8'; h264Profile?: undefined })

/** What the caller sends in the offer metadata. null means no video goes that way (an audio-only call, or no shared codec or height). */
export interface CodecPlan {
  v: typeof CALL_PROTOCOL_VERSION
  directions: { callerToCallee: DirectionPlan | null; calleeToCaller: DirectionPlan | null }
}

/**
 * v1 never plans above 720p, even between two flagships. The v3 ladder tops out at 720p30, the relay capacity is
 * sized to that (DESIGN §3.5), and the old 1080p rule ("Wi-Fi on both ends") cannot even be checked on iOS, which has
 * no navigator.connection.
 */
export const PLAN_MAX_HEIGHT = 720
/** H.264 starts here when both phones allow it. Not 720: hardware encoders start blocky, and BWE begins at 300 kbps. */
export const H264_START_HEIGHT = 540
/** VP8 (software) starts lower, because nothing in a report proves the sender's CPU can handle more. */
export const VP8_START_HEIGHT = 360
/** H.264 is planned only at ≥360p. Below that, Android hardware H.264 loses to software VP8 (DESIGN §2). */
export const H264_MIN_HEIGHT = 360

/**
 * The rungs a call can START on, tallest first, each with its starting maxBitrate (DESIGN §2: 540p30 1.2 Mbps,
 * 360p24 0.6–0.8 → 0.7, 240p15 ≤0.3). The full ladder (720p and video-paused included) belongs to the ladder module.
 * These are only the entry points.
 */
export const START_RUNGS: readonly { readonly height: number; readonly maxBitrate: number }[] = [
  { height: 540, maxBitrate: 1_200_000 },
  { height: 360, maxBitrate: 700_000 },
  { height: 240, maxBitrate: 300_000 },
]
/** No direction is planned below the lowest start rung. A receiver that cannot take 240p gets no video. */
export const PLAN_MIN_HEIGHT = START_RUNGS[START_RUNGS.length - 1].height

// ---------------------------------------------------------------------------
// buildPlan
// ---------------------------------------------------------------------------

/** What one report claims about one codec (or one H.264 profile), after merging duplicate entries. */
interface Support {
  encode: boolean
  decode: boolean
  hwEncode: boolean
  hwDecode: boolean
}
const NONE: Support = { encode: false, decode: false, hwEncode: false, hwDecode: false }
const KNOWN_CODECS: ReadonlySet<string> = new Set<CodecName>(['H264', 'VP8', 'VP9', 'AV1', 'H265'])

/**
 * The index key of a report entry, or null for an entry this build cannot interpret. H.264 with no profile counts as
 * CBP: it is the profile every H.264 implementation must offer (RFC 7742), and an unprofiled claim must never be
 * read as High. An UNKNOWN profile (say 'main' from a newer build) is skipped rather than folded into CBP. A Main
 * encoder claim says nothing about CBP.
 */
function supportKey(c: CodecSupport): string | null {
  if (!c || !KNOWN_CODECS.has(c.codec)) return null
  if (c.codec !== 'H264') return c.codec
  if (c.profile == null || c.profile === 'cbp') return 'H264:cbp'
  if (c.profile === 'high') return 'H264:high'
  return null
}

/**
 * The report as a lookup keyed by codec (and H.264 profile).
 * ⚠️ DUPLICATE ENTRIES MERGE TO THE WEAKER CLAIM (AND), so a report that contradicts itself ("encodes VP8" and
 * "does not encode VP8") never gets the benefit of the doubt. That keeps "never choose a codec one side lacks" true
 * for broken reports, and it keeps the plan independent of the order the entries arrive in.
 * A power-efficiency flag counts only together with its capability. "powerEfficient but cannot encode" means nothing.
 */
function supportIndex(report: CapabilityReport): ReadonlyMap<string, Support> {
  const index = new Map<string, Support>()
  for (const c of Array.isArray(report?.codecs) ? report.codecs : []) {
    const key = supportKey(c)
    if (!key) continue
    const encode = c.encode === true
    const decode = c.decode === true
    const next: Support = {
      encode,
      decode,
      hwEncode: encode && c.powerEfficientEncode === true,
      hwDecode: decode && c.powerEfficientDecode === true,
    }
    const prev = index.get(key)
    index.set(
      key,
      prev
        ? {
            encode: prev.encode && next.encode,
            decode: prev.decode && next.decode,
            hwEncode: prev.hwEncode && next.hwEncode,
            hwDecode: prev.hwDecode && next.hwDecode,
          }
        : next,
    )
  }
  return index
}

const of = (index: ReadonlyMap<string, Support>, key: string): Support => index.get(key) ?? NONE

/**
 * Can this codec (or H.264 profile) be negotiated at all on the call's one sendrecv video transceiver? Only if BOTH
 * reports encode it AND decode it (header: ONE SENDRECV TRANSCEIVER). The result is symmetric, so swapping the two
 * reports cannot change it.
 */
function negotiable(a: ReadonlyMap<string, Support>, b: ReadonlyMap<string, Support>, key: string): boolean {
  const x = of(a, key)
  const y = of(b, key)
  return x.encode && x.decode && y.encode && y.decode
}

/**
 * Which H.264 profile this direction can start on in HARDWARE, or null when it cannot. The profile must first be
 * negotiable (both ends encode and decode it). Beyond that:
 * High needs the sender's High encoder AND the receiver's High decoder both power-efficient (DESIGN §2: "when both
 * sides report it powerEfficient"). A software High decode on the receiver would cost CABAC CPU on exactly the
 * phones the plan protects. CBP needs a hardware CBP encoder on the sender, and any decoder on the receiver,
 * because VP8 would be decoded in software there too. Each profile is judged on its OWN entries: a hardware High
 * encoder does not imply that the CBP the receiver can take is encoded in hardware.
 */
function h264ProfileFor(sender: ReadonlyMap<string, Support>, receiver: ReadonlyMap<string, Support>): H264Profile | null {
  if (negotiable(sender, receiver, 'H264:high') && of(sender, 'H264:high').hwEncode && of(receiver, 'H264:high').hwDecode) return 'high'
  if (negotiable(sender, receiver, 'H264:cbp') && of(sender, 'H264:cbp').hwEncode) return 'cbp'
  return null
}

/** A finite positive height, floored to whole pixels. Anything else (missing, NaN, negative, Infinity) is 0, which plans no video. */
const pixels = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** The tallest start rung at or below both the codec's own start height and the direction's cap. */
const startRung = (codecStart: number, maxHeight: number) =>
  START_RUNGS.find((r) => r.height <= codecStart && r.height <= maxHeight) ?? null

function planDirection(
  sender: ReadonlyMap<string, Support>,
  receiver: ReadonlyMap<string, Support>,
  maxHeight: number,
): DirectionPlan | null {
  // VP8 is the floor every planned direction must share. It is the fallback the ladder switches to, and the codec of
  // the bottom rungs. Without it, `fallback: 'VP8'` would promise a codec the SDP never negotiated. On a sendrecv
  // transceiver that means both ends send AND receive it, so a side that cannot send VP8 leaves both directions unplanned.
  if (!negotiable(sender, receiver, 'VP8')) return null
  const common = {
    maxHeight,
    av1Eligible: negotiable(sender, receiver, 'AV1'),
    fallback: 'VP8' as const,
  }
  const profile = h264ProfileFor(sender, receiver)
  if (profile) {
    const rung = startRung(H264_START_HEIGHT, maxHeight)
    if (rung && rung.height >= H264_MIN_HEIGHT) {
      return { codec: 'H264', h264Profile: profile, startHeight: rung.height, startMaxBitrate: rung.maxBitrate, ...common }
    }
  }
  const rung = startRung(VP8_START_HEIGHT, maxHeight)
  return rung ? { codec: 'VP8', startHeight: rung.height, startMaxBitrate: rung.maxBitrate, ...common } : null
}

/**
 * The plan for a call. The CALLER runs this exactly once, after the accept brings the callee's report, and sends the
 * result in the offer metadata. Each direction is judged on (its sender, its receiver) alone, so swapping the two
 * reports swaps the two directions.
 * The reports' own `v` is not checked here. The server already refuses a pair whose protocol versions differ.
 */
export function buildPlan(caller: CapabilityReport, callee: CapabilityReport, media: CallMedia): CodecPlan {
  if (media !== 'video') {
    return { v: CALL_PROTOCOL_VERSION, directions: { callerToCallee: null, calleeToCaller: null } }
  }
  const callerIndex = supportIndex(caller)
  const calleeIndex = supportIndex(callee)
  const capFor = (sender: CapabilityReport, receiver: CapabilityReport) =>
    Math.min(pixels(sender?.maxSendHeight), pixels(receiver?.maxRecvHeight), PLAN_MAX_HEIGHT)
  return {
    v: CALL_PROTOCOL_VERSION,
    directions: {
      callerToCallee: planDirection(callerIndex, calleeIndex, capFor(caller, callee)),
      calleeToCaller: planDirection(calleeIndex, callerIndex, capFor(callee, caller)),
    },
  }
}

/**
 * The direction a role SENDS (its encoder settings and the ladder's starting point) and the direction it RECEIVES.
 * The received one is what goes to videoCodecPreferences, for the reason in the header.
 */
export function directionsFor(plan: CodecPlan, role: CallRole): { send: DirectionPlan | null; receive: DirectionPlan | null } {
  const { callerToCallee, calleeToCaller } = plan.directions
  return role === 'caller'
    ? { send: callerToCallee, receive: calleeToCaller }
    : { send: calleeToCaller, receive: callerToCallee }
}

// ---------------------------------------------------------------------------
// The wire contract (the callee's side)
// ---------------------------------------------------------------------------

/**
 * Bounds that every start rung (and the ladder's 720p30 2.5 Mbps top) fits inside. A plan from another build may use
 * different numbers within them. Numbers outside them are refused: setParameters({maxBitrate: 1e12}) is "uncapped".
 */
export const PLAN_MIN_BITRATE = 100_000
export const PLAN_MAX_BITRATE = 2_500_000

const planHeight = z.number().int().min(PLAN_MIN_HEIGHT).max(PLAN_MAX_HEIGHT)
const directionCommonShape = {
  startHeight: planHeight,
  startMaxBitrate: z.number().int().min(PLAN_MIN_BITRATE).max(PLAN_MAX_BITRATE),
  maxHeight: planHeight,
  av1Eligible: z.boolean(),
  fallback: z.literal('VP8'),
}
const directionPlanSchema = z
  .discriminatedUnion('codec', [
    z.strictObject({ codec: z.literal('H264'), h264Profile: z.enum(['high', 'cbp']), ...directionCommonShape }),
    z.strictObject({ codec: z.literal('VP8'), ...directionCommonShape }),
  ])
  .refine((d) => d.startHeight <= d.maxHeight, { message: 'startHeight is above maxHeight' })

/**
 * The plan as it crosses the wire. Strict: an unknown key is a different protocol, not something to ignore. Only
 * shape and bounds are checked here, not buildPlan's policy (H.264 at ≥360p, which profile). The caller's plan is
 * authoritative by design, and a newer build may tune the policy without a protocol bump.
 */
export const codecPlanSchema = z.strictObject({
  v: z.literal(CALL_PROTOCOL_VERSION),
  directions: z.strictObject({
    callerToCallee: directionPlanSchema.nullable(),
    calleeToCaller: directionPlanSchema.nullable(),
  }),
})

/**
 * The callee's reading of the offer metadata's plan. null for anything malformed. It never throws in the call path.
 * ⚠️ safeParse alone does not keep that promise: zod 4 lets a throwing getter or a revoked Proxy escape it (measured).
 * JSON cannot produce either, but the guarantee should not depend on how the caller decoded the payload.
 */
export function parseCodecPlan(raw: unknown): CodecPlan | null {
  try {
    const parsed = codecPlanSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// setCodecPreferences orders
// ---------------------------------------------------------------------------

/** An RTCRtpCodec as getCapabilities returns it. lib.dom's RTCRtpCodec has exactly this shape. */
export interface RtpCodecLike {
  mimeType: string
  clockRate: number
  channels?: number
  sdpFmtpLine?: string
}

/** What a video list puts first: a DirectionPlan, or any codec name (a later AV1 / HEVC trial). */
export interface PreferredCodec {
  codec: CodecName
  h264Profile?: H264Profile
}

const MIME_SUBTYPE: Record<CodecName, string> = { H264: 'h264', VP8: 'vp8', VP9: 'vp9', AV1: 'av1', H265: 'h265' }
const PROFILE_PREFIX: Record<H264Profile, string> = { cbp: '42e0', high: '640c' }
/** Retransmission, redundancy and FEC wrappers. They protect a media codec and are never one, so they go last. */
const REPAIR_SUBTYPES: ReadonlySet<string> = new Set(['rtx', 'red', 'ulpfec'])

/** 'video/H264' → 'h264'. MIME types are case-insensitive, and engines disagree on case. */
function subtypeOf(c: RtpCodecLike): string {
  const mime = String(c?.mimeType ?? '').trim().toLowerCase()
  return mime.slice(mime.indexOf('/') + 1)
}

/** One fmtp parameter, lowercased. Names are case-insensitive and engines differ on spacing around ';'. */
function fmtpParam(c: RtpCodecLike, name: string): string | undefined {
  for (const part of String(c?.sdpFmtpLine ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim().toLowerCase() === name) return part.slice(eq + 1).trim().toLowerCase()
  }
  return undefined
}

const isRepair = (c: RtpCodecLike): boolean => {
  const s = subtypeOf(c)
  return REPAIR_SUBTYPES.has(s) || s.startsWith('flexfec')
}

const isH264Profile = (c: RtpCodecLike, profile: H264Profile): boolean => {
  const prefix = PROFILE_PREFIX[profile]
  return !!prefix && subtypeOf(c) === 'h264' && (fmtpParam(c, 'profile-level-id') ?? '').startsWith(prefix)
}

const isPreferred = (c: RtpCodecLike, want: PreferredCodec): boolean =>
  want.codec === 'H264' ? isH264Profile(c, want.h264Profile ?? 'cbp') : subtypeOf(c) === MIME_SUBTYPE[want.codec]

/**
 * ⚠️ packetization-mode=0 (single NAL unit, also what an ABSENT parameter means) cannot split a NAL across RTP
 * packets. An encoder that does not cut its slices to the MTU (hardware encoders generally do not) cannot send a
 * 540p keyframe in that mode. So within each H.264 profile, mode 1 goes first.
 */
const h264ModeRank = (c: RtpCodecLike): number =>
  subtypeOf(c) === 'h264' && fmtpParam(c, 'packetization-mode') !== '1' ? 1 : 0

/** Stable sort by rank, with ties kept in input order. The result is a new array holding exactly the input's elements. */
function permuteByRank<T>(codecs: readonly T[], rank: (c: T) => number): T[] {
  return codecs
    .map((codec, index) => ({ codec, index, rank: rank(codec) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((e) => e.codec)
}

/**
 * The order to give transceiver.setCodecPreferences for the VIDEO this peer RECEIVES:
 *   the planned codec (H.264 by profile-level-id prefix) → H.264 Constrained Baseline (42e0…, the universal H.264
 *   fallback) → VP8 → every other video codec as given → rtx / red / ulpfec / flexfec last.
 * Within each H.264 group, packetization-mode=1 comes first. Pass `codecs` from
 * RTCRtpReceiver.getCapabilities('video').codecs. setCodecPreferences accepts anything in the union of the sender's and
 * receiver's capabilities. On the call's sendrecv transceiver, any entry outside send ∩ receive is then silently
 * left out of the SDP, which is why buildPlan only plans negotiable codecs.
 * The result is a permutation of `codecs`, and the entries are the browser's own objects. With `receiving` null (no video
 * planned that way) the order is the same minus the planned head. If the planned codec is absent from the list (a
 * 'high' plan into an engine that lists no 640c entry), the list simply starts at CBP. The sender then follows the
 * next entry, which is the graceful outcome.
 */
export function videoCodecPreferences<T extends RtpCodecLike>(codecs: readonly T[], receiving: PreferredCodec | null): T[] {
  return permuteByRank(codecs, (c) => {
    if (isRepair(c)) return 90
    if (receiving && isPreferred(c, receiving)) return 0 + h264ModeRank(c)
    if (isH264Profile(c, 'cbp')) return 10 + h264ModeRank(c)
    if (subtypeOf(c) === 'vp8') return 20
    return 30
  })
}

/**
 * The order for the AUDIO this peer receives: opus first, or red then opus when `useRed` (DESIGN §2: RED goes on
 * only after loss stays above 2–3% for 5 s, so turning it on means calling this again and renegotiating). Everything
 * else follows in its given order, red included when it is off. libwebrtc sends RED only when red is listed BEFORE
 * the primary codec, so a red entry after opus is inert.
 * ⚠️ THE LOSS THAT TURNS RED ON IS THIS PEER'S INBOUND LOSS (inbound-rtp packetsLost), not remote-inbound-rtp. A sender
 * reads the REMOTE description's order (webrtc_voice_engine.cc SetSendCodecs: "RED codec needs to be negotiated
 * before the actual codec they reference"). So `useRed: true` here makes the OTHER peer send RED, and drives nothing
 * this peer sends. Drive it from outbound loss and the side that is not losing packets gets the redundancy.
 * ⚠️ red leads only if opus is in the list too. RED carries redundant copies of the primary codec, and with no opus
 * there is nothing for it to protect. A list without opus comes back unchanged.
 */
export function audioCodecPreferences<T extends RtpCodecLike>(codecs: readonly T[], opts: { useRed: boolean }): T[] {
  if (!codecs.some((c) => subtypeOf(c) === 'opus')) return [...codecs]
  const redFirst = opts?.useRed === true
  return permuteByRank(codecs, (c) => {
    const s = subtypeOf(c)
    if (s === 'red' && redFirst) return 0
    if (s === 'opus') return 1
    return 2
  })
}
