import { LIPS_MODEL_URL, LIPS_WORKLET_URL } from '@/lib/concierge/guide-assets'

/**
 * THE GUIDE'S FACE, DRAWN IN THE VISITOR'S BROWSER — TalkingHead 1.8.2 (three.js; MIT) plays the guide's voice and moves
 * the avatar, HeadAudio 1.0.0 (MIT) reads the visemes off that AUDIO, so the mouth follows any of the languages the voice
 * speaks (owner, 2026-10-28: "find best free avatar from talking head lightweight one to become eno concierge"). It replaces
 * Spatius on the concierge: no token, no per-minute bill, no vendor in the loop. Every quirk below was read in the 1.8.2 /
 * 1.0.0 sources (~/eno-classroom-2026-10-25/concierge/avatar/workflow-result.json "recipe").
 *
 * ⛔ CLIENT-ONLY AND LAZY (guide-face.tsx imports this module inside an effect): HeadAudio's module runs `class … extends
 * AudioWorkletNode` when it loads — a ReferenceError on the server — and three + TalkingHead are ~0.3 MB gzip that only an
 * open window needs.
 */

type MorphValue = { newvalue: number; needsUpdate: boolean }
/** The parts of a TalkingHead instance this module uses (the package ships no types). */
export type Head = {
  audioCtx: AudioContext
  renderer: { domElement: HTMLCanvasElement }
  controls: { disconnect: () => void } | null
  mtAvatar: Record<string, MorphValue | undefined>
  opt: { update: ((dt: number) => void) | null }
  audioStreamGainNode: AudioNode
  audioSpeechGainNode: AudioNode
  audioReverbNode: AudioNode
  audioAnalyzerNode: AudioNode
  showAvatar: (avatar: Record<string, unknown>) => Promise<void>
  streamStart: (opt: Record<string, unknown>, onAudioStart?: () => void, onAudioEnd?: () => void) => Promise<void>
  streamAudio: (r: { audio: Int16Array }) => void
  streamNotifyEnd: () => void
  streamInterrupt: () => void
  streamStop: () => void
  lookAtCamera: (ms: number) => void
  speakWithHands: () => void
  dispose: () => void
}
export type Lips = AudioWorkletNode & {
  loadModel: (url: string) => Promise<void>
  update: (dt: number) => void
  resetAll: () => void
  onvalue: ((key: string, value: number) => void) | null
  onstarted: (() => void) | null
  onended: (() => void) | null
}

/**
 * HeadAudio needs 50–100 ms to name a viseme, so the voice is DELAYED this much behind the mouth (lips that trail the sound
 * are what a viewer notices). The stream's "drained" therefore comes this much before the last sound is heard.
 */
export const LIP_DELAY_S = 0.1
/** The playback worklet starts on its first chunk and has no jitter buffer: hold this much before the first send. */
const PREROLL_S = 0.12

export type GuideStream = {
  /** ⛔ SYNCHRONOUSLY, at the top of the Start tap (iOS lets an audio context start only inside the gesture). */
  unlock: () => void
  /** Once per session, after the model is shown: the playback worklet (≤ 5 s). Chunks before it resolves are lost. */
  open: (onSound: () => void, onDrained: () => void) => Promise<void>
  /** One chunk of the guide's voice, PCM16 mono at `rate`. */
  pushPcm: (pcm: Int16Array, rate: number) => void
  /** The reply's last audio is in: it plays out, then "drained". Once per reply. */
  endTurn: () => void
  /** Talked over: the worklet's queue goes, and the delayed tail is muted. The caller stops the turn's reader FIRST. */
  interrupt: () => void
}
export type Guide = { stream: GuideStream; dispose: () => void }

/**
 * Draw the guide in `el` (already sized) and wire its voice. Throws when the device cannot (no WebGL2 — three r186 needs it
 * — no AudioWorklet, no Intl.Segmenter: TalkingHead's constructor makes one), or the model fails: the window then shows the
 * still portrait and plays the voice itself.
 */
