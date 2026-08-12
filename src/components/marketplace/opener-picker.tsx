'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Clock } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import { haptic } from '@/lib/haptics'
import {
  SILENCE_COPY,
  openerString,
  openersFor,
  sellerSilence,
  silenceLine,
  type Opener,
  type OpenerListing,
  type SilenceInput,
} from '@/lib/openers'
import { cn } from '@/lib/utils'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

/**
 * ONE-TAP OPENERS FOR THE FIRST MESSAGE, plus the one honest thing a buyer deserves to know
 * before they spend a minute writing it.
 *
 * The blank composer at peak intent is the slowest thing on the screen, and the sentence it
 * produces — "Is this still available?" — is the one a seller has the least reason to answer.
 * Measured on the live database 2026-08-12: it was the FIRST message in 15 of 27 threads, and 6
 * of those 15 never got a reply. Every chip here costs the same one tap and carries either a
 * commitment or a specific question instead. The copy and the category rules are pure and live
 * in src/lib/openers.ts; this file is the surface.
 *
 * ── WHAT THIS COMPONENT IS DELIBERATELY NOT ─────────────────────────────────────
 * It is not a wizard, not a dialog, and not a gate. It renders a row of chips and at most one
 * line of prose above a composer that stays exactly as usable as it was. TYPING IS THE PRIMARY
 * PATH and must never become the harder one: the picker takes no focus, autofocuses nothing,
 * covers nothing, and sits in normal flow ABOVE the composer, so the input is still the first
 * thing a thumb lands on. If a change here would ever make the input harder to reach than a
 * chip, the change is wrong.
 */

/** A nearby listing offered beside the silence warning. The CALLER decides what "nearby" means
 *  (same category and area is the obvious reading) and supplies at most two — this component
 *  renders no more than two regardless, because a third turns a note into a shelf. */
export type OpenerAlternative = {
  id: string
  title: string
  href: string
  /** Optional asking price. Rendered through src/lib/vnd.ts like every other amount. */
  price?: number | null
  /** Raw listing currency, e.g. '₫'. Defaults to đồng. */
  currency?: string
}

export type OpenerPickerProps = {
  /** The listing being written about — category, subcategory, price, negotiable. */
  listing: OpenerListing
  /**
   * A chip was tapped. `text` is finished copy: translated for the active language and with the
   * money already substituted — put it straight into the composer.
   *
   * ⚠️ `opener.offerAmount` is non-null on the price-anchored chip, and it should NOT be sent as
   * a text line. Pass it to the send path as a STRUCTURED offer (`stashCompose({ body, offerAmount })`
   * / the kind='offer' message) so the seller gets an offer CARD they can accept in one tap. A
   * number baked into a sentence is a number nobody can accept.
   */
  onPick: (opener: Opener, text: string) => void
  /**
   * The seller's measured responsiveness facts, or null/undefined when the caller does not have
   * them. Everything about the honesty gates lives in `sellerSilence()` — pass the raw facts and
   * let it decide; do not pre-filter here.
   */
  silence?: SilenceInput | null
  /** Up to two nearby listings, shown with the warning. Ignored when there is no warning. */
  alternatives?: OpenerAlternative[]
  /**
   * The composer's CURRENT text. The warning retires on the first keystroke — it is a thing to
   * know BEFORE writing, and a note that survives the writing is just nagging — and it retires
   * FOR GOOD: emptying the field again does not bring it back (see the latch below).
   * The chips deliberately do NOT retire: a row that vanishes mid-keystroke would shift the
   * composer under a moving thumb.
   *
   * ⚠️ THE TEXT, NOT A `hasDraft` BOOLEAN, AND THE BOOLEAN IS WHAT KEPT FAILING. A level cannot
   * distinguish "the buyer started writing to THIS seller" from "there is text in the box",
   * and on a docked composer whose draft survives navigation those are different facts. Three
   * review rounds on 2026-08-12 walked the boolean through both failure modes: mirroring it
   * re-inserted the line when the field was emptied, latching on it hid the new listing's line
   * behind the old listing's text, and an edge over the boolean then left the line nagging for
   * the whole message because the level never changed. The text has an edge in every one of
   * those cases, and the caller already has it (ChatComposer's `value`).
   */
  draft?: string
  /** Injectable clock (tests, stories). Absent = the client clock, read after mount. */
  now?: number
  /**
   * `Listing.id` — the identity of the thing being written about (a thread id works equally well
   * on a docked composer). Changing it resets BOTH pieces of per-listing state: the pinned clock
   * and the warning latch.
   *
   * ⚠️ IT EXISTS BECAUSE THAT STATE IS INSTANCE-SCOPED AND THE FEATURE IS LISTING-SCOPED, which a
   * reviewer caught on 2026-08-12. A buyer types in listing A's composer, then client-navigates to
   * listing B whose seller is the measured-and-quiet one; if the same instance is reused, the latch
   * is still set and B's warning — the single case this feature exists for — never renders, while
   * B also inherits A's frozen time slot ("collect today at 6pm", at 19:00).
   *
   * ⚠️ AND IT IS REQUIRED, BECAUSE THE CONVENIENT VERSION WAS WORSE THAN NOTHING. It was briefly
   * optional with a fallback identity built from category|subcategory|price|unit|negotiable — and
   * all three reviewers, independently, pointed out that two standard motorbikes at 12,000,000 ₫
   * negotiable produce the identical string. On a classifieds marketplace that is not an edge case,
   * it is Tuesday. A fallback that silently collides is worse than no fallback, because it reads as
   * protection. My own test had dodged it by changing the price between the two listings.
   * `key={listingId}` on the element remains worth doing as belt-and-braces.
   */
  listingId: string
  className?: string
}

