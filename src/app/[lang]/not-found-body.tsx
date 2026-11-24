'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { useAuthMaybe } from '@/context/auth-context'
import type { OwnListingState } from '@/app/api/listings/[id]/status/route'
import { LANG_VARIANTS, variantOfLanguage } from '@/lib/lang-variant'
import { localizedHref } from '@/lib/lang-pinned'

/**
 * ⚠️ THE ONE-PREFIX TOLERANCE IS WHAT KEEPS THIS HYDRATION-SAFE. The proxy rewrites a public path P to
 * `/<variant>P`, and on the server usePathname() can report that internal path while the browser
 * reports P (header.tsx records the same trap as React #418). "Is this a listing" must therefore give
 * one answer for both spellings — an optional leading `/en` or `/vi` does that without a hydration gate
 * (a gate would swap the sentence after paint).
 */
const LISTING_PATH = new RegExp(`^(?:/(?:${LANG_VARIANTS.join('|')}))?/listings/`)

/**
 * The part of the 404 that depends on WHERE the reader got lost, and the search box that gets them out
 * (C-404, 2026-09-29). Every miss used to say "The listing may have sold…" — including /nope-xyz and a
 * mistyped /help link, where there never was a listing.
 *
 * ⚠️ THE HEADING IS PART OF IT, NOT JUST THE LEDE. "This page has moved on." says the page existed and
 * left — true of a sold listing, false of a mistyped URL that never existed, and it sat above "The link
 * may be mistyped" on every non-listing miss (review, 2026-09-29). One path test picks both sentences,
 * so they cannot disagree.
 *
 * ⚠️ A CLIENT ISLAND, NOT headers() IN not-found.tsx: Next ships the not-found UI inside EVERY page's
 * RSC payload, so a request API there would make every route dynamic, and a query there would tax
 * every route. usePathname costs neither.
 *
 * The search is a plain GET form to the home explorer (home-is-search on both editions), so it works
 * before hydration and with no JavaScript at all; the wrapper owns the box and its focus ring, the same
 * contract as the help centre's search (ui/input `unstyled`).
 */
/** The listing id of the listing PAGE itself — /listings/<id>, either spelling (LISTING_PATH), an optional trailing slash —
 *  or '' for anything else, /listings/<id>/edit included (its 404 must not offer an Edit link back to itself). */
