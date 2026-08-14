'use client'

/**
 * MARKETPLACE-EDITION STUB for visa-start.tsx.
 *
 * ⚠️ THIS ONE WAS MISSED FOR A MONTH, AND THE MEASUREMENT IS WHY IT EXISTS. The real module is 505
 * lines of e-Visa picker, and `src/app/listings/[id]/page.tsx` — the PRODUCT DETAIL PAGE, the most
 * crawled and most visited surface on eno.vn — imports it at module top level. Both editions
 * compile that page, so a clean marketplace build put eight distinct e-Visa sentences into a 61KB
 * client chunk that every eno.vn listing page downloads. The call site is correctly gated behind
 * `isVisaProduct`, and the gate is irrelevant: a gate decides what RENDERS, an alias decides what
 * SHIPS.
 *
 * It hid because it fits no pattern the guards look for. It is not a route, so `pageExtensions` and
 * the `.svc.` convention do not reach it. It is not in a services TREE, so edition-lint Rule C —
 * which fails a marketplace file importing an unaliased services module — does not see it either,
 * because `SERVICES_TREES` lists directories. Every automated check was satisfied while the words
 * shipped.
 *
 * The repo already knew: `scripts/gen-ui-strings.mjs` has listed
 * `src/components/marketplace/visa-start` as a services source for weeks, so its strings were kept
 * out of the shared catalogue. The classification existed; only the alias was missing. If a module
 * is a services source THERE, it needs an entry in `turbopack.resolveAlias` here.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE. The alias is a bundler resolution, so `tsc` checks the PDP
 * against the real module; a shape mismatch here is a runtime error on eno.vn's busiest page that
 * no typecheck catches. The export surface is matched by hand and pinned by the parity check in
 * edition-stubs.test.ts, which derives the alias map from next.config.ts.
 */

/**
 * ⛔ THE STUB SAYS SO IN CODE, SO A ROLLBACK CANNOT SILENTLY BREAK THE PDP.
 *
 * `VISA_THREADS_ENABLED` is a RUNTIME secret; which of these two modules is compiled is a BUILD
 * flag. Those can desynchronise in both directions, and one of them is silent: a build without
 * MARKETPLACE_HOSTS_SERVICES (this stub) serving while the runtime flag IS set makes the product
 * page decide "this is a visa product" and then render nothing at all where the Chat button
 * belongs — on every one of the partner's live listings, with no error anywhere. That is what a
 * `gcloud run services rollback` during an incident, or a revert of the cloudbuild line, produces.
 *
 * Two reviewers independently called the original mitigation what it was: a comment telling a human
 * to unset the runtime flag first. This is the same rule as a build-time constant instead. Both
 * modules export it, the aliaser picks one, and the branch folds away — so the page cannot offer a
 * visa entry point that this build has no code to render.
 */
export const VISA_START_AVAILABLE = false

/** Mirror of the real module's product shape. Structural only — nothing here constructs one. */
export type VisaStartProduct = {
  listingId: string
  title: string
  priceVnd: number
  priceUsd: number | null
  entryType: string | null
  speedCode: string | null
  etaIso: string | null
  gated: boolean
}

type CatalogueState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; products: VisaStartProduct[]; payable: boolean; ready: boolean }

/**
 * Always null — the real hook ticks a clock for desk cutoffs, and there is no desk here.
 *
 * ⚠️ RETURNS THE SAME TYPE AS THE REAL ONE (`Date | null`, null before the first client tick), so a
 * consumer that narrows on null behaves identically rather than hitting an unexpected shape.
 */
export function useMinuteTick(): Date | null {
  return null
}

/**
 * Permanently 'error', never 'loading'.
 *
 * Deliberate: 'loading' would leave any consumer spinning forever waiting for a fetch this stub
 * will never make. 'error' is the terminal state the real module already handles, and it is honest
 * — there is no catalogue on this edition. It issues no request, so eno.vn never calls a visa API.
 */
export function useVisaCatalogue(_enabled: boolean): CatalogueState {
  return { status: 'error' }
}

/** Renders nothing. Unreachable: the PDP only mounts these behind its `isVisaProduct` gate, and a
 *  desk listing cannot reach a marketplace PDP in the first place (see src/lib/edition-scope.ts). */
export function VisaProductRow(_props: {
  product: VisaStartProduct
  now: Date | null
  disabled: boolean
  onPick: (product: VisaStartProduct) => void
}) {
  return null
}

/** Renders nothing. */
export function VisaStartPicker(_props: { className?: string; onStarted?: () => void }) {
  return null
}

/** Renders nothing — the entry point the product detail page imports. */
export function VisaStart(_props: { listingId: string; label?: string; className?: string }) {
  return null
}
