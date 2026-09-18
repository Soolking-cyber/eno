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
 * ⚠️ EXISTENCE ONLY — the weaker guard, on purpose. `page.tsx` still owns the real policy,
 * including the auto-noindex when a category holds zero live listings. An EMPTY category is a
 * valid 200 page that de-indexes itself; it must not 404 here.
 *
 * ⚠️ AND IT DELIBERATELY DOES NOT CALL `loadCategory`. Everything a layout awaits delays the
 * skeleton below it, and `loadCategory` runs a COUNT across the category to decide the noindex tag.
 * `categoryExists` asks the one question that decides the status; the count stays below the
 * boundary where `loading.tsx` covers it.
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
