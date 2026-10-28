'use client'

import { useCallback, useEffect, useRef } from 'react'
import { AUDIO_CONSTRAINTS } from '@/lib/calls/client/media'
import { encodeWav, toPcm16k } from '@/lib/classroom/wav'
import { LIMITS } from '@/lib/classroom/constants'
import { mark } from './trace'

/**
 * How the learner's turn is heard (public/classroom/recorder-worklet.js does the detecting, on the audio thread).
 * `endMs` — the silence that ends a turn. Learners stop to find a word, so it is long, and longer for children: cut a
 * learner off mid-sentence and the tutor answers half a thought (Praktika's commonest complaint).
 * `barge` — the avatar is talking: only clearly louder, longer speech counts, so the avatar's own voice from the
 * speaker (echo cancellation removes most of it) never interrupts the avatar.
 */
export type Listening = { endMs: number; barge: boolean }

const VAD = {
  normal: { minLevel: 0.012, startRatio: 3, endRatio: 2, startMs: 120, preRollMs: 350 },
  barge: { minLevel: 0.035, startRatio: 5, endRatio: 2, startMs: 320, preRollMs: 350 },
}

/**
 * The learner's microphone for the whole session (one permission prompt). HANDS-FREE: `listen()` arms the detector; when
 * the learner starts speaking the turn records by itself (`onSpeechStart`), and when they stop (`onSpeechEnd`) the page
 * takes the turn with `take()` — a 16 kHz mono WAV in memory. ⛔ Nothing is written anywhere: the WAV goes to the turn
 * route and is dropped there (plan: "Student audio is never stored"). A turn auto-stops at LIMITS.turnSeconds.
 */
