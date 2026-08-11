'use client'

import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/context/language-context'
import { isAskAboveBand, isBelowTypical, type SoldPriceBand } from '@/lib/price-guidance'
import { cn } from '@/lib/utils'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

/**
 * ── <PriceBand> — "what this actually sold for" ─────────────────────────────────────────────
 *
 * The band from src/lib/price-guidance.ts, rendered in the two rooms it belongs in. Props only:
 * it fetches nothing, reads no clock, and decides nothing the pure module has not already
 * decided. Hand it `band = null` and it renders NOTHING — which is what production does today
 * (measured 2026-08-12: the live DB has no `salePrice` column at all, so there are zero confirmed
 * sales and no band exists for any listing). "Nothing" is the finished day-one behaviour, not a
 * loading state, and there is deliberately no placeholder, no skeleton and no "not enough data
 * yet" line to grow into one. A guidance module that says something when it knows nothing is the
 * exact failure this feature is replacing.
 *
 * ── THE TWO ROOMS ───────────────────────────────────────────────────────────────────────────
 *
 * `placement="compose"` — THE SELLER, WHILE THEY CAN STILL ACT ON IT. Shows the range, how many
 * confirmed sales it rests on, what it is comparing against, and — when the typed price is above
 * the range — SAYS SO. Naming it is the whole point: a seller who prices 40% over the market gets
 * silence today and learns it three weeks later from nobody messaging them.
 *
 * ⚠️ THE WARNING GOES THROUGH `isAskAboveBand`, NOT THROUGH `positionInBand`, AND THE DIFFERENCE
 * IS THE FEATURE. Everything in the band is a price somebody PAID; the number being typed is a
 * price somebody is ASKING, and in this market the ask is where haggling starts. Judging one
 * against the other with a bare `> p75` fires on the median honest seller — a truthful sentence
 * shown so often it becomes furniture. The margin lives in PRICE_GUIDANCE.ASK_NEGOTIATION_MARGIN
 * and is an ASSUMPTION until there are enough confirmed sales to measure the real gap.
 *
 * ⚠️ IT NEVER BLOCKS. There is no error tone, no `role="alert"`, no aria-invalid and nothing a
 * form gate could read as a validity failure — an above-range price is a legal, sometimes
 * correct, decision (a pristine unit, a rare colour, a seller who is not in a hurry) and the
 * marketplace has eight sales and no opinion worth vetoing anyone over. Publishing must stay one
 * tap away. If a future caller wires this into a submit gate, that is a bug in the caller.
 *
 * `placement="card"` — THE BUYER. ONLY the good news: a "Below typical" chip when the ask is
 * under P25, and nothing at all otherwise. No overpriced badge, ever — see `isBelowTypical` in
 * price-guidance.ts for why an above-range verdict is the seller's business and not a mark the
 * marketplace prints next to their photo. The chip is geometrically identical to the existing
 * "Good price" cue in listing-card.tsx so it can REPLACE it in place.
 *
 * ⚠️ INTEGRATOR: THE CARD MUST NOT SHOW BOTH. `listing.goodPrice` (the ASKED-price band, via
 * Listing.marketPosition) and this chip are two answers to one question and would stack as two
 * green pills saying nearly the same thing. Where a sold band exists it wins — it is evidence,
 * the other is inference — and the asked-price cue is suppressed for that card.
 *
 * ── WHY THERE IS NO GAUGE ───────────────────────────────────────────────────────────────────
 * market-price.tsx draws a track with a marker showing where the ask sits inside the asked-price
 * band. This one deliberately does not, and it is not an omission. The band's edges are estimated
 * from as few as 8 observations, and the measurement recorded in PRICE_GUIDANCE.MIN_COMPARABLES
 * puts the 90th-percentile error on an edge at ~27%. A needle positioned to the pixel inside a
 * range that fuzzy is a picture claiming precision the data does not have. A range, plus the
 * sample count, is the honest rendering of an estimate.
 */

export type PriceBandProps = {
  /** From `priceGuidance()`. `null` = nothing to show; the component renders nothing. Pass the
   *  band ONLY when the result was `{ shown: true }` — do not reconstruct one from a hidden
   *  result, which is how a suppressed band gets shown anyway. */
  band: SoldPriceBand | null
  /** The ASK being judged: the seller's current input while posting, the listed price on a card.
   *  Whole VND. Absent / 0 / half-typed → no verdict is drawn (see positionInBand). */
  price?: number | null
  placement: 'compose' | 'card'
  className?: string
}

