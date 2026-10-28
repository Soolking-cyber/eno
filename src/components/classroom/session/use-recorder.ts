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

/**
 * The microphone as the browser REPORTS it — no guessing from the sound (commit review, rounds 1–3: every silence heuristic
 * had a quiet room it misread). 'paused': the phone muted it (a call, Siri), its track ended, or the audio is interrupted or
 * suspended; 'lost': a fresh microphone was REFUSED (permission off, no device). Neither ends anything: the page says so and
 * offers "turn it back on" — a tap, the gesture iOS may need, and the ONE way it is taken again (no automatic retake: a hidden
 * page or a permission prompt made those fail in ways the learner could not see). (Owner, 2026-10-28, "fix both": a
 * microphone that ended or was muted mid-session left "Listening" up to the deadline.)
 */
export type MicState = 'on' | 'paused' | 'lost'

/** How long taking the microphone again may take, all of it (a permission prompt counts), before it is given up for now. */
const REACQUIRE_MS = 10_000
/** A getUserMedia failure that a retry cannot fix: the browser said no, or there is no microphone. */
const REFUSALS = new Set(['NotAllowedError', 'NotFoundError', 'SecurityError', 'OverconstrainedError'])

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
  /** The microphone's state changed (MicState) — reported on a change only. */
  mic?: (state: MicState) => void
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
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  /** Why the microphone is paused now ('muted', 'ended', 'context', 'taking') — none: on. */
  const pausedFor = useRef(new Set<string>())
  const lost = useRef(false)
  const reported = useRef<MicState>('on')
  /** The one taking-again under way (single-flight: a second tap meanwhile waits for it — plan review, opus). */
  const taking = useRef<Promise<boolean> | null>(null)
  /** What prepare() set up beside the graph, undone by release(): the context's state listener. */
  const undo = useRef<(() => void)[]>([])

  const report = useCallback(() => {
    const next: MicState = lost.current ? 'lost' : pausedFor.current.size ? 'paused' : 'on'
    if (next === reported.current) return
    reported.current = next
    mark(`mic: ${next}`, [...pausedFor.current].join(' '))
    handlers.current.mic?.(next)
  }, [])
  const pause = useCallback((why: string) => { if (!pausedFor.current.has(why)) { pausedFor.current.add(why); report() } }, [report])
  const unpause = useCallback((why: string) => { if (pausedFor.current.delete(why)) report() }, [report])

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
    await ctx.audioWorklet.addModule('/classroom/recorder-worklet.js?v=2')
    if (stale(stream)) { streamRef.current = null; throw new Error('released') }
    const source = ctx.createMediaStreamSource(stream)
    sourceRef.current = source
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
    // The audio interrupted under us (iOS: a call; a suspended context): paused, and resumed as soon as it can be.
    const onState = () => {
      if (mine !== gen.current) return
      const state = ctx.state as string
      if (state === 'running') unpause('context')
      else if (state === 'suspended' || state === 'interrupted') { pause('context'); void ctx.resume().catch(() => {}) }
    }
    ctx.addEventListener('statechange', onState)
    undo.current.push(() => ctx.removeEventListener('statechange', onState))
    // …and the state the microphone is in NOW (commit review, codex): a context already suspended, a track that came muted or
    // ended while the graph was being built — none of them fires an event to say so.
    onState()
    noteTracks(stream)
  }, [take, pause, unpause])

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
    for (const u of undo.current.splice(0)) u()
    sourceRef.current?.disconnect()
    sourceRef.current = null
    nodeRef.current?.disconnect()
    nodeRef.current = null
    // The ref first: a track's handlers check it, so nothing that stops here is taken for the microphone going away.
    const old = streamRef.current
    streamRef.current = null
    old?.getTracks().forEach((t) => { t.onmute = null; t.onunmute = null; t.onended = null; t.stop() })
    taking.current = null
    pausedFor.current.clear()
    lost.current = false
    // The page is told too: a next prepare() on this same hook starts from 'on', and a stale "stopped" must not outlive it
    // (commit review, codex + opus).
    if (reported.current !== 'on') { reported.current = 'on'; handlers.current.mic?.('on') }
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

  /**
   * Take the microphone AGAIN — a fresh getUserMedia, a new source into the SAME worklet (the old one disconnected and its
   * tracks stopped). Only from the page's tap (resume). One at a time; ⛔ BOUNDED WHOLE (commit review, codex): it waits on
   * getUserMedia for REACQUIRE_MS at most and never on the context's resume — a grant that comes later is stopped, and the
   * microphone stays paused (another tap tries again). A REFUSAL (REFUSALS) is 'lost'. Never after release().
   */
  function takeAgain(): Promise<boolean> {
    if (taking.current) return taking.current
    const ctx = ctxRef.current
    const node = nodeRef.current
    if (!ctx || !node) return Promise.resolve(false)
    const mine = gen.current
    pause('taking')
    let refused = false
    const asked = navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false }).catch((e: unknown) => {
      refused = REFUSALS.has((e as { name?: string } | null)?.name ?? '')
      return null
    })
    const attempt = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), REACQUIRE_MS) })
      const got = await Promise.race([asked, late])
      clearTimeout(timer)
      if (got === 'late') { void asked.then((st) => st?.getTracks().forEach((t) => t.stop())); return false }
      if (!got) return false
      if (mine !== gen.current || nodeRef.current !== node) { got.getTracks().forEach((t) => t.stop()); return false }
      // The new source is built BEFORE the old one is let go (commit review, codex): a graph that throws here leaves the old
      // microphone as it was, and the new one stopped.
      let source: MediaStreamAudioSourceNode
      try {
        source = ctx.createMediaStreamSource(got)
        source.connect(node)
      } catch {
        got.getTracks().forEach((t) => t.stop())
        return false
      }
      const old = streamRef.current
      streamRef.current = got
      old?.getTracks().forEach((t) => { t.onmute = null; t.onunmute = null; t.onended = null; t.stop() })
      sourceRef.current?.disconnect()
      sourceRef.current = source
      // Resumed, never awaited: an interruption still under way must not hold the attempt (the context's own listener
      // says when the sound is back).
      if (ctx.state !== 'running') void ctx.resume().catch(() => {})
      return true
    })()
    taking.current = attempt
    // Never a rejection left behind, and never a jammed retry (commit review, codex): whatever happened, the next tap asks again.
    void attempt.catch(() => false).then((ok) => {
      if (mine !== gen.current) return
      taking.current = null
      if (ok) {
        pausedFor.current.delete('ended')
        pausedFor.current.delete('muted')
        lost.current = false
        // The fresh track as it IS (a track that came muted or ended fires no event to say so — commit review, codex).
        noteTracks(streamRef.current)
        mark('mic: taken again')
      } else if (refused && !works(streamRef.current)) {
        // Refused — unless the microphone we kept came back meanwhile (it unmuted while the ask waited: commit review, codex).
        lost.current = true
        mark('mic: refused')
      } else {
        mark('mic: not back yet')
      }
      unpause('taking')
      report()
    })
    return attempt
  }

  /** A stream that can be heard: a live, unmuted track, and no 'ended' waiting on it. */
  function works(stream: MediaStream | null): boolean {
    return !!stream && !pausedFor.current.has('ended') && stream.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted)
  }

  /** The CURRENT stream's tracks: watched from now on (muted, back, ended), and their state read now. */
  function noteTracks(stream: MediaStream | null) {
    if (!stream) return
    for (const t of stream.getAudioTracks()) {
      t.onmute = () => { if (streamRef.current === stream) pause('muted') }
      // Unmuted: this microphone works again — whatever a refused fresh one said (commit review, codex).
      t.onunmute = () => { if (streamRef.current === stream) { lost.current = false; pausedFor.current.delete('muted'); report() } }
      t.onended = () => { if (streamRef.current === stream) { mark('mic: ended'); pause('ended') } }
      if (t.muted) pause('muted')
      if (t.readyState === 'ended') pause('ended')
    }
  }

  /**
   * The page's "turn it back on" (a tap — the gesture iOS may need): a microphone that ended, was muted or was refused is
   * taken again (fresh), and a suspended or interrupted context resumed — so the tap always does something (commit review,
   * codex). A working track under a mere interruption is kept.
   */
  const resume = useCallback(async (): Promise<void> => {
    const ctx = ctxRef.current
    if (!ctx) return
    // ⛔ The context first, IN the tap — before any await (commit review, codex): a browser that needs the gesture to resume
    // audio no longer has it once getUserMedia has been awaited.
    const resumed = ctx.state !== 'running' ? ctx.resume().catch(() => {}) : null
    const why = pausedFor.current
    if (lost.current || why.has('ended') || why.has('muted')) await takeAgain().catch(() => false)
    await resumed
  }, []) // takeAgain reads refs only

  return { prepare, listen, stream, keepLast, unlisten, take, release, resume }
}