/**
 * The chip look, matching the quick-reply chips this replaces on the first-message surface
 * (src/components/marketplace/quick-reply-chips.tsx) so the two never disagree while both exist.
 * Paired with <Button variant="soft" size="none">: `soft` supplies the muted hover and leaves
 * the label colour to this class.
 *
 * ⚠️ RESTATED, NOT IMPORTED — the constant there is module-private. When the openers replace the
 * buyer-side quick reply for good, hoist ONE copy into a shared module rather than letting a
 * second one drift.
 */
const chipCls =
  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-muted hover:text-foreground cursor-pointer'

export function OpenerPicker({
  listing,
  onPick,
  silence,
  alternatives,
  draft = '',
  now,
  listingId,
  className,
}: OpenerPickerProps) {
  const { tr, lang } = useLanguage()
  const mounted = useMounted()

  /**
   * ⚠️ THE MOUNT GATE IS LOAD-BEARING, NOT DEFENSIVE. Both halves of this component are
   * CLIENT-CLOCK values: the commitment chip says "today at 6pm" before 3pm and "tomorrow at
   * 10am" after it, and the warning counts days. The PDP is a cacheable route (30d ISR), so
   * baked server HTML and a fresh client compute legitimately disagree, and the mismatch is
   * STRUCTURAL — a different chip, not different text — which suppressHydrationWarning does not
   * cover. Same reason and same hook as the presence bucket (src/hooks/use-mounted.ts).
   *
   * ⚠️ THE GATE APPLIES EVEN WHEN THE CALLER PINS `now`, AND AN EARLIER VERSION DID NOT — codex
   * refuted it (2026-08-12) and was right. The commitment slot is chosen from
   * `new Date(now).getHours()`, i.e. the LOCAL hour of whichever machine evaluates it. A pinned
   * epoch is therefore NOT a pinned slot: a Server Component passing `now` renders it in the
   * container's timezone (UTC on Cloud Run) while the browser renders the same number in
   * Asia/Ho_Chi_Minh — seven hours apart, straddling the 15:00 cutoff for most of the day. So
   * `now` overrides the clock's VALUE, never the mount gate; the server emits no chip either way.
   *
   * ⚠️ THE SLOT IS DECIDED ONCE PER MOUNT AND DOES NOT RE-TICK — AND `Date.now()` IN THE RENDER
   * BODY DID NOT ACTUALLY DO THAT. An earlier version wrote `mounted ? (now ?? Date.now()) : null`
   * and claimed this paragraph; antigravity refuted it (2026-08-12) and was exactly right. A bare
   * `Date.now()` in the body re-evaluates on EVERY render, so a buyer who opened the composer at
   * 14:59 and typed their first letter at 15:01 would watch the chip mutate from "today at 6pm"
   * to "tomorrow at 10am" under their thumb — the parent re-renders to flip `hasDraft`, and the
   * clock moved with it. Worse, the whole test file passed a pinned `now`, which short-circuits
   * `??` and masks the behaviour completely. `useState(() => …)` runs its initialiser once per
   * mounted instance, which is what the paragraph always meant.
   *
   * What is left is a bounded imprecision worth stating rather than hiding: a composer opened at
   * 14:59 and tapped at 18:01 sends "today at 6pm" a minute after 6pm. That needs the surface to
   * sit open for THREE HOURS across the 3pm boundary, by which point the price and the
   * availability on the page behind it are stale too. A five-minute interval would close it and
   * would also re-render every open composer in the app forever; the trade is deliberate.
   */
  /**
   * ONE PIECE OF STATE FOR ONE LISTING: the clock pinned at the moment this listing's composer
   * appeared, and whether the buyer has started writing to it.
   *
   * ⚠️ STATE, NOT A REF, AND THE FIRST VERSION WAS A REF MUTATED DURING RENDER. `writtenRef.current
   * = true` in the render body is a purity violation: React may abort a render before committing
   * it, and the mutation survives the abort — so a discarded render with `hasDraft` could suppress
   * the warning forever without one ever having been on screen. A reviewer flagged it on
   * 2026-08-12. Adjusting state during render by comparing against the previous props is the
   * pattern React documents for exactly this, and it is discarded with the render that set it.
   *
   * ⚠️ THE LATCH IS NOT A MIRROR OF `hasDraft`. That prop describes the composer's CURRENT
   * contents, so select-all-and-delete flips it back to false and would RE-INSERT the warning
   * under a buyer mid-edit. The brief said "once", and a line that can come back is not once.
   */
  const [session, setSession] = useState(() => ({
    identity: listingId,
    clock: Date.now(),
    written: false,
    draft,
  }))
  if (session.identity !== listingId) {
    // A different listing is a different everything: new clock, no latch, and the baseline seeded
    // from whatever is in the box right now — so a carried-over sentence is not read as writing.
    setSession({ identity: listingId, clock: Date.now(), written: false, draft })
  } else if (session.draft !== draft) {
    /**
     * ⚠️ THE LATCH CLOSES WHEN THE TEXT CHANGES ON THIS LISTING — the one event that actually
     * means "the buyer is writing to this seller". Any change counts, including clearing the
     * field, because a buyer who typed and deleted has still seen the line and does not need it
     * pushed back at them; and a carried-over draft that is never touched leaves the line up,
     * which is the harmless direction.
     *
     * Three earlier versions failed here, each caught by review on 2026-08-12 and each recorded
     * because the next person will reach for the same shortcut: mirroring a `hasDraft` boolean
     * re-inserted the line when the field was emptied; resetting the latch on a listing change
     * was INERT, because setting state during render re-renders immediately and the level-based
     * branch flipped it straight back; and an edge over the BOOLEAN then nagged for the whole
     * message, since a carried-over draft never changes the level at all.
     */
    setSession({ ...session, draft, written: true })
  }

  const clock = mounted ? (now ?? session.clock) : null
  const openers = clock == null ? [] : openersFor(listing, clock)
  const quiet = clock == null || !silence ? null : sellerSilence(silence, clock)
  const alts = (alternatives ?? []).slice(0, 2)

  const pick = (o: Opener) => {
    haptic()
    onPick(o, openerString(o, o.text, tr, lang))
  }

  return (
    /*
     * min-h-8 is the CHIP ROW's own height, reserved from the first paint so the post-mount
     * fill-in cannot shift the composer under the buyer's thumb.
     *
     * ⚠️ IT DOES NOT COVER THE WARNING, and an earlier version of this comment implied it did —
     * both reviewers caught the overclaim (2026-08-12). The warning line is ~34px that appears
     * after mount and disappears again on the first keystroke, so it shifts twice. Reserving for
     * it permanently would spend that space on every listing to serve the rare measured-and-quiet
     * seller (ONE of eleven, measured), and keeping it on screen while the buyer types turns a
     * one-time note into a nag. Two shifts on a rare path beat a permanent hole or a permanent
     * nag; recorded as a deliberate trade rather than hidden behind a class name.
     */
    <div className={cn('min-h-8', className)}>
      {quiet && !session.written && (
        <Alert
          tone="default"
          appearance="flat"
          size="xs"
          className="mb-1.5 rounded-xl"
          icon={<Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          /**
           * ⚠️ POLITE, OVERRIDING ui/alert's role="alert". This line appears one frame after
           * mount, and an assertive live region interrupts a screen-reader user mid-sentence to
           * announce something that is context, not an emergency. An explicit aria-live wins over
           * the implicit assertive that role=alert carries.
           *
           * ⚠️ AND IT MAY WELL NOT ANNOUNCE AT ALL — a live region INSERTED into the DOM (rather
           * than present and then filled) is unreliably announced across screen readers, which a
           * reviewer raised on 2026-08-12. That is acceptable HERE and would not be for a real
           * alert: this is static context sitting in reading order immediately above the
           * composer, so a user who reaches the composer reaches the sentence. What must not
           * happen is the opposite — an assertive interruption for a note.
           */
          aria-live="polite"
        >
          <div className="min-w-0">
            {/*
              The wording is one verifiable fact and nothing more: no "unreliable", no score, no
              comparison with other sellers, and — since the reviewer refutation — no claim about
              the seller's habits at all, only about a message that really is sitting unanswered.
              The buyer may well be right to write anyway; this is information, not a verdict.
            */}
            <p className="text-body">{silenceLine(quiet.days, tr)}</p>
            {alts.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ink-4">{tr(SILENCE_COPY.alternatives.en, SILENCE_COPY.alternatives.vi)}</span>
                {alts.map((a) => (
                  <Link
                    key={a.id}
                    href={a.href}
                    className="max-w-[14rem] truncate rounded-full bg-tint px-2.5 py-1 font-medium text-ink-2 transition-colors hover:text-foreground"
                  >
                    {a.title}
                    {typeof a.price === 'number' && a.price > 0 && (
                      <span className="ml-1 text-ink-4">
                        {formatMoneyFull(a.price, a.currency || '₫', moneyLocale(lang))}
                      </span>
                    )}
                  </Link>
                ))}
              </p>
            )}
          </div>
        </Alert>
      )}

      {/* The group is CONDITIONAL, not merely empty, before the clock arrives: a labelled group
          with no children is a thing a screen reader announces and a sighted user cannot see. */}
      {openers.length > 0 && (
      <div
        role="group"
        aria-label={tr('Suggested openers', 'Gợi ý mở lời')}
        className="flex gap-1 overflow-x-auto scrollbar-none"
      >
        {openers.map((o) => (
          <Button
            key={o.id}
            variant="soft"
            size="none"
            onClick={() => pick(o)}
            className={chipCls}
            /* The chip previews the message; the full sentence goes into the composer, where the
               buyer reads and edits it before anything is sent. Nothing here auto-sends. */
            title={openerString(o, o.text, tr, lang)}
          >
            {openerString(o, o.label, tr, lang)}
          </Button>
        ))}
      </div>
      )}
    </div>
  )
}
