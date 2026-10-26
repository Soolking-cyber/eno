'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { pcm16Of, resamplePcm16 } from './voice'
import { mark } from './trace'

/**
 * The face on the session screen. Two looks behind one handle:
 *   · AVATAR (Spatius AvatarKit, Direct Mode) — loaded lazily here and nowhere else, so no other page ever carries its
 *     ~9 MB; the server mints the session token (api/classroom/sessions/<id>/token); any failure — an unsupported device,
 *     a refused token, the plan's concurrency cap, a dropped socket — calls `onFallback` and the page goes voice-only;
 *   · VOICE — the teacher's photo with a ring that breathes while the avatar speaks (the page plays the audio).
 * ⛔ AvatarKit receives the AVATAR's voice only, never the learner's (plan; the practice notice says so).
 */
export type StageHandle = {
  /**
   * Avatar mode: hand one decoded PART of a reply to AvatarKit — `last` closes the reply. Parts stream in as the server
   * makes them, so the face starts on the first sentence. False = not started; the page plays it itself.
   */
  speakPart: (buffer: AudioBuffer, last: boolean) => boolean
  /** The same for raw PCM16 already at FACE_RATE — the voice server's frames, streamed. */
  speakPcm: (pcm: Int16Array, last: boolean) => boolean
  interrupt: () => void
  /**
   * Start AvatarKit's audio and its connection once the face has drawn. Resolves true when replies go to the face.
   * Its docs want `initializeAudioContext` inside a user gesture — Chrome and Android carry the Start tap's activation
   * to here; iOS may not, and then the page shows one "Tap to start" and calls this again from that tap.
   */
  unlock: () => Promise<boolean>
}

/**
 * THE FACE'S AUDIO RATE: the voice server's own 24 kHz (measured 2026-10-26: the face only starts moving when Spatius's
 * server sends back its first motion frames, so every byte up to it counts). It was the page's 48 kHz — the 24 kHz voice
 * upsampled, twice the bytes for nothing — sent as raw PCM; now 24 kHz, compressed to Opus on the way up (~1/8 the bytes;
 * the SDK's `opusUplinkEnabled`). Spatius supports 8–48 kHz.
 */
export const FACE_RATE = 24_000

/** `?face=fast` on the page: the face's audio does not wait for its motion (owner testing — see frameStarvationMode). */
function faceFast(): boolean {
  try { return new URLSearchParams(window.location.search).get('face') === 'fast' } catch { return false }
}

/** How long the face may take to draw its first frame before the page gives up on it and stays voice-only. */
const FIRST_FRAME_MS = 20_000
/**
 * …and its WHOLE load — the token, the ~9 MB SDK, the avatar's assets, then that first frame (2026-10-26 review round 2,
 * opus: only the last step had a timer, so a stalled download on 3G never gave up). The conversation no longer waits for
 * the face (it starts in voice), so this only stops it trying.
 */
const LOAD_MS = 45_000

type Kit = typeof import('@spatius/avatarkit')

/**
 * The SDK, imported once per page and early: the screen calls this while it shows its intro, so by the Start tap the
 * ~9 MB is in memory. ⛔ NOT `AvatarSDK.isDeviceSupported()`: its own docs say it runs a ~2 s benchmark (16 s measured
 * on a loaded machine, 2026-10-26) and then returns true whenever WebGL2 or WebGPU exists — "the score thresholds are
 * not yet enforced". The same answer, from the same two checks, costs a millisecond here.
 */
