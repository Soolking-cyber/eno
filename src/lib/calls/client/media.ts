import { CALL_PROTOCOL_VERSION, type CapabilityReport, type CodecName, type CodecSupport } from '../types'
import { inAppHost } from '@/lib/in-app-browser'

/**
 * In-app calls — the phone's media: microphone and camera capture, where calls work, and the capability report the
 * codec plan is built from (DESIGN.md v3 §2; codec-plan.ts's capability-builder contract).
 *
 * ⚠️ CAMERA OFF AT START (owner decision 3). A video call opens with the microphone only; its video transceiver is
 * negotiated with NO track until the person turns the camera on (engine.ts createActive) — turning it on is then
 * replaceTrack, never a renegotiation. ⛔ NOT a black placeholder: its frames read as "their camera is on" on the other
 * phone, which hid the caller's identity behind a blurred black screen (client review).
 * ⚠️ ONE CODEC ENTRY PER CODEC/PROFILE, CARRYING BOTH HALVES (codec-plan review): encode = listed in
 * RTCRtpSender.getCapabilities, decode = listed in RTCRtpReceiver.getCapabilities, and H.264 'high' only from a 640c
 * profile-level-id. Separate send/receive entries would be AND-merged by the plan and could erase VP8 — no video.
 */

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
}

/** 720p is the ladder's top (§2); a ≤ 2 GB phone captures 540p so its encoder never starts above what it can carry. */
export function cameraConstraints(facingMode: 'user' | 'environment' = 'user'): MediaTrackConstraints {
  const small = deviceMemory() !== null && (deviceMemory() as number) <= 2
  return {
    facingMode,
    width: { ideal: small ? 960 : 1280 },
    height: { ideal: small ? 540 : 720 },
    frameRate: { ideal: 30, max: 30 },
  }
}

function deviceMemory(): number | null {
  const m = (typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined)
  return typeof m === 'number' && Number.isFinite(m) ? m : null
}

export type MediaFailure = 'denied' | 'no_device' | 'in_use' | 'insecure' | 'unsupported'

/** Classify a getUserMedia failure for the screen (the device keeps ringing elsewhere on any of these). */
export function mediaFailure(e: unknown): MediaFailure {
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device'
  if (name === 'NotReadableError' || name === 'AbortError') return 'in_use'
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure'
  return 'unsupported'
}

export async function getMicrophone(): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false })
  const [track] = stream.getAudioTracks()
  if (!track) throw Object.assign(new Error('no audio track'), { name: 'NotFoundError' })
  return track
}

export async function getCamera(facingMode: 'user' | 'environment' = 'user'): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: cameraConstraints(facingMode) })
  const [track] = stream.getVideoTracks()
  if (!track) throw Object.assign(new Error('no video track'), { name: 'NotFoundError' })
  if ('contentHint' in track) track.contentHint = 'motion'
  return track
}

/** Two or more cameras (front and back): worth a switch button. Counting needs no permission; labels would. */
export async function hasSeveralCameras(): Promise<boolean> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length > 1
  } catch {
    return false
  }
}

const MIME: Record<CodecName, string> = { H264: 'video/h264', VP8: 'video/vp8', VP9: 'video/vp9', AV1: 'video/av1', H265: 'video/h265' }

function listed(codecs: readonly RTCRtpCodec[] | undefined, codec: CodecName, profilePrefix?: string): boolean {
  return (codecs ?? []).some((c) => {
    if (c.mimeType.toLowerCase() !== MIME[codec]) return false
    if (!profilePrefix) return true
    const plid = /(?:^|;)\s*profile-level-id=([0-9a-f]{6})/i.exec(c.sdpFmtpLine ?? '')
    return !!plid && plid[1].toLowerCase().startsWith(profilePrefix)
  })
}

async function powerEfficient(kind: 'encode' | 'decode', contentType: string): Promise<boolean | undefined> {
  const mc = (typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined)
  if (!mc) return undefined
  const video = { contentType, width: 960, height: 540, bitrate: 1_200_000, framerate: 30 }
  try {
    const info = kind === 'encode'
      ? await mc.encodingInfo({ type: 'webrtc', video } as MediaEncodingConfiguration)
      : await mc.decodingInfo({ type: 'webrtc', video } as MediaDecodingConfiguration)
    return info.supported ? info.powerEfficient : false
  } catch {
    return undefined
  }
}