export async function createGuide(el: HTMLElement, modelUrl: string, onLost: (why: string) => void, signal?: AbortSignal): Promise<Guide> {
  const probe = document.createElement('canvas').getContext('webgl2')
  if (!probe || typeof AudioWorkletNode !== 'function' || typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter !== 'function') {
    throw new Error('face_unsupported')
  }
  probe.getExtension('WEBGL_lose_context')?.loseContext()

  const [{ TalkingHead }, { HeadAudio }] = await Promise.all([
    import('@met4citizen/talkinghead') as Promise<{ TalkingHead: new (el: HTMLElement, opt: Record<string, unknown>) => Head }>,
    // Not the bare name: the package's `main` names a file it does not ship (dist/headaudio.min.js — the file is .mjs).
    import('@met4citizen/headaudio/dist/headaudio.min.mjs') as Promise<{ HeadAudio: new (ctx: AudioContext, opt: Record<string, unknown>) => Lips }>,
  ])

  // ⛔ ITS OWN AUDIO CONTEXT, at the device's rate (never a sampleRate: Firefox refuses a microphone on a non-native rate,
  // and streamStart with one rebuilds the whole graph). The window's microphone lives on another; head.stop() suspends
  // this one, which must never take the microphone with it.
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  let head: Head | null = null
  // The window closed while this was loading (commit review, codex): the audio context and the GPU go NOW, not when a slow
  // model finally lands — and the load stops at its next step.
  let released = false
  const release = () => {
    if (released) return
    released = true
    try { head?.dispose() } catch { /* gone */ }
    void ctx.close().catch(() => {})
  }
  if (signal?.aborted) { release(); throw new Error('face_cancelled') }
  signal?.addEventListener('abort', release, { once: true })
  const step = () => { if (signal?.aborted) throw new Error('face_cancelled') }
  try {
    head = new TalkingHead(el, {
      audioCtx: ctx,
      // ⛔ No lip-sync modules: TalkingHead would import() them by a computed path at runtime (and HeadAudio drives the mouth).
      lipsyncModules: [],
      // Head and shoulders, closer than TalkingHead's "upper" (the window is 192–256 px): the face reads, the badge shows.
      cameraView: 'upper',
      cameraDistance: -0.55,
      cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false,
      modelFPS: 30,
      // ⚠️ MULTIPLIED BY devicePixelRatio inside TalkingHead (its README says "sets"): 1 would draw 3× on an iPhone. ≤ 1.5×.
      modelPixelRatio: Math.min(1, 1.5 / (window.devicePixelRatio || 1)),
      mixerGainSpeech: 1,
      avatarMood: 'happy',
      avatarIdleEyeContact: 0.3,
      avatarSpeakingEyeContact: 0.7,
    })
    // OrbitControls set touch-action:none on the canvas even with every camera move off: a finger on the face could not
    // scroll anything.
    head.controls?.disconnect()
    step()
    // The model BEFORE the Start tap: showAvatar suspends and resumes the context, which must not undo the tap's unlock.
    // ⚠️ The shirt's blue is calibrated for TalkingHead's DEFAULT lights (make-shirt.mjs): keep them.
    await head.showAvatar({ url: modelUrl, body: 'F', avatarMood: 'happy' })
    step()

    const { lips, duck } = await attachLips(head, ctx, HeadAudio)
    step()
    signal?.removeEventListener('abort', release)
    const session = audioSessionKeeper()
    const stream = makeStream(head, ctx, lips, duck, session.callLike)

    // The GPU took the context back (a phone under memory pressure, a backgrounded tab): the window goes to the portrait.
    const canvas = head.renderer.domElement
    const lost = (e: Event) => { e.preventDefault(); onLost('webgl_context_lost') }
    canvas.addEventListener('webglcontextlost', lost)
    // ⚠️ NOT stopped while the page is hidden (commit review, opus): head.stop() suspends the voice's context, and iOS may
    // refuse to resume it without a tap — the guide would come back mute. A hidden page draws nothing anyway (no frames).
    const h = head

    let disposed = false
    return {
      stream,
      // Once: a failure and the window's own cleanup may both reach it.
      dispose() {
        if (disposed) return
        disposed = true
        canvas.removeEventListener('webglcontextlost', lost)
        try { h.streamStop() } catch { /* not streaming */ }
        try { lips.onvalue = null; lips.disconnect() } catch { /* gone */ }
        try { h.dispose() } catch { /* gone */ }
        // dispose() never closes the context it was given.
        void ctx.close().catch(() => {})
        // The page's audio goes back to how it was (commit review, codex: a call-like session outlived the window).
        session.restore()
      },
    }
  } catch (e) {
    signal?.removeEventListener('abort', release)
    release()
    throw e
  }
}

/**
 * HeadAudio on TalkingHead's stream. ⚠️ TalkingHead 1.8.2's stream reaches the speakers by TWO paths (worklet → stream gain
 * → reverb, and worklet → analyser → speech gain → reverb), and its "dry" reverb is a normalised 1 s impulse: HeadAudio's
 * README recipe (a delay on one path) plays the voice twice, 100 ms apart. So ONE path stays — analyser → speech gain →
 * delay → duck → speakers — and the lips listen at the analyser, BEFORE the delay. Volume is head.setMixerGain from here on.
 */
