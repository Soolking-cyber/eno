/**
 * First-run product tour — storage, targets and the worked example.
 *
 * Owner, 2026-08-28: the consent card should also introduce the marketplace, and closing it should
 * start a short tour — the search bar, then the category rail with a real example, ending on a
 * one-tap Google sign-up. This module holds the parts worth testing away from the DOM: whether the
 * tour has already run, which elements it points at, and the example it navigates to.
 *
 * ⛔ THE EXAMPLE MUST LAND ON REAL RESULTS OR THE TOUR IS WORSE THAN NOTHING. A walkthrough whose
 * finale is an empty page teaches the visitor the catalogue is empty. Measured against production
 * before this was written: `/?q=iPhone 17 Pro Max case` returns 97 listings, led by the UAG Monarch
 * case, and 100 against the local database.
 * ⚠️ THERE IS NO RUNTIME GUARD ON THAT COUNT, and an earlier version of this comment claimed there
 * was — a reviewer went looking for it and found nothing. The step's copy is written so it still
 * reads correctly with few results ("These are the results for …" rather than a boasted number),
 * but if this query ever empties out, the honest fix is to change it here to something well
 * stocked. `src/lib/intro-tour.test.ts` pins the phone the owner asked for, so a change is a
 * deliberate edit rather than a drift.
 */

/** Bumping the suffix re-runs the tour for everyone — do that only for a genuinely new tour. */
export const TOUR_STORAGE_KEY = 'eno_intro_tour_v1'

/**
 * The step the owner asked for by name: Electronics → cases → Apple → iPhone 17 Pro Max. Expressed
 * as a search rather than a chain of facet params because that is what the browse page actually
 * keys on, and because one URL cannot go wrong halfway.
 */
/**
 * ⚠️ THE QUERY, NOT A HREF. An earlier version also exported `TOUR_EXAMPLE_HREF` for a
 * `router.push` — and kept exporting it after the step switched to dispatching `eno:search`,
 * leaving a constant that nothing used and a test asserting a navigation that no longer happened.
 * The explorer writes the query string itself once it handles the event (measured: the address bar
 * becomes `?q=iPhone+17+Pro+Max+case`), so sharing and Back still work.
 */
export const TOUR_EXAMPLE_QUERY = 'iPhone 17 Pro Max case'

/**
 * ⚠️ THESE STRINGS ARE CONTRACTS WITH THE MARKUP. Each is a `data-tour` attribute on a real element
 * (header.tsx, category-rail.tsx). A tour step whose anchor has gone is SKIPPED rather than shown
 * floating in the corner, so renaming one here without renaming it there silently shortens the
 * tour instead of breaking it — which is why intro-tour.test.ts asserts both ends exist.
 */
export const TOUR_TARGETS = {
  search: '[data-tour="search"]',
} as const

/** True for the four steps that wait on a real click. Exported so the component need not guess. */
export function isDrillStep(step: TourStepId): boolean {
  return step in TOUR_DRILL
}

/**
 * ⚠️ `signup` IS GONE ON PURPOSE (owner, 2026-08-28: "no need form 6-7"). The tour used to end on a
 * step whose only content was a sign-up pitch and whose button left the site for
 * /auth/google/start; the last step now hands straight to the one sign-in popup instead. Leaving
 * the id in this union would let a step reference it and typecheck against a step that cannot exist.
 */
export type TourStepId = 'search' | 'category' | 'subcategory' | 'brand' | 'model' | 'result'

