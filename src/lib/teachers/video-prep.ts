'use client'

import { compressVideo, recordedSeconds, VIDEO_PICK_MAX_BYTES, videoCompressionSupported } from '@/lib/video-compress'
import { hasHevcTrack, VIDEO_UPLOAD_MAX_BYTES } from '@/lib/video-upload-client'
import { VIDEO_CUT_SECONDS, VIDEO_MAX_SECONDS } from '@/lib/video-length'

/**
 * A TEACHER'S INTRO VIDEO, READY TO UPLOAD (owner, 2026-10-16: "make short intor video mandatory from now on"). Required
 * of a new profile until the 2026-10-25 deploy, recommended since (owner, 2026-10-22: "publish before video/CV"), so the
 * teacher form gets the post wizard's protections (src/hooks/use-post-media.ts
 * addVideo — the same rules, kept beside it rather than refactored out of the post wizard): a phone's minute of 1080p is
 * 100–400 MB, far over the 50 MB storage ceiling, so a clip over it is COMPRESSED in the browser instead of refused; the
 * length is read from the file (≤ 5 minutes since 2026-10-18 — src/lib/video-length.ts — one second over for rounding); and
 * an HEVC (iPhone) clip is flagged so its server transcode fails CLOSED rather than keeping a clip that plays black on most
 * Android phones.
 */
/** 150 MB — the compressor's own limit, so every intro video keeps its sound (owner, 2026-10-17; src/lib/video-compress.ts). */
export const TEACHER_VIDEO_PICK_MAX_BYTES = VIDEO_PICK_MAX_BYTES
const MAX_SECONDS = VIDEO_MAX_SECONDS.teacher_intro + 1

export type TeacherVideoPrepError = 'type' | 'too_big' | 'too_long' | 'unreadable' | 'cannot_compress' | 'compress_failed' | 'no_picture' | 'interrupted'

export async function prepareTeacherVideo(file: File, opts: { onCompress?: (fraction: number) => void } = {}): Promise<{ file: File; hevc: boolean } | { error: TeacherVideoPrepError }> {
  // Some iOS picker paths hand over an EMPTY type: the name is then the only signal.
  const typeOk = /^video\/(mp4|webm|quicktime|x-m4v)$/.test(file.type) || (!file.type && /\.(mp4|webm|mov|m4v)$/i.test(file.name))
  if (!typeOk) return { error: 'type' }
  if (file.size > TEACHER_VIDEO_PICK_MAX_BYTES) return { error: 'too_big' }
  const url = URL.createObjectURL(file)
  try {
    const seconds = await new Promise<number>((resolve) => {
      const v = document.createElement('video')
      let timer = 0
      // Settled once: the timer cleared and the probe let go of the file (no decoder kept on a 150 MB clip).
      const done = (n: number) => {
        window.clearTimeout(timer)
        v.onloadedmetadata = null
        v.onerror = null
        v.removeAttribute('src')
        v.load()
        resolve(n)
      }
      v.preload = 'metadata'
      v.onloadedmetadata = () => done(v.duration)
      v.onerror = () => done(NaN)
      // Metadata that never arrives (a WKWebView blob hiccup) must not hang the step on "Checking…".
      timer = window.setTimeout(() => done(NaN), 10_000)
      v.src = url
    })
    if (!Number.isFinite(seconds)) {
      // The length could not be read HERE (a WebM a browser recorded reports Infinity; an iPhone HEVC .mov fails in a browser
      // without HEVC) — and the video matters (required 2026-10-16..25, strongly recommended since — gate review, 2026-10-16): a clip that needs no shrinking goes up as
      // it is (flagged HEVC or not, the server's transcode decides — one over five minutes comes back 'video_too_long'); only
      // one that must be made smaller cannot be, unread.
      if (file.size > VIDEO_UPLOAD_MAX_BYTES) return { error: 'unreadable' }
      return { file, hevc: await hasHevcTrack(file).catch(() => false) }
    }
    if (seconds > MAX_SECONDS) return { error: 'too_long' }
  } finally {
    URL.revokeObjectURL(url)
  }
  if (file.size > VIDEO_UPLOAD_MAX_BYTES) {
    if (!videoCompressionSupported()) return { error: 'cannot_compress' }
    try {
      // The output is H.264 MP4 (Safari) or VP8/9 WebM (Chromium) — never HEVC.
      const out = await compressVideo(file, { targetBytes: VIDEO_UPLOAD_MAX_BYTES, onProgress: opts.onCompress })
      // A recording that stalls runs longer than its clip; one that ran past the server's cut would come back "too long"
      // after the whole upload (gate review, 2026-10-18) — refused here, as a shrinking that did not work on this device.
      const recorded = await recordedSeconds(async (start, end) => new Uint8Array(await out.slice(start, end).arrayBuffer()), out.size).catch(() => null)
      if (recorded !== null && recorded > VIDEO_CUT_SECONDS.teacher_intro - 0.5) return { error: 'compress_failed' }
      return { file: out, hevc: false }
    } catch (e) {
      // A picture this browser cannot read, or the page left mid-run, has its own remedy (VideoCompressError's reason, read
      // duck-typed); anything else is the shrinking itself failing.
      const reason = (e as { reason?: unknown } | null)?.reason
      return { error: reason === 'no_picture' || reason === 'interrupted' ? reason : 'compress_failed' }
    }
  }
  return { file, hevc: await hasHevcTrack(file).catch(() => false) }
}
