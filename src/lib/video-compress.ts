// Client-side video compression — the iPhone-clip fix (2026-07-18).
//
// WHY: the Supabase project's upload ceiling is 50MB (probed; owner-raisable only in the
// dashboard), but a real 60s iPhone HEVC clip is 60–400MB — so before this existed, every
// normal iPhone video died at select with "too large". Instead of rejecting, the post
// wizard now RE-ENCODES oversized clips in the browser down to ≤720p at a bitrate that
// lands a 60s clip around ~35–40MB, then uploads that.
//
// HOW: no demuxer dependency — the platform does the heavy lifting.
//   <video> (native decode: iOS decodes its own HEVC in hardware) → canvas draw loop
//   (requestVideoFrameCallback, rAF fallback) → canvas.captureStream() + the element's
//   audio routed through an AudioContext MediaElementSource → MediaStreamDestination
//   (never to the speakers) → MediaRecorder (H.264 MP4 on Safari/WebKit, VP9/VP8 WebM
//   on Chromium — first supported type wins).
//
// Realtime by nature (a 60s clip takes ~60s to re-encode) — callers surface onProgress.
// Every failure path throws VideoCompressError with a compact reason; callers fall back
// to an honest "too large" toast, never a hang (hard watchdog at duration + 30s).

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
  // Muted so autoplay policy never blocks the processing run. Audio is still captured:
  // createMediaElementSource reroutes the element's audio INTO the graph regardless of
  // element volume in every engine this runs on, and the graph feeds the recorder only.
  video.muted = true

  let audioContext: AudioContext | null = null
  const cleanup = () => {
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
    try {
      audioContext = new AudioContext()
      const source = audioContext.createMediaElementSource(video)
      const sink = audioContext.createMediaStreamDestination()
      source.connect(sink)
      const [audioTrack] = sink.stream.getAudioTracks()
      if (audioTrack) stream.addTrack(audioTrack)
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined)
    } catch {
      // Soundless fallback beats a dead upload path — some WebViews refuse the audio graph.
      audioContext = null
    }

    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond })
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }

    const done = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new VideoCompressError('record_failed'))
    })

    // Draw loop — rVFC ties draws to real decoded frames (Safari 15.4+/Chromium);
    // rAF fallback for anything older.
    let stopped = false
    const draw = () => { ctx.drawImage(video, 0, 0, width, height) }
    const scheduleDraw = () => {
      if (stopped) return
      draw()
      opts.onProgress?.(Math.min(0.99, video.currentTime / duration))
      if ('requestVideoFrameCallback' in video) {
        (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(scheduleDraw)
      } else {
        window.requestAnimationFrame(scheduleDraw)
      }
    }

    const finish = () => {
      if (stopped) return
      stopped = true
      if (recorder.state !== 'inactive') recorder.stop()
    }
    video.onended = finish
    // Watchdog: a stalled decode must never strand the wizard mid-"compressing".
    const watchdog = window.setTimeout(finish, (duration + 30) * 1000)

    recorder.start(1_000)
    draw()
    try { await video.play() } catch { window.clearTimeout(watchdog); throw new VideoCompressError('decode_failed') }
    scheduleDraw()
    await done
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