function platform(): CapabilityReport['platform'] {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop'
  return 'other'
}

function app(): CapabilityReport['app'] {
  const cap = typeof window !== 'undefined' ? (window as Window & { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor : undefined
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === 'ios' ? 'capacitor-ios' : 'capacitor-android'
  return 'browser'
}

/** This device's report (types.ts CapabilityReport) — what it can send and receive, never a guess at a tier. */
export async function buildCapabilityReport(): Promise<CapabilityReport> {
  const send = typeof RTCRtpSender !== 'undefined' ? RTCRtpSender.getCapabilities?.('video')?.codecs : undefined
  const recv = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver.getCapabilities?.('video')?.codecs : undefined
  const entries: { codec: CodecName; profile?: 'high' | 'cbp'; prefix?: string; contentType: string }[] = [
    { codec: 'H264', profile: 'cbp', prefix: '42e0', contentType: 'video/H264;profile-level-id=42e01f;packetization-mode=1' },
    { codec: 'H264', profile: 'high', prefix: '640c', contentType: 'video/H264;profile-level-id=640c1f;packetization-mode=1' },
    { codec: 'VP8', contentType: 'video/VP8' },
    { codec: 'VP9', contentType: 'video/VP9' },
    { codec: 'AV1', contentType: 'video/AV1' },
  ]
  const codecs: CodecSupport[] = []
  for (const e of entries) {
    const encode = listed(send, e.codec, e.prefix)
    const decode = listed(recv, e.codec, e.prefix)
    if (!encode && !decode) continue
    const support: CodecSupport = { codec: e.codec, encode, decode }
    if (e.profile) support.profile = e.profile
    const [pe, pd] = await Promise.all([encode ? powerEfficient('encode', e.contentType) : undefined, decode ? powerEfficient('decode', e.contentType) : undefined])
    if (pe !== undefined) support.powerEfficientEncode = pe
    if (pd !== undefined) support.powerEfficientDecode = pd
    codecs.push(support)
  }
  const mem = deviceMemory()
  const report: CapabilityReport = {
    v: CALL_PROTOCOL_VERSION,
    codecs,
    // ≤ 3 GB: one WebView renderer hosts the page AND the decoder, so ask for no more than 540p (types.ts).
    maxRecvHeight: mem !== null && mem <= 3 ? 540 : 720,
    maxSendHeight: mem !== null && mem <= 2 ? 540 : 720,
    platform: platform(),
    app: app(),
  }
  if (mem !== null) report.deviceMemory = mem
  return report
}

/**
 * The native apps (Capacitor, iOS and Android). Calls stay off in BOTH for now (client review): the Android shell has
 * no WebRTC capture, and the iOS app's purpose strings (ios/App/App/Info.plist NSMicrophoneUsageDescription /
 * NSCameraUsageDescription) describe photos and listing videos, not calls — App Review 5.1.1 wants every use named.
 * ⛔ To turn calls on in the iOS app: name calls in both strings, ship that build, then let this return false there.
 */
export function inNativeShell(): boolean {
  return typeof window !== 'undefined'
    && !!(window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}

/**
 * Can THIS page place or take a call? Not in the native apps, and not in the Facebook / Zalo / Instagram in-app
 * browsers, where capture is unreliable (§5) — the ring still shows there, with "answer on another device". ONE rule
 * for the thread's buttons and the ring screen (client review: the shell showed buttons that could never work).
 */
export function callsWorkHere(): boolean {
  return webrtcAvailable() && !inNativeShell() && inAppHost() === null
}

/** Can this page place or take a call at all? (No WebRTC, no capture, an insecure page → no call buttons.) */
export function webrtcAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' // each start's id (engine.ts)
    && typeof RTCPeerConnection !== 'undefined'
    && typeof RTCPeerConnection.generateCertificate === 'function'
    && !!navigator.mediaDevices?.getUserMedia
    && window.isSecureContext
}
