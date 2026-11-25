'use client'

import type { MouseEvent } from 'react'
import { useLanguage } from '@/context/language-context'

/**
 * The switcher's link (lang-pilot-switch.tsx). Its click stores the choice the way `setLang` does — it IS
 * `setLang`, which on a pinned pilot page goes to the twin with `location.assign` (language-context.tsx),
 * so later adaptive pages follow the choice. A modified click (new tab, save) is left to the browser.
 * `relative tap-44`: the 12px label gets a 44px touch target without moving anything (home-06 / quality-11).
 * `name`, the twin's own name in its language, follows the label for screen readers and crawlers only: "Tiếng Việt" alone
 * was one link text for every twin (Seobility crawl 5, 2026-11-25: one anchor, six category pages).
 */
export function LangPilotLink({ href, target, hrefLang, label, name }: { href: string; target: 'en' | 'vi'; hrefLang: string; label: string; name?: string }) {
  const { setLang } = useLanguage()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    setLang(target)
  }
  return (
    <a href={href} hrefLang={hrefLang} lang={target} onClick={onClick} className="relative tap-44 text-xs font-semibold text-accent-foreground hover:underline">
      {label}
      {name ? <span className="sr-only">: {name}</span> : null}
    </a>
  )
}
