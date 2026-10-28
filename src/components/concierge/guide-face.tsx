'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { mark } from '@/components/classroom/session/trace'
import type { StageHandle } from '@/components/classroom/session/avatar-stage'
import type { GuideFaceConfig } from '@/lib/concierge/guide-assets'
import type { Guide } from './talking-guide'

/**
 * THE GUIDE'S FACE IN THE CONCIERGE WINDOW — the 3D guide (talking-guide.ts: TalkingHead + HeadAudio, drawn in this
 * browser) behind the classroom stage's handle, so the window's turn-taking is unchanged (concierge-frame.tsx). Two looks:
 *   · AVATAR — drawn before Start (the model downloads and draws while the intro is up; nothing is billed), then `prime`
 *     unlocks its audio inside the Start tap and `connect` opens its stream. The face PLAYS the guide's voice itself.
 *   · VOICE — the guide's still portrait, with a ring that breathes while the guide speaks (the window plays the audio):
 *     the device cannot draw it (no WebGL2, no AudioWorklet), the model failed, or the GPU took the context back.
 * Any failure calls `onFallback` once; the window goes voice-only and never comes back to the face for that window.
 */
export type GuideHandle = Omit<StageHandle, 'connect'> & {
  /** The drawn face takes this session's voice: its stream opens. False = voice-only (`onFallback` has been called). */
  connect: () => Promise<boolean>
}

export const GuideFace = forwardRef<GuideHandle, {
  mode: 'avatar' | 'voice'
  face: GuideFaceConfig | null
  name: string
  speaking: boolean
  /** The face has drawn: the window may offer Start. */
  onDrawn: () => void
  onFallback: () => void
  /** The face's own sound started (true) or played out (false) — the window's turn-taking listens to both. */
  onPlaying: (playing: boolean) => void
}>(function GuideFace({ mode, face, name, speaking, onDrawn, onFallback, onPlaying }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const guide = useRef<Guide | null>(null)
  /** The stream is open: replies go to the face. */
  const live = useRef(false)
  const [drawn, setDrawn] = useState(false)
  const cbs = useRef({ onDrawn, onFallback, onPlaying })
  cbs.current = { onDrawn, onFallback, onPlaying }
  const failed = useRef(false)
  const drainTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fail = (why: string) => {
    if (failed.current) return
    failed.current = true
    mark(`face: ${why}`)
    live.current = false
    if (drainTimer.current) { clearTimeout(drainTimer.current); drainTimer.current = null }
    const g = guide.current
    guide.current = null
    g?.dispose()
    cbs.current.onFallback()
  }
  const failRef = useRef(fail)
  failRef.current = fail

  const modelUrl = face?.model ?? null
  useEffect(() => {
    if (mode !== 'avatar' || !modelUrl || failed.current) return
    const el = box.current
    if (!el) return
    let gone = false
    let made: Guide | null = null
    const stop = new AbortController()
    mark('face: drawing')
    void import('./talking-guide')
      .then(({ createGuide }) => createGuide(el, modelUrl, (why) => { if (!gone) failRef.current(why) }, stop.signal))
      .then((g) => {
        if (gone) { g.dispose(); return }
        made = g
        guide.current = g
        setDrawn(true)
        mark('face: drawn')
        cbs.current.onDrawn()
      })
      .catch((e: unknown) => { if (!gone) failRef.current(e instanceof Error ? e.message : 'load failed') })
    return () => {
      gone = true
      stop.abort()
      live.current = false
      if (drainTimer.current) clearTimeout(drainTimer.current)
      if (guide.current === made) guide.current = null
      made?.dispose()
    }
  }, [mode, modelUrl])

  useImperativeHandle(ref, () => ({
    prime: () => {
      const g = guide.current
      if (!g) return false
      g.stream.unlock()
      return true
    },
    connect: async () => {
      const g = guide.current
      if (!g) return false
      try {
        await g.stream.open(
          () => {
            if (drainTimer.current) { clearTimeout(drainTimer.current); drainTimer.current = null }
            cbs.current.onPlaying(true)
          },
          // Drained = the worklet's queue is empty; the ears still have the lip delay to go.
          () => {
            if (drainTimer.current) clearTimeout(drainTimer.current)
            drainTimer.current = setTimeout(() => { drainTimer.current = null; cbs.current.onPlaying(false) }, 130)
          },
        )
      } catch (e) {
        failRef.current(e instanceof Error ? e.message : 'stream failed')
        return false
      }
      if (guide.current !== g) return false
      live.current = true
      return true
    },
    speakPcm: (pcm, last) => {
      const g = guide.current
      if (!g || !live.current) return false
      g.stream.pushPcm(pcm, FACE_PCM_RATE)
      if (last) g.stream.endTurn()
      return true
    },
    speakPart: (buffer, last) => {
      const g = guide.current
      if (!g || !live.current) return false
      g.stream.pushPcm(pcm16OfBuffer(buffer), buffer.sampleRate)
      if (last) g.stream.endTurn()
      return true
    },
    interrupt: () => {
      if (drainTimer.current) { clearTimeout(drainTimer.current); drainTimer.current = null }
      guide.current?.stream.interrupt()
    },
  }), [])

  const portrait = face?.portrait ?? null
  if (mode === 'avatar') {
    return (
      <div className="relative h-full w-full">
        <div ref={box} className="absolute inset-0" />
        {!drawn && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Avatar name={name} url={portrait} size="lg" className="animate-pulse" />
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className={cn('rounded-full p-2 ring-primary-foreground/20 transition-[box-shadow] duration-300 motion-reduce:transition-none', speaking ? 'ring-8' : 'ring-0')}>
        <Avatar name={name} url={portrait} size="lg" />
      </span>
    </div>
  )
})

/** The rate the window gives `speakPcm` (concierge-frame.tsx resamples the voice server's frames to it). */
export const FACE_PCM_RATE = 24_000

/** A decoded line (the opening) as PCM16 mono at its own rate — the face's stream takes PCM. */
function pcm16OfBuffer(buffer: AudioBuffer): Int16Array {
  const ch = buffer.getChannelData(0)
  const out = new Int16Array(ch.length)
  for (let i = 0; i < ch.length; i++) {
    const s = Math.max(-1, Math.min(1, ch[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
