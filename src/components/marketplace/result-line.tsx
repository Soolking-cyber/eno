'use client'

import * as React from 'react'
import { Bookmark } from 'lucide-react'

import { RemovableBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { groupVnd, moneyLocale } from '@/lib/vnd'

/**
 * THE RESULT LINE — the one sentence the explorer says back to the user after every tap:
 * how many things they are looking at, which taps got them here, which filters are on, and
 * (once it is worth it) an offer to keep this search.
 *
 * PURE AND PROPS-DRIVEN ON PURPOSE. It owns no filter state, no URL, no query. The explorer
 * (which owns all three) hands it a count, a ladder and an ORDERED list of active filters, and
 * gets back callbacks. That is what makes it testable without a router, a DB or a network — and
 * what stops the third copy of the chip row appearing (there are two hand-rolled ones inside
 * `listings-explorer.tsx` today, in `renderSaveBox` and `renderEmptyState`, and they have already
 * drifted apart: one wraps chips at `text-xs font-semibold` in a brand-50 tray, the other at
 * `rounded-xl` with no tray at all).
 */

/** tr from useLanguage(), passed explicitly into the pure helpers so they are testable
 *  without a LanguageProvider. Signature matches LanguageContextProps['tr'] exactly. */
export type TrFn = (en: string, vi?: string) => string

/** One rung of the ladder the user climbed: "Vehicles" › "Manual" › "Honda" › "Vision". */
export type ResultCrumb = {
  /** Already localised by the caller — these are taxonomy words, and the taxonomy owns
   *  its own en/vi fields (see src/lib/taxonomy.ts). */
  label: string
  /** Optional: makes this rung a control that climbs back down to it. The LAST rung is
   *  always inert (it is where you are), whatever this says. */
  onSelect?: () => void
}

/**
 * One active filter. ⚠️ These arrive as an ARRAY, never a Set or a `Record<facet, value>`,
 * because THE ORDER IS DATA: the row must read back in the order the user picked, so the
 * newest choice is the last chip and the first thing to reach for is the thing they just did.
 * A record would hand us insertion order by accident and lose it the moment a value is
 * replaced rather than added (re-assigning an existing key keeps its ORIGINAL position, so
 * changing the district would leave the district chip stranded at position 1).
 */
export type ResultFilter = {
  /**
   * Stable identity — the facet key ('district', 'brand', 'price') is fine, INCLUDING for a
   * facet the user can pick twice. ResultLine identifies a chip by `id` + `label` (that pair is
   * both the React key and the focus-restore identity), so two districts keyed 'district' are
   * safe. Two chips identical in BOTH id and label are the same filter listed twice, which is a
   * caller bug and warns in development.
   */
  id: string
  /** Visible chip text, already localised. */
  label: string
  onRemove: () => void
  /** Optional: tapping the chip's LABEL re-opens this filter. It never removes — see the
   *  RemovableBadge header for why. */
  onReopen?: () => void
}

export type ResultLineProps = {
  /** Total matching listings. Clamped to a non-negative integer before formatting. */
  count: number
  /** The ladder, root first. Omit/empty for an unfiltered feed. */
  crumbs?: ResultCrumb[]
  /** Active filters IN PICK ORDER. See ResultFilter. */
  filters: ResultFilter[]
  /** THE CALLER DECIDES. The rule is `shouldOfferSaveSearch(filters.length)` — offered from
   *  the SECOND filter tap on — but the explorer may also have already saved this search, or
   *  be showing a signed-out visitor, and the primitive cannot know either. */
  showSaveSearch?: boolean
  onSaveSearch?: () => void
  /** Optional: renders "Clear all" beside the chips, only when there is more than one to clear. */
  onClearAll?: () => void
  className?: string
}

/**
 * ⚠️ THE SAVE-SEARCH THRESHOLD, EXPORTED SO THERE IS ONE COPY OF IT.
 * One filter is browsing; two is an intent worth keeping. Offering at the first tap trains
 * people to dismiss the offer, and offering only at the fourth means almost nobody sees it.
 *
 * ⚠️ IT COUNTS ACTIVE FILTERS, NOT TAPS, AND THE TWO ARE NOT THE SAME. The spec says "after
 * the second filter tap"; a user who picks a district and then CHANGES that district has
 * tapped twice and still has one chip, so no offer appears. That is deliberate rather than
 * unnoticed: tap history is not in these props and a pure component cannot invent it, and of
 * the two readings the ACTIVE-FILTER one is the honest signal — it asks "is this search
 * specific enough to be worth keeping?", which is the question the offer is really about. A
 * caller that genuinely wants tap-count semantics owns the history and can pass
 * `showSaveSearch` from it — but only to SUPPRESS; the floor below still applies.
 */
export const SAVE_SEARCH_MIN_FILTERS = 2
export function shouldOfferSaveSearch(activeFilterCount: number): boolean {
  return activeFilterCount >= SAVE_SEARCH_MIN_FILTERS
}

/**
 * How long a pending focus-restore stays armed. Long enough for a router transition to land,
 * short enough that a removal the caller silently drops cannot move focus later in the session.
 * If it expires the user simply keeps the focus behaviour they have today — no regression.
 */
const FOCUS_INTENT_TTL_MS = 5000

/**
 * "2,418 listings" / "2.418 tin đăng".
 *
 * ⚠️ VIETNAMESE HAS NO PLURAL INFLECTION, so this does NOT build an English string and
 * translate it. It picks the NOUN per language and lets each language answer the plural
 * question its own way: `tr('listing', …)` and `tr('listings', …)` are two independent
 * catalogue entries, and the Vietnamese side of both is the same invariant "tin đăng". If
 * this instead did `tr(\`${n} listings\`)` it would be wrong twice over — it would ask a
 * translator to inflect a noun that does not inflect, AND a template literal is invisible to
 * `scripts/gen-ui-strings.mjs` (it harvests quoted `tr(` arguments only), so the string would
 * never reach the catalogue and all eleven machine-translated languages would fall back to
 * English. Both halves here are plain single-quoted literals with no apostrophes, which is
 * what the harvester can actually see.
 *
 * ⚠️ KNOWN LIMIT, STATED SO NOBODY READS MORE INTO THIS THAN IT DOES: the split is BINARY
 * (one / not one). That is exactly right for en and for vi, and wrong for the Slavic
 * languages in the roster — Russian needs three forms (1 / 2–4 / 5+), so "2,418 listings"
 * translated word-for-word lands on the wrong one. Closing that needs `Intl.PluralRules`
 * and a plural-aware catalogue entry; measured, the repo contains ZERO uses of
 * `Intl.PluralRules` today, so this is a pre-existing app-wide gap and not something this
 * line introduces. Do not "fix" it here by adding English plural rules — that is the
 * failure this helper exists to avoid.
 *
 * ⚠️ THE NUMBER GOES THROUGH `groupVnd`, NOT `formatCount`. formatCount is the repo's COMPACT
 * count formatter and it is the wrong tool here: measured, `formatCount(2418)` returns '2.4k'
 * (src/lib/vnd.test.ts pins the same behaviour at 1200 → '1.2k'), which throws away the exact
 * figure this line exists to state. `groupVnd` is the grouping half of the same module and is
 * the only thing that gets the Vietnamese separator right — vi groups thousands with a DOT
 * ("2.418"), en with a comma ("2,418"). The test file asserts both, and asserts the
 * formatCount value too so the reason this call is not formatCount cannot rot silently.
 */
export function resultCountLabel(count: number, lang: string, tr: TrFn): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  const n = groupVnd(String(safe), moneyLocale(lang))
  const noun = safe === 1 ? tr('listing', 'tin đăng') : tr('listings', 'tin đăng')
  return `${n} ${noun}`
}

