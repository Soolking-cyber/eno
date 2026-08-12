'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { useCurrency, vndPerUsd } from '@/context/currency-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { formatMoney } from '@/lib/currencies'
import { cn } from '@/lib/utils'

type Props = {
  price: number
  currency: string
  priceUnit: string
  compact?: boolean
  /** Dual-currency approximation (user decision 2026-07-13): true = always show,
   *  'sm' = only at sm+ (one-line rows that fight for phone width), false = off.
   *
   *  ⚠️ 'sm' HIDES THIS SLOT ONLY WHEN IT REALLY IS AN APPROXIMATION — see `approxIsEstimate`. */
  dual?: boolean | 'sm'
  /** Unit suffix (" / service", " / month"): true = always, 'sm' = only at sm+, false = never.
   *  On a one-line ROW the suffix is the widest, least informative part (every visa row reads
   *  "/ service") and it is what pushed the price into the action icons — so a row may hide it,
   *  because a row carries a category, a district and other context that disambiguate.
   *
   *  ⛔ THERE IS DELIBERATELY NO 'fit' HERE, AND IT WAS WRITTEN AND THEN REMOVED. Hiding the
   *  suffix by container width would have dropped "/ month" from every card under 208px — all
   *  phones and every rail — so a rental at "15,000,000 VND / month" would render as
   *  "15,000,000 VND" and read as a SALE price. That is not a layout trade, it is a change of
   *  meaning, and it is exactly the case a marketplace cannot get wrong. A reviewer caught it
   *  before it shipped. If a card genuinely cannot fit the price, the price WRAPS — two truthful
   *  lines beat one misleading one. Only `dual` gets the container treatment, because an FX
   *  approximation is the one part that carries no meaning of its own. */
  unit?: boolean | 'sm'
  className?: string
}

/**
 * Renders a price in the viewer's chosen DISPLAY currency (live-converted from the
 * stored VND amount; defaults to VND), plus a QUIET dual-currency approximation for
 * every viewer in every language: "≈ $x" beside any non-USD display, and "≈ x đ"
 * beside a USD display — small and muted so it never overshadows the main price.
 * The unit suffix (e.g. "month") is translated; separators follow the language
 * ("12.000.000 đ" for vi). Locale-swap stays hydration-safe the tr() way. A rare
 * non-VND stored listing shows as-is, with no approximation (no reliable rate).
 */
