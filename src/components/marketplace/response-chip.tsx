'use client'

import { Clock } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { responseSignal, type ResponseFacts, type ResponseSignal, type ResponseTier } from '@/lib/response-signal'

/**
 * HOW LONG A BUYER WILL WAIT FOR AN ANSWER — the card-level chip.
 *
 * All of the judgement lives in src/lib/response-signal.ts; read its header first, because the one
 * rule this component exists to obey is stated there: a seller the nightly job has never measured
 * has NO signal, and NO signal renders NOTHING. Not a grey placeholder, not "New seller", not an
 * optimistic default — Seller.responseRate defaults to 100 and any chip drawn from that default is
 * a promise the shop never made. Both exports below return `null` for that case, and it is the
 * only branch in this file worth defending.
 *
 * ⚠️ THE CHIP NEVER TURNS RED, AND THAT IS A PRODUCT DECISION, NOT AN OVERSIGHT. `slow` renders in
 * the same quiet neutral as `ok`. The spec for this signal is that slow sellers rank LOWER and are
 * NEVER HIDDEN — the listing is real and the seller is real — and a warning-coloured chip on a
 * seller's own card is a punishment the ranking already administered once, in the only place it
 * belongs. What `slow` earns here is a plain sentence — "Replies in a few days", or "Often no
 * reply within a day" for a seller below the reply-rate floor — which is the single most useful
 * thing a buyer can know before opening a thread. The words carry the fact; the colour must not
 * carry a verdict.
 */

/**
 * Tone per tier. Only `fast` is coloured, and it borrows `success` — the one token in the badge
 * palette that means "this is good news" without reaching for brand blue, which docs/
 * design-language.md reserves for price and trust. Two of the three tiers deliberately share
 * `neutral`: see the header.
 */
const TONE: Readonly<Record<ResponseTier, 'success' | 'neutral'>> = {
  fast: 'success',
  ok: 'neutral',
  slow: 'neutral',
}

/**
 * The chip, given an ALREADY-COMPUTED signal. No clock read, no mount gate — so WHETHER it renders
 * and WHICH tier it renders are identical on the server and the client.
 *
 * USE THIS on a surface that is not cached — the dashboard, the message thread, a search page
 * rendered per request — where the server can compute `responseSignal(facts, Date.now())` at
 * request time and the answer is fresh by construction. The element is present in the SSR HTML, so
 * there is no layout shift.
 *
 * ⚠️ "IDENTICAL" IS ABOUT THE ELEMENT, NOT THE WORDS, and this comment used to overstate it. A
 * reviewer pointed out that LanguageProvider resolves the reader's language in a MOUNT EFFECT
 * (response-chip.test.tsx's header records the same fact), so the server pass emits tr()'s English
 * and the first client commit swaps in Vietnamese. That is true of every tr() call site in this
 * app, it is the provider's behaviour rather than this component's, and it is a text swap on one
 * node rather than an element appearing — which is exactly the class `suppressHydrationWarning`
 * covers and the class the mount gate below exists for the OTHER of.
 *
 * ⛔ DO NOT USE IT on an ISR/edge-cached route. See <ResponseChip>.
 */
export function ResponseChipView({
  signal,
  className,
}: {
  signal: ResponseSignal | null | undefined
  className?: string
}) {
  const { tr } = useLanguage()
  if (!signal?.measured || !signal.tier) return null

  // ⚠️ HOISTED, NOT INLINED. `react/jsx-no-literals` is an ERROR in `npm run lint` (its own CI
  // step) and cannot tell a computed label from hardcoded English in JSX position.
  //
  // ⚠️ tr(), NOT `lang === 'vi' ? vi : en`. Both shapes exist in this codebase (seller-card.tsx
  // uses the first, trust-meta.tsx the second) and only the first serves the other nine languages:
  // tr() falls through to the runtime MT cache for anything that is not en/vi, while the ternary
  // hands a Korean reader the English string forever.
  //
  // ⚠️ THE ARGUMENTS ARE VARIABLES, SO scripts/gen-ui-strings.mjs NEVER SEES THESE STRINGS — it
  // harvests single-quoted literal `tr(` arguments only. That is the SAME arrangement
  // seller-card.tsx already uses for the response bucket, and it is not a correctness bug: tr()'s
  // fallback path calls translateText() at runtime and repaints, so the other nine languages are
  // served, just not pre-warmed. What it DOES mean is a cache key per distinct English string —
  // fine for the six fixed coarse labels, and a reason to prewarm deliberately if the exact-median
  // path in response-signal.ts ever goes live, since "Replies in ~N min" generates a new key per N.
  const visible = tr(signal.label.en, signal.label.vi)
  const spoken = tr(signal.aria.en, signal.aria.vi)

  return (
    <Badge
      variant={TONE[signal.tier]}
      size="sm"
      data-slot="response-chip"
      data-tier={signal.tier}
      className={cn('gap-1', className)}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {/* Visible text is hidden FROM the accessible tree and replaced by `spoken`, which spells
          "~" out as "about". Same split, and the same reason, as <CountChip>: a chip whose visible
          form is punctuation-dependent must not BE the accessible name. */}
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{spoken}</span>
    </Badge>
  )
}

