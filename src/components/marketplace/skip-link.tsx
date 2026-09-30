'use client'

import { useLanguage } from '@/context/language-context'
import { useExplorerMounted } from '@/lib/explorer-presence'

const SKIP_CLS =
  'sr-only rounded-lg font-bold focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:text-white focus:shadow-pop focus:outline-none focus:ring-2 focus:ring-ring/50'

/** WCAG 2.4.1 (Bypass Blocks) — the first focusable element on every page. Hidden
 *  until focused, then jumps keyboard/SR users straight past the sticky header to
 *  `#main` (each page's <main> carries id="main" tabIndex={-1}).
 *
 *  ⛔ AND, WHERE THERE IS A FEED, A SECOND ONE STRAIGHT TO IT (D-KEYBOARD, 2026-09-29). `#main` sits
 *  ABOVE the category rail, so "Skip to main content" still left ~30 Tab stops (every category tile,
 *  the facet pills, the sort tabs) before the first listing. "Skip to listings" lands on the explorer's
 *  results row, `#results` (tabIndex -1, so focus really moves), below all of that — rendered only
 *  while an explorer is mounted (explorer-presence.ts), never as a dead link on a page without one. */
export function SkipLink() {
  const { tr } = useLanguage()
  const hasFeed = useExplorerMounted()
  return (
    <>
      <a href="#main" className={SKIP_CLS}>
        {tr('Skip to main content', 'Tới nội dung chính')}
      </a>
      {hasFeed && (
        <a href="#results" className={SKIP_CLS}>
          {tr('Skip to listings', 'Tới danh sách tin đăng')}
        </a>
      )}
    </>
  )
}