export function useRecorder(on: {
  speechStart: () => void
  speechEnd: () => void
  autoStop: (wav: Uint8Array) => void
  /** Every frame of the turn as it is recorded — its pre-roll first — at the context's rate (live listening streams them). */
  frames?: (frame: Float32Array) => void
}) {
  const ctxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunks = useRef<Float32Array[]>([])
  /** STREAM mode (live listening): every frame is recorded, no detector — only the last LIMITS.turnSeconds are kept. */
  const streaming = useRef(false)
  const kept = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlers = useRef(on)
  handlers.current = on
  /** Bumped by release(): a prepare() still waiting on the permission prompt then stops what it was granted. */
  const gen = useRef(0)

  const take = useCallback((): Uint8Array => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    nodeRef.current?.port.postMessage('stop')
    const total = chunks.current.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let at = 0
    for (const c of chunks.current) { all.set(c, at); at += c.length }
    chunks.current = []
    kept.current = 0
    streaming.current = false
    return encodeWav(toPcm16k(all, ctxRef.current?.sampleRate ?? 48_000))
  }, [])

  /** Ask for the microphone and wire the worklet — on the Start tap (a user gesture, which iOS needs for audio). */
  const prepare = useCallback(async (ctx: AudioContext) => {
    if (nodeRef.current) return
    const mine = gen.current
    /**
     * ⛔ THE SCREEN CAN CLOSE WHILE THE PERMISSION PROMPT IS UP (C3a round 2, codex): a stream granted after release()
     * ran would stay live with nothing left to stop it — the mic indicator on, the page gone. Checked after each await.
     */
    const stale = (stream: MediaStream) => {
      if (mine === gen.current) return false
      stream.getTracks().forEach((t) => t.stop())
      return true
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false })
    if (stale(stream)) throw new Error('released')
    streamRef.current = stream
    // The microphone taken away under us (iOS: a call, Siri, another app) — in the trace, where a "can't hear me" starts.
    for (const t of stream.getAudioTracks()) {
      t.onmute = () => mark('mic: muted by the system')
      t.onunmute = () => mark('mic: back')
      t.onended = () => mark('mic: ended')
    }
    await ctx.audioWorklet.addModule('/classroom/recorder-worklet.js?v=2')
    if (stale(stream)) { streamRef.current = null; throw new Error('released') }
    const source = ctx.createMediaStreamSource(stream)
    // One output, wired to the speakers: WebKit only runs a node whose output reaches the destination (C3a round 2, Opus —
    // a node with no outputs may never be processed there, every turn an empty WAV). The worklet never writes its
    // outputs, so the learner hears nothing of themselves.
    const node = new AudioWorkletNode(ctx, 'classroom-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    node.port.onmessage = (e: MessageEvent<Float32Array | { type: string; preRoll?: Float32Array[] }>) => {
      const d = e.data
      if (d instanceof Float32Array) {
        chunks.current.push(d)
        // STREAM mode keeps the last LIMITS.turnSeconds only (the drill's clip, or the turn when the live socket breaks).
        if (streaming.current) {
          kept.current += d.length
          // A margin past the turn's cap: the cap starts when Soniox first hears words, a moment after they began.
          const cap = (LIMITS.turnSeconds + 5) * (ctxRef.current?.sampleRate ?? 48_000)
          while (kept.current > cap && chunks.current.length > 1) kept.current -= chunks.current.shift()!.length
        }
        handlers.current.frames?.(d)
        return
      }
      if (d.type === 'speech-start') {
        chunks.current = [...(d.preRoll ?? [])]
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => handlers.current.autoStop(take()), LIMITS.turnSeconds * 1000)
        handlers.current.speechStart()
        // The pre-roll AFTER speechStart: a live stream opens its utterance there, then gets the turn's first sound.
        for (const f of d.preRoll ?? []) handlers.current.frames?.(f)
      } else if (d.type === 'speech-end') {
        handlers.current.speechEnd()
      }
    }
    source.connect(node)
    node.connect(ctx.destination)
    ctxRef.current = ctx
    nodeRef.current = node
  }, [take])

  /** Arm the detector (or re-arm it with other tuning). */
  const listen = useCallback((l: Listening) => {
    // From STREAM mode (live listening broke, or the avatar talks): recording stops until the detector hears a start —
    // it would otherwise grow without its cap (review, opus).
    if (streaming.current) {
      streaming.current = false
      nodeRef.current?.port.postMessage('stop')
      chunks.current = []
      kept.current = 0
    }
    nodeRef.current?.port.postMessage({ type: 'vad', vad: { ...(l.barge ? VAD.barge : VAD.normal), endMs: l.endMs } })
  }, [])

  /**
   * LIVE LISTENING (owner, 2026-10-27: "let the stt decide itself"): no detector — every frame from here on reaches the
   * page (which streams it to Soniox), and nothing ends the turn here. A talk-over's held pre-roll is not kept in the
   * recording (it still reaches the page as frames, right after the speech-start).
   */
  const stream = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    chunks.current = []
    kept.current = 0
    streaming.current = true
    nodeRef.current?.port.postMessage({ type: 'vad-off' })
    nodeRef.current?.port.postMessage('start')
  }, [])

  /** Disarm: nothing is detected or recorded (muted, or the avatar is thinking). A turn in progress is dropped. */
  const unlisten = useCallback(() => {
    streaming.current = false
    nodeRef.current?.port.postMessage({ type: 'vad-off' })
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    nodeRef.current?.port.postMessage('stop')
    chunks.current = []
    kept.current = 0
  }, [])

  const release = useCallback(() => {
    gen.current += 1
    if (timer.current) clearTimeout(timer.current)
    nodeRef.current?.disconnect()
    nodeRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunks.current = []
    kept.current = 0
    streaming.current = false
  }, [])

  useEffect(() => release, [release])
  /**
   * STREAM mode: keep only the last `ms` of the recording — called when Soniox first hears the learner, so the turn's clip
   * (a drill's, or the fallback's) starts just before their words, not with the avatar's tail, the silence or an "um"
   * (review, opus).
   */
  const keepLast = useCallback((ms: number) => {
    if (!streaming.current) return
    const keep = (ms / 1000) * (ctxRef.current?.sampleRate ?? 48_000)
    while (kept.current > keep && chunks.current.length > 1) kept.current -= chunks.current.shift()!.length
  }, [])

  return { prepare, listen, stream, keepLast, unlisten, take, release }
}
