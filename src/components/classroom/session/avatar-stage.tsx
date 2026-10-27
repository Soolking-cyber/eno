'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { pcm16Of, resamplePcm16 } from './voice'
import { mark } from './trace'

/**
 * The face on the session screen. Two looks behind one handle:
 *   · AVATAR (Spatius AvatarKit, Direct Mode) — loaded lazily here and nowhere else, so no other page ever carries its
 *     ~9 MB. ⚡ DRAWN BEFORE START (owner, 2026-10-26: "make sure all ai avatar voice etc loads at once when its ready now
 *     voice loads first avatar is not there bad experience"): the SDK, the avatar's files and its first frame need no
 *     session token — the SDK fetches an avatar's metadata unauthenticated ("This endpoint does not require
 *     authentication"), its files from a CDN, and reads the token only when its websocket connects. So the face is drawn
 *     while the screen's intro is up (no Spatius session exists, nothing is billed), and Start only CONNECTS it
 *     (`connect`: the session's token, then the websocket). Any failure — an unsupported device, a refused token, the
 *     plan's concurrency cap, a dropped socket — calls `onFallback`, and the page goes voice-only.
 *   · VOICE — the teacher's photo with a ring that breathes while the avatar speaks (the page plays the audio).
 * ⛔ AvatarKit receives the AVATAR's voice only, never the learner's (plan; the practice notice says so).
 * ⛔ The page passes a `face` only when a start would give one (api/classroom/face — the start's own rules: an under-13
 *    gets none until Spatius's written OK). Without one, nothing here touches Spatius.
 */
export type FaceConfig = { avatarId: string; appId: string; region: string }

export type StageHandle = {
  /**
   * Avatar mode: hand one decoded PART of a reply to AvatarKit — `last` closes the reply. Parts stream in as the server
   * makes them, so the face starts on the first sentence. False = the face is not live; the page plays it itself.
   */
  speakPart: (buffer: AudioBuffer, last: boolean) => boolean
  /** The same for raw PCM16 already at FACE_RATE — the voice server's frames, streamed. */
  speakPcm: (pcm: Int16Array, last: boolean) => boolean
  interrupt: () => void
  /**
   * ⛔ CALLED SYNCHRONOUSLY IN THE START TAP: the face's audio starts inside the gesture — iOS and Safari let an audio
   * context start only there (the SDK creates and resumes its context before its first await). False: no face to prime.
   */
  prime: () => boolean
  /**
   * The drawn face joins this session: its token, then its websocket. True = replies go to the face. False = voice-only
   * (`onFallback` has been called, or the face was taken down meanwhile — a websocket opened late is closed).
   */
  connect: (sessionId: string) => Promise<boolean>
}

/**
 * THE FACE'S AUDIO RATE: the voice server's own 24 kHz (measured 2026-10-26: the face only starts moving when Spatius's
 * server sends back its first motion frames, so every byte up to it counts). It was the page's 48 kHz — the 24 kHz voice
 * upsampled, twice the bytes for nothing — sent as raw PCM; now 24 kHz, compressed to Opus on the way up (~1/8 the bytes;
 * the SDK's `opusUplinkEnabled`). Spatius supports 8–48 kHz.
 */
export const FACE_RATE = 24_000
/** The face is drawn at most this many pixels tall (the SDK's resolution cap); the browser scales it to the screen. */
const FACE_MAX_PX = 960

/** `?face=fast` on the page: audioIndependent (owner testing — see frameStarvationMode); `?face=webgpu`: the SDK may draw
 *  with WebGPU again (see drawWithWebGl). */
function faceParam(): string | null {
  try { return new URLSearchParams(window.location.search).get('face') } catch { return null }
}
const faceFast = () => faceParam() === 'fast'

