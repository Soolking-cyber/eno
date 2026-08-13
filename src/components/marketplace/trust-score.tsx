'use client'

import Link from 'next/link'
import { Tooltip } from '@/components/ui/tooltip'
import { useLanguage } from '@/context/language-context'
import { trustScoreColor, trustFillClass } from '@/lib/trust-score'
import { UI_ART } from '@/generated/icon-paths'
import { cn } from '@/lib/utils'

type Props = {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  // 'shield' = the seal (profile/detail); 'number' = just a color-coded number
  // (cards — low-key, since ranking already surfaces trust); 'mini' = a tiny
  // rounded-full chip (shield glyph + number) for card meta rows.
  variant?: 'shield' | 'number' | 'mini'
  // When set, the badge itself is the "How trust works" link (standalone surfaces
  // only — never inside another link/card, nested anchors are invalid HTML).
  href?: string
  className?: string
}

// Pixel size of the square shield badge per size.
const PX = { sm: 28, md: 38, lg: 48 } as const

// Gradient stops + in-badge text color per EARNED tier (mirrors the .trust-fill-*
// classes in globals.css — SVG needs its own <linearGradient>, CSS classes can't
// paint SVG fills).
//
// ⚠️ TEXT HOLDS ≥4.5:1 AGAINST THE WORST STOP, AND THE WORST STOP DEPENDS ON THE INK.
// This comment used to say "against the lightest stop", and that wrong rule is exactly why
// two of the three tiers shipped failing AA — measured 2026-08-09: trusted `from` #3b82f6
// gave 3.68:1 with white, and exceptional's dark ink gave 4.04:1 against `to` #f59e0b.
// White ink is worst over the LIGHTEST stop; dark ink is worst over the DARKEST one. Check
// all three, against the stop closest in luminance to the text.
// Now: trusted 4.55/5.17/6.70 · exceptional 8.23/7.09/5.05 · elite 5.70/7.10/8.98.
//
// ⚠️ TO BUY HEADROOM ON A DARK-INK TIER, DARKEN THE INK — NEVER THE GRADIENT. A reviewer
// proposed darkening Exceptional's `to` stop; measured, that moves it the wrong way
// (4.51 → 3.75 → 3.04 as the end stop darkens), because dark ink on darker gold loses
// contrast. It is the same inverted reasoning that produced the original bug, which is why
// it is written down here rather than just fixed.
//
// ⚠️ THESE VALUES ARE DUPLICATED IN `globals.css` (.trust-fill-*) BY NECESSITY — a CSS class
// cannot paint an SVG fill, so the chip and the shield each need their own copy. They are a
// sync pair with no compiler to enforce it: change one, change the other, or the same score
// renders two different blues on one screen.
const SHIELD_GRADIENT: Record<string, { from: string; mid: string; to: string; text: string }> = {
  trusted: { from: '#3473da', mid: '#2563eb', to: '#1d4ed8', text: '#ffffff' },
  exceptional: { from: '#fde047', mid: '#facc15', to: '#f59e0b', text: '#5c330e' },
  elite: { from: '#7c3aed', mid: '#6d28d9', to: '#5b21b6', text: '#ffffff' },
}

/**
 * The single public trust signal, color-coded by tier (red→slate→blue→gold→violet).
 * `variant='shield'` is the seal; `variant='number'` is just a subtle bold number;
 * `variant='mini'` is the tiny card chip. The EARNED tiers (Trusted blue /
 * Exceptional gold / Elite violet) render as vivid glossy gradient badges; building
 * and restricted stay quiet (tinted text) — shine is earned.
 */
