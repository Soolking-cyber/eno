'use client'

// THE INTRO VIDEO AS A POSTER WITH ONE PLAY BUTTON (owner-approved 2026-11-15, build 7 — cook r07 teachers): the teacher's own
// public video (search-floor.ts teacherPublicVideo), first under the header. Until the first tap it shows its opening frame, a
// white play disc in the middle and its length on a white plate in the corner — the photo plates' system (globals.css
// `--plate-fill`, `.photo-badge`), not the browser's control bar. The tap is a real <button>: it turns the native controls on,
// plays the SAME <video> and hands it the focus, so a keyboard user carries on in the player. ⛔ NO AUTOPLAY: nothing starts
// without the tap.
// ⚠️ THE SERVER HTML AND THE FIRST CLIENT RENDER ARE THE SAME: NATIVE CONTROLS, NO OVERLAY BUTTON, NO LENGTH (so a reader with
// no JavaScript, or one who taps during hydration, can play it). After mount the overlay replaces the controls, unless the video
// is already playing. The length is read from the video's own metadata after mount — it may have loaded before hydration (`readyState`), so it is read then as well as on the
// event. The plate is absolutely placed, so its arrival moves nothing.
// ⚠️ THE PRIVATE VIDEO NEVER COMES HERE: only the public URL the page already prints (teacher-profile-view.tsx's ⛔ note).
import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Play } from '@/components/ui/icons'
import { useMounted } from '@/hooks/use-mounted'

/** "0:59", "12:05" — a video's length as a clock; null for an unknown, live or zero length (no plate then). */
export function videoClock(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function TeacherIntroVideo({ src }: { src: string }) {
  const { tr } = useLanguage()
  const ref = useRef<HTMLVideoElement>(null)
  // Until the page has hydrated the video keeps its NATIVE controls (the server HTML has them): a reader with no JavaScript, or
  // one who taps during hydration, can always play it. The play overlay replaces them only once it can act (review).
  const mounted = useMounted()
  const [started, setStarted] = useState(false)
  const [length, setLength] = useState<string | null>(null)
  // A new video (the same component, another `src`): forget the last one's state (render-time reset, no effect).
  const [forSrc, setForSrc] = useState(src)
  if (forSrc !== src) {
    setForSrc(src)
    setStarted(false)
    setLength(null)
  }

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const read = () => setLength(videoClock(v.duration))
    // HAVE_METADATA or later: the `preload="metadata"` fetch can finish before React attaches the listener.
    if (v.readyState >= 1) read()
    // Started with the native controls before hydration (or by any other means): it stays started, controls and all, and
    // the overlay never lands on a playing video (review).
    const played = () => setStarted(true)
    if (!v.paused || v.currentTime > 0.01) played()
    v.addEventListener('loadedmetadata', read)
    v.addEventListener('durationchange', read)
    v.addEventListener('play', played)
    return () => {
      v.removeEventListener('loadedmetadata', read)
      v.removeEventListener('durationchange', read)
      v.removeEventListener('play', played)
    }
  }, [src])

  const start = () => {
    const v = ref.current
    if (!v) return
    // Inside the tap's own handler, so a phone counts it as the user's gesture; the controls are set on the element here too
    // (React sets the same value on the next render), so the focus has a player to land on.
    v.controls = true
    setStarted(true)
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
    v.focus({ preventScroll: true })
  }

  return (
    <div className="relative">
      {/* `#t=0.001`: iOS Safari paints no frame for preload="metadata" without a start offset, so the box was black behind
          the play button (review); the fragment makes it decode the opening frame. */}
      <video ref={ref} src={src.includes('#') ? src : `${src}#t=0.001`} controls={!mounted || started} preload="metadata" playsInline className="block aspect-video w-full rounded-2xl bg-black" />
      {mounted && !started && (
        // ui/button (bare): the whole frame is the target. `active:scale-100` keeps the frame still; the disc takes the press.
        <Button
          variant="bare"
          size="none"
          type="button"
          onClick={start}
          aria-label={tr('Play video', 'Phát video')}
          data-teacher-video-play=""
          className="group absolute inset-0 flex cursor-pointer items-center justify-center rounded-2xl active:scale-100"
        >
          <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-plate-fill text-on-plate shadow-plate transition-[scale] duration-150 ease-out group-active:scale-[0.94] motion-reduce:transition-none">
            {/* Optically centred: a play triangle's weight sits left of its box. */}
            <Play className="ml-0.75 size-6.5 fill-current" />
          </span>
          {length && <span aria-hidden data-teacher-video-length="" className="photo-badge absolute bottom-3 left-3">{length}</span>}
        </Button>
      )}
    </div>
  )
}