export function listingIdOf(pathname: string): string {
  if (!LISTING_PATH.test(pathname)) return ''
  const m = /^([^/?#]+)\/?$/.exec(pathname.replace(LISTING_PATH, ''))
  return m ? m[1] : ''
}

/**
 * ⛔ THE OWNER'S VIEW (owner, 2026-11-24): the listing page shows only live rows to everyone (cached), so a seller opening
 * their own pending, held or hidden listing — My listings, the step after posting, a teacher's own profile — landed here.
 * For a signed-in reader on a /listings/<id> 404, the browser asks GET /api/listings/<id>/status (owner-only; any refusal
 * leaves the ordinary 404 below untouched) and, for the owner, says why it is not public and links Edit / My listings.
 * After hydration, never in the server render: the page stays cacheable and the same for everyone.
 */
function OwnListingPanel({ id, state }: { id: string; state: OwnListingState }) {
  const { tr } = useLanguage()
  const why: Record<OwnListingState, string> = {
    // True of a new listing awaiting its check AND of one a moderator unpublished: the row looks the same (active, unverified).
    pending: tr('eno checks listings before they appear on the site, and this one is not approved yet.', 'eno kiểm duyệt tin trước khi hiển thị, và tin này chưa được duyệt.'),
    held: tr('It is on hold while eno checks it. You can still edit it.', 'Tin đang được tạm giữ để eno kiểm tra. Bạn vẫn có thể sửa tin.'),
    hidden: tr('You hid it, so it is off the site. Make it active again from My listings.', 'Bạn đã ẩn tin này nên tin không hiển thị trên trang. Bật lại trong Tin của tôi.'),
    off: tr('It is not on the site right now. You can still edit it.', 'Tin hiện không hiển thị trên trang. Bạn vẫn có thể sửa tin.'),
    live: tr('It was just approved. It can take a few minutes to appear here.', 'Tin vừa được duyệt. Có thể mất vài phút để hiển thị ở đây.'),
    sold: tr('Sold listings stay in My listings, where you can put it back on sale.', 'Tin đã bán vẫn nằm trong Tin của tôi, nơi bạn có thể mở bán lại.'),
  }
  return (
    <>
      <h1 className="h-display mt-6 text-foreground">
        {state === 'live' ? tr('Your listing is live.', 'Tin của bạn đã hiển thị.')
          : state === 'sold' ? tr('Your listing is marked sold.', 'Tin của bạn đã được đánh dấu là đã bán.')
            : tr('Your listing is not public yet.', 'Tin của bạn chưa hiển thị công khai.')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-body">{why[state]}</p>
      <div className="mx-auto mt-6 flex max-w-sm flex-wrap items-center justify-center gap-3">
        {/* No Reload for `live`: the 404 can still be the cached one for a few minutes, and Reload would loop on it. */}
        {state !== 'live' && (
          <Button variant="cta" asChild><Link href={`/listings/${encodeURIComponent(id)}/edit`}>{tr('Edit listing', 'Sửa tin')}</Link></Button>
        )}
        <Button variant="outline" asChild><Link href="/dashboard/listings">{tr('My listings', 'Tin của tôi')}</Link></Button>
      </div>
    </>
  )
}

const OWN_STATES: readonly OwnListingState[] = ['pending', 'held', 'hidden', 'off', 'live', 'sold']

export function NotFoundBody() {
  const { tr, lang } = useLanguage()
  const pathname = usePathname() ?? ''
  const isListing = LISTING_PATH.test(pathname)
  const id = listingIdOf(pathname)
  const signedIn = !!useAuthMaybe()?.user
  const [own, setOwn] = useState<OwnListingState | null>(null)
  useEffect(() => {
    setOwn(null) // a new path or a sign-out never keeps the last listing's panel
    if (!id || !signedIn) return
    let gone = false
    fetch(`/api/listings/${encodeURIComponent(id)}/status`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { state?: unknown } | null) => {
        if (!gone && j && OWN_STATES.includes(j.state as OwnListingState)) setOwn(j.state as OwnListingState)
      })
      .catch(() => {})
    return () => { gone = true }
  }, [id, signedIn])
  const label = tr('Search listings', 'Tìm tin đăng')
  if (own && id) return <OwnListingPanel id={id} state={own} />
  return (
    <>
      <h1 className="h-display mt-6 text-foreground">
        {isListing ? tr('This page has moved on.', 'Trang này không còn tồn tại.') : tr("We can't find that page.", 'Không tìm thấy trang này.')}
      </h1>
      {/* 16px, the reading size (2026-11-07 audit): at 14px under the display heading the one sentence that says what happened
          read as a caption. */}
      <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-body">
        {isListing
          ? tr(
              "The listing may have sold, been taken down, or the link is broken — let's get you back to the good stuff.",
              'Tin đăng có thể đã bán, bị gỡ hoặc link bị hỏng — cùng quay lại tìm đồ xịn nhé.',
            )
          : tr('The link may be mistyped or out of date.', 'Đường dẫn có thể bị gõ sai hoặc đã cũ.')}
      </p>
      <form
        // A Vietnamese 404 searches the `/vi` twin, not the English-pinned `/` (A1-LANG).
        action={localizedHref('/', variantOfLanguage(lang))}
        method="get"
        role="search"
        className="mx-auto mt-6 flex max-w-sm items-center rounded-xl bg-tint px-3 transition-shadow focus-within:ring-2 focus-within:ring-[color:var(--ring)]"
      >
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          variant="unstyled"
          type="search"
          name="q"
          enterKeyHint="search"
          placeholder={label}
          aria-label={label}
          className="min-w-0 flex-1 px-3 py-3 text-base"
        />
      </form>
    </>
  )
}

/**
 * The recovery list's "Search all listings": the home explorer in the reader's language — the `/vi`
 * twin on a Vietnamese 404, never the English-pinned `/` (A1-LANG). A client island for the same
 * reason as NotFoundBody: not-found.tsx cannot read the request.
 */
export function NotFoundHomeLink({ className }: { className?: string }) {
  const { tr, lang } = useLanguage()
  return (
    <Link href={localizedHref('/', variantOfLanguage(lang))} className={className}>
      {tr('Search all listings', 'Tìm trong tất cả tin đăng')}
    </Link>
  )
}

/**
 * The lead-in to the machine-readable indexes, translated (auth-13): the English sentence sat in the
 * Vietnamese 404 because it had no curated Vietnamese. The filenames that follow it stay as they are.
 */
export function MachineIndexLead() {
  const { tr } = useLanguage()
  return <>{tr('Looking for a machine-readable index?', 'Cần chỉ mục cho máy đọc?')}</>
}
