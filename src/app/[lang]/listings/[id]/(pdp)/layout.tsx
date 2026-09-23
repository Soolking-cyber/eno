import { notFound } from 'next/navigation'
import { isListingViewable } from './get-listing'

/**
 * ⛔ THIS LAYOUT EXISTS ONLY TO MAKE A MISSING LISTING A REAL 404. It renders nothing of its own.
 *
 * `page.tsx` has always called `notFound()` in `generateMetadata` "before any streaming/Suspense
 * boundary", and its comment says that is what turns a missing listing into a real 404 rather than
 * a soft one. Measured 2026-09-07 against production AND reproduced in a local production build:
 * it does not. `https://eno.vn/listings/<any-unknown-id>` answered **200** with the not-found UI,
 * on a cold `x-nextjs-cache: MISS`, while `/sellers/<unknown>` and `/brands/<unknown>` answered 404.
 *
 * ⚠️ THE CAUSE IS THE SIBLING `loading.tsx`, PROVEN BY EXPERIMENT, NOT BY READING. Moving
 * `listings/[id]/loading.tsx` and `c/[category]/loading.tsx` out of the tree and rebuilding turned
 * both routes from 200 into 404; putting them back restored the 200. A `loading.tsx` wraps its own
 * segment's page in a Suspense boundary, so Next flushes the shell — status and all — before the
 * page's `notFound()` is ever reached. The RSC payload still carries `NEXT_HTTP_ERROR_FALLBACK;404`:
 * Next threw correctly, the status had simply already gone out as 200.
 *
 * ⛔ SO WHY A LAYOUT AND NOT JUST DELETING loading.tsx. Deleting it fixes the status and costs the
 * skeleton, which is not a fair trade: that file's block heights were each MEASURED against the
 * live page to hold layout stable, and this app took CLS from 8.74 to 0.0002. A layout renders
 * ABOVE its segment's own loading boundary — the nesting is layout → loading → page — so a guard
 * here runs while the response status can still be set, and the skeleton below it is untouched.
 * Verified in a production build: unknown id → 404, real id → 200 with the skeleton still served.
 *
 * ⛔ IT PROBES VIEWABILITY, NOT MERE EXISTENCE — and the first version of this file got that wrong.
 * It called the full `getListing` and 404'd only on null, which let hidden, unverified and held
 * listings through to the page, where the policy guard runs BELOW the loading boundary and produces
 * the very soft-404 this layout exists to remove. Measured on production: a hidden listing answered
 * 200. `isListingViewable` applies the same rule as `page.tsx` and costs three columns.
 *
 * ⚠️ EVERYTHING THIS LAYOUT AWAITS DELAYS THE SKELETON, which is the price of rendering above the
 * boundary. That is why the probe is a three-column primary-key lookup rather than the page's
 * seller+category+owner join: the shell waits on the smallest question that decides the status, and
 * the expensive read still happens below, where `loading.tsx` can cover it.
 *
 * ⚠️ `sold` IS VIEWABLE, deliberately — it renders its own "this item has been sold" page, not a
 * 404. `page.tsx` remains the authority on what happens after this; the layout only decides whether
 * there is a page at all.
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
  return children
}
