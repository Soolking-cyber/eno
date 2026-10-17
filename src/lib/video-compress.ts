// Client-side video compression — the iPhone-clip fix (2026-07-18).
//
// WHY: the Supabase project's upload ceiling is 50MB (probed; owner-raisable only in the
// dashboard), but a real 60s iPhone HEVC clip is 60–400MB — so before this existed, every
// normal iPhone video died at select with "too large". Instead of rejecting, the post
// wizard now RE-ENCODES oversized clips in the browser down to ≤720p at a bitrate that
// lands a 60s clip around ~35–40MB, then uploads that.
//
// HOW: no demuxer dependency — the platform does the heavy lifting.
//   <video muted> (native decode: iOS decodes its own HEVC in hardware) → canvas draw loop
//   (requestVideoFrameCallback, rAF fallback) → canvas.captureStream() + the clip's sound
//   (`planAudio`: the element's captureStream() track, or the file's audio decoded and played
//   into a MediaStreamDestination — never to the speakers) → MediaRecorder (H.264 MP4 on
//   Safari/WebKit and current Chromium, else VP9/VP8 WebM — first supported type wins).
//
// Realtime by nature (a 60s clip takes ~60s to re-encode) — callers surface onProgress.
// Every failure path throws VideoCompressError with a compact reason; callers fall back
// to an honest "too large" toast, never a hang (hard watchdog at duration + 30s).

import { mediaElementCaptureSupported, takeCompressionAudioContext } from '@/lib/compression-audio'

export class VideoCompressError extends Error {
  constructor(public reason: 'unsupported' | 'decode_failed' | 'record_failed' | 'still_too_large' | 'timeout') {
    super(`video_compress_${reason}`)
  }
}

// Recorder container/codec preference: MP4/H.264 first (Safari + iOS WKWebView — also
// universally playable, skipping the server HEVC transcode), then WebM (Chromium).
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

/**
 * THE LARGEST CLIP A VIDEO PICKER ACCEPTS — the teacher form (src/lib/teachers/video-prep.ts) and the post wizard
 * (src/hooks/use-post-media.ts) — and the largest whose sound is decoded: ONE number, so every clip that goes up keeps its
 * sound (owner, 2026-10-17: "put 150mb limit so we have all clips with sound"). decodeAudioData takes the ENTIRE file in
 * memory (plus ~23 MB of decoded sound a minute, beside the video decoder and the recorder), and a tab a phone kills for
 * memory is worse than a refused pick — so the cap is conservative: a phone's default 1080p minute is 60–100 MB; a 4K one
 * is refused with "record in 1080p".
 */
export const VIDEO_PICK_MAX_BYTES = 150 * 1024 * 1024
const DECODE_AUDIO_MAX_BYTES = VIDEO_PICK_MAX_BYTES

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })

type AudioPlan =
  | { kind: 'capture'; stream: MediaStream }
  | { kind: 'decode'; ctx: AudioContext; buffer: AudioBuffer; sink: MediaStreamAudioDestinationNode }
  | { kind: 'none' }

/**
 * WHERE THE SOUND COMES FROM. Until 2026-10-17 it was the muted element routed through createMediaElementSource — and a
 * muted element feeds that graph SILENCE (Web Audio: "volume, and other aspects of the HTMLMediaElement MUST affect the
 * audio stream"): every compressed clip carried an AAC track of digital silence (−91 dB measured on two teacher intro
 * videos uploaded that day; the same −91 dB reproduced in Chromium and WebKit). Measured in a Playwright harness — a tone
 * at −21 dB for the sound, a white flash and a beep both at 3.0 s for the sync (picture time minus sound time):
 *  1. The file's audio DECODED whole and played into the recorder beside the frames, started with the first frame shown —
 *     Chromium −21.1 dB, +0.04–0.07 s; desktop WebKit −21.2 dB, but the sound +0.23 s ahead there whichever start was tried
 *     (its picture track runs late — to be checked on an iPhone). The element stays muted. First choice everywhere, through
 *     the AudioContext the picker tap started (src/lib/compression-audio.ts — iOS runs one only from a gesture).
 *  2. The element's own captureStream() track (Chromium, Android WebViews, Firefox) — −21.2 dB, unaffected by muted, but
 *     the sound LEADS the picture by 0.18–0.55 s, run to run (it is taken ahead of what is shown). Only where decoding
 *     cannot: a clip over the decode cap, a context that will not run. Early sound beats none.
 *  3. Neither — no sound, as before this, and never a failed upload: the teacher intro video is required.
 * ⚠️ The element itself stays MUTED: that is what lets play() run with no user gesture (autoplay policy, and Android
 * WebViews' mediaPlaybackRequiresUserGesture). Unmuting it would carry the sound through the old graph — and refuse to play.
 */
