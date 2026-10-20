import { notFound, permanentRedirect } from 'next/navigation'
import { IS_SERVICES } from '@/lib/edition'
import { teacherSurfaceUrl } from '@/lib/teachers/surface'
import { isListingViewable, isTeacherListing } from './get-listing'

/**
 * ⛔ THIS LAYOUT DECIDES WHETHER THERE IS A LISTING PAGE AT ALL: a real 404, or the page. It renders
 * nothing of its own.
 *
 * `page.tsx` has always called `notFound()` in `generateMetadata`, and its comment once said that
 * made a missing listing a real 404. Measured 2026-09-07 against production AND in a local production
 * build: it did not. `https://eno.vn/listings/<any-unknown-id>` answered **200** with the not-found
 * UI, on a cold `x-nextjs-cache: MISS`. The cause, proven by moving the file out and back: the
 * segment's `loading.tsx`. Its Suspense boundary made Next flush the shell, status and all, before
 * the page's `notFound()` ran. This layout renders ABOVE a segment's loading boundary, so it was
 * where the status could still be set, and it was added to keep the skeleton.
 *
 * ⛔ THE SKELETON IS GONE SINCE SEO WAVE B, H1a (2026-09-28): `(pdp)/loading.tsx` was deleted. Its
 * boundary also hid the whole listing from anything that reads HTML without running JavaScript.
 * React moves a finished Suspense boundary over 500 B into `<div hidden id="S:0">` whenever the
 * shell's bytes plus the boundary's exceed 12,800 B, which on this page is always, cached or not
 * (the rule and its source lines are in `src/app/[lang]/crawler-visible-html-contract.test.ts`).
 * Googlebot, OAI-SearchBot, PerplexityBot and bingbot all got the H1 under `[hidden]`, and the only
 * visible words were the skeleton's header and footer. And the skeleton bought no earlier byte: a
 * cold render was not streamed, the complete HTML arriving 1-5 ms after the first byte. That test
 * keeps a `loading.tsx` from coming back on the way down to this page.
 *
 * ⚠️ SO THE PAGE BODY'S OWN `notFound()` NO LONGER NEEDS THIS LAYOUT: with no boundary above it,
 * nothing is flushed before it runs. The district pages are the same case: since their category skeleton moved
 * out from above them (`district-status-contract.test.ts`), their `notFound()` answers a real 404
 * (`e2e/ci/marketplace.spec.ts`). The layout stays as the first check, because it is cheap and it
 * keeps the status independent of the page body.
 *
 * ⛔ IT PROBES VIEWABILITY, NOT MERE EXISTENCE — and the first version of this file got that wrong.
 * It called the full `getListing` and 404'd only on null, which let hidden, unverified and held
 * listings through to the page, where the policy guard then ran below the loading boundary and
 * produced the very soft-404 this layout was added to remove. Measured on production: a hidden
 * listing answered 200. `isListingViewable` applies the same rule as `page.tsx` and costs three
 * columns.
 *
 * ⚠️ EVERYTHING THIS LAYOUT AWAITS DELAYS THE WHOLE RESPONSE: the page below it renders only after it
 * returns, and an ISR render is sent complete. That is why the probe is a three-column primary-key
 * lookup rather than the page's seller+category+owner join (`getListing`, shared with
 * `generateMetadata` through `cache()`).
 *
 * ⚠️ `sold` IS VIEWABLE, deliberately — it renders its own "this item has been sold" page, not a
 * 404. `page.tsx` remains the authority on what happens after this; the layout only decides whether
 * there is a page at all.
 * ⛔ SO IS A GONE ROW (a hidden import-shop listing → the gone page, 200 + noindex;
 * src/lib/gone-listing.ts) — and ONLY that hidden row: a person's post hidden by moderation, and every
 * other non-live status, is still a 404 decided here.
 *
 * ⛔ IT LIVES IN THE `(pdp)` ROUTE GROUP SO THAT IT GUARDS THE PRODUCT PAGE AND NOTHING ELSE. It sat
 * at `listings/[id]/layout.tsx` until 2026-09-23, where a layout wraps every child segment — so the
 * owner's `edit/` page inherited the PUBLIC viewability rule and a seller got a 404 trying to edit
 * exactly the listings that most need editing: hidden, awaiting review, or held for identity. The
 * group changes no URL. `edit/` stays outside it and does its own owner check. (Audit finding #16.)
 *
 * ⚠️ THE GROUP IS PART OF EVERY CACHE TAG THIS PAGE CARRIES. Next derives a page's implicit tags from
 * its file path, groups included (the home page carries `_N_T_/[lang]/(home)/page`), so a pattern
 * purge of `'/listings/[id]', 'page'` no longer matches anything. Purge the whole route with
 * `revalidatePublicPath('/listings/[id]', 'layout')` — `_N_T_/[lang]/listings/[id]/layout` is on
 * every page under the segment whatever groups sit below it. Concrete paths (`/listings/<id>`) are
 * unaffected.
 */
export default async function ListingLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!(await isListingViewable(id))) notFound()
  /**
   * ⛔ ON eno.forum A TEACHER'S PROFILE IS eno.vn's PAGE — a 308 to the same path there, decided HERE, before anything of
   * the page renders (owner decision 6, 2026-10-20; src/lib/teachers/surface.ts is the whole map). The path cannot say the
   * row is a teacher, so next.config's path rules cannot; this layout is the first thing that knows.
   * ⚠️ WHY THE STATUS IS RIGHT: this layout renders in the shell, with no loading boundary above it (see the top of this
   * file), so a redirect thrown here sets the response's status and Location exactly as its notFound() sets a real 404 —
   * the shape of /c/<cat>/<twin>'s permanentRedirect, which www.eno.forum answers 308, x-nextjs-cache HIT. ISR stores the
   * 308 with its Location (Next's app-page handler re-serves a cached entry's status) — never a 200 page — and an in-app
   * (RSC) request gets the redirect inside its payload, as Next encodes one, so the router leaves for eno.vn. /listings/*
   * never passes the HTML Worker (a no-script route), so no edge copy holds either answer. A purge of /listings/<id>
   * re-renders the same 308.
   * ⚠️ AFTER THE VIEWABILITY CHECK, ON PURPOSE: a teacher row that is not public is the 404 here that it is on eno.vn, and
   * generateMetadata — which 404s that same row — can then never race a redirect; a live one never makes it throw, so the
   * 308 is the only answer the request has.
   * ⚠️ A NON-TEACHER ROW IS UNTOUCHED: the question reads the row the page reads next, through the same cache(), so it adds
   * no query and the page renders as before. eno.vn never asks (IS_SERVICES): its PDP makes the one query it always made.
   */
  if (IS_SERVICES && (await isTeacherListing(id))) permanentRedirect(teacherSurfaceUrl(`/listings/${encodeURIComponent(id)}`))
  return children
}
