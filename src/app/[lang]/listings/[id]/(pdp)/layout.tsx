import { notFound } from 'next/navigation'
import { isListingViewable } from './get-listing'

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