/**
 * The chip, given the raw measured FACTS. Computes the signal against the CLIENT clock, after
 * mount.
 *
 * USE THIS EVERYWHERE THE PAGE CAN BE CACHED — the PDP is `revalidate = 30d`, browse HTML sits
 * behind a Cloudflare cache rule, and cards are rendered on both.
 *
 * ⚠️ THE MOUNT GATE IS LOAD-BEARING, TWICE OVER, AND IS NOT DECORATION.
 *  1. CORRECTNESS. The receipt is only honoured for RECEIPT_MAX_AGE_DAYS. A server-baked answer on
 *     a 30-day ISR page keeps asserting a reply time whose 8-day receipt expired three weeks
 *     earlier — the chip would OVER-claim, which is the exact failure mode this whole feature is
 *     built to avoid. Deciding it against the viewer's clock caps that at 8 days.
 *
 *     ⚠️ IT CAPS THE OVER-CLAIM, IT DOES NOT ELIMINATE IT, AND THIS COMMENT USED TO SAY OTHERWISE.
 *     It read "a stale page can only ever DROP a chip it should have shown, never show one it
 *     should not", which a reviewer correctly refuted: the client clock ages the BAKED receipt, it
 *     cannot see new FACTS. A PDP baked with rate 95 / 'within an hour' keeps rendering that after
 *     the nightly job re-measures the seller to rate 20, until the baked receipt's own 8 days run
 *     out. 30 days down to 8 is the real improvement; "never" was the wrong word. Closing the rest
 *     needs revalidation on the seller, not a cleverer clock read. (src/lib/last-seen.ts CAN claim
 *     the strict asymmetry, because presence has no facts to go stale — only an age.)
 *  2. HYDRATION. The server and a fresh client legitimately DISAGREE on a stale page, and the
 *     disagreement is an element appearing or disappearing — a structural mismatch, which
 *     `suppressHydrationWarning` does not cover (it only reconciles text). Rendering nothing until
 *     mounted is what makes the two passes agree; useMounted()'s own header records this.
 *
 * THE COST, STATED: the chip is absent from the SSR HTML and fades in on the first client render,
 * so a card's meta row can reflow by one chip width. It sits in an inline wrap row rather than a
 * fixed grid, so it pushes rather than jumps, and there is no honest way to reserve space for it —
 * whether the chip exists at all is the very thing that is not known until the clock is read.
 */
export function ResponseChip({
  facts,
  className,
}: {
  /** The measured facts. `null`/`undefined` renders nothing, so a caller whose payload does not
   *  carry them yet can pass through without a guard. */
  facts: ResponseFacts | null | undefined
  className?: string
}) {
  const mounted = useMounted()
  // Both hooks run unconditionally, above every early return — ResponseChipView owns useLanguage.
  if (!mounted || !facts) return null
  // ⚠️ THE CLOCK IS READ AT RENDER AND NOTHING RE-READS IT ON A TIMER, so a mounted chip does not
  // expire on its own. ⚠️ AND THE FIRST VERSION OF THIS NOTE GOT THE SIZE WRONG — it said the
  // failure "needs a tab open for over a week", which a reviewer corrected: what has to elapse is
  // not the 8-day window but whatever REMAINS of it at mount, so a chip opened at 7d23h goes stale
  // one minute later. Accepted anyway, and the reason is the grid: the fix is an interval per chip
  // and a 40-card browse page would then carry 40 timers, all to correct a claim on a page nobody
  // has looked at since the boundary passed. <LiveUntil> makes the opposite call for the
  // price-drop badge, whose window is hours rather than days — if this window is ever shortened,
  // that is the precedent to follow.
  return <ResponseChipView signal={responseSignal(facts, Date.now())} className={className} />
}
