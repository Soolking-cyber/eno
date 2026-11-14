'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * /c/rentals ON A PHONE: THE COUNT AT THE END OF THE HEADING LINE (UI climb batch 93, owner decision 5, 2026-11-14 — "one
 * control row"). The sort strip below sm became one swipe row (Relevance · Filters · Map · every district), so the short
 * count ("48 of 5,344" / "48/5.344 tin") left it for the right end of the heading line, the mock's 12px body ink.
 *
 * ⛔ THE SERVER PAINTS IT, AND HYDRATION CHANGES NOTHING. The page renders <HeadingCount> with a `seed` computed from the same
 * `listings.length` and the same total expression as `serverScope.total`, so the first HTML already carries the words; then
 * SellerListings (the one that knows about Show more, a sort in flight, a failed query) publishes its own text through the
 * provider. Its first value IS the seed's, because both come from `phoneCountText` below with the same inputs
 * (heading-count.test.tsx pins it, EN and VI): the ellipsis of the heading beside it never moves at hydration.
 * ⚠️ TRI-STATE: `undefined` = nothing published yet (show the seed), `null` = hide (no strip, a failed query), a string = show
 * it. A published `null` NEVER falls back to the seed (codex, plan review round 4).
 * ⚠️ PER TREE, NOT A MODULE SINGLETON: each page render mounts its own provider, so nothing outlives the page or leaks
 * between two of them. Without a provider the setter is a no-op and nothing reads a value.
 */

/** What the phone's short count says. The words the sort row used to carry (seller-listings.tsx `phoneNote`), moved here unchanged. */
export function phoneCountText(
  tr: (en: string, vi?: string) => string,
  grouped: (n: number) => string,
  { awaiting, shown, total }: { awaiting: boolean; shown: number; total: number },
): string {
  if (awaiting) return tr('Searching…', 'Đang tìm…')
  if (shown >= total) return `${grouped(total)} ${total === 1 ? tr('listing', 'tin đăng') : tr('listings', 'tin đăng')}`
  return tr('{shown} of {total}', '{shown}/{total} tin').replace('{shown}', grouped(shown)).replace('{total}', grouped(total))
}

/**
 * The short count's type, wherever it is painted: the sort row's end (seller-listings.tsx `phoneNote`) or the heading line —
 * the same words in the same 12px body ink (the mock), one definition. ⚠️ A sub-13px step (design-lint `sub13Type`): when this
 * area moves onto the meta role, it moves here, once, for both.
 */
export const PHONE_COUNT_TYPE = 'text-xs text-body'

/** The digit grouping SellerListings uses: dots in Vietnamese, commas otherwise. */
export const groupedIn = (lang: string) => (n: number) => n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')

type Published = string | null | undefined

// Two contexts: the setter's identity never changes (useState's), so SellerListings, which only publishes, never re-renders
// because the value moved; only <HeadingCount> reads the value.
const PublishContext = createContext<(text: string | null) => void>(() => {})
const ValueContext = createContext<Published>(undefined)

export function HeadingCountProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<Published>(undefined)
  return (
    <PublishContext.Provider value={setText}>
      <ValueContext.Provider value={text}>{children}</ValueContext.Provider>
    </PublishContext.Provider>
  )
}

/** SellerListings' end: hand the provider the current count, or `null` to hide it. A no-op outside a provider. */
export function usePublishHeadingCount() {
  return useContext(PublishContext)
}

/** What was last published: `undefined` before anything was, `null` = hide. <HeadingCount> reads it (and the tests' probe). */
export function useHeadingCount(): Published {
  return useContext(ValueContext)
}

/**
 * The visible count, floated to the right end of the heading line (it comes BEFORE the heading in the DOM: the heading,
 * `truncate` and so its own block formatting context, narrows beside it and still ellipsises on one line).
 * ⚠️ `aria-hidden`: SellerListings keeps the announced copy (an `sr-only` live region), so a screen reader hears one count.
 * ⚠️ `leading-[1.625rem]` = the mock's 26px line, ≤ the heading's own box at every root size, so the float never reaches the
 * line below; `max-w-[40%]` + `truncate` keep room for the heading beside it however large the number grows. The leading goes
 * AFTER the type step: tailwind-merge drops a line height that comes before a font size (text-xs carries its own).
 */
export function HeadingCount({ seed }: { seed: { shown: number; total: number } }) {
  const { tr, lang } = useLanguage()
  const published = useHeadingCount()
  const text = published === undefined ? phoneCountText(tr, groupedIn(lang), { awaiting: false, ...seed }) : published
  if (text === null) return null
  return (
    <span aria-hidden data-heading-count="" className={cn('float-right ml-3 max-w-[40%] truncate', PHONE_COUNT_TYPE, 'leading-[1.625rem]')}>
      {text}
    </span>
  )
}
