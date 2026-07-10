'use client'

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { isHlsUrl } from '@/lib/stream-url'

// Attach a source to a <video> element, transparently handling BOTH kinds a listing may hold:
//   • Cloudflare Stream HLS (.m3u8) → hls.js on Chrome/Firefox (lazy-imported, so the ~120KB
//     chunk loads only the first time a Stream clip actually plays), native on Safari/iOS.
//   • Supabase MP4 (legacy / Stream-off fallback) → set video.src directly.
//
// hls.js is configured for the card-first use: start at the LOWEST rendition and cap quality to
// the player's on-screen size, so a 180px card pulls a tiny rung while a fullscreen PDP/feed
// clip climbs the ladder — the adaptive "small to browse, sharp on full open" behavior. The
// instance is destroyed on src change / unmount (releases the MSE buffers).
//
// `playing`: OPTIONAL declarative play/pause intent. Callers that drive playback via the
// `autoPlay` attribute (CardVideo) omit it — the hook only attaches the source. Callers that
// play imperatively (the PDP gallery, the feed) pass a boolean instead of calling
// video.play()/pause() themselves: because hls.js attaches the source asynchronously, a bare
// video.play() fired before attach would reject with no source. The hook plays once the source
// is actually ready (native: immediately; HLS: after attach) and re-applies on every change.
export function useHlsVideo(
  ref: RefObject<HTMLVideoElement | null>,
  src: string | null | undefined,
  playing?: boolean,
) {
  // Latest play intent, readable from the async attach callback without re-subscribing.
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const v = ref.current
    if (!v || !src) return

    // Apply the current play intent to a source that is now ready.
    const applyIntent = () => {
      if (playingRef.current === undefined) return
      if (playingRef.current) v.play().catch(() => {})
      else v.pause()
    }

    if (!isHlsUrl(src) || v.canPlayType('application/vnd.apple.mpegurl')) {
      // Plain MP4, or Safari/iOS native HLS — a src attribute is enough.
      if (v.src !== src) v.src = src
      applyIntent()
      return
    }

    let cancelled = false
    let hls: import('hls.js').default | null = null
    import('hls.js')
      .then(({ default: Hls }) => {
        const el = ref.current
        if (cancelled || !el) return
        if (!Hls.isSupported()) {
          el.src = src // last-resort: let the browser try
          applyIntent()
          return
        }
        hls = new Hls({
          startLevel: 0, // begin at the smallest rung → fast first frame
          capLevelToPlayerSize: true, // never fetch above the on-screen size
          maxBufferLength: 10, // keep the forward buffer short (autoplay loops, not long views)
          backBufferLength: 0,
        })
        hls.loadSource(src)
        hls.attachMedia(el)
        hls.on(Hls.Events.MANIFEST_PARSED, applyIntent) // play once the ladder is known
      })
      .catch(() => {
        const el = ref.current
        if (!cancelled && el) { el.src = src; applyIntent() }
      })

    return () => {
      cancelled = true
      if (hls) {
        try { hls.destroy() } catch { /* ignore */ }
        hls = null
      }
    }
  }, [ref, src])

  // Play-intent changes after the source is attached (tap-to-pause, feed slide change).
  useEffect(() => {
    const v = ref.current
    if (!v || playing === undefined) return
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [ref, playing])
}
