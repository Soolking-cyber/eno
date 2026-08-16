'use client'

import * as React from 'react'

import { reactionAnimationUrl, reactionFor } from '@/lib/reactions'

/**
 * ONE ANIMATED EMOJI — the Lottie art layered over the Unicode glyph that is already there.
 *
 * ⛔ IT RENDERS THE PLAIN CHARACTER FIRST AND ALWAYS. The glyph is the content; the animation is
 * decoration that arrives later, or never. That ordering is the entire load strategy: a reaction is
 * legible with zero network, zero JavaScript and no layout shift, and everything below is an
 * enhancement layered on top of something already correct. It also means the degraded states —
 * offline, blocked CDN, reduced-motion, a browser the player does not support — are not special
 * cases anyone has to design, because they are just the base state persisting.
 *
 * ⚠️ THE PLAYER IS THE `light` BUILD, IMPORTED DYNAMICALLY, AND BOTH HALVES MATTER. lottie-web's
 * full build carries expression evaluation the emoji pack does not use; `lottie_light` drops it.
 * The dynamic import keeps even that out of the page bundle until something actually animates, so a
 * user who never opens a reaction picker downloads none of it.
 *
 * ⚠️ BASE UI HAS NO EQUIVALENT, which is why this is a hand-rolled wrapper around a third-party
 * player rather than a ui/* primitive: per CLAUDE.md's order of preference, Base UI ships no Lottie
 * renderer, so option (2) — the best-in-class purpose-built library — applies. The same reasoning
 * that put embla behind ui/carousel and input-otp behind the OTP field.
 *
 * ⛔ IT DOES NOT ANIMATE UNDER `prefers-reduced-motion`. A grid of 47 looping faces is exactly the
 * content that setting exists to suppress, and the static glyph underneath already communicates
 * everything. Checked at play time rather than mount, so a user changing the OS setting mid-session
 * gets the new behaviour on the next hover instead of on the next reload.
 */

/** Cache parsed animation data across mounts — the picker remounts constantly as it opens/closes. */
const animationCache = new Map<string, Promise<unknown>>()

function loadAnimation(url: string): Promise<unknown> {
  const hit = animationCache.get(url)
  if (hit) return hit
  // ⚠️ The PROMISE is cached, not the resolved value, so ten emoji mounting in the same frame share
  // one request instead of racing ten. A rejection is evicted so a transient failure can retry.
  const pending = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`emoji ${r.status}`))))
    .catch((err) => {
      animationCache.delete(url)
      throw err
    })
  animationCache.set(url, pending)
  return pending
}

export function LottieEmoji({
  emoji,
  play,
  className,
  size = 20,
}: {
  emoji: string
  /** Animate while true. False leaves the static glyph alone and tears the player down. */
  play: boolean
  className?: string
  /** Rendered box in px. The glyph is sized in CSS to match. */
  size?: number
}) {
  const host = React.useRef<HTMLSpanElement | null>(null)
  const [animating, setAnimating] = React.useState(false)
  const entry = reactionFor(emoji)

  React.useEffect(() => {
    if (!play) return
    // Checked here, not at module scope: the OS setting can change while the tab is open.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const url = reactionAnimationUrl(emoji)
    if (!url) return

    let cancelled = false
    let instance: { destroy: () => void } | null = null

    void (async () => {
      try {
        const [{ default: lottie }, data] = await Promise.all([
          import('lottie-web/build/player/lottie_light'),
          loadAnimation(url),
        ])
        // ⚠️ Re-checked after both awaits. A hover that ends before the player lands is the common
        // case, not the rare one, and without this the animation would appear after the pointer had
        // already moved on — and leak an instance nothing would ever destroy.
        if (cancelled || !host.current) return
        instance = lottie.loadAnimation({
          container: host.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData: data as object,
        })
        setAnimating(true)
      } catch {
        // Static glyph stands. Nothing to report and nothing to retry — see the header.
      }
    })()

    return () => {
      cancelled = true
      instance?.destroy()
      setAnimating(false)
    }
  }, [play, emoji])

  return (
    <span
      className={className}
      style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
      role="img"
      aria-label={entry?.label ?? emoji}
    >
      {/* The content. Hidden from AT because the wrapper already carries the accessible name, and
          hidden VISUALLY only once the animation is actually on screen — never merely because we
          started trying to load one. */}
      <span
        aria-hidden="true"
        style={{ fontSize: size * 0.92, lineHeight: 1, opacity: animating ? 0 : 1 }}
      >
        {emoji}
      </span>
      <span
        ref={host}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </span>
  )
}
