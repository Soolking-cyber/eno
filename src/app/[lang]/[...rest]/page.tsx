import { notFound } from 'next/navigation'

/**
 * ⛔ UNMATCHED DEEP PATHS 404 IN THE VISITOR'S LANGUAGE, AND WITHOUT THIS FILE THEY DO NOT.
 * Every page now lives under `[lang]`, which is where the root layout is. A multi-segment URL that no
 * route matches (`/nope/deep/path`) used to reach `app/not-found.tsx` inside the root layout; with no
 * layout at `app/` it would get Next's bare default 404 instead — no header, no footer, no way back
 * (measured on Next 16.3.1 before this move). Catching it here routes it to `[lang]/not-found.tsx`.
 * ⚠️ Single-segment misses never reach this: `[handle]` answers them and 404s an unclaimed name.
 * ⚠️ `force-dynamic` so a scanner walking random paths cannot fill the ISR cache with 404 pages.
 * ⚠️ A DELIBERATE TRADE WITH THE MARKDOWN 404. next.config.ts's `fallback` rewrite answers
 * `Accept: text/markdown` on an unmatched path with /md/not-found, and fallback runs AFTER dynamic
 * routes — so for deep page paths this catch-all now answers first and an agent gets the HTML 404
 * (still status 404). Single-segment misses keep the markdown answer (the afterFiles rule), and so do
 * dotted paths the proxy never rewrites. A person on a dead deep link getting eno's own page, in their
 * language, was judged worth more than a markdown body for a scanner's guess.
 */
export const dynamic = 'force-dynamic'

export default function UnmatchedPath() {
  notFound()
}