/**
 * ⛔ WEBGL, NOT WEBGPU (measured 2026-10-26 on the owner's Mac — Chrome, Intel UHD 630 — machine idle): with WebGPU the
 * avatar's files came in 1.5–3 s and then NO first frame in 20 s, every try (the SDK's telemetry: stage=render_system, no
 * backend; disposing it then threw "getBackend of null" — the owner's console). The SDK falls back to WebGL only when
 * WebGPU THROWS, never when it hangs. With WebGPU hidden, the same avatar drew in 1.4 s on WebGL2. The SDK has no public
 * switch (its RenderSystem reads a `preferBackend` that AvatarView never passes), so `navigator.gpu` reads as undefined
 * for this page from the first face on — the SDK's own "no WebGPU" path. Nothing else in eno uses WebGPU.
 */
let webGpuHidden = false
function drawWithWebGl(): void {
  if (webGpuHidden || faceParam() === 'webgpu' || typeof navigator === 'undefined') return
  try {
    const proto = Object.getPrototypeOf(navigator) as object
    const own = Object.getOwnPropertyDescriptor(proto, 'gpu')
    if (own?.configurable) Object.defineProperty(proto, 'gpu', { configurable: true, enumerable: own.enumerable, get: () => undefined })
    webGpuHidden = true
  } catch {
    // a browser that will not let it go: the SDK picks as it would
  }
}

/**
 * THE FACE'S OWN SPLIT OF ITS DELAY, for the trace (2026-10-27 latency workflow: "measure Spatius's own time first"): the
 * SDK marks when each second of a reply's audio was sent (tap_N) and when each group of motion arrived (anim_N). Spatius
 * computes a reply's first motion once it holds 2 s of audio (or the reply is closed): `2 s sent` − first audio is OUR
 * part (the voice being made), `motion` − `2 s sent` is Spatius's. An internal SDK call — read defensively, trace only.
 */
function latencyNote(c: unknown): string | undefined {
  try {
    const m = (c as { getPlaybackLatency?: () => Record<string, unknown> | null }).getPlaybackLatency?.()
    if (!m) return undefined
    const at = (k: string) => { const v = m[k]; const n = typeof v === 'number' ? v : (v as { value?: unknown } | undefined)?.value; return typeof n === 'number' ? n : null }
    const t0 = at('tap_0')
    const t2 = at('tap_2')
    const a0 = at('anim_0')
    if (t0 === null || a0 === null) return undefined
    return `2 s sent ${t2 === null ? '—' : `+${Math.round(t2 - t0)}ms`} · motion +${Math.round(a0 - t0)}ms${t2 === null ? '' : ` (Spatius ${Math.round(a0 - t2)}ms)`}`
  } catch {
    return undefined
  }
}

/** A backstop on the draw itself: the page gives up sooner (session-screen.tsx FACE_PREP_MS) and takes the face down. */
const FIRST_FRAME_MS = 60_000
/** A view taken down mid-init is released once its init is over (settle) — or after this long, a device that never ends it. */
const SETTLE_MAX_MS = 120_000

type Kit = typeof import('@spatius/avatarkit')
type View = InstanceType<Kit['AvatarView']>
type Controller = View['controller']

/**
 * The SDK, imported once per page and early: the screen calls this while it shows its intro. ⛔ NOT
 * `AvatarSDK.isDeviceSupported()`: its own docs say it runs a ~2 s benchmark (16 s measured on a loaded machine,
 * 2026-10-26) and then returns true whenever WebGL2 or WebGPU exists — "the score thresholds are not yet enforced". The
 * same answer, from the same two checks, costs a millisecond here.
 */
let kitPromise: Promise<Kit> | null = null
export function warmAvatarKit(): Promise<Kit> {
  kitPromise ??= import('@spatius/avatarkit')
  return kitPromise
}
/** The face draws with WebGL2 (drawWithWebGl says why): no WebGL2, no face. */
/**
 * iOS (iPadOS reports a Mac) and desktop Safari: an audio context started outside a tap stays SILENT there, with no error
 * (2026-10-26 review, opus). The face's audio starts in the Start tap (prime); when it could not, the face is not used.
 */
export const audioNeedsGesture = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  || /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent))

