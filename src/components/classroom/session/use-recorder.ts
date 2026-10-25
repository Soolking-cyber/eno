'use client'

import { useCallback, useEffect, useRef } from 'react'
import { AUDIO_CONSTRAINTS } from '@/lib/calls/client/media'
import { encodeWav, toPcm16k } from '@/lib/classroom/wav'
import { LIMITS } from '@/lib/classroom/constants'

/**
 * The learner's turn recorder: one microphone for the whole session (one permission prompt), captured only between
 * start() and stop(), handed back as a 16 kHz mono WAV in memory. ⛔ Nothing is written anywhere — the WAV goes to the turn
 * route and is dropped there after scoring (plan: "Student audio is never stored").
 * Auto-stops at LIMITS.turnSeconds; `onAutoStop` gets that WAV.
 */
export function useRecorder(onAutoStop: (wav: Uint8Array) => void) {
  const ctxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunks = useRef<Float32Array[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoStop = useRef(onAutoStop)
  autoStop.current = onAutoStop
  /** Bumped by release(): a prepare() still waiting on the permission prompt then stops what it was granted. */
  const gen = useRef(0)

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
    await ctx.audioWorklet.addModule('/classroom/recorder-worklet.js')
    if (stale(stream)) { streamRef.current = null; throw new Error('released') }
    const source = ctx.createMediaStreamSource(stream)
    // One output, wired to the speakers: WebKit only runs a node whose output reaches the destination (C3a round 2, Opus —
    // a node with no outputs may never be processed there, every turn an empty WAV). The worklet never writes its
    // outputs, so the learner hears nothing of themselves.
    const node = new AudioWorkletNode(ctx, 'classroom-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    node.port.onmessage = (e: MessageEvent<Float32Array>) => { chunks.current.push(e.data) }
    source.connect(node)
    node.connect(ctx.destination)
    ctxRef.current = ctx
    nodeRef.current = node
  }, [])

  const finish = useCallback((): Uint8Array => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    nodeRef.current?.port.postMessage('stop')
    const total = chunks.current.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let at = 0
    for (const c of chunks.current) { all.set(c, at); at += c.length }
    chunks.current = []
    return encodeWav(toPcm16k(all, ctxRef.current?.sampleRate ?? 48_000))
  }, [])

  const start = useCallback(() => {
    chunks.current = []
    nodeRef.current?.port.postMessage('start')
    timer.current = setTimeout(() => autoStop.current(finish()), LIMITS.turnSeconds * 1000)
  }, [finish])

  /** Stop and hand back the turn's WAV. */
  const stop = useCallback(() => finish(), [finish])

  /** Drop what is being recorded (an interrupted turn) without sending it. */
  const cancel = useCallback(() => { finish() }, [finish])

  const release = useCallback(() => {
    gen.current += 1
    if (timer.current) clearTimeout(timer.current)
    nodeRef.current?.disconnect()
    nodeRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunks.current = []
  }, [])

  useEffect(() => release, [release])
  return { prepare, start, stop, cancel, release }
}
