'use client'

import type { MouseEvent } from 'react'
import { useLanguage } from '@/context/language-context'

/**
 * The switcher's link (lang-pilot-switch.tsx). Its click stores the choice the way `setLang` does — it IS
 * `setLang`, which on a pinned pilot page goes to the twin with `location.assign` (language-context.tsx),
 * so later adaptive pages follow the choice. A modified click (new tab, save) is left to the browser.
 */
export function LangPilotLink({ href, target, hrefLang, label }: { href: string; target: 'en' | 'vi'; hrefLang: string; label: string }) {
  const { setLang } = useLanguage()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    setLang(target)
  }
  return (
    <a href={href} hrefLang={hrefLang} lang={target} onClick={onClick} className="text-xs font-semibold text-accent-foreground hover:underline">
      {label}
    </a>
  )
}
