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
/** Nominal đồng-per-dollar, expressed the way /api/fx publishes it (currency per 1 VND), used
 *  ONLY to size the invisible placeholder that reserves the approximation's slot before the real
 *  table arrives. It is never displayed and never used for a figure a viewer can read, so it does
 *  not need to be accurate — only the right order of magnitude, so the reserved box is the right
 *  number of digits wide. */
const FX_RESERVE_RATES = { USD: 1 / 26_000 }

export function Price({ price, currency, priceUnit, compact = false, dual = true, unit: showUnit = true, className }: Props) {
  void compact // amounts are always shown in full now
  const { lang, tr } = useLanguage()
  const { currency: displayCur, rates, ratesPending, format } = useCurrency()
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
  // ⚠️ NO LEADING SPACE — the space that separates the suffix from the amount is rendered as its
  // own text node OUTSIDE both nowrap spans, because that space is the ONLY break opportunity the
  // price line has. See the suffix markup below.
  const suffix = !isFree && unitRaw && showUnit !== false ? `/ ${unit}` : null

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
  // ⚠️ TRUE WHEN `approx` HOLDS A STAND-IN, NOT A RATE. See the block below the assignment.
  let approxReserved = false
  // `dual`/`unit` of 'fit' are truthy here on purpose: the element is always RENDERED and hidden
  // by a container query in CSS. Deciding it in JS would need the container's width, which is not
  // known at render and would tear on resize.
  if (dual !== false && currency === '₫' && price > 0) {
    if (displayCur === 'USD') approx = formatMoneyFull(price, '₫', locale)
    else if (vndPerUsd(rates)) approx = formatMoney(price, 'USD', rates, locale)
    // ⛔ THIS BRANCH RENDERS A FIGURE THAT IS NEVER SHOWN, AND THAT IS THE ENTIRE POINT.
    // /api/fx is deferred to an idle slot for the default VND viewer, so the "≈ $x" slot used to
    // appear ~620ms after paint and push everything under it down a line: on the PDP the whole
    // desktop buy box — H1, metadata and the Chat CTA — dropped 26px on every first visit, which
    // is a CLS hit on the most valuable page in the app. Rendering the slot from a FIXED nominal
    // rate reserves its width in the SSR HTML, so the real approximation lands into a box that is
    // already the right size and nothing moves.
    // ⚠️ IT IS `invisible`, NOT a rate we are willing to publish: visibility:hidden keeps the
    // geometry and paints nothing, and the span is aria-hidden below, so no viewer and no screen
    // reader ever meets this number. NĐ 340/2025 is about the figure a shopper SEES; a stand-in
    // that is never seen is a layout box, not a price. Do not "fix" it by making it visible, and
    // do not swap `invisible` for `opacity-0` (still hit-testable) or `text-transparent`
    // (selectable, and copied into the clipboard as a confidently wrong dollar figure).
    // ⚠️ IT RESERVES THE WIDTH FOR 99.7% OF PRICES, NOT ALL OF THEM, AND THE GAP IS MEASURED.
    // tabular-nums above makes every digit the same width, so the stand-in and the real
    // approximation differ only when the digit COUNT does. Swept every 10 000 ₫ from 50 000 to
    // 2bn against 25 000/25 500/26 000/26 500/27 000 ₫ per $ — 999 980 pairs: 99.67% identical
    // width, 0.30% off by one character, 0.03% off by two. The two-character case is a price that
    // straddles $1 000 ($961 vs $1,000 — the thousands comma arrives with the digit), which a
    // reviewer found after the first version of this comment claimed one character was the worst
    // case.
    // ⚠️ SO THE CLAIM IS 99.67%, NOT "NO SHIFT", and a second reviewer was right to press on the
    // difference: on a card narrow enough to have less than two characters of slack, a price in
    // that 0.33% can still cross the `<wbr>` when the real rate lands and take the second line
    // with it. That is the same failure this replaces, at 1/300th the frequency, and closing the
    // remainder needs a server-rendered rate rather than a nominal one. Do not restate this as
    // "exact", and do not widen the reserve to hide it — a wider box is a visible gap on the
    // 99.67%.
    // ⚠️ A STORED USD VIEWER IS NOT SERVED BY THIS AND CANNOT BE. `displayCur` is read from
    // localStorage in an effect, so on the server every viewer looks like a VND one and gets the
    // dollar-shaped stand-in; a viewer whose stored currency is USD then hydrates into branch one,
    // where the second slot holds the full đồng price and the box grows. That shift is older than
    // this code — the same viewer previously went from NO span to the đồng string, so the reserve
    // makes their jump smaller, not larger — and closing it needs the display currency in the SSR
    // response, not a better placeholder. Noted so the next reader does not re-derive it.
    else if (ratesPending) { approx = formatMoney(price, 'USD', FX_RESERVE_RATES, locale); approxReserved = true }
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
    // With the real face rendering the weight finally mattered: 900 read too heavy at price size
    // ("too bold try 800"), then the app moved to Open Runde, whose ceiling IS 700 — four static
    // cuts, no variable axis — and the owner settled on 700 ("make prices 700"). So this is Bold,
    // the heaviest the family has, and globals.css retargets 800/900 to 700 for the same reason.
    <span className={cn('tabular-nums font-bold', className)}>
      {/**
        * ⛔ THE AMOUNT AND ITS UNIT ARE ONE UNBREAKABLE RUN. Without this the price broke between
        * the number and the currency word on EVERY phone width — measured on the home feed, 12 of
        * 12 cards at 320px, 360px and 390px, 8 of 12 at 430px: the block rendered 45px tall against
        * a 23px line-height, i.e. "9,490,000" on line 1 and "VND ≈ $361" on line 2. On the
        * most-repeated element in the product.
        * ⚠️ IT IS NOT A WIDTH PROBLEM — "9,490,000 VND" measures 135px inside a 175px column. It was
        * pushed over only because the `≈ $361` sub-span shares the same inline run, so the line
        * filled and the break landed at the last space before it. Widening the column would not
        * have fixed it; this does, and leaves the conversion free to wrap, which is the wrap the
        * comment below deliberately keeps.
        * ⛔ IT WRAPS THE AMOUNT+UNIT ONLY, NOT THE WHOLE SPAN. `whitespace-nowrap` on the parent
        * would force "9,490,000 VND ≈ $361" onto one line and overflow the card instead.
        * ⚠️ HOW TO RE-MEASURE IT: `height > lineHeight * 1.6`. `getClientRects().length` returns 1
        * for this span even when the text occupies two lines — that metric is what made me refute
        * this bug as a false positive the first time it was reported.
        */}
      <span className="whitespace-nowrap">{amount}</span>
      {/* ⛔ THE UNIT SUFFIX IS ITS OWN NOWRAP RUN, SEPARATED FROM THE AMOUNT BY A REAL SPACE — so
          the price can wrap at the unit and NOWHERE else. Until 2026-09-05 the suffix sat INSIDE
          the amount's nowrap span, which made "2,370,000 VND / service" one unbreakable run; the
          `unit` doc above promised "if a card cannot fit the price, the price WRAPS" and the DOM
          could not deliver it. MEASURED on eno.vn ?q=visa, 2-column feed: 8 of 8 service cards
          overflowed — by 24–40px at 390 (179px column), 39–57px at 360, 73–77px at 320 — and the
          run painted straight over the neighbouring card. The owner reported it twice ("the text
          overlaps"); the first fix (`unit="sm"`, f780cc23) applied only to rows that PASS `unit`,
          and the card never did — hiding "/ month" on a card is the meaning change the doc above
          forbids anyway. After: "2,370,000 VND" on line 1, "/ service ≈ $91" on line 2, 45px tall —
          the two-line height the skeleton already reserves. Zero overflowing cards at 320–430.
          ⚠️ The suffix is nowrap on its own so "/ dịch vụ" never strands a lone "/" at a line end
          (the same fault the approximation below guards against). ⚠️ The separating space lives
          OUTSIDE both nowrap spans — a space at the start of a nowrap span is not a break
          opportunity, and two adjacent nowrap inlines with nothing between them cannot break at all
          (the `<wbr>` lesson below). For the 'sm' variant the space is inside the hidden wrapper so
          the compact row's one-line width is unchanged below sm. */}
      {suffix && (
        <span className={showUnit === 'sm' ? 'hidden sm:inline' : undefined}>
          {' '}
          <span className="whitespace-nowrap">{suffix}</span>
        </span>
      )}
      {/* ⛔ A ZERO-WIDTH BREAK OPPORTUNITY, AND WITHOUT IT THIS ROW CANNOT WRAP AT ALL. Both spans
          carry `whitespace-nowrap` and JSX strips the newline between them, so there is no text
          node here — and two adjacent inline boxes with no intervening whitespace offer the line
          breaker NOWHERE to break. The comment above claims the amount+unit wrap "wraps the amount
          only, not the whole span"; that was true of the intent and false of the DOM. Measured on a
          real card: "58,990,000 VND ≈ $2,246" rendered 218px on ONE line inside a 164–199px column,
          overflowing by 21px at 430 and 56px at 360 and painting over the NEXT card in the grid.
          Owner reported it as "some overlap issue" with a screenshot of exactly that collision.
          ⚠️ `<wbr>`, NOT a space: a space would add to the 6px `ml-1.5` and widen the one-line case
          that fits today. `<wbr>` is invisible until the break is needed. Measured after: 195px on
          two lines at 430 (2px of slack), 45px tall — which is the two-line height
          listing-card-skeleton.tsx ALREADY reserves, so the grid's footer alignment is unaffected.
          ⛔ Do not "tidy" this away as a stray tag, and do not replace it with `truncate` — half a
          price reads as the whole price to a shopper, which price-drop code here already argues. */}
      {approx ? <wbr /> : null}
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
          aria-hidden={approxIsEstimate || approxReserved}
          /** ⛔ INLINE, NOT ONLY THE UTILITY CLASS, AND A REVIEWER IS WHY. `invisible` lives in the
           *  stylesheet; the stand-in figure is real text in the SSR HTML. On any load where the
           *  stylesheet is blocked, fails or is stripped — a corporate proxy, a reader mode — the
           *  class does nothing and a fabricated dollar amount becomes visible and selectable
           *  beside a real đồng price.
           *  ⚠️ IT DOES NOT COVER A CLIENT THAT IGNORES CSS ALTOGETHER, and an earlier version of
           *  this comment claimed it did. Something that drops `style=` along with the stylesheet
           *  still sees the digits; so does anything reading `textContent`. What the inline style
           *  buys is the far more common case — the CSS never arrives — and nothing beyond it.
           *  Closing the remainder means not rendering the figure at all, which costs the
           *  reservation this whole branch exists for. That is the exact NĐ 340/2025
           *  exposure the rest of this component is built to avoid, so the hiding travels with the
           *  element itself. The class stays too: it is what tailwind-merge and any future variant
           *  reason about. */
          style={approxReserved ? { visibility: 'hidden' } : undefined}
          className={cn(
            'ml-1.5 whitespace-nowrap text-[0.8em] font-medium text-muted-foreground',
            approxReserved && 'invisible',
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
