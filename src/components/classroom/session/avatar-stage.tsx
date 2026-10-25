'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { pcm16Of } from './voice'

/**
 * The face on the session screen. Two looks behind one handle:
 *   · AVATAR (Spatius AvatarKit, Direct Mode) — loaded lazily here and nowhere else, so no other page ever carries its
 *     ~9 MB; the server mints the session token (api/classroom/sessions/<id>/token); any failure — an unsupported device,
 *     a refused token, the plan's concurrency cap, a dropped socket — calls `onFallback` and the page goes voice-only;
 *   · VOICE — the teacher's photo with a ring that breathes while the avatar speaks (the page plays the audio).
 * ⛔ AvatarKit receives the AVATAR's voice only, never the learner's (plan; the practice notice says so).
 */
export type StageHandle = {
  /** Avatar mode: hand a decoded line to AvatarKit (it plays it). False = not ready; the page plays it itself. */
  speak: (buffer: AudioBuffer) => boolean
  interrupt: () => void
  /**
   * Call from INSIDE a user gesture (the mic tap): starts AvatarKit's audio and its connection once the face has loaded.
   * Its own docs: `initializeAudioContext` "must be called in user gesture context" — iOS keeps audio started any later
   * silent (C3a review, Opus). A no-op before the face has loaded, after it started, or in voice mode.
   */
  unlock: () => void
}

/** How long the face may take to draw its first frame before the page gives up on it and stays voice-only. */
const FIRST_FRAME_MS = 20_000

type Kit = typeof import('@spatius/avatarkit')

export const AvatarStage = forwardRef<StageHandle, {
  mode: 'avatar' | 'voice'
  sessionId: string
  spatiusAvatarId: string | null
  photoUrl: string | null
  name: string
  speaking: boolean
  sampleRate: number
  onFallback: () => void
  onPlaying: (playing: boolean) => void
}>(function AvatarStage({ mode, sessionId, spatiusAvatarId, photoUrl, name, speaking, sampleRate, onFallback, onPlaying }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const ctl = useRef<InstanceType<Kit['AvatarView']>['controller'] | null>(null)
  /** The loaded face's controller, not yet started (it starts on the first gesture — `unlock`). */
  const pending = useRef<InstanceType<Kit['AvatarView']>['controller'] | null>(null)
  /** The current load's token: a chain from an earlier load (cleaned up) never adopts its controller. */
  const run = useRef<object | null>(null)
  const [ready, setReady] = useState(false)
  const fallback = useRef(onFallback)
  fallback.current = onFallback
  const playing = useRef(onPlaying)
  playing.current = onPlaying

  useImperativeHandle(ref, () => ({
    speak: (buffer) => {
      if (mode !== 'avatar' || !ready || !ctl.current) return false
      try {
        ctl.current.send(pcm16Of(buffer), true)
        return true
      } catch {
        return false
      }
    },
    interrupt: () => { try { ctl.current?.interrupt() } catch { /* nothing playing */ } },
    unlock: () => {
      const c = pending.current
      const mine = run.current
      if (mode !== 'avatar' || !c || !mine) return
      pending.current = null
      const live = () => run.current === mine
      // initializeAudioContext is CALLED here, synchronously inside the gesture; what follows may finish later.
      c.initializeAudioContext()
        .then(() => (live() ? c.start() : undefined))
        .then(() => {
          if (!live()) { try { c.close() } catch { /* closed */ } return }
          ctl.current = c
          setReady(true)
        })
        .catch(() => { if (live()) fallback.current() })
    },
  }), [mode, ready])

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
    ;(async () => {
      try {
        const kit = await import('@spatius/avatarkit')
        if (disposed) return
        if (!(await kit.AvatarSDK.isDeviceSupported())) throw new Error('unsupported_device')
        if (disposed) return
        const tok = await fetch(`/api/classroom/sessions/${sessionId}/token`, { method: 'POST' })
        if (!tok.ok) throw new Error(`token_${tok.status}`)
        const { token, appId, region } = (await tok.json()) as { token: string; appId: string; region: string }
        if (disposed) return
        if (!kit.AvatarSDK.appId) await kit.AvatarSDK.initialize(appId, { region, drivingServiceMode: kit.DrivingServiceMode.direct, logLevel: kit.LogLevel.error })
        kit.AvatarSDK.setSessionToken(token)
        const avatar = await kit.AvatarManager.shared.load(spatiusAvatarId, undefined, true)
        if (disposed || !box.current) return
        const v = new kit.AvatarView(avatar, box.current, { audioFormat: { channelCount: 1, sampleRate } })
        view = v
        const c = v.controller
        c.onError = () => { if (!disposed) fallback.current() }
        c.onConnectionState = (s) => { if (s === kit.ConnectionState.failed && !disposed) fallback.current() }
        c.onConversationState = (s) => playing.current(s === kit.ConversationState.playing)
        // A face that never draws its first frame must not hold the page: voice-only after FIRST_FRAME_MS.
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('first_frame_timeout')), FIRST_FRAME_MS)
          v.onFirstRendering = () => { clearTimeout(t); resolve() }
        })
        if (disposed) { try { v.dispose() } catch { /* disposed */ } return }
        // Loaded; the audio and the connection start on the learner's next tap (`unlock`).
        pending.current = c
      } catch {
        if (!disposed) fallback.current()
      }
    })()
    return () => {
      disposed = true
      if (run.current === mine) run.current = null
      pending.current = null
      try { ctl.current?.close() } catch { /* closed */ }
      try { view?.dispose() } catch { /* disposed */ }
      ctl.current = null
      setReady(false)
    }
  }, [mode, sessionId, spatiusAvatarId, sampleRate])

  if (mode === 'avatar') {
    return (
      <div className="relative h-full w-full">
        <div ref={box} className="absolute inset-0" />
        {!ready && (
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
