'use client'

import { useState } from 'react'

/**
 * The photo layer of <Avatar>, and the ONLY part of it that needs JavaScript.
 *
 * ⚠️ WHY THIS IS A SEPARATE FILE. `ui/avatar` is deliberately server-safe — no 'use client',
 * no hooks — because it renders inside server components (the public profile page, the
 * storefront header, chat lists). Recovering from a broken photo needs an `onError` handler,
 * which needs state, which needs a client boundary. Putting that on the whole avatar would
 * hydrate a purely presentational component in ten places; putting it on this leaf hydrates
 * one `<img>`. The initials underneath stay server-rendered.
 *
 * ⚠️ IT REMOVES ITSELF ON ERROR RATHER THAN LETTING THE BROKEN IMAGE SHOW, and that is not the
 * same as doing nothing. Stacking the initials behind a failed `<img alt="">` LOOKS like it
 * should be enough — the initials do show through — but Chrome still paints its broken-image
 * glyph in the corner and washes the circle. Measured side by side: removing the element is
 * pixel-identical to never rendering it; leaving it is visibly damaged. That artifact is what
 * the owner reported (2026-08-09) as a profile-image fetch error.
 *
 * Avatars fail in ordinary, unavoidable ways, so this is a normal path and not an edge case:
 * a Google account photo (src/lib/profile.ts seeds avatarUrl from the OAuth metadata, i.e.
 * lh3.googleusercontent.com) can 403, rotate, or disappear when the person changes it, and an
 * uploaded photo can outlive its storage object. The account still has initials and a colour,
 * so there is always something correct to fall back to.
 */
// Known and accepted: a TRANSIENT failure (a CDN blip, a dropped connection) also falls back,
// and stays fallen back until this element remounts — there is no retry. That is a deliberate
// trade rather than an oversight: the alternative is a retry loop on an image that is usually
// genuinely gone, and the fallback is the person's own initials rather than an error state, so
// the cost of being wrong is low. It self-heals on the next navigation, and a changed `src`
// remounts via the key in <Avatar>.
export function AvatarImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt=""
      // Google serves account photos without CORS but rejects some hotlink referrers; sending
      // no referrer is the difference between a photo and a grey circle for anyone who signed
      // in with Google. Harmless for our own Supabase objects, which are public.
      referrerPolicy="no-referrer"
      decoding="async"
      // ⚠️ THE IMAGE IS OPAQUE, so a photo with transparency does not show the initials through
      // itself. The initials sit directly behind this element (that is the whole fallback), and
      // a transparent PNG — a storefront logo, most likely — would otherwise render letters
      // showing through the gaps in the artwork.
      //
      // ⚠️ BUT THE PLATE IS A FIXED LIGHT GROUND, **NOT** THE AVATAR'S IDENTITY COLOUR, and that
      // distinction is the whole bug (owner, 2026-08-12: "fix vietkite avatar image in messages
      // background is blue"). This used to paint `avatarColor` here, which is the colour chosen to
      // sit behind INITIALS — so every transparent pixel of a partner's logo came out in that
      // colour, and a seller with no colour set fell through to BRAND_BLUE. VietKite's mark is an
      // orange wordmark and a green kite drawn for a light ground; it shipped on a blue disc.
      // The failure path is untouched: the element removes itself, revealing the coloured initials.
      //
      // ⚠️ `bg-white`, NOT `bg-card`, AND THE DIFFERENCE IS DARK MODE. `bg-card` was the first
      // answer — a theme-aware neutral, which sounds obviously right — and all three reviewers
      // rejected it independently. Measured: `--card` is `#fafafa` in light and `#1b1b1b` in dark
      // (globals.css), so a dark-mode viewer would have got the same bug in a different colour, on
      // a near-black disc.
      //
      // The reason a FIXED light ground is correct rather than a compromise: this plate is only
      // ever VISIBLE through transparent pixels. An ordinary photo is opaque and covers it
      // completely, in either theme — so the plate's colour is, by construction, a decision about
      // artwork with alpha. Artwork with alpha in an avatar slot is a logo, and logos are drawn
      // for a light ground. Theme-matching a surface nobody can see, at the cost of the one case
      // that can, is the trade `bg-card` was making.
      className="absolute inset-0 h-full w-full bg-white object-cover"
      // ⚠️ onError ALONE IS NOT ENOUGH, because this element is server-rendered: the browser
      // starts fetching from the HTML, long before React hydrates and attaches the handler. A
      // 404 that resolves in that window fires its error event into the void, and the broken
      // photo would sit there forever — the exact bug this component exists to fix. The ref runs
      // at attach time and asks the element what already happened: `complete` with a zero
      // `naturalWidth` is the DOM's way of saying "finished, and it failed". Also caught by
      // codex; measured before and after, since a race you cannot reproduce is not a fix.
      ref={(el) => { if (el && el.complete && el.naturalWidth === 0) setFailed(true) }}
      onError={() => setFailed(true)}
    />
  )
}
