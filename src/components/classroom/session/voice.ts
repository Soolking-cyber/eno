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
