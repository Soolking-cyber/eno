'use client'

import { BadgeCheck } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * THE TEACHER CARD'S "IDENTITY VERIFIED" TICK (owner, 2026-10-15 — "on their CARD in lists": the card and the phone's
 * compact row). Drawn only where the card payload says `identityMark: true` (serialize.ts serializeListingCard — a
 * teacher card whose teacher has not hidden the mark — AUTOMATIC since 2026-10-16 — while the identity check is live and
 * the profile's name is within the ID's); the rules are src/lib/teachers/identity-mark.ts.
 *
 * ⛔ A NAMED IMAGE, NOT A CONTROL. role="img" with the label as its name (and `title`, as the Business glyph beside it
 * carries) — no tabIndex, no tooltip, no link: on ListingCard it sits under the card's stretched link, which owns every
 * tap and the focus, and the link names it in its description (aria-describedby → this id). What the mark means is said
 * in full on the profile, beside the same words.
 * ⛔ CORE GLYPH ONLY. Cards paint on arrival on the home page, /c and the storefronts, so BadgeCheck must stay in the core
 * sprite (scripts/critical-icons.mjs) — src/lib/critical-glyphs.guard.test.ts lists this file in ON_ARRIVAL. One claim,
 * one glyph: the profile line wears the same BadgeCheck (never the Solar shield — that is the trust chip's).
 * ⛔ THE WORDS ARE ONLY EVER "Identity verified" / "Đã xác minh danh tính" — never "Verified by eno", never "xác thực".
 */
export function IdentityVerifiedMark({ id, className }: { id?: string; className?: string }) {
  const { tr } = useLanguage()
  const label = tr('Identity verified', 'Đã xác minh danh tính')
  return (
    <span id={id} role="img" aria-label={label} title={label} data-identity-mark="" className={cn('inline-flex shrink-0 items-center text-success', className)}>
      <BadgeCheck aria-hidden className="h-3.5 w-3.5" />
    </span>
  )
}