async function planAudio(video: HTMLVideoElement, file: File): Promise<AudioPlan> {
  if (file.size <= DECODE_AUDIO_MAX_BYTES) {
    const decoded = await decodeAudio(file)
    if (decoded) return decoded
  } else {
    // Too big to decode: the context the tap started is not needed — closed now, not after the unused-release timer.
    void takeCompressionAudioContext()?.close().catch(() => undefined)
  }
  if (mediaElementCaptureSupported()) {
    try {
      const el = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }
      const capture = el.captureStream ?? el.mozCaptureStream
      if (capture) return { kind: 'capture', stream: capture.call(video) }
    } catch { /* fall through to no sound */ }
  }
  return { kind: 'none' }
}

/**
 * How long the decode may take before the clip goes on without sound. ⛔ It runs before the compression's watchdog exists, so
 * without this a decodeAudioData that never settles (a known class of WebKit bug) held "Making it smaller…" forever — and
 * the teacher intro video is required (review, 2026-10-17). A minute of sound decodes in a second or two.
 */
const DECODE_AUDIO_TIMEOUT_MS = 20_000

/** The decoded path — null when it cannot run (no context, one that stays suspended, a clip with no audio track, too slow). */
async function decodeAudio(file: File): Promise<Extract<AudioPlan, { kind: 'decode' }> | null> {
  const ctx = takeCompressionAudioContext()
  if (!ctx) return null
  const attempt = async (): Promise<Extract<AudioPlan, { kind: 'decode' }>> => {
    // Suspended (no tap reached it) or "interrupted" (Safari, e.g. after the Photos picker): one try to resume, bounded.
    const state = () => ctx.state as string
    if (state() !== 'running') await Promise.race([ctx.resume().catch(() => undefined), sleep(1_000)])
    if (state() !== 'running') throw new Error('not running')
    // Throws for a clip with no audio track (EncodingError) — no sound to carry, which is fine.
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    return { kind: 'decode', ctx, buffer, sink: ctx.createMediaStreamDestination() }
  }
  try {
    const result = await Promise.race([attempt(), sleep(DECODE_AUDIO_TIMEOUT_MS).then(() => null)])
    if (!result) throw new Error('decode timeout')
    return result
  } catch {
    void ctx.close().catch(() => undefined)
    return null
  }
}

/**
 * captureStream()'s audio track is there once the metadata is (measured in Chromium: present at loadedmetadata, the same live
 * track after a seek) — a short wait covers an engine that adds it later; a clip with no sound never gets one.
 */
async function captureAudioTracks(stream: MediaStream): Promise<MediaStreamTrack[]> {
  for (let i = 0; i < 6 && !stream.getAudioTracks().length; i++) await sleep(50)
  return stream.getAudioTracks()
}

