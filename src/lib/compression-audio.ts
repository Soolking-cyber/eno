'use client'

/**
 * THE SOUND OF A COMPRESSED VIDEO NEEDS A RUNNING AudioContext, AND BROWSERS RUN ONE ONLY FROM A TAP.
 *
 * src/lib/video-compress.ts carries a clip's sound (2026-10-17, after every compressed upload came out as digital silence)
 * by decoding the file's audio and playing it into the recorder through an AudioContext — the one way measured in step
 * with the picture — and browsers keep an AudioContext suspended until a user gesture starts it (iOS strictly; Chromium
 * until the page has had one). The compression runs seconds after the pick (a length probe comes first), long past any
 * gesture, so the TAP THAT OPENS THE VIDEO PICKER starts one here and the compressor takes it.
 *
 * ⚠️ Called from a click handler: it never throws and never awaits.
 */
let shared: AudioContext | null = null
let releaseTimer: ReturnType<typeof setTimeout> | null = null

/**
 * A context nobody took — the picker cancelled, a clip small enough to need no compression — is closed after this long
 * (review, 2026-10-17: left running it keeps the phone's audio hardware awake). Long enough for a slow pick from Photos.
 */
const UNUSED_RELEASE_MS = 5 * 60_000

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null
}

/** Whether this browser hands a media element's audio over directly — the compressor's fallback when decoding cannot run. */
export function mediaElementCaptureSupported(): boolean {
  if (typeof HTMLMediaElement === 'undefined') return false
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  return typeof proto.captureStream === 'function' || typeof proto.mozCaptureStream === 'function'
}

/** In the click that opens a video picker: start (or resume) the AudioContext the compressor will use. */
export function unlockCompressionAudio(): void {
  try {
    const Ctor = audioContextCtor()
    if (!Ctor) return
    if (!shared || shared.state === 'closed') shared = new Ctor()
    // Suspended, or "interrupted" (Safari: after the Photos picker, a call) — this tap is the one chance to resume with a gesture.
    if ((shared.state as string) !== 'running') void shared.resume().catch(() => undefined)
    if (releaseTimer) clearTimeout(releaseTimer)
    const unused = shared
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (shared !== unused) return
      shared = null
      void unused.close().catch(() => undefined)
    }, UNUSED_RELEASE_MS)
  } catch {
    // No sound unlocked: the compressor records without it, as before — never a failed pick.
  }
}

/**
 * The context a tap started, handed over ONCE (the compressor closes it when done; the next pick's tap starts a fresh one)
 * — else a new one, which iOS may leave suspended (the compressor checks and records without sound then).
 */
export function takeCompressionAudioContext(): AudioContext | null {
  const ctx = shared
  shared = null
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null }
  if (ctx && ctx.state !== 'closed') return ctx
  try {
    const Ctor = audioContextCtor()
    return Ctor ? new Ctor() : null
  } catch {
    return null
  }
}

/** Tests only. */
export function resetCompressionAudioForTests(): void {
  shared = null
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null }
}