export function TrustScore({ score, size = 'sm', showLabel = false, variant = 'shield', href, className }: Props) {
  const { lang, tr } = useLanguage()
  const { color, label, labelVi, band } = trustScoreColor(score)
  const fill = trustFillClass(band)
  const n = Math.round(score)
  const title = `${tr('Trust score', 'Điểm uy tín')}: ${n} · ${lang === 'vi' ? labelVi : label}`
  // The inner span carries a NATIVE title only when there is NO href — that is the unwrapped case
  // where it's the sole hint. When href is set the badge is wrapped in a Base UI <Tooltip> below,
  // which owns the hint; leaving the native title on too would fire BOTH bubbles (same text twice)
  // on every card's mini badge.
  const nativeTitle = href ? undefined : title
  // Badge-as-link: tapping any trust badge explains the system.
  const wrap = (node: React.ReactNode) => href
    // prefetch={false}: a trust badge renders on EVERY card in the feed, so auto-prefetch would
    // warm the same /trust explainer once per visible card. It is a rarely-followed footnote link.
    ? <Tooltip content={title} side="top"><Link href={href} prefetch={false} aria-label={tr('How trust works', 'Điểm uy tín hoạt động thế nào')} className="inline-flex cursor-pointer transition-transform hover:scale-105 active:scale-[0.96]">{node}</Link></Tooltip>
    : <>{node}</>

  if (variant === 'mini') {
    // Card-facing chip: shield + score ONLY (user decision 2026-07-13 — a tier
    // word made cards too verbose; the `title` tooltip and every tap-through
    // surface still name the tier). Earned tiers get the glossy gradient fill;
    // building/restricted keep the quiet 10%-tint treatment.
    return wrap(
      <span
        title={nativeTitle}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-bold leading-none tabular-nums',
          fill,
          className,
        )}
        style={fill ? undefined : { color, background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
      >
        {/* ⚠️ SOLAR'S `shield-check`, NOT THE eno SEAL. This is the one variant where the tick
            belongs: the score sits BESIDE the shield as text, so nothing competes for the
            shield's centre and the mark can carry its own mark. Solar already draws exactly this
            (owner, 2026-08-12: "for different types of shiel with tick or other shields seach
            from solar icon pack already exists"), so there is nothing to hand-draw.

            Painted with `fill`, not `stroke` — Solar's Outline weight is a filled ring, which
            holds its exact weight at 11px where a stroked path would thin out. */}
        <svg width={11} height={11} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
          {UI_ART['shield-verified'].rest.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill="currentColor"
              fillRule={p.evenOdd ? 'evenodd' : undefined}
              clipRule={p.evenOdd ? 'evenodd' : undefined}
            />
          ))}
        </svg>
        {n}
      </span>,
    )
  }

  if (variant === 'number') {
    const txt = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }[size]
    return wrap(
      <span title={nativeTitle} className={cn('font-extrabold tabular-nums', txt, className)} style={{ color }}>
        {n}
      </span>,
    )
  }

  const px = PX[size]
  // ⚠️ THE NUMERAL IS ANCHORED TO THE SHIELD'S OPTICAL CENTRE, NOT THE VIEWBOX'S.
  // MEASURED, not guessed: Solar's Bold `shield-minimalistic` has a bbox of y 2..22, so its
  // GEOMETRIC centre is 12 — but the shield tapers to a point, so its AREA centroid (sampled by
  // hit-testing the fill row by row) is y=11.5. `dominantBaseline="central"` centres the digits
  // on that coordinate, so 11.5 puts them on the shield's visual mass. 12.6 was an eyeballed
  // first guess and sat 1.1 units into the taper. (This note used to cite the eno seal's SEAL_CHECK — that mark is the
  // BRAND logo and no longer appears in this component; the shield is stock Solar now.)
  //
  // ⚠️ `y` LANDS THE DIGIT INK CENTRE — VERIFIED, BECAUSE IT WAS DISPUTED. A reviewer argued
  // `dominantBaseline="central"` is a FONT baseline (halfway between ascender and descender),
  // not an ink centre, and predicted the digits sit 0.3–0.7 units off — which would make every
  // fit number below wrong. Measured instead of argued: rendering the same string twice,
  // once `alphabetic` and once `central`, gives the shift `central` applies (2.275 units at
  // 6.2, 2.65 at 7.2); adding that to y and subtracting the canvas ink ascent puts the ink
  // centre at 12.08–12.12 against a y of 12.1 — off by ≤0.02 units in every case. The
  // reviewer's reasoning is right in general and cancels here specifically: DIGITS HAVE NO
  // DESCENDERS, so in this face their ink is symmetric about the central baseline. Keep the
  // check in mind if this `<text>` ever renders anything but digits.
  //
  // Sizes are bounded by the interior WIDTH, which is the real constraint. The shield is
  // 15 units wide at the chief but narrows as the keel closes: ~12.4 where the digits'
  // lowest ink sits. THE OLD SIZES DID NOT FIT — swept across every score 0..150, the worst
  // case (100, the widest three-digit) overflowed the outline by 0.51 units at 109% of the
  // interior, and even 45/95 sat at 102–103%. The digits were literally wider than the
  // shield they were inside (owner, 2026-08-08: "numbers ... dont look right ... make
  // numbers smaller and fit nicely into the shield"). At 7.2/6.2 the worst case is 100
  // again, now at 87% with 0.84 units of clear air; two-digit scores sit at 73–77%.
  //
  // ⚠️ THESE NUMBERS ARE FONT-CONDITIONAL — `fontFamily="inherit"` resolves to Be Vietnam Pro,
  // and they were measured with `document.fonts.ready` awaited. A fallback face during the
  // font swap has different advance widths. That exposure is pre-existing and strictly
  // smaller than before (the old sizes overflowed in the MEASURED face, never mind a
  // fallback), but do not re-tune these against a cold cache.
  //
  // ⚠️ THREE-DIGIT SCORES ARE COMMON, NOT AN EDGE CASE — `TRUST.MAX` is 150 and the
  // Exceptional tier STARTS at 110, so most earned badges have three digits. That is
  // why a second size exists at all. Keep the step small (7.2→6.2, ~14%): the old
  // 8.6→7.0 was a 23% jump, so a 95 and a 118 side by side in one list visibly
  // disagreed about how big a trust score is.
  //
  // ⚠️ BOTH EXTERNAL REVIEWERS ARGUED 6.2 IS TOO SMALL AND IT WAS KEPT ANYWAY — the
  // reasoning, so it is not re-litigated. At `sm` (28px) 6.2 renders at 7.2px against the
  // old 7.0's 8.2px, and 6.5 was built and compared side by side. 6.5 buys 0.35px of glyph
  // and gives back a third of the clearance (89% fill), which at 110px reads as pressing
  // into the walls again — the exact complaint being fixed. The strong form of the
  // objection is also wrong on the facts: WCAG sets NO minimum font size, and this `<svg>`
  // is `aria-hidden` with the score exposed as text on the wrapper's `title`/tooltip
  // ("Trust score: 118 · Exceptional"), so assistive tech never depends on the glyph. If a
  // future owner wants bigger digits the honest lever is `PX.sm`, not the font size —
  // the interior width, not the type, is what ran out.
  const fontSize = n >= 100 ? 6.2 : 7.2
  const grad = SHIELD_GRADIENT[band]
  const gradId = grad ? `trust-grad-${band}` : undefined

  return wrap(
    <span
      title={nativeTitle}
      className={cn('inline-flex items-center gap-1.5 align-middle', className)}
    >
      <svg width={px} height={px} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        {grad && (
          <defs>
            {/* Fixed per-tier id: duplicate defs across shields on one page resolve
                to identical gradients, so collisions are harmless. */}
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={grad.from} />
              <stop offset="55%" stopColor={grad.mid} />
              <stop offset="100%" stopColor={grad.to} />
            </linearGradient>
          </defs>
        )}
        {grad ? (
          <>
            {/* Vivid gradient badge on the eno seal (§0b): the chief becomes the
                glassy highlight (static — shine without motion; reduced-motion
                safe by construction) and the SCORE renders in the tier's text
                ink, so the signature reads even on gold/violet.
                (This comment used to say "the e-bar renders in the tier's text
                ink" — wrong twice over: the interior has been a check, not a
                bar, since 2026-08-07, and this variant draws no interior mark at
                all. The `text` below is the only thing wearing `grad.text`.) */}
            {/* ⚠️ THE SHIELD IS SOLAR'S `shield-minimalistic`, NOT THE eno SEAL (owner, 2026-08-12:
                "trust badge use solar pack minimalistic shield no custom icons across the app").
                The seal is the BRAND MARK — it belongs on the logo, the watermark and the favicon,
                not on a data badge. Borrowing it here made a score look like a certification.

                ⚠️ THE BOLD WEIGHT CARRIES THE GRADIENT, AND THAT IS THE WHOLE REASON THIS TIER
                WORKS. Solar's Bold shield is a solid silhouette, so a gradient fill reads as one
                object; the Outline weight is a hollow ring and a gradient inside it would show
                through to the page. Same outline/bold grammar as every other icon in the app.

                ⚠️ NO TICK IN A BADGE THAT CARRIES THE SCORE — the numeral owns the optical centre
                (owner, 2026-08-07: "maybe not tickmark here"). `shield-verified` / `shield-star`
                exist in UI_ART for surfaces where a shield stands alone with no number. */}
            {UI_ART['trust-shield'].selected.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill={`url(#${gradId})`}
                fillRule={p.evenOdd ? 'evenodd' : undefined}
                clipRule={p.evenOdd ? 'evenodd' : undefined}
              />
            ))}
            {/* ⚠️ 700, NOT 800 — `fontFamily="inherit"` means this numeral is drawn in Open Runde,
                which ships two cuts (400/700). An 800 here always rasterised at 700 and merely
                said otherwise; design-lint now refuses the mismatch. The digit is unchanged. */}
            <text x="12" y="11.5" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="700" fontFamily="inherit" fill={grad.text}>
              {n}
            </text>
          </>
        ) : (
          <>
            {/* Quiet tiers: line seal with a tinted chief (fill/stroke via style
                so the CSS var resolves — SVG attrs don't take var()). */}
            {/* Quiet tiers: the same Solar shield at its Outline weight. Solar draws an outline
                as a FILLED ring rather than a stroke, so this paints with `fill`, not `stroke`
                — and it means the ring keeps its exact weight at every size instead of thinning
                as the badge shrinks, which a stroked path would do. */}
            {UI_ART['trust-shield'].rest.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fillRule={p.evenOdd ? 'evenodd' : undefined}
                clipRule={p.evenOdd ? 'evenodd' : undefined}
                style={{ fill: color }}
              />
            ))}
            {/* 700 for the same reason as the earned-tier numeral above. */}
            <text x="12" y="11.5" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="700" fontFamily="inherit" style={{ fill: color }}>
              {n}
            </text>
          </>
        )}
      </svg>
      {showLabel && <span className="text-sm font-bold" style={{ color }}>{tr(label, labelVi)}</span>}
    </span>,
  )
}
