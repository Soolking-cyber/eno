'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LIMITS, VOICE_RATE } from '@/lib/classroom/constants'
import { encodeWav, peakNormalize, toPcmAt, trimEnds } from '@/lib/classroom/wav'

/**
 * THE TEACHER READING THEIR SCRIPT, for their own voice (own-voice-flow.tsx). The lesson's worklet
 * (public/classroom/recorder-worklet.js) hands over every frame; nothing is sent until the teacher taps Send, and then ONE
 * WAV — PCM16 mono at VOICE_RATE — goes to /api/classroom/own-voice/recording and is never stored (own-voice.ts).
 * THE MICROPHONE NEARLY RAW: echo cancellation and noise suppression OFF (a clone copies what it hears, processing
 * included — plan review, opus), AUTO GAIN ON (owner, 2026-11-09: with it off a phone recorded so low that "voice too quiet"
 * came up even close to the phone). The finished take is then brought up to full level by one plain gain (peakNormalize).
 * ⛔ iOS: the AudioContext is made on the Start TAP (a gesture), runs at the device's own rate whatever is asked (the JS
 * resampler makes 24 kHz), and stops when the screen locks or a call comes — the take is then dropped ("interrupted"),
 * never sent half-made.
 */
export type TakeState = 'idle' | 'starting' | 'recording' | 'done' | 'interrupted' | 'denied'

const RAW: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }

export function useVoiceTake() {
  const [state, setState] = useState<TakeState>('idle')
  const [seconds, setSeconds] = useState(0)
  /** The input level now, 0–1 (the meter). */
  const [level, setLevel] = useState(0)
  const ctx = useRef<AudioContext | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const node = useRef<AudioWorkletNode | null>(null)
  const frames = useRef<Float32Array[]>([])
  const count = useRef(0)
  const wav = useRef<Uint8Array | null>(null)
  const peak = useRef(0)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const gen = useRef(0)
  /** Between the tap and the first frame (the permission prompt, the worklet loading). */
  const starting = useRef(false)

  const release = useCallback(() => {
    gen.current++
    if (tick.current) clearInterval(tick.current)
    tick.current = null
    try { node.current?.port.postMessage('stop'); node.current?.disconnect() } catch { /* gone */ }
    node.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void ctx.current?.close().catch(() => {})
    ctx.current = null
    setLevel(0)
  }, [])

  const interrupt = useCallback(() => {
    // Recording, or still STARTING (commit gate, codex): release() makes the pending start stop what it is granted.
    if (!node.current && !starting.current) return
    starting.current = false
    release()
    frames.current = []
    wav.current = null
    setState('interrupted')
  }, [release])

  const stop = useCallback(() => {
    const c = ctx.current
    if (!c || !node.current) return
    const rate = c.sampleRate
    release()
    const all = new Float32Array(count.current)
    let at = 0
    for (const f of frames.current) { all.set(f, at); at += f.length }
    frames.current = []
    wav.current = encodeWav(toPcmAt(peakNormalize(trimEnds(all, rate)).samples, rate, VOICE_RATE), VOICE_RATE)
    setState('done')
  }, [release])

  const start = useCallback(async () => {
    release()
    const mine = gen.current
    frames.current = []
    count.current = 0
    peak.current = 0
    wav.current = null
    setSeconds(0)
    setState('starting')
    starting.current = true
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: RAW, video: false })
    } catch {
      if (mine === gen.current) { starting.current = false; setState('denied') }
      return
    }
    if (mine !== gen.current) { s.getTracks().forEach((t) => t.stop()); return }
    const c = new AudioContext()
    try {
      await c.resume()
      await c.audioWorklet.addModule('/classroom/recorder-worklet.js?v=2')
    } catch {
      s.getTracks().forEach((t) => t.stop())
      void c.close().catch(() => {})
      if (mine === gen.current) { starting.current = false; setState('interrupted') }
      return
    }
    if (mine !== gen.current) { s.getTracks().forEach((t) => t.stop()); void c.close().catch(() => {}); return }
    stream.current = s
    ctx.current = c
    const n = new AudioWorkletNode(c, 'classroom-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    node.current = n
    const cap = (LIMITS.voiceMaxSeconds - 1) * c.sampleRate
    let last = 0
    n.port.onmessage = (e: MessageEvent<unknown>) => {
      if (!(e.data instanceof Float32Array)) return
      const f = e.data
      frames.current.push(f)
      count.current += f.length
      let sum = 0
      for (let i = 0; i < f.length; i++) { sum += f[i] * f[i]; const a = Math.abs(f[i]); if (a > peak.current) peak.current = a }
      last = Math.sqrt(sum / f.length)
      if (count.current >= cap) stop()
    }
    c.createMediaStreamSource(s).connect(n)
    n.connect(c.destination) // WebKit only runs a node whose output reaches the speakers; the worklet writes silence
    n.port.postMessage({ type: 'vad-off' })
    n.port.postMessage('start')
    // A call, Siri, a locked screen or a track that ends: the take is dropped, never sent half-made.
    c.addEventListener('statechange', () => { if (c.state !== 'running' && node.current === n) interrupt() })
    for (const t of s.getAudioTracks()) { t.addEventListener('ended', () => { if (node.current === n) interrupt() }); t.addEventListener('mute', () => { if (node.current === n) interrupt() }) }
    starting.current = false
    tick.current = setInterval(() => {
      setSeconds(Math.floor(count.current / c.sampleRate))
      // A square-root curve: quiet speech still moves the bar visibly, loud speech does not pin it.
      setLevel(Math.min(1, Math.sqrt(last) * 2.4))
    }, 100)
    setState('recording')
  }, [release, stop, interrupt])

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') interrupt() }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); release() }
  }, [interrupt, release])

  /** The finished take (after stop) and how loud the microphone got (0–1, before the take was brought up to level). */
  const take = useCallback(() => ({ wav: wav.current, peak: peak.current }), [])
  const reset = useCallback(() => { release(); frames.current = []; wav.current = null; setSeconds(0); setState('idle') }, [release])

  return { state, seconds, level, start, stop, take, reset }
}
