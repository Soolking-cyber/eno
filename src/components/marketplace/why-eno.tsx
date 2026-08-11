'use client'

import { Coins, Gavel, LockKeyhole, Megaphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { EnoSeal } from './eno-seal'
import { railEdgeMask } from './shelf'
import { useScrollArrows } from '@/hooks/use-scroll-arrows'

/**
 * "WHY USE eno" — the borderless icon row from the reference the owner sent (Shopee's quick-link
 * strip: an icon tile, a label under it, in one row, no boxes and no rules).
 *
 * ⚠️ EVERY CLAIM HERE WAS CHECKED AGAINST THE CODE BEFORE IT WAS WRITTEN, and that is a standing
 * requirement rather than a one-off diligence note. eno.vn is registering as a licensed sàn TMĐT,
 * so a homepage bullet is an advertising claim by a licensed operator, and the site currently
 * carries a notice saying it is not officially operating yet. Advertising a capability the product
 * does not have is the one failure mode here that is not merely a UX bug.
 *
 * What was rejected at draft time, so nobody re-adds it:
 *   · "Market price check" — <MarketPrice> only renders when ≥5 comparable listings exist for the
 *     same brand+model+segment. At today's catalogue size it would essentially never appear, so
 *     the bullet would advertise something a visitor cannot see.
 *   · "Bilingual EN/VI" — true, but a visitor learns it from the language toggle in the first
 *     second. A bullet should tell someone something the interface has not already told them.
 *
 * ⚠️ "Trust scores" IS NOT "verified sellers", and the distinction is deliberate. Seller
 * verification is real (Seller.verificationStatus, a 365-day-expiring verifiedIdentityHash), but
 * how MANY sellers hold it varies, and a claim that every seller is verified would be false the
 * moment one is not. The trust score, by contrast, exists for every seller by construction.
 */
type Reason = {
  key: string
  /** lucide glyph — or omitted for the ONE reason that carries the eno seal instead
   *  (the trust score is a first-party trust claim, and icon-language §0b reserves
   *  that moment for the seal, not a generic lucide badge). */
  icon?: LucideIcon
  titleEn: string
  titleVi: string
}

const REASONS: Reason[] = [
  {
    key: 'free',
    icon: Megaphone,
    titleEn: 'Free to post',
    titleVi: 'Đăng tin miễn phí',
  },
  {
    key: 'trust',
    // No lucide icon: this tile renders <EnoSeal> (see the map below) — the
    // highest-visibility seal echo on the home page (foundation handoff request).
    titleEn: 'Trust scores you can check',
    titleVi: 'Điểm tin cậy có thể kiểm chứng',
  },
  {
    key: 'private',
    icon: LockKeyhole,
    titleEn: 'Your number stays private',
    titleVi: 'Số điện thoại được giữ kín',
  },
  {
    key: 'currency',
    icon: Coins,
    // 'Đ', not 'VND' and not 'đ' (owner, 2026-08-05, twice: "use Đ instead of vnd", then "capital D").
    // ⚠️ This is DELIBERATELY the one place the capital is used, and it does NOT match the prices.
    // src/lib/vnd.ts renders lowercase ("12.000.000 đ") and canon §7 pins that — do not "fix" the
    // formatter to agree with this line. Standing alone as a label, the capital reads as the currency;
    // inside a price, lowercase is the Vietnamese convention. Both titles carry it so the bullet is
    // the same in either language.
    titleEn: 'Prices in Đ and $',
    titleVi: 'Giá bằng Đ và $',
  },
  {
    key: 'disputes',
    icon: Gavel,
    titleEn: 'Real dispute resolution',
    titleVi: 'Giải quyết tranh chấp thật sự',
  },
]

export function WhyEno() {
  const { tr } = useLanguage()
  // Scroll-state for the mobile edge-fade mask only — no arrows here: at sm+ the row never
  // overflows (five flex-1 tiles), and on touch the swipe is the gesture.
  const { scrollerRef, canLeft, canRight } = useScrollArrows<HTMLUListElement>()

  // ⚠️ aria-label, NOT aria-labelledby. The visible <h2> was removed (owner, 2026-08-05) and an
  // aria-labelledby pointing at the deleted id would leave the section silently unnamed — the
  // failure mode where a landmark exists but announces nothing. The name still has to exist for
  // anyone navigating by landmark, so it moves onto the section itself.
  return (
    <section aria-label={tr(`Why sell and buy on ${SITE_NAME}`, `Vì sao nên mua bán trên ${SITE_NAME}`)} className="border-t border-border pt-8">

      {/* ONE symmetric band (wow pass, 2026-08-06). The 2-col phone grid it replaces stacked
          five tiles into three sparse rows of dead vertical air; a single snap row keeps the
          band compact, with the edge-fade mask + the peeking sixth-of-a-tile saying "more this
          way" — which answers the old objection to a scroller (reasons hidden behind a
          gesture): nothing here LOOKS complete at the cut edge, and all five stay in the DOM
          in reading order for AT. At sm+ every tile is flex-1, so the reference's single row
          is exact: five equal columns, one icon-container size, no phantom cells.
          ⚠️ The column count no longer tracks REASONS.length — flex divides by whatever
          renders, so adding/removing a reason cannot strand a gap the way the grid could.
          -mx-3/px-3 is COUPLED to the page frame's px-3 (canon §4), same as the facet bar:
          the row bleeds to the screen edge on a phone, so the cut tile is cut by the
          viewport, not by a box floating inside it. reveal-on-scroll: the home page's one
          authored entrance — this band rises as it enters; pure enhancement, nothing moves
          under reduced motion or on engines without animation-timeline. */}
      <ul
        ref={scrollerRef}
        style={railEdgeMask(canLeft, canRight)}
        // tabIndex: the mobile band scrolls horizontally and its tiles hold no focusable
        // controls, so without a tab stop a keyboard/switch user could never reach the
        // off-screen reasons (Safari doesn't auto-focus scrollers). Gated on the live
        // scroll state so it isn't an inert tab stop at sm+ where nothing overflows.
        tabIndex={canLeft || canRight ? 0 : undefined}
        // SITE_NAME, not a hardcoded brand: this component ships on BOTH editions, and a
        // literal "eno.vn" here would have a screen reader asserting the marketplace brand
        // on eno.forum (guard-review catch, 2026-08-06 — same pattern as the section label).
        aria-label={tr(`Why ${SITE_NAME}`, `Vì sao chọn ${SITE_NAME}`)}
        className="reveal-on-scroll -mx-3 flex snap-x gap-3 overflow-x-auto overscroll-x-contain scrollbar-none px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:mx-0 sm:gap-4 sm:px-0"
      >
        {REASONS.map((r) => {
          const Icon = r.icon
          return (
            <li key={r.key} className="flex w-24 shrink-0 snap-start flex-col items-center text-center sm:w-auto sm:flex-1 sm:shrink">
              {/* Bare glyphs, no tile: icon-language §6 reserves the brand-50 coin for the
                  EmptyState badge and the Post chip — never behind inline icons (two blind
                  critics flagged the boxed variant independently). The h-12 band keeps the
                  row's vertical rhythm. ALL FIVE are LINE-ONLY in brand ink at the display
                  stroke — the seal included — so the row reads as one weight. */}
              <span className="flex h-12 shrink-0 items-center justify-center">
                {/* For the trust reason the glyph is the eno seal itself, so the row's one
                    first-party claim carries the one first-party mark.
                    ⚠️ `variant="line"` MEANS NO WASH — this call renders the silhouette +
                    the check in brand ink and NOTHING else; <EnoSeal>'s brand-100 chief
                    ships only under the default `variant="wash"`. What sets this tile apart
                    from its four lucide neighbours is therefore the MARK, not a colour or a
                    fill: same ink, same 1.5 stroke, a shape no other app has. (The comment
                    here used to claim a "washed chief + e-bar", which was wrong on both
                    counts — the wash is off, and the interior has been a check since
                    2026-08-07.) Keep it line: a lone washed glyph in a row of five would
                    read as a rendering fault, which is exactly the §0 complaint that
                    produced the outline-idle law. */}
                {/* The lucide branch needs `aria-hidden`; the seal branch does NOT, and
                    passing it there was dead code — <EnoSeal> hardcodes aria-hidden="true"
                    on its own <svg> and spreads nothing, so the attribute never reached
                    the DOM. Removed so the call site stops implying otherwise. */}
                {Icon ? <Icon aria-hidden className="size-8 text-brand" strokeWidth={1.5} /> : <EnoSeal variant="line" strokeWidth={1.5} className="size-8 text-brand" />}
              </span>
              {/* The blurb under each title was removed (owner, 2026-08-05) — icon + title only.
                  The two-line min-height floor went with it: its entire job was making the BLURBS
                  start on the same baseline when titles wrapped to different heights. With nothing
                  below the title, a floor only pads short titles with dead space. */}
              <span className="mt-2 text-xs font-bold leading-snug text-foreground text-balance sm:text-sm">
                {tr(r.titleEn, r.titleVi)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