/**
 * Accessible name for a chip's ✕: "Remove Thảo Điền" / "Bỏ Thảo Điền".
 *
 * The verb is a catalogue string, the value is data, and they are joined here rather than
 * inside tr() for the harvester reason above. Vietnamese uses "Bỏ" (drop) rather than "Xóa"
 * (delete): the filter is being lifted, not destroyed, and "Xóa Thảo Điền" reads like it
 * deletes the district.
 *
 * ⚠️ SAME KNOWN LIMIT AS THE PLURAL, AND FOR THE SAME REASON: this hard-codes VERB-THEN-VALUE
 * word order. That is right for en and vi and wrong for a verb-final language; a language whose
 * grammar wants the value first cannot express that, because `tr()` translates a whole string
 * and has no placeholder form to reorder around. The alternative — putting the value inside the
 * tr() literal — is strictly worse: the string becomes unharvestable AND unbounded (one
 * catalogue entry per district). Fixing this properly means a placeholder-aware catalogue, which
 * is an app-wide change. Every screen-reader user still hears the value, which is the property
 * that mattered enough to build this helper.
 */
export function removeFilterLabel(label: string, tr: TrFn): string {
  return `${tr('Remove', 'Bỏ')} ${label}`
}

export function ResultLine({
  count,
  crumbs,
  filters,
  showSaveSearch = false,
  onSaveSearch,
  onClearAll,
  className,
}: ResultLineProps) {
  const { lang, tr } = useLanguage()
  const ladder = crumbs ?? []
  // ⚠️ THE THRESHOLD IS ENFORCED HERE, NOT ONLY ADVERTISED. `showSaveSearch` can only ever
  // SUPPRESS the offer (already saved, signed out, a surface where it makes no sense) — it
  // cannot bring it forward. Exporting `shouldOfferSaveSearch` and then not applying it would
  // leave the rule as a suggestion, and `filters={[]} showSaveSearch` would render an offer to
  // save nothing. One filter is browsing; two is an intent worth keeping.
  const saveSearch = showSaveSearch && !!onSaveSearch && shouldOfferSaveSearch(filters.length)
  const clearAll = !!onClearAll && filters.length > 1

  // ONE identity for a chip, used for the React key AND for knowing when its removal has landed.
  // id ALONE is not enough: a multi-select facet ("district" twice) is a perfectly reasonable
  // thing for a caller to produce, and keying by facet alone would make React reconcile the two
  // chips as one — removing one could leave the other showing the removed label. Pairing in the
  // label makes it unique for free and stays position-independent.
  //
  // ⚠️ JSON, NOT `${id}::${label}`. Both halves are free-form caller strings, so ANY literal
  // separator can appear inside them: `{id:'a::b', label:'c'}` and `{id:'a', label:'b::c'}`
  // produce the same joined string and React would reconcile two different filters as one.
  // JSON.stringify escapes its own delimiters, so the encoding is unambiguous by construction
  // rather than by hoping no label contains the magic characters.
  const chipKey = (f: ResultFilter) => JSON.stringify([f.id, f.label])

  // ⚠️ A TRUE DUPLICATE (same id AND same label) IS NAMED OUT LOUD IN DEV — it is the same filter
  // listed twice, which no correct caller produces, and it is the one shape `chipKey` cannot
  // disambiguate. Warned from an EFFECT keyed on the chip identities, not from the render body:
  // a warning in render fires twice under StrictMode and again on every re-render of a caller
  // that rebuilds `filters` inline, which is how a useful warning becomes noise people filter out.
  const chipKeys = filters.map(chipKey)
  const chipKeySignature = JSON.stringify(chipKeys)
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const keys: string[] = JSON.parse(chipKeySignature)
    const dup = keys.find((k, i) => keys.indexOf(k) !== i)
    if (dup) {
      console.warn(
        `<ResultLine>: duplicate filter chip ${dup}. A chip is identified by id + label — two chips ` +
          'identical in both are the same filter twice, and React cannot tell them apart for keying ' +
          'or for focus restore. (Re-using an `id` across a multi-select facet is fine; re-using id ' +
          'AND label is not.)',
      )
    }
  }, [chipKeySignature])

  /**
   * ⚠️ REMOVING A CHIP MUST NOT DROP KEYBOARD FOCUS ON THE FLOOR.
   *
   * The ✕ that was activated is the element that unmounts, so without this a keyboard or
   * switch user presses Enter on "Remove Honda" and focus resets to <body> — they then have to
   * traverse the whole page again to remove a second filter, and the only feedback is a polite
   * live region they may already have talked over. Removing three filters means three full
   * re-traversals. Mouse users never see it, which is why it survives review.
   *
   * Destination: the ✕ that took the removed one's place (or the last one, if the tail went),
   * so repeated removals stay under the same finger; and the COUNT when the row empties,
   * because it is the surviving anchor and the thing that just changed.
   *
   * ⚠️ THE INTENT IS NOT "THE NEXT RENDER" — REMOVAL IS NOT NECESSARILY SYNCHRONOUS, AND THE
   * FIRST VERSION OF THIS ASSUMED IT WAS. A caller that removes a filter by pushing a URL gets
   * its new props an async transition later, and a caller that builds `filters` inline gets a
   * fresh array identity on EVERY render. So "fire on the next `filters` change" fires on a
   * render where the chip is still there: it focuses the ✕ that is about to unmount, clears the
   * intent, and then focus lands on <body> anyway — the exact bug this exists to prevent, now
   * silent. Three reviewer families converged on it; the test harness could not see it because
   * a `useState` parent removes in the same commit.
   *
   * So the intent names WHAT it is waiting for and is only consumed once that is true:
   *   · a chip removal waits for that chip's KEY (id + label) to be GONE from `filters`;
   *   · "Clear all" waits for the list to be EMPTY.
   * Three further guards keep an unresolved intent from becoming a delayed focus steal:
   *   · it is dropped if the user has already put focus somewhere (we only ever reclaim focus
   *     that our own unmount dropped, which shows up as <body>);
   *   · it expires, so a removal the caller rejects or debounces away cannot fire minutes later;
   *   · nothing arms it except our own controls, so an unrelated filters change never triggers it.
   */
  const listRef = React.useRef<HTMLUListElement | null>(null)
  const countRef = React.useRef<HTMLParagraphElement | null>(null)
  const focusIntent = React.useRef<{ index: number; id: string | null; count: number; at: number } | null>(null)

  /**
   * ⚠️ ONLY ARM THE RESTORE IF THE ROW ACTUALLY HELD FOCUS. This is the whole precondition, and
   * skipping it makes the feature actively harmful on the platform this app is built for.
   *
   * Restoring focus is only ever "give back what my unmount took" — and a TOUCH TAP never takes
   * it. iOS Safari does not focus a <button> on tap (nor does Safari/Firefox on macOS for a mouse
   * click), so activeElement stays <body>. Without this check a phone user taps ✕, scrolls two
   * screens down while the URL push is in flight, and when it lands `.focus()` fires on a chip
   * and drags the viewport back up to the filter row. The suite could never see it because
   * user-event always focuses what it clicks.
   *
   * "Was focus inside our list?" is exactly the right question: true for keyboard and switch
   * users (the ✕ they activated is in there), false for every pointer tap that did not focus.
   */
  const armFocusRestore = (intent: { index: number; id: string | null }) => {
    const active = document.activeElement
    if (!active || !listRef.current?.contains(active)) return
    focusIntent.current = { ...intent, count: filters.length, at: Date.now() }
  }

  React.useEffect(() => {
    const intent = focusIntent.current
    if (!intent) return
    if (Date.now() - intent.at > FOCUS_INTENT_TTL_MS) {
      focusIntent.current = null
      return
    }
    // Still pending — leave it armed. This is the render the old version got wrong.
    //
    // Matched on the CHIP KEY, not on `id`: with `id` alone, a caller with two districts both
    // keyed 'district' would never see this resolve (the sibling keeps the id alive), the intent
    // would sit armed until the TTL, and focus would land on <body> — the exact regression this
    // effect exists to prevent, in the exact state the dev warning above tolerates.
    //
    // ⚠️ AND THE ROW MUST ACTUALLY HAVE SHRUNK. A key can stop existing without anything being
    // removed: the key contains the localised label, so switching language mid-flight retires
    // every key at once, and a facet REPLACE or a background refetch can retire one. Any of
    // those would otherwise resolve the intent early — focus would be restored to a chip that is
    // still there, the intent would be spent, and when the real removal landed a moment later
    // focus would drop to <body> after all. Our own ✕ always removes exactly one chip, so
    // requiring the count to fall is free here and excludes every one of those look-alikes.
    // "Clear all" resolves on EMPTY or on any shrink: a caller whose clear legitimately keeps a
    // pinned chip would otherwise never resolve, sit until the TTL, and strand focus on <body>.
    const shrank = filters.length < intent.count
    const done = intent.id == null ? filters.length === 0 || shrank : shrank && !chipKeys.includes(intent.id)
    if (!done) return
    focusIntent.current = null
    // ⚠️ "DID THE USER CHOOSE THIS?" — NOT "IS IT <body>?". The first version bailed out unless
    // activeElement was exactly <body>, which disarmed the restore in the case it was written
    // for: a caller that removes a filter by pushing a URL gets the App Router's focus-and-scroll,
    // which parks focus on the changed SEGMENT ROOT — not <body> — so the guard declined and the
    // keyboard user was left stranded anyway. The distinguishing property is not the tag, it is
    // whether the element is something a user could have TABBED to: a real control has
    // tabIndex >= 0, while a scroll/segment container is a tabindex="-1" programmatic target.
    // So we yield to a deliberate choice and reclaim focus from a container that merely caught it.
    const active = document.activeElement as HTMLElement | null
    const userChose =
      !!active &&
      active !== document.body &&
      active !== document.documentElement &&
      (active.tabIndex >= 0 || active.isContentEditable)
    if (userChose) return
    // ⚠️ `preventScroll: true` — MOVE THE FOCUS RING, NEVER THE VIEWPORT. `armFocusRestore` asks
    // whether the row held focus, which separates keyboard from pointer only on WebKit: Blink
    // (Chrome, Edge, Android) and Firefox on Windows/Linux DO focus a <button> on click, so a
    // pointer user arms the intent there too. If their removal is async and they scroll into the
    // results while it is in flight, a plain .focus() scrolls the chip back into view and yanks
    // the page out from under them. preventScroll keeps the accessibility win (focus continues
    // where the user was working, so the next Enter removes the next filter) and drops the only
    // harmful half, in every engine, for every activation type — which is why it is the fix
    // rather than a better guess about which input device was used.
    const xs = listRef.current?.querySelectorAll<HTMLElement>('[data-slot="removable-badge-remove"]')
    if (xs && xs.length > 0) xs[Math.min(intent.index, xs.length - 1)].focus({ preventScroll: true })
    else countRef.current?.focus({ preventScroll: true })
    // ⚠️ KEYED ON THE CHIP SIGNATURE, NOT ON THE `filters` ARRAY IDENTITY. A string dep means the
    // effect runs exactly when the set of chips actually changed — it cannot be starved by a
    // caller that mutates and re-uses the same array (no new reference, no effect, dangling
    // intent), and it does not re-run on the identity churn of a caller that rebuilds the array
    // inline every render. Everything the body reads is derived from that signature.
    // (Measured, because a reviewer expected the opposite: `npx eslint` on this file reports no
    // `react-hooks/exhaustive-deps` finding — the repo's flat config runs the React Compiler
    // lint, and the rule is not error-level here. If it is ever turned on, the honest response is
    // a narrow disable with this paragraph as the reason, not widening the dep back to `filters`.)
  }, [chipKeySignature])

  return (
    <div data-slot="result-line" className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* The count changes on every tap and the change is the whole feedback loop, so it is
            announced. `polite` — it must never interrupt what a screen reader is reading; the
            user is mid-gesture and will hear it at the next pause.
            `tabIndex={-1}` makes it a programmatic focus destination only (never in the tab
            order) for the last-chip-removed case above. */}
        <p ref={countRef} tabIndex={-1} aria-live="polite" className="text-sm font-bold text-ink">
          {resultCountLabel(count, lang, tr)}
        </p>

        {ladder.length > 0 && (
          // ⚠️ THE LADDER AND THE CHIPS ARE TWO DIFFERENT THINGS AND EACH NAMES ITSELF.
          // An earlier draft put "Filters applied" here, on the TAXONOMY path — so a screen
          // reader announced the category ladder as the filters, and the list that actually
          // holds the filters was unlabelled. Worse, a deep category with zero filters still
          // announced "Filters applied". The nav is the category path; the <ul> below is the
          // filters. (ui/breadcrumb hardcodes an untranslated aria-label="breadcrumb", which is
          // why this is passed at all rather than left to the primitive.)
          <Breadcrumb aria-label={tr('Category', 'Danh mục')}>
            <BreadcrumbList className="gap-1 text-xs">
              {ladder.map((c, i) => {
                // The LAST rung is where you are standing: always inert, always
                // `aria-current="page"` (BreadcrumbPage), whatever the caller passed — a link
                // back to the page you are on is noise for keyboard and screen-reader users.
                // An earlier rung is a control only if the caller gave it somewhere to go; the
                // ladder is a receipt first and a navigation affordance second.
                const last = i === ladder.length - 1
                let rung: React.ReactNode
                if (last) rung = <BreadcrumbPage>{c.label}</BreadcrumbPage>
                else if (!c.onSelect) rung = <span>{c.label}</span>
                else
                  rung = (
                    <BreadcrumbLink render={<Button type="button" variant="bare" size="none" />} onClick={c.onSelect}>
                      {c.label}
                    </BreadcrumbLink>
                  )
                return (
                  <React.Fragment key={`${c.label}-${i}`}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>{rung}</BreadcrumbItem>
                  </React.Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>

      {(filters.length > 0 || saveSearch || clearAll) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {filters.length > 0 && (
            // ⚠️ THE LIST HOLDS FILTERS AND NOTHING ELSE. "Clear all" and "Save search" used to
            // be <li>s in here, which made two filters announce as "Filters, list, 4 items" and
            // put non-filters inside a list named "Filters". They are siblings of the list now.
            //
            // ⚠️ `role="list"` IS NOT REDUNDANT. Tailwind's preflight sets `list-style: none` on
            // every ul, and Safari/VoiceOver drop list semantics from an unstyled-marker list —
            // so without this the count ("3 filters") is not announced at all. Restating the
            // implicit role is WebKit's own documented mitigation.
            //
            // ⚠️ RENDERED STRAIGHT FROM `filters`, IN ARRAY ORDER — no sort, no group-by-facet,
            // no Object.keys(). Pick order is the contract (see ResultFilter) and any tidying
            // here would quietly break it.
            <ul
              ref={listRef}
              role="list"
              aria-label={tr('Filters', 'Bộ lọc')}
              className="flex min-w-0 flex-wrap items-center gap-1.5"
            >
              {filters.map((f, i) => (
                // ⚠️ `min-w-0` IS LOAD-BEARING, NOT TIDINESS. A flex item defaults to
                // `min-width: auto`, i.e. its min-content width — and the chip's label is
                // `whitespace-nowrap` (Badge's base) so its min-content width is the WHOLE
                // string. Without this the <li> cannot shrink, `max-w-full` on the badge
                // resolves against a content-sized parent and never bites, and the label's
                // `truncate` never fires: "honda vision 2022 màu đen" pushes the page into
                // horizontal scroll on a 360px phone instead of ellipsising. Caught by two
                // reviewers; the fix belongs on the FLEX ITEM, which is the <li>, not the badge.
                // ⚠️ THE KEY IS `chipKey(f)` (id + label), NOT id ALONE, and it is POSITION-
                // INDEPENDENT. An index-based key would remount every chip after the one that
                // moved, which is exactly what the pick-order contract must not do.
                //
                // The tradeoff, stated because two reviewers argued opposite sides of it: a
                // RELABEL (switching UI language) changes every key at once and remounts the
                // whole row. That costs a repaint of some stateless spans. The thing it buys is
                // that a caller keying by facet cannot make React remove the WRONG filter —
                // silent data loss beats a repaint, so the composite wins.
                <li key={chipKey(f)} className="min-w-0 max-w-full">
                  <RemovableBadge
                    label={f.label}
                    removeLabel={removeFilterLabel(f.label, tr)}
                    onRemove={() => {
                      armFocusRestore({ index: i, id: chipKey(f) })
                      f.onRemove()
                    }}
                    onReopen={f.onReopen}
                    // No `reopenLabel`: the button's accessible name is its visible text, which
                    // is what WCAG 2.5.3 wants and pairs cleanly with "Remove <label>" beside it.
                  />
                </li>
              ))}
            </ul>
          )}

          {clearAll && (
            <Button
              type="button"
              variant="bare"
              size="none"
              onClick={(e) => {
                // Same reason as a chip's ✕ — this button unmounts itself, so it hands focus on.
                // `id: null` = wait for the list to be EMPTY, not for one chip to go.
                // This button sits OUTSIDE the <ul>, so armFocusRestore's containment test would
                // never pass for it; ask the same question directly instead — did this control
                // have focus, i.e. was this a keyboard activation rather than an untracked tap?
                if (document.activeElement === e.currentTarget) {
                  focusIntent.current = { index: 0, id: null, count: filters.length, at: Date.now() }
                }
                onClearAll?.()
              }}
              className="rounded-full px-2 py-1 text-xs font-semibold text-body underline-offset-2 hover:underline"
            >
              {tr('Clear all', 'Xóa tất cả')}
            </Button>
          )}

          {saveSearch && (
            // ⚠️ INLINE, NEVER A MODAL. The offer sits in the same row as the chips that earned
            // it, so accepting it costs one tap and ignoring it costs none. A dialog here would
            // interrupt a browsing gesture to ask for a commitment the user has not made yet.
            //
            // ⚠️ `outline`, NOT `cta`. Canon reserves `variant="cta"` for THE one brand CTA on a
            // page (docs/design-language.md; the brand-CTA rule). A dismissible offer sitting in
            // the filter row is by definition not that — on a results page the primary action is
            // opening a listing, and a solid brand button here competes with every card below it.
            <Button type="button" variant="outline" size="sm" onClick={onSaveSearch} className="gap-1.5">
              <Bookmark className="h-4 w-4" />
              {tr('Save search', 'Lưu tìm kiếm')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
