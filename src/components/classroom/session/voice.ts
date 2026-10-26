'use client'

/**
 * The avatar's voice on the page: the server sends each line as base64 MP3 (azure-speech.ts — ~6 KB a second), decoded
 * here once with the session's AudioContext, then either PLAYED (voice-only mode) or handed to AvatarKit as PCM16 at the
 * context's own rate (avatar mode — AvatarKit plays it and moves the face to it). No <audio> element, no URL: nothing for
 * the CSP to admit and nothing left behind.
 */
export async function decodeLine(ctx: AudioContext, base64: string): Promise<AudioBuffer> {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return ctx.decodeAudioData(bytes.buffer)
}

/** Play a decoded line; resolves when it ends (or is stopped). Returns the stop handle at once. */
export function playLine(ctx: AudioContext, buffer: AudioBuffer): { done: Promise<void>; stop: () => void } {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  const done = new Promise<void>((resolve) => { src.onended = () => resolve() })
  src.start()
  return { done, stop: () => { try { src.stop() } catch { /* already ended */ } } }
}

/** Mono PCM16 little-endian of a decoded line — what AvatarKit's send() takes at the view's sample rate. */
export function pcm16Of(buffer: AudioBuffer): ArrayBuffer {
  const data = buffer.getChannelData(0)
  const out = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)))
  return out.buffer
}

/**
 * Voice mode's player for a reply that arrives in PARTS: each part is scheduled right after the one before, so the parts
 * play as one line with no gap, and the first starts as soon as it has arrived. `stop()` silences all of them (the
 * learner talked over the avatar, or the screen closed).
 */
export function partPlayer(ctx: AudioContext) {
  let at = 0
  let live: AudioBufferSourceNode[] = []
  return {
    /** Resolves when THIS part has finished playing (or was stopped). */
    play(buffer: AudioBuffer): Promise<void> {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      const startAt = Math.max(ctx.currentTime + 0.02, at)
      at = startAt + buffer.duration
      live.push(src)
      const done = new Promise<void>((resolve) => { src.onended = () => { live = live.filter((s) => s !== src); resolve() } })
      src.start(startAt)
      return done
    },
    stop() {
      for (const s of live) { try { s.stop() } catch { /* already ended */ } }
      live = []
      at = 0
    },
  }
}

/** A base64 chunk of the server's raw voice (PCM16, little-endian, mono) → samples. */
export function pcmFromBase64(b64: string): Int16Array {
  const bin = atob(b64)
  const out = new Int16Array(bin.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16
  return out
}

/**
 * PCM16 from one sample rate to another (the voice server's 24 kHz → the face's rate, the page's audio context's).
 * Linear interpolation — a voice, not music: the error is far below what a phone speaker shows.
 */
export function resamplePcm16(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to || pcm.length === 0) return pcm
  const n = Math.max(1, Math.round((pcm.length * to) / from))
  const out = new Int16Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const x = i * step
    const j = Math.floor(x)
    const a = pcm[Math.min(j, pcm.length - 1)]
    const b = pcm[Math.min(j + 1, pcm.length - 1)]
    out[i] = Math.round(a + (b - a) * (x - j))
  }
  return out
}

/** PCM16 samples → an AudioBuffer the page can play (voice mode). */
export function bufferFromPcm16(ctx: AudioContext, pcm: Int16Array, rate: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, pcm.length), rate)
  const ch = buf.getChannelData(0)
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
  return buf
}
