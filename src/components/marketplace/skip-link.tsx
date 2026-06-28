'use client'

import { useLanguage } from '@/context/language-context'

/** WCAG 2.4.1 (Bypass Blocks) — the first focusable element on every page. Hidden
 *  until focused, then jumps keyboard/SR users straight past the sticky header to
 *  `#main` (each page's <main> carries id="main" tabIndex={-1}). */
export function SkipLink() {
  const { tr } = useLanguage()
  return (
    <a
      href="#main"
      className="sr-only rounded-lg font-bold focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:text-white focus:shadow-pop focus:outline-none focus:ring-2 focus:ring-ring/50"
    >
      {tr('Skip to main content', 'Tới nội dung chính')}
    </a>
  )
}