/**
 * ⛔ THE DRILL-DOWN IS CLICKED BY THE VISITOR, ONE LEVEL AT A TIME — owner, 2026-08-28: "make user
 * click 1 by one first electronics then cases after apple and then iphone 17 pro max… let them
 * experience how to find". So these steps do NOT advance on a Next button: each points at one real
 * control and waits for the URL to gain the parameter that clicking it produces. The tour cannot
 * fake the click, which is the point — the visitor's hand does it.
 *
 * ⚠️ EVERY LEVEL WAS WALKED IN A BROWSER BEFORE BEING WRITTEN DOWN, because a guided path that
 * dead-ends is worse than no guide:
 *   Electronics                    → ?category=electronics                 7,690
 *   Cases & covers                 → &subcategory=phone-cases              1,093
 *   Apple                          → &brand=apple                            790
 *   iPhone 17 Pro Max              → &model=iPhone 17 Pro Max                  3
 * ⚠️ THE LAST LEVEL IS THIN — THREE LISTINGS, NOT THE ~100 THE TEXT SEARCH RETURNS, because most
 * case listings carry no model tag. That is the honest result of this path and the step's copy is
 * written for it. If model tagging improves the number rises on its own; if the model facet ever
 * empties, drop the `model` step rather than leave the tour ending on nothing.
 */
export const TOUR_DRILL = {
  category: { param: 'category', value: 'electronics', selector: '[data-cat="electronics"]' },
  subcategory: { param: 'subcategory', value: 'phone-cases', selector: '[data-subcat="phone-cases"]' },
  brand: { param: 'brand', value: 'apple', selector: '[data-brand="apple"]' },
  model: { param: 'model', value: 'iPhone 17 Pro Max', selector: '[data-model="iPhone 17 Pro Max"]' },
} as const

/**
 * ⚠️ NO EXPORTED STEP ORDER. There was one, and a test asserted it — but intro-tour.tsx owns the
 * order alongside the copy, so the constant was never read and reordering the real tour would have
 * left that test green. That is the same false confidence `TOUR_EXAMPLE_HREF` was deleted for.
 * `TourStepId` stays because it genuinely types both ends.
 */
/** The anchor selector for a step, or null when the step is a centred card. */
export function tourAnchorFor(step: TourStepId): string | null {
  if (step === 'search') return TOUR_TARGETS.search
  if (step in TOUR_DRILL) return TOUR_DRILL[step as keyof typeof TOUR_DRILL].selector
  return null
}

/**
 * Has the visitor completed this drill step? Read from the query string the explorer maintains, so
 * it is true however they got there — the highlighted chip, the "More" overflow, or their own
 * curiosity. ⚠️ Deliberately NOT a click listener on the anchor: that would miss the overflow copy
 * of the same chip and would go stale if the rail re-rendered under it.
 */
export function drillDone(step: TourStepId, search: string): boolean {
  const d = TOUR_DRILL[step as keyof typeof TOUR_DRILL]
  if (!d) return false
  return new URLSearchParams(search).get(d.param) === d.value
}

/**
 * ⚠️ EVERY READ AND WRITE IS WRAPPED. Safari in private mode throws on `localStorage` access rather
 * than returning null, and a thrown error here would take the whole provider tree down on first
 * paint. A tour that cannot remember it ran is a small annoyance; a blank site is not.
 */
/**
 * ⚠️ MIRRORED INTO A COOKIE AS WELL AS localStorage, and that is not belt-and-braces. iOS Safari in
 * private mode throws on `setItem` while `getItem` happily returns null, so the flag silently never
 * sticks and the visitor gets the tour again on every single load with no way to stop it — the
 * shape the owner reported on 2026-08-28. A cookie is written through a different door and survives
 * that case. `setConsent` next door already does exactly this, for a different reason.
 * ⚠️ Either store answering 'done' is enough: this is a "have we already spent our one shot" flag,
 * so the safe direction is to believe whichever one says yes.
 */
/**
 * ⚠️ PARSED, NOT `includes()`. A substring test for `eno_intro_tour_v1=done` also matches a cookie
 * NAMED `x_eno_intro_tour_v1`, and `resetTour()` only ever deletes the exact name — so one unrelated
 * cookie could pin the tour to "already seen" with no way to clear it. A reviewer caught it. Split
 * on `;`, compare the trimmed name exactly.
 */