function canDrawAvatar(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/** One load of the face: its own box, its view, and where it is in its life. */
type Load = {
  /** This load's own box inside the stage — taken out of the page at teardown, so a view still settling never shares one. */
  host: HTMLDivElement
  view: View | null
  controller: Controller | null
  /** Resolves at the first frame; rejects when the load failed. */
  drawn: Promise<void>
  firstFrame: boolean
  /** The face's audio — started in the Start tap (prime) or by connect — awaited before the websocket opens. */
  audio: Promise<void> | null
  /** connect() set a session token / began opening the websocket: teardown clears and closes them. */
  token: boolean
  connecting: boolean
  /** Ends the draw's wait (teardown) and the token's request — nothing of a load outlives it. */
  stop: AbortController
  firstFrameTimer: ReturnType<typeof setTimeout> | undefined
  fail: (e: unknown) => void
  /** Taken down (the effect's cleanup ran): every continuation stops at its next step. */
  gone: boolean
  failed: boolean
  released: boolean
}

/**
 * ⛔ A VIEW IS NEVER DISPOSED MID-INIT (the owner's console, 2026-10-26: "[AvatarKit] [AvatarView] Failed to initialize
 * avatar view Cannot read properties of null (reading 'getBackend')", telemetry stage=render_system): dispose() nulls the
 * render system that the SDK's own init is still awaiting, and the init then throws on it. A view taken down early is
 * released once it has drawn its first frame or its init has otherwise finished (the SDK's `isInitialized`), or after
 * SETTLE_MAX_MS — a device that never finishes. Its websocket was closed already: only the GPU waits.
 */
function settle(l: Load): void {
  const v = l.view
  if (!v || l.released) return
  const over = () => l.firstFrame || (v as unknown as { isInitialized?: boolean }).isInitialized === true
  const release = () => {
    if (l.released) return
    l.released = true
    try { v.dispose() } catch { /* disposed */ }
  }
  if (over()) { release(); return }
  const since = Date.now()
  const t = setInterval(() => {
    if (!over() && Date.now() - since < SETTLE_MAX_MS) return
    clearInterval(t)
    release()
  }, 500)
}

export const AvatarStage = forwardRef<StageHandle, {
  /** 'avatar' while the face is shown or being drawn; 'voice' = the photo. */
  mode: 'avatar' | 'voice'
  /** The face to draw (api/classroom/face) — null: none. */
  face: FaceConfig | null
  photoUrl: string | null
  name: string
  speaking: boolean
  /** The face has drawn its first frame: the page may offer Start. */
  onDrawn: () => void
  onFallback: () => void
  onPlaying: (playing: boolean) => void
}>(function AvatarStage({ mode, face, photoUrl, name, speaking, onDrawn, onFallback, onPlaying }, ref) {
  const box = useRef<HTMLDivElement>(null)
  /** The current load (null: none, or taken down). */
  const load = useRef<Load | null>(null)
  /** The face's controller once its websocket is open: replies go here. */
  const ctl = useRef<Controller | null>(null)
  const [drawn, setDrawn] = useState(false)
  const fallback = useRef(onFallback)
  fallback.current = onFallback
  const drawnCb = useRef(onDrawn)
  drawnCb.current = onDrawn
  const playing = useRef(onPlaying)
  playing.current = onPlaying

  useImperativeHandle(ref, () => ({
    speakPart: (buffer, last) => {
      const c = ctl.current
      if (!c) return false
      try {
        const pcm = new Int16Array(pcm16Of(buffer))
        c.send(resamplePcm16(pcm, buffer.sampleRate, FACE_RATE).slice().buffer, last)
        mark(last ? 'face: last part sent' : 'face: part sent', `${buffer.duration.toFixed(1)}s`)
        return true
      } catch {
        return false
      }
    },
    speakPcm: (pcm, last) => {
      const c = ctl.current
      if (!c) return false
      try {
        // An exact ArrayBuffer of these samples (a view may sit in a larger buffer).
        c.send(pcm.slice().buffer, last)
        if (last) mark('face: last frames sent')
        return true
      } catch {
        return false
      }
    },
    interrupt: () => { try { ctl.current?.interrupt() } catch { /* nothing playing */ } },
    prime: () => {
      const l = load.current
      if (!l || l.gone || !l.controller) return false
      if (!l.audio) {
        // CALLED here, synchronously — inside the Start tap. Its failure surfaces in connect().
        l.audio = l.controller.initializeAudioContext()
        l.audio.catch(() => {})
      }
      return true
    },
    connect: async (sessionId) => {
      const l = load.current
      if (!l || l.gone) return false
      // The token is asked for at once, while the face finishes drawing if it still is — and given up with the load.
      const tok = fetch(`/api/classroom/sessions/${sessionId}/token`, { method: 'POST', signal: l.stop.signal }).catch(() => null)
      try {
        await l.drawn
        const res = await tok
        if (l.gone) return false
        if (!res?.ok) throw new Error(`token_${res?.status ?? 'network'}`)
        const { token } = (await res.json()) as { token: string }
        if (l.gone) return false
        const kit = await warmAvatarKit()
        if (l.gone) return false
        kit.AvatarSDK.setSessionToken(token)
        l.token = true
        mark('face: token')
        if (!l.audio) {
          // ⛔ Not started in a tap: where the browser keeps such audio silent, no face at all — never lips without a voice.
          if (audioNeedsGesture()) throw new Error('audio_not_started_in_a_tap')
          l.audio = l.controller!.initializeAudioContext()
        }
        await l.audio
        if (l.gone) return false
        l.connecting = true
        await l.controller!.start()
        // Taken down while the websocket opened: the cleanup closed it already; closed again in case it opened after.
        if (l.gone) { try { l.controller!.close() } catch { /* closed */ } return false }
        ctl.current = l.controller
        mark('face: started')
        return true
      } catch (e) {
        mark('face: connect failed', String((e as Error)?.message ?? e))
        if (!l.gone && !l.failed) fallback.current()
        return false
      }
    },
  }), [])

  useEffect(() => {
    const root = box.current
    if (mode !== 'avatar' || !face || !root) return
    const host = document.createElement('div')
    host.className = 'absolute inset-0'
    root.appendChild(host)
    let drawnOk: () => void = () => {}
    let drawnFail: (e: unknown) => void = () => {}
    const l: Load = {
      host, view: null, controller: null, firstFrame: false, audio: null, token: false, connecting: false, gone: false, failed: false, released: false,
      drawn: new Promise<void>((resolve, reject) => { drawnOk = resolve; drawnFail = reject }),
      stop: new AbortController(),
      firstFrameTimer: undefined,
      fail: (e) => drawnFail(e),
    }
    l.drawn.catch(() => {}) // observed by connect(); never an unhandled rejection
    load.current = l
    ;(async () => {
      try {
        mark('face: load')
        if (!canDrawAvatar()) throw new Error('unsupported_device')
        drawWithWebGl()
        const kit = await warmAvatarKit()
        if (l.gone) return
        // The app id and region only (no token): the SDK resolves its region with them.
        // ⚡ LIGHT ON PURPOSE (owner, 2026-10-27: "lower the quality … compressed version for faster load"): the SDK draws
        // at `ultra` by default and at the screen's full density (×3 on an iPhone) — here `standard`, its height capped at
        // FACE_MAX_PX and scaled up by the browser. Spatius bills connected minutes, not pixels: this saves the phone's GPU,
        // battery and first frame, not the bill. (The model is already the compressed one — the `true` below.)
        if (!kit.AvatarSDK.appId) await kit.AvatarSDK.initialize(face.appId, { region: face.region, drivingServiceMode: kit.DrivingServiceMode.direct, logLevel: kit.LogLevel.error, renderQuality: kit.RenderQuality.standard })
        // On every mount, not only the first setup (review, codex + opus): whatever set the SDK up first, this face is light.
        kit.AvatarSDK.setRenderQuality(kit.RenderQuality.standard)
        kit.AvatarSDK.setRenderResolutionCap(true, FACE_MAX_PX)
        if (l.gone) return
        const avatar = await kit.AvatarManager.shared.load(face.avatarId, undefined, true)
        if (l.gone) return
        mark('face: assets')
        const v = new kit.AvatarView(avatar, host, { audioFormat: { channelCount: 1, sampleRate: FACE_RATE, opusUplinkEnabled: true } })
        l.view = v
        const c = v.controller
        l.controller = c
        // ⛔ STRICT SYNC (owner, 2026-10-26: "i cannot see live avatar" — the lips stood still). The SDK's default
        // (`audioIndependent`) keeps the AUDIO playing when the face's motion frames run late, so a slow frame stream is a
        // talking photo. strictSync holds the audio until the frames catch up: a short pause, never a still mouth.
        // ⚠️ NEITHER MODE STARTS THE VOICE BEFORE THE FIRST MOTION (AvatarKit 1.3.10 source, read 2026-10-27): no audio plays
        // until Spatius's first motion frames arrive, and the mode only matters once playback has started — `?face=fast`
        // (audioIndependent) changes what happens when motion runs late mid-reply, not how soon a reply starts.
        c.frameStarvationMode = faceFast() ? kit.FrameStarvationMode.audioIndependent : kit.FrameStarvationMode.strictSync
        c.onPlaybackStall = (stalled) => mark(stalled ? 'face: STALLED (motion late)' : 'face: resumed')
        c.onError = (e?: unknown) => { mark('face: error', String((e as { code?: string })?.code ?? e)); if (!l.gone) fallback.current() }
        c.onConnectionState = (s) => { mark(`face: ${s}`); if (s === kit.ConnectionState.failed && !l.gone) fallback.current() }
        c.onConversationState = (s) => {
          mark(`face: ${s}`, s === kit.ConversationState.playing ? latencyNote(c) : undefined)
          if (!l.gone) playing.current(s === kit.ConversationState.playing)
        }
        await new Promise<void>((resolve, reject) => {
          l.firstFrameTimer = setTimeout(() => reject(new Error('first_frame_timeout')), FIRST_FRAME_MS)
          v.onFirstRendering = () => { clearTimeout(l.firstFrameTimer); l.firstFrame = true; resolve() }
          // Taken down while it draws: this wait ends too (its view is released by settle once its init is over).
          l.stop.signal.addEventListener('abort', () => reject(new Error('taken_down')), { once: true })
        })
        if (l.gone) return
        mark('face: drawn')
        setDrawn(true)
        drawnOk()
        drawnCb.current()
      } catch (e) {
        mark('face: load failed', String((e as Error)?.message ?? e))
        l.failed = true
        drawnFail(e)
        if (!l.gone) fallback.current()
      }
    })()
    return () => {
      l.gone = true
      // A connect() waiting on this load ends now, and its token request with it (2026-10-26 review, codex + opus).
      l.fail(new Error('taken_down'))
      l.stop.abort()
      clearTimeout(l.firstFrameTimer)
      if (load.current === l) load.current = null
      if (ctl.current === l.controller) ctl.current = null
      // The websocket and the session's token go AT ONCE — a billed connection never outlives the face's place on screen…
      if (l.connecting) { try { l.controller?.close() } catch { /* closed */ } }
      if (l.token) void warmAvatarKit().then((kit) => kit.AvatarSDK.setSessionToken('')).catch(() => {})
      // …the view itself once its own init is over (settle says why).
      host.remove()
      settle(l)
      setDrawn(false)
    }
  }, [mode, face])

  if (mode === 'avatar') {
    return (
      <div className="relative h-full w-full">
        <div ref={box} className="absolute inset-0" />
        {!drawn && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Avatar name={name} url={photoUrl} size="2xl" className="animate-pulse" />
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className={cn('rounded-full p-2 ring-primary-foreground/20 transition-[box-shadow] duration-300 motion-reduce:transition-none', speaking ? 'ring-8' : 'ring-0')}>
        <Avatar name={name} url={photoUrl} size="2xl" className="size-40 text-3xl" />
      </span>
    </div>
  )
})