export function videoCompressionSupported(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && RECORDER_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/** Re-encode `file` to fit inside `targetBytes`. Resolves to a new File (mp4 or webm). */
export async function compressVideo(file: File, opts: {
  targetBytes: number
  onProgress?: (fraction: number) => void
}): Promise<File> {
  if (!videoCompressionSupported()) throw new VideoCompressError('unsupported')
  const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type))!
  const container = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.playsInline = true
  video.preload = 'auto'
  // Muted so autoplay policy never blocks the processing run — and the sound is NOT taken from its output (a muted
  // element feeds silence to createMediaElementSource): see `planAudio`.
  video.muted = true

  let audioContext: AudioContext | null = null
  let bufferSource: AudioBufferSourceNode | null = null
  const cleanup = () => {
    video.onplaying = null
    video.onwaiting = null
    video.onseeked = null
    try { bufferSource?.stop() } catch { /* never started */ }
    try { video.pause() } catch { /* already torn down */ }
    video.removeAttribute('src')
    try { video.load() } catch { /* detached */ }
    URL.revokeObjectURL(url)
    void audioContext?.close().catch(() => undefined)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new VideoCompressError('decode_failed')), 15_000)
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve() }
      video.onerror = () => { window.clearTimeout(timer); reject(new VideoCompressError('decode_failed')) }
      video.src = url
    })

    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) throw new VideoCompressError('decode_failed')

    // Output geometry: fit within 1280×720, even dimensions (encoder requirement).
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, 1), 720 / Math.max(video.videoHeight, 1))
    const width = Math.max(2, Math.floor((video.videoWidth * scale) / 2) * 2)
    const height = Math.max(2, Math.floor((video.videoHeight * scale) / 2) * 2)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new VideoCompressError('unsupported')

    // Bitrate budget: fill ~85% of the target across the clip's real duration, clamped
    // to a sane 720p range (a 60s clip at 4.5Mbps + 128k audio ≈ 35MB — well under 50MB).
    const totalBudgetBits = (opts.targetBytes * 8 * 0.85) / duration
    const audioBitsPerSecond = 128_000
    const videoBitsPerSecond = Math.min(4_500_000, Math.max(1_200_000, Math.floor(totalBudgetBits - audioBitsPerSecond)))

    const stream = canvas.captureStream()
    // "Making it smaller… 0%" from here, not "Uploading…": the decode below can take a few seconds before the first frame.
    opts.onProgress?.(0)
    // ⛔ THE SOUND JOINS BEFORE THE RECORDER STARTS — a track added to a running MediaRecorder is ignored.
    const audio = await planAudio(video, file)
    if (audio.kind === 'capture') {
      for (const track of await captureAudioTracks(audio.stream)) stream.addTrack(track)
    } else if (audio.kind === 'decode') {
      audioContext = audio.ctx
      for (const track of audio.sink.stream.getAudioTracks()) stream.addTrack(track)
    }

    const chunks: BlobPart[] = []
    let resolveDone!: () => void
    let rejectDone!: (e: unknown) => void
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
    // A run that throws before awaiting it (play() refused) must not leave an unhandled rejection behind (review, 2026-10-17).
    void done.catch(() => undefined)
    let stopTimer = 0
    const startRecorder = () => {
      const r = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond })
      r.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      r.onstop = () => resolveDone()
      r.onerror = () => rejectDone(new VideoCompressError('record_failed'))
      r.start(1_000)
      return r
    }
    let recorder: MediaRecorder | null = null
    const record = () => {
      try {
        recorder = startRecorder()
      } catch {
        // An engine that will not record this container WITH sound (review, 2026-10-17): the frames alone — a silent clip,
        // as before the sound was carried, never a failed upload. A throw without sound is a real failure, as it always was.
        for (const track of stream.getAudioTracks()) stream.removeTrack(track)
        chunks.length = 0
        try { recorder = startRecorder() } catch { throw new VideoCompressError('record_failed') }
      }
    }
    /**
     * ⛔ THE ELEMENT'S OWN TRACK CARRIES NO SAMPLES UNTIL PLAYBACK RUNS, so with it the recorder starts AFTER play() — started
     * before (as the decoded and the silent paths do, their sound flowing from the first instant), the frames ran from 0 while
     * the sound began a beat later and Chromium's MP4 writer put it at 0 too: the sound led the picture by 0.76 s (measured,
     * a flash and a beep both at 3.0 s, 2026-10-17).
     */
    const recordAfterPlay = audio.kind === 'capture' && stream.getAudioTracks().length > 0
    if (!recordAfterPlay) record()

    /**
     * IN STEP WITH THE FRAMES (plan review + harness, 2026-10-17): the decoded sound starts on the FIRST FRAME ACTUALLY
     * SHOWN (requestVideoFrameCallback's mediaTime), from where that frame is — not on `playing`, which can fire before a
     * frame is; `playing` is the fallback without the callback. Measured (a flash and a beep both at 3.0 s): Chromium
     * +0.05–0.07 s over three runs; desktop WebKit +0.23 s with either start (its picture track runs late — to be checked on
     * an iPhone). A STALL is held to the frames: `waiting` stops the sound, `playing` starts it again from the frame.
     * ⛔ No continuous drift correction: re-aligning on every frame to the AudioContext clock (which starts slowly in
     * Chromium) jumped the sound ahead — +0.33 s in two of four runs. Over a minute the two clocks do not drift apart.
     * ⛔ Never suspend(): holding the context left WebKit's MediaRecorder waiting on a silent track at stop() — onstop never
     * came and the compression hung (harness, 2026-10-17).
     */
    const hasFrameCallback = typeof (video as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function'
    let syncSound: ((frameTime: number) => void) | null = null
    if (audio.kind === 'decode' && stream.getAudioTracks().length) {
      const sound = audio
      let started = false
      let stalled = false
      const playFrom = (at: number) => {
        try { bufferSource?.stop() } catch { /* not started */ }
        try {
          bufferSource = sound.ctx.createBufferSource()
          bufferSource.buffer = sound.buffer
          bufferSource.connect(sound.sink)
          bufferSource.start(0, Math.max(0, at))
        } catch { bufferSource = null /* no sound from here — never a failed upload */ }
      }
      syncSound = (frameTime: number) => {
        if (started) return
        started = true
        playFrom(frameTime)
      }
      video.onwaiting = () => {
        if (!started) return
        stalled = true
        try { bufferSource?.stop() } catch { /* not started */ }
        bufferSource = null
      }
      video.onplaying = () => {
        if (!started) {
          if (!hasFrameCallback) syncSound?.(video.currentTime)
          return
        }
        if (stalled) { stalled = false; playFrom(video.currentTime) }
      }
    }

    // Draw loop — rVFC ties draws to real decoded frames (Safari 15.4+/Chromium);
    // rAF fallback for anything older.
    let stopped = false
    const draw = () => { ctx.drawImage(video, 0, 0, width, height) }
    const scheduleDraw = (_now?: number, frame?: { mediaTime?: number }) => {
      if (stopped) return
      if (frame && syncSound) syncSound(frame.mediaTime ?? video.currentTime)
      draw()
      opts.onProgress?.(Math.min(0.99, video.currentTime / duration))
      if (hasFrameCallback) {
        (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: (now: number, frame: { mediaTime: number }) => void) => void }).requestVideoFrameCallback(scheduleDraw)
      } else {
        window.requestAnimationFrame(() => scheduleDraw())
      }
    }

    const finish = () => {
      if (stopped) return
      stopped = true
      const r = recorder as MediaRecorder | null
      if (!r) { resolveDone(); return }
      // A context a call or an alarm interrupted mid-run leaves its track silent, and WebKit's stop() then waits on it (the
      // suspend() hang, measured): one resume first — review, 2026-10-17. The stop timer below still ends a hang.
      if (audioContext && (audioContext.state as string) !== 'running') void audioContext.resume().catch(() => undefined)
      if (r.state !== 'inactive') {
        r.stop()
        // A recorder whose stop never lands must not strand the step on "Making it smaller…" — a reported failure is better.
        // Generous (review, 2026-10-17): stop() flushes at most a second of data (timeslice 1 s) and finishes the file, and an
        // old phone finishing an MP4 must not be failed for being slow — this only ends a hang.
        stopTimer = window.setTimeout(() => rejectDone(new VideoCompressError('record_failed')), 15_000)
      }
    }
    video.onended = finish
    // Watchdog: a stalled decode must never strand the wizard mid-"compressing".
    const watchdog = window.setTimeout(finish, (duration + 30) * 1000)

    draw()
    try {
      await video.play()
    } catch {
      window.clearTimeout(watchdog)
      // Started before play() on the decoded and silent paths: stopped, not left recording a frozen frame.
      const r = recorder as MediaRecorder | null
      try { if (r && r.state !== 'inactive') r.stop() } catch { /* already stopped */ }
      throw new VideoCompressError('decode_failed')
    }
    if (recordAfterPlay) {
      // Back to the start if play() took its time, so the recording misses nothing (the captured track is the same live one
      // after a seek — measured in Chromium).
      if (video.currentTime > 0.15) {
        await new Promise<void>((resolve) => {
          const t = window.setTimeout(resolve, 2_000)
          video.onseeked = () => { window.clearTimeout(t); resolve() }
          video.currentTime = 0
        })
        video.onseeked = null
      }
      if (stopped) { window.clearTimeout(watchdog); throw new VideoCompressError('timeout') }
      record()
    }
    scheduleDraw()
    try { await done } finally { window.clearTimeout(stopTimer) }
    window.clearTimeout(watchdog)

    // A watchdog-stopped run produced a truncated clip — treat as failure, not a result.
    if (video.currentTime < duration - 2) throw new VideoCompressError('timeout')

    const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
    if (!blob.size) throw new VideoCompressError('record_failed')
    if (blob.size > opts.targetBytes) throw new VideoCompressError('still_too_large')
    opts.onProgress?.(1)
    const baseName = file.name.replace(/\.[a-z0-9]+$/i, '') || 'video'
    return new File([blob], `${baseName}-compressed.${container}`, { type: mimeType.split(';')[0] })
  } finally {
    cleanup()
  }
}