function cookieValue(): string | null {
  try {
    if (typeof document === 'undefined') return null
    for (const part of document.cookie.split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      if (part.slice(0, eq).trim() === TOUR_STORAGE_KEY) return part.slice(eq + 1).trim()
    }
    return null
  } catch {
    return null
  }
}

function stored(): string | null {
  const c = cookieValue()
  if (c) return c
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(TOUR_STORAGE_KEY) : null
  } catch {
    // ⚠️ Rethrown as "seen" by the caller — see hasSeenTour.
    throw new Error('unreadable')
  }
}

/**
 * ⛔ THE ONE-SHOT IS CLAIMED BUT NOT YET SPENT. `CookieConsent` is global: a visitor whose first
 * page is a shared listing link answers the card THERE, and the tour's anchors only exist on `/`.
 * The tour used to simply drop that event, so — measured by a reviewer against this very diff —
 * everyone who did not land on the home page first lost the tour permanently, because consent is
 * then stored and the card never returns to fire it again. `pending` remembers the claim until they
 * reach a page the tour can actually run on.
 * ⚠️ THIS IS NOT THE MOUNT PATH THAT WAS REMOVED, and the difference is the whole point. That one
 * inferred a tour from "consent is decided", which is true forever and on every reload. This one
 * reads a token that ONLY the consent card's close can write and that `begin()` overwrites with
 * `done` the instant the tour starts. It can fire at most once, whatever storage does.
 */
/**
 * ⚠️ COOKIE ONLY, AND FOR HOURS RATHER THAN A YEAR. A reviewer asked what happens to someone who
 * answers the cookie card on a listing page and does not reach `/` for three months: with the
 * ordinary write they would get a first-run walkthrough on a visit that is nothing of the sort.
 * A claim is a short-lived intention, not a permanent fact, so it expires on its own — and writing
 * it to the cookie ALONE is what makes that true, since localStorage has no expiry and a `pending`
 * left there would outlive the cookie and defeat the bound.
 */
const PENDING_MAX_AGE = 12 * 60 * 60

export function markTourPending(): void {
  try {
    document.cookie = `${TOUR_STORAGE_KEY}=pending; path=/; max-age=${PENDING_MAX_AGE}; SameSite=Lax`
  } catch {
    /* noop — no claim parked, and the tour is simply not shown */
  }
}

export function tourPending(): boolean {
  try {
    return stored() === 'pending'
  } catch {
    return false
  }
}

export function hasSeenTour(): boolean {
  try {
    return stored() === 'done'
  } catch {
    // ⚠️ TRUE, NOT FALSE, when storage is unreadable: if we cannot tell whether it ran, do NOT run
    // it. Repeating an unskippable-feeling tour on every page load is far more irritating than
    // never showing it, and the visitor has no way to make it stop.
    return true
  }
}

function write(value: string): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, value)
  } catch {
    /* private mode — the cookie below is what carries the flag there; see cookieValue */
  }
  try {
    // A year, path-wide, Lax: the same shape as the consent mirror. No personal data — one bit
    // saying an introduction has been shown — so it needs no consent of its own.
    document.cookie = `${TOUR_STORAGE_KEY}=${value}; path=/; max-age=31536000; SameSite=Lax`
  } catch {
    /* noop */
  }
}

export function markTourSeen(): void {
  write('done')
}

/** For the footer/debug affordance and for tests. */
export function resetTour(): void {
  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY)
  } catch {
    /* nothing to reset if we cannot reach storage */
  }
  // ⚠️ AND THE COOKIE, or a reset would silently do nothing: `hasSeenTour` checks the cookie FIRST,
  // so clearing only localStorage leaves the tour just as unreachable as before.
  try {
    document.cookie = `${TOUR_STORAGE_KEY}=; path=/; max-age=0; SameSite=Lax`
  } catch {
    /* noop */
  }
}
