import { notFound } from 'next/navigation'
import { categoryExists } from './load-category'

/**
 * ⛔ THIS LAYOUT EXISTS ONLY TO MAKE AN UNKNOWN CATEGORY A REAL 404. It renders nothing of its own.
 *
 * ⚠️ IT OVERTURNS A DELIBERATE DECISION RECORDED IN `page.tsx`, SO READ THIS BEFORE REVERTING IT.
 * That file said the soft-404 was "left as-is deliberately… every alternative fix regressed
 * something real (deleting loading.tsx trades a verified CLS of 0 for a status byte; force-dynamic
 * reimposes a Singapore DB hit on every view)". Both of those judgements were correct. There was a
 * third option nobody had tried: App Router nests **layout → loading → page**, so a guard in the
 * layout runs ABOVE this segment's own Suspense boundary, while the response status can still be
 * set — and the `loading.tsx` underneath it is never touched. Neither trade-off is taken.
 *
 * ⚠️ THE DIAGNOSIS IN THAT COMMENT WAS ALSO INCOMPLETE, which is why the fix looked impossible.
 * It blamed Next 15.2+ streaming metadata. Measured 2026-09-07 in a local production build: move
 * `c/[category]/loading.tsx` out of the tree and rebuild, and the route returns 404; put it back
 * and it returns 200. The trigger is the loading boundary, not metadata streaming — the RSC
 * payload carries `NEXT_HTTP_ERROR_FALLBACK;404` either way, so Next always threw correctly and
 * only the status had already gone out.
 *
 * ⚠️ AND SINCE UX3 FAST-8 (2026-10-05) THERE IS NO `(index)/loading.tsx` AT ALL: the boundary kept the grid in
 * `<div hidden id="S:0">` until a reveal script ~400–500 KB into the HTML (phone LCP +0.5–0.6 s: measured A/B,
 * Chromium 390×844, CPU 4×, the same live HTML with only the boundary inlined). The guard below still runs first; with no boundary the status is never
 * sent early in any case. The "CLS of 0" the skeleton bought is re-measured in the UX3 preview, not assumed.
 *
 * ⚠️ (HISTORY) THE SKELETON LIVED IN `(index)/loading.tsx` from 2026-09-27 until UX3 FAST-8 removed it, beside the
 * category page, so it no longer wrapped `[district]` as well — see the note at the top of `(index)/page.tsx`. This layout still
 * sits above both and still guards both: an unknown category is a 404 under either URL shape.
 *
 * ⛔ IT RENDERS NOTHING, AND THE CATEGORY PAGE'S HEADER AND H1 MUST NOT MOVE HERE. They moved out of
 * the loading boundary into `(index)/layout.tsx` (SEO wave B, H1b), one level down, because this
 * layout also wraps `[district]/page.tsx`, which renders its own Header, `<main>`, breadcrumb, H1 and
 * Footer — anything here would be doubled on every district page (contract test).
 *
 * ⚠️ EXISTENCE ONLY — the weaker guard, on purpose. `page.tsx` still owns the real policy,
 * including the auto-noindex when a category has held zero live listings for 14 days (I1b). An
 * EMPTY category is a valid 200 page that de-indexes itself; it must not 404 here.
 *
 * ⚠️ AND IT DELIBERATELY DOES NOT CALL `loadCategory`. Everything a layout awaits delays the
 * whole first chunk below it — the district page and the category page's header, H1 and skeleton —
 * and `loadCategory` runs a COUNT across the category to decide the noindex tag. `categoryExists`
 * asks the one question that decides the status, through the same `cache()`d row lookup
 * `(index)/layout.tsx` reads (`getCategoryRow`), so the two layouts cost one `findUnique`.
 */
export default async function CategoryLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  if (!(await categoryExists(category))) notFound()
  return children
}