export function Price({ price, currency, priceUnit, compact = false, dual = true, unit: showUnit = true, className }: Props) {
  void compact // amounts are always shown in full now
  const { lang, tr } = useLanguage()
  const { currency: displayCur, rates, format } = useCurrency()
  const locale = moneyLocale(lang)
  // A zero price is FREE, not "0 VND". Rendering the number was actively misleading on the one
  // surface that has one — the trip-planning service, where planning genuinely costs nothing and
  // the fee is quoted later in chat — because "0 VND" in 3xl bold reads as a broken card rather
  // than a deliberate offer. The unit suffix is dropped with it: "Free / service" is nonsense.
  // Guarded on price > 0 rather than truthiness so a negative never slips through as free.
  // Unit suffix is translatable; bare "VND"/empty has none.
  const unitRaw = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  const unit = useTr(unitRaw ?? '') // hook called unconditionally (no-op when empty)
  // VND-stored listings convert to the display currency; the rare non-VND listing
  // is shown in its own currency, unconverted.
  const isFree = price === 0
  const amount = isFree
    ? tr('Free', 'Miễn phí')
    : currency === '₫' ? format(price, locale) : formatMoneyFull(price, currency, locale)
  const suffix = !isFree && unitRaw && showUnit !== false ? ` / ${unit}` : null

  // Approximation: USD unless the display already IS USD (then VND). Rendered only
  // once rates exist (prefetched + cached 12h by the provider) and for real prices.
  //
  // ⚠️ THE RATE IS PLAUSIBILITY-BANDED VIA vndPerUsd, not merely truthy. `rates.USD` arrives from
  // an upstream that publishes "currency per 1 VND"; a negative, infinite or wrongly-scaled value
  // is positive-but-absurd and would print a confidently wrong dollar figure beside a real price.
  // Shared with useDualMoney so the marketplace and the trip planner cannot disagree about when an
  // approximation is safe to show — a reviewer correctly pointed out that two copies of this rule
  // are only equal until one of them changes.
  let approx: string | null = null
  // `dual`/`unit` of 'fit' are truthy here on purpose: the element is always RENDERED and hidden
  // by a container query in CSS. Deciding it in JS would need the container's width, which is not
  // known at render and would tear on resize.
  if (dual !== false && currency === '₫' && price > 0) {
    if (displayCur === 'USD') approx = formatMoneyFull(price, '₫', locale)
    else if (vndPerUsd(rates)) approx = formatMoney(price, 'USD', rates, locale)
  }
  // ⛔ THE SECOND FIGURE IS NOT ALWAYS THE ESTIMATE, AND 'fit' MUST NOT HIDE IT WHEN IT IS NOT.
  // Read the branch above: for a viewer whose display currency is USD, `amount` is the CONVERTED
  // dollar figure and this second slot holds the stored ĐỒNG price — the authoritative number,
  // the one the buyer actually pays. Hiding it on a narrow card would leave a USD-viewing expat
  // looking only at an FX estimate, with the real price nowhere on the card.
  // ⚠️ It is also the legally load-bearing one: under NĐ 340/2025 a Vietnamese marketplace
  // displaying prices in USD is sanctionable, so the đồng figure is the last thing that may be
  // dropped for space. 'fit' therefore only ever hides a genuine approximation.
  // A reviewer caught this; the first version applied the container query unconditionally.
  const approxIsEstimate = displayCur !== 'USD'

  return (
    // tabular-nums: fixed-width digits so price columns align across card grids.
    //
    // ⚠️ THE WEIGHT LIVES HERE, NOT AT THE CALL SITES (owner, 2026-08-11: "prices bolder on
    // products, make sure its implemented everywhere"). It was previously repeated as
    // `font-extrabold` at eight call sites, `font-semibold` at a ninth, and omitted at two —
    // which is exactly how a "make it consistent" instruction quietly becomes untrue again the
    // next time someone adds a surface. Owning it in the component means a new <Price /> is
    // correct by default and the audit cannot drift.
    //
    // ⚠️ A CALL SITE CAN STILL OVERRIDE IT, AND TWO MUST: the struck-through PREVIOUS price on
    // the PDP and the card is deliberately light — a heavy strikethrough competes with the
    // price that actually applies. Those pass an explicit weight, and cn()'s tailwind-merge
    // makes the later class win. Do not "tidy" those away.
    // ⚠️ 800, AND THE REASON IT LOOKED WRONG FOR SO LONG WAS NEVER THE NUMBER.
    // This value moved four times. The history is worth keeping because three of those moves
    // were chasing a symptom:
    //   · 800 originally, at eight call sites, with a ninth on 600 and two omitting it.
    //   · centralised here, still 800 — which changed nothing anyone could see, reported back
    //     three times as "prices are still not bold".
    //   · raised to 900, with a matching Be Vietnam Pro 900 cut added in layout.tsx — which ALSO
    //     changed nothing anyone could see, and was reported back again.
    //   · 800 (here), once the real cause was found and fixed.
    // ⚠️ THE REAL CAUSE WAS THAT NONE OF IT WAS RENDERING. Measured 2026-08-12 with CDP
    // `CSS.getPlatformFontsForNode`, which reports the font Chrome actually rasterised with:
    // price, heading and body all came back **Arial**. next/font's localFont had injected an
    // adjusted `local(Arial)` companion face into --font-inter-vn WITHOUT a unicode-range, and
    // that face sits first in --font-sans, so it matched every Latin character and the UI face
    // was never reached. Arial has no 900 — `font-black` collapsed to Arial Bold, and no weight
    // written here could ever have made a difference. The fix is `adjustFontFallback: false` in
    // layout.tsx; see the block there.
    // With the real face rendering, Blinker's 900 is genuinely heavy — too heavy at price size
    // (owner, 2026-08-12: "too bold try 800"). 800 it is.
    <span className={cn('tabular-nums font-extrabold', className)}>
      {amount}
      {/* The bare text node is kept for the default (always-on) case so the other
          call sites' DOM is byte-identical to before; only the 'sm' variant needs a
          wrapper element to hang the breakpoint class on. */}
      {suffix && (showUnit === 'sm'
        ? <span className="hidden sm:inline">{suffix}</span>
        : suffix)}
      {approx && (
        /**
         * ⛔ `aria-hidden` IS CONDITIONAL, AND THE CONDITION IS THE SAME ONE THAT GOVERNS THE
         * CONTAINER QUERY — this slot does not always hold an approximation. When the viewer's
         * display currency is USD, the amount above is the CONVERTED dollar figure and this span
         * holds the stored ĐỒNG price. Hiding it from assistive tech left a blind USD-viewing
         * user hearing "one hundred and fifteen dollars" and never the đồng price they would
         * actually pay — the same NĐ 340/2025 exposure the visual fix above addresses, reached
         * through the accessibility tree instead of the layout. Found by a reviewer immediately
         * after the visual half was fixed and the a11y half was not, which is the lesson: a rule
         * about "which figure is authoritative" has to be applied everywhere the figure is
         * suppressed, not just where it is hidden with CSS.
         *
         * ⚠️ WHEN IT IS A GENUINE ESTIMATE, THE WHOLE THING IS HIDDEN — NOT JUST THE OPERATOR.
         * A screen reader was announcing "eighty-one thousand VND ALMOST EQUAL TO three dollars"
         * — on every card in the feed, every rail, and every PDP. The `≈` is spoken, and the
         * conversion doubles the length of the single most-repeated string in the product.
         * It is a CONVENIENCE for sighted scanning, not information: the price is the amount
         * above it, and the converted figure is an estimate from a live FX rate that the copy
         * elsewhere is careful never to present as a price. Hiding the whole span leaves the
         * real amount announced once, cleanly.
         * ⚠️ Do NOT "fix" this by aria-hiding only the `≈` glyph — that leaves "eighty-one
         * thousand VND three dollars", two prices run together with nothing between them, which
         * is worse than the operator.
         *
         * ⚠️ `whitespace-nowrap` KEEPS THE OPERATOR WITH ITS NUMBER. On a narrow grid card the
         * price line is genuinely too long for one line — at 1024px the feed lays out cards at
         * 228px while "3,030,000 VND / service ≈ $115" measures ~271px at 18px — so it wraps,
         * and it used to break at the space INSIDE the approximation, stranding a lone "≈" at
         * the end of line one and "$115" on line two. That reads as a rendering fault rather
         * than a second currency. Now the whole approximation moves down together.
         * This does NOT stop the wrap itself, which predates the weight change.
         * ⚠️ A CORRECTION WORTH KEEPING, because the first version of this note was wrong in a
         * way that is easy to repeat: "tabular-nums, so 800 and 900 measure identically" was
         * measured on INTER, which is variable. `tabular-nums` equalises digit advances WITHIN a
         * face, not across weights, and Be Vietnam Pro is STATIC — 800 and 900 are separately
         * drawn files. Measured on the real face at 18px: "3.030.000 đ / dịch vụ ≈ $115" is
         * 258.16px at 800 and 261.04px at 900, so Vietnamese runs ~1.1% wider at 900. Not enough
         * to change any wrap decision recorded here (the grid card has ~48px of slack at 1280),
         * but do not reuse the "identical" claim — a reviewer caught it and was right.
         *
         * ⚠️ AND ON A NARROW ROW WITH A USD DISPLAY THIS SPAN IS NOT OPTIONAL, so it can run out
         * of room on a very large price. Measured at 390px, USD display, compact row:
         * "$115 ≈ 3,030,000 VND" is 139px inside a 162px column — comfortable. A nine-figure
         * property price is the case that would not fit. The alternative is worse (hiding the
         * đồng figure entirely, which is the compliance problem the guard above exists for), so
         * the real fix if that shows up is to make đồng the PRIMARY amount on narrow surfaces
         * for USD viewers — a product decision, not a styling one.
         */
        <span
          aria-hidden={approxIsEstimate}
          className={cn(
            'ml-1.5 whitespace-nowrap text-[0.8em] font-medium text-muted-foreground',
            // ⛔ `approxIsEstimate` GUARDS THE HIDE, AND THE UNGUARDED VERSION WAS A LIVE LEGAL
            // BUG ON THE DEFAULT FEED. `dual="sm"` is passed by the compact row — the default
            // browse view — so on a phone this span was `display: none` unconditionally. For a
            // viewer whose display currency is USD that span holds the ĐỒNG price, so the
            // marketplace showed a USD-only price to every USD-viewing mobile user: exactly the
            // NĐ 340/2025 exposure this component is otherwise careful about. Found by a reviewer
            // after the identical hole was fixed in a sibling code path and this one was not,
            // which is the lesson — the rule is about the FIGURE, so it belongs on every branch
            // that can suppress the figure.
            dual === 'sm' && approxIsEstimate && 'hidden sm:inline',
          )}
        >
          {/* ⚠️ THE GLYPH IS HIDDEN SEPARATELY IN THE NON-ESTIMATE BRANCH, AND ONLY THERE.
              With the span exposed (USD display, so this is the real đồng price), a screen
              reader was reading "ALMOST EQUAL TO one million three hundred twenty thousand
              đồng" over the figure two lines of comment above call legally authoritative —
              announcing the exact price as an approximation. `≈` is a visual shorthand for
              "converted", not a claim about this number.
              ⚠️ This is NOT the "aria-hide only the operator" fix the block above forbids. That
              warning is about the ESTIMATE branch, where both figures are announced and dropping
              the operator runs two prices together. Here the span itself is already hidden in
              that branch, so this only ever applies when the second figure is exact. */}
          <span aria-hidden={!approxIsEstimate}>{'≈'}</span> {approx}
        </span>
      )}
    </span>
  )
}