export async function attachLips(head: Head, ctx: AudioContext, HeadAudio: new (ctx: AudioContext, opt: Record<string, unknown>) => Lips): Promise<{ lips: Lips; duck: GainNode }> {
  await ctx.audioWorklet.addModule(LIPS_WORKLET_URL)
  const lips = new HeadAudio(ctx, { parameterData: { vadMode: 1, vadGateActiveDb: -40, vadGateInactiveDb: -50 } })
  await lips.loadModel(LIPS_MODEL_URL)
  head.audioStreamGainNode.disconnect()
  head.audioSpeechGainNode.disconnect()
  head.audioReverbNode.disconnect()
  const delay = new DelayNode(ctx, { delayTime: LIP_DELAY_S })
  const duck = new GainNode(ctx, { gain: 1 })
  head.audioAnalyzerNode.connect(lips)
  head.audioSpeechGainNode.connect(delay).connect(duck).connect(ctx.destination)
  // A key the model lacks is undefined: skipped (every viseme is in eno-guide — make-shirt.mjs added viseme_sil).
  lips.onvalue = (key, value) => {
    const mt = head.mtAvatar[key]
    if (mt) { mt.newvalue = value; mt.needsUpdate = true }
  }
  head.opt.update = (dt) => lips.update(dt)
  // A new sentence after a pause: eye contact and a small gesture, as a person starts a thought.
  let quietAt = 0
  lips.onended = () => { quietAt = performance.now() }
  lips.onstarted = () => { if (performance.now() - quietAt > 150) { head.lookAtCamera(500); head.speakWithHands() } }
  return { lips, duck }
}

/**
 * iOS mutes "ambient" Web Audio with the silent switch: while the window talks and listens its audio session is call-like
 * (Safari 16.4+), and the page gets back what it had when the window goes.
 */
function audioSessionKeeper(): { callLike: () => void; restore: () => void } {
  const s = typeof navigator === 'undefined' ? undefined : (navigator as { audioSession?: { type: string } }).audioSession
  let before: string | null = null
  return {
    callLike() {
      try {
        if (!s) return
        before ??= s.type
        s.type = 'play-and-record'
      } catch { /* Safari < 16.4 */ }
    },
    restore() {
      try { if (s && before !== null) s.type = before } catch { /* gone */ }
      before = null
    },
  }
}

export function makeStream(head: Head, ctx: AudioContext, lips: Lips, duck: GainNode, callLike: () => void = () => {}): GuideStream {
  let srcRate = 0
  let resample: (x: Int16Array) => Int16Array = (x) => x
  let held: Int16Array[] = []
  let heldN = 0
  let primed = false
  const preroll = Math.round(ctx.sampleRate * PREROLL_S)
  // TalkingHead copies the array and transfers the copy: ours is not detached.
  const send = (p: Int16Array) => head.streamAudio({ audio: p })
  const reset = () => { held = []; heldN = 0; primed = false; srcRate = 0 }
  return {
    unlock() {
      callLike()
      void ctx.resume().catch(() => {})
    },
    async open(onSound, onDrained) {
      await head.streamStart({ lipsyncType: 'visemes' }, onSound, onDrained)
    },
    pushPcm(pcm, rate) {
      if (!pcm.length) return
      // ⛔ RESAMPLED HERE: the 1.8.2 playback worklet does not resample — 24 kHz into a 48 kHz context plays at double speed.
      if (rate !== srcRate) { srcRate = rate; resample = resampler(rate, ctx.sampleRate) }
      const out = resample(pcm)
      if (!out.length) return
      if (primed) { send(out); return }
      held.push(out)
      heldN += out.length
      if (heldN >= preroll) { primed = true; held.forEach(send); held = []; heldN = 0 }
    },
    endTurn() {
      held.forEach(send)
      reset()
      head.streamNotifyEnd()
    },
    interrupt() {
      head.streamInterrupt()
      // What is already inside the delay still plays: muted, then the gain comes back for the next reply.
      const t = ctx.currentTime
      const g = duck.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(0, t + 0.02)
      g.setValueAtTime(0, t + LIP_DELAY_S + 0.03)
      g.linearRampToValueAtTime(1, t + LIP_DELAY_S + 0.06)
      lips.resetAll()
      reset()
    },
  }
}

/** A streaming linear resampler: the phase and the last sample carry over, so there is no seam at every chunk. */
export function resampler(from: number, to: number): (x: Int16Array) => Int16Array {
  if (from === to) return (x) => x
  const step = from / to
  let t = 0
  let prev = 0
  return (x) => {
    if (!x.length) return x
    const out = new Int16Array(Math.ceil((x.length - t) / step) + 1)
    let k = 0
    while (t < x.length - 1) {
      const i = Math.floor(t)
      const f = t - i
      const a = i < 0 ? prev : x[i]
      out[k++] = Math.round(a + (x[i + 1] - a) * f)
      t += step
    }
    t -= x.length
    prev = x[x.length - 1]
    return out.slice(0, k)
  }
}
