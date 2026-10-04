'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/context/language-context'
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
export function NotFoundBody() {
  const { tr, lang } = useLanguage()
  const isListing = LISTING_PATH.test(usePathname() ?? '')
  const label = tr('Search listings', 'Tìm tin đăng')
  return (
    <>
      <h1 className="h-display mt-6 text-foreground">
        {isListing ? tr('This page has moved on.', 'Trang này không còn tồn tại.') : tr("We can't find that page.", 'Không tìm thấy trang này.')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-body">
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