let kitPromise: Promise<Kit> | null = null
export function warmAvatarKit(): Promise<Kit> {
  kitPromise ??= import('@spatius/avatarkit')
  return kitPromise
}
function canDrawAvatar(): boolean {
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) return true
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export const AvatarStage = forwardRef<StageHandle, {
  mode: 'avatar' | 'voice'
  sessionId: string
  spatiusAvatarId: string | null
  photoUrl: string | null
  name: string
  speaking: boolean
  sampleRate: number
  /** The face has drawn its first frame (avatar mode) — the page may start it (`unlock`). */
  onReady: () => void
  onFallback: () => void
  onPlaying: (playing: boolean) => void
}>(function AvatarStage({ mode, sessionId, spatiusAvatarId, photoUrl, name, speaking, sampleRate, onReady, onFallback, onPlaying }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const ctl = useRef<InstanceType<Kit['AvatarView']>['controller'] | null>(null)
  /** The loaded face's controller, not yet started (`unlock` starts it). */
  const pending = useRef<InstanceType<Kit['AvatarView']>['controller'] | null>(null)
  /** The current load's token: a chain from an earlier load (cleaned up) never adopts its controller. */
  const run = useRef<object | null>(null)
  const [drawn, setDrawn] = useState(false)
  const fallback = useRef(onFallback)
  fallback.current = onFallback
  const ready = useRef(onReady)
  ready.current = onReady
  const playing = useRef(onPlaying)
  playing.current = onPlaying

  useImperativeHandle(ref, () => ({
    speakPart: (buffer, last) => {
      if (mode !== 'avatar' || !ctl.current) return false
      try {
        const pcm = new Int16Array(pcm16Of(buffer))
        ctl.current.send(resamplePcm16(pcm, buffer.sampleRate, FACE_RATE).slice().buffer, last)
        mark(last ? 'face: last part sent' : 'face: part sent', `${buffer.duration.toFixed(1)}s`)
        return true
      } catch {
        return false
      }
    },
    speakPcm: (pcm, last) => {
      if (mode !== 'avatar' || !ctl.current) return false
      try {
        // An exact ArrayBuffer of these samples (a view may sit in a larger buffer).
        ctl.current.send(pcm.slice().buffer, last)
        if (last) mark('face: last frames sent')
        return true
      } catch {
        return false
      }
    },
    interrupt: () => { try { ctl.current?.interrupt() } catch { /* nothing playing */ } },
    unlock: async () => {
      if (ctl.current) return true
      const c = pending.current
      const mine = run.current
      if (mode !== 'avatar' || !c || !mine) return false
      const live = () => run.current === mine
      try {
        // initializeAudioContext is CALLED synchronously here — inside the gesture when there is one.
        await c.initializeAudioContext()
        if (!live()) return false
        await c.start()
        if (!live()) { try { c.close() } catch { /* closed */ } return false }
        pending.current = null
        ctl.current = c
        mark('face: started')
        return true
      } catch {
        mark('face: start failed')
        return false
      }
    },
  }), [mode])

  useEffect(() => {
    if (mode !== 'avatar' || !spatiusAvatarId || !box.current) return
    let disposed = false
    const mine = {}
    run.current = mine
    let view: InstanceType<Kit['AvatarView']> | null = null
    /**
     * ⛔ EVERY AWAIT CAN OUTLIVE THIS EFFECT (C3a review, codex + Opus): the screen can close while the SDK loads, the
     * token is minted or the first frame is drawn. Each step checks `disposed`, and a view made after the cleanup ran is
     * disposed right here — the cleanup below has already passed and would never see it (an open socket holds one of
     * the plan's concurrent sessions).
     */
    const deadline = setTimeout(() => {
      if (disposed || pending.current || ctl.current) return
      mark('face: load failed', 'load_timeout')
      fallback.current()
    }, LOAD_MS)
    ;(async () => {
      try {
        mark('face: load')
        if (!canDrawAvatar()) throw new Error('unsupported_device')
        const [kit, tok] = await Promise.all([
          warmAvatarKit(),
          fetch(`/api/classroom/sessions/${sessionId}/token`, { method: 'POST' }),
        ])
        if (disposed) return
        if (!tok.ok) throw new Error(`token_${tok.status}`)
        const { token, appId, region } = (await tok.json()) as { token: string; appId: string; region: string }
        if (disposed) return
        mark('face: token')
        if (!kit.AvatarSDK.appId) await kit.AvatarSDK.initialize(appId, { region, drivingServiceMode: kit.DrivingServiceMode.direct, logLevel: kit.LogLevel.error })
        kit.AvatarSDK.setSessionToken(token)
        const avatar = await kit.AvatarManager.shared.load(spatiusAvatarId, undefined, true)
        if (disposed || !box.current) return
        mark('face: assets')
        const v = new kit.AvatarView(avatar, box.current, { audioFormat: { channelCount: 1, sampleRate: FACE_RATE, opusUplinkEnabled: true } })
        view = v
        const c = v.controller
        // ⛔ STRICT SYNC (owner, 2026-10-26: "i cannot see live avatar" — the lips stood still). The SDK's default
        // (`audioIndependent`) keeps the AUDIO playing when the face's motion frames run late, so a slow frame stream is a
        // talking photo. strictSync holds the audio until the frames catch up: a short pause, never a still mouth.
        // ⚠️ `?face=fast` (owner testing, 2026-10-26): the voice starts at once and the lips catch up when Spatius's first
        // motion frames arrive (~1.3 s measured) — against strictSync's pause before the voice. The owner judges which feels
        // better; the default stays strictSync until then.
        c.frameStarvationMode = faceFast() ? kit.FrameStarvationMode.audioIndependent : kit.FrameStarvationMode.strictSync
        c.onPlaybackStall = (stalled) => mark(stalled ? 'face: STALLED (motion late)' : 'face: resumed')
        c.onError = (e?: unknown) => { mark('face: error', String((e as { code?: string })?.code ?? e)); if (!disposed) fallback.current() }
        c.onConnectionState = (s) => { mark(`face: ${s}`); if (s === kit.ConnectionState.failed && !disposed) fallback.current() }
        c.onConversationState = (s) => { mark(`face: ${s}`); playing.current(s === kit.ConversationState.playing) }
        // A face that never draws its first frame must not hold the page: voice-only after FIRST_FRAME_MS.
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('first_frame_timeout')), FIRST_FRAME_MS)
          v.onFirstRendering = () => { clearTimeout(t); resolve() }
        })
        if (disposed) { try { v.dispose() } catch { /* disposed */ } return }
        mark('face: drawn')
        pending.current = c
        setDrawn(true)
        ready.current()
      } catch (e) {
        mark('face: load failed', String((e as Error)?.message ?? e))
        if (!disposed) fallback.current()
      }
    })()
    return () => {
      disposed = true
      clearTimeout(deadline)
      if (run.current === mine) run.current = null
      pending.current = null
      try { ctl.current?.close() } catch { /* closed */ }
      try { view?.dispose() } catch { /* disposed */ }
      ctl.current = null
      setDrawn(false)
    }
  }, [mode, sessionId, spatiusAvatarId, sampleRate])

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