/** What the band is comparing against — stated, because "same model" and "same model, year and
 *  condition" are different claims and the seller is entitled to know which one this is. */
function useTierLabel(tier: SoldPriceBand['tier']): string {
  const { tr } = useLanguage()
  if (tier === 'model_condition_year') return tr('Same model, year and condition', 'Cùng mẫu, năm và tình trạng')
  if (tier === 'model_condition') return tr('Same model and condition', 'Cùng mẫu và tình trạng')
  if (tier === 'model_year') return tr('Same model and year', 'Cùng mẫu và năm')
  return tr('Same model', 'Cùng mẫu')
}

export function PriceBand({ band, price, placement, className }: PriceBandProps) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  // ⚠️ Hooks before the early return — `useTierLabel` calls useLanguage, so it cannot sit behind
  // `if (!band)`. It is given a harmless default when there is no band; nothing renders anyway.
  const tierLabel = useTierLabel(band?.tier ?? 'model')
  const below = band ? isBelowTypical(price, band) : false
  const above = band ? isAskAboveBand(price, band) : false

  if (!band) return null

  if (placement === 'card') {
    // Deal-positive only. An above-range or typical ask renders nothing at all.
    if (!below) return null
    return (
      <Badge variant="success" className={cn('shrink-0 self-center px-1.5 py-0.5 text-3xs', className)}>
        {tr('Below typical', 'Dưới giá phổ biến')}
      </Badge>
    )
  }

  // ₫ — Listing.salePrice is đồng by definition (see the schema comment on the column), so the
  // band has no currency of its own to carry. formatMoneyFull renders the viewer's own
  // convention: "12.000.000 đ" for vi, "12,000,000 VND" for en.
  const low = formatMoneyFull(band.p25, '₫', loc)
  const high = formatMoneyFull(band.p75, '₫', loc)

  return (
    <div className={cn('rounded-xl bg-tint px-3 py-2.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{tr('Recently sold for', 'Đã bán gần đây')}</span>
        <span className="text-2xs text-ink-4">{tierLabel}</span>
      </div>
      {/* ⚠️ A ZERO-WIDTH BAND IS ONE FIGURE, NOT A "RANGE" FROM X TO X. Nine fixed-price units of
          the same new phone across three shops is an ordinary shape, not an edge case, and
          printing "12.000.000 đ – 12.000.000 đ" reads as a broken widget rather than as the
          strongest possible answer. (Caught by an external reviewer against the suite's OWN
          per-party-cap fixture, which builds exactly this band and never rendered it.) */}
      <p className="mt-1 text-sm font-bold tabular-nums text-foreground">
        {low}
        {band.p75 > band.p25 && (
          <>
            <span className="font-normal text-ink-4"> – </span>
            {high}
          </>
        )}
      </p>
      <p className="mt-1 text-2xs text-ink-4">
        {tr('Based on {n} confirmed sales', 'Dựa trên {n} giao dịch đã xác nhận').replace('{n}', String(band.n))}
      </p>
      {/* ⚠️ ONE PERSISTENT POLITE LIVE REGION, NOT A CONDITIONALLY MOUNTED <p>. The verdict
          appears and disappears as the seller types, and a live region that is INSERTED along
          with its text is unreliable in every screen reader — the announcement is what makes
          this line exist for a non-sighted seller, who otherwise gets the range read once and
          silence thereafter. `polite` and never `alert`: assertive would interrupt them
          mid-word, and this is information, not an error (see the header — it never blocks).
          Empty and unstyled when there is no verdict, so it occupies no space.
          ⚠️ KNOWN LIMIT, stated rather than hidden: if the whole box mounts with a verdict
          already in it (a band arriving late for a price that is already over), the region is
          inserted together with its text and may not announce. That case cannot be fixed here —
          `band === null` must render NOTHING — so a caller that fetches the band after the price
          is typed should own a live region of its own. */}
      <p
        aria-live="polite"
        className={cn(
          'text-2xs font-medium',
          above && 'mt-1.5 text-warning',
          below && 'mt-1.5 text-success',
        )}
      >
        {above
          ? tr(
              'Higher than this model has been selling for. You can still post it.',
              'Cao hơn mức mẫu này đang bán. Bạn vẫn có thể đăng tin.',
            )
          : below
            ? tr('Below the range — buyers will see this as a good price.', 'Thấp hơn mặt bằng — người mua sẽ thấy đây là giá tốt.')
            : null}
      </p>
    </div>
  )
}
