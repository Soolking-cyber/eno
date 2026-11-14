'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { useLanguage } from '@/context/language-context'

/**
 * /c/rentals ON A PHONE: THE COUNT AT THE END OF THE HEADING LINE (UI climb batch 93, owner decision 5, 2026-11-14 — "one
 * control row"). The sort strip below sm became one swipe row (Relevance · Filters · Map · every district), so the short
 * count ("48 of 5,344" / "48/5.344 tin") left it for the right end of the heading line, the mock's 12px body ink.
 *
 * ⛔ THE SERVER PAINTS IT, AND HYDRATION CHANGES NOTHING. The page renders <HeadingCount> with a `seed` computed from the same
 * total expression as `serverScope.total`, so the first HTML already carries the words; then
 * SellerListings (the one that knows about Show more, a sort in flight, a failed query) publishes its own text through the
 * provider. Its first value IS the seed's, because both come from `headingCountText` below with the same total
 * (heading-count.test.tsx pins it, EN and VI): the ellipsis of the heading beside it never moves at hydration.
 * ⛔ Since build 7 (owner-approved 2026-11-15, cook r07 rentals) the line says the TOTAL, "5,344 listings", not "48 of 5,344"
 * (`headingCountText`); the short "48 of 5,344" stays the announced live copy and every other page's sort-row count.
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
 * ⛔ WHAT THE HEADING LINE SAYS: THE SCOPE'S TOTAL, IN WORDS — "5,344 listings" / "5.344 tin đăng" (owner-approved 2026-11-15
 * (build 7), cook r07 rentals — it reverses batch 93's / cook r06's "48 of 5,344" / "48/5.344 tin" there). Beside the page's
 * name, "48 of" read as a vague fraction; the total is the figure the page is about, and the words are the page's own sentence's
 * ("Showing 48 of 5,344 listings."). How many are on screen is still announced: SellerListings' `sr-only` live copy keeps
 * `phoneCountText` ("48 of 5,344"), and Show more says the rest. No "Searching…" here either: a sort in flight does not change
 * the scope, so the line keeps its total (a failed query still hides it — SellerListings publishes `null`).
 */
export function headingCountText(
  tr: (en: string, vi?: string) => string,
  grouped: (n: number) => string,
  total: number,
): string {
  return `${grouped(total)} ${total === 1 ? tr('listing', 'tin đăng') : tr('listings', 'tin đăng')}`
}

/**
 * The short count's type on the sort row's end (seller-listings.tsx `phoneNote`), every /c page but /c/rentals' phone. The
 * heading line's count has its own (HEADING_COUNT_TYPE, below — the meta role, muted, since 2026-11-14). ⚠️ A sub-13px step
 * (design-lint `sub13Type`): when this row moves onto the meta role, it moves here.
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

/** The heading line's count type (HeadingCount, below) — exported for its test. */
export const HEADING_COUNT_TYPE = 'max-w-[40%] shrink-0 truncate text-t-meta tabular-nums text-muted-foreground'

/**
 * The visible count at the right end of the heading line: ⛔ A FLEX SIBLING AFTER THE HEADING (owner-approved 2026-11-14, cook r06
 * rentals-a — it replaces batch 93's float, which came BEFORE the heading in the DOM). (index)/page.tsx draws the line as one
 * `flex items-baseline` row: the heading `min-w-0 flex-1 truncate` (the page's one display element, 28/34), then this. DOM order
 * is visual order, and the two share a baseline at any root size with no tuned line height.
 * The meta role in the muted ink (`text-t-meta`, 13/18 — the shell's count look; it was 12px body ink), tabular figures so a
 * Show more does not wobble it. `shrink-0` + `max-w-[40%]` + `truncate`: the heading gives way first, and however large the
 * number grows the heading keeps 60% of the line.
 * ⚠️ `aria-hidden`: SellerListings keeps the announced copy (an `sr-only` live region), so a screen reader hears one count.
 * The words are the total's since build 7 (`headingCountText`, above): the seed is the scope's total alone, the same
 * expression as `serverScope.total`, so the server's words are SellerListings' first published words.
 */
export function HeadingCount({ seed }: { seed: { total: number } }) {
  const { tr, lang } = useLanguage()
  const published = useHeadingCount()
  const text = published === undefined ? headingCountText(tr, groupedIn(lang), seed.total) : published
  if (text === null) return null
  return (
    <span aria-hidden data-heading-count="" className={HEADING_COUNT_TYPE}>
      {text}
    </span>
  )
}
