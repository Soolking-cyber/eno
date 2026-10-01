import { LANGUAGES } from '@/lib/languages'
import { VI_PILOT, localizedHref } from '@/lib/lang-pinned'
import { LangPilotLink } from './lang-pilot-link'

/**
 * ⛔ THE LANGUAGE SWITCHER OF A `/vi` PILOT PAGE (SEO wave B, V3b — dormant until V5; copy sheet CS-3
 * V3b-4…6). A server-rendered `<a href hreflang lang>` to the page's other-language twin, so crawlers
 * and readers without JavaScript have the link; its label is the target language's own name
 * (`LANGUAGES.native`: "Tiếng Việt" / "English") with that `lang`, which is also its accessible name
 * (WCAG 3.1.2), so it carries no aria-label.
 *
 * ⛔ BUILT FROM THE PAGE'S OWN KNOWN PATH, NEVER `usePathname`, and RENDERED ONLY FOR A LIVE PILOT PATH:
 * `(index)/layout.tsx` wraps every category, and a "Tiếng Việt" link from /c/rentals would open a 404
 * (CS-3 claim 10). Off the list it renders nothing — and the layouts do not even mount it.
 * ⚠️ ASYNC ONLY TO READ `params` (resolved before render): the layouts pass the promise through so that
 * their own code awaits nothing new (crawler-visible-html-contract.test.ts).
 */
export async function LangPilotSwitch({ path, params }: { path: string; params: Promise<{ lang: string }> }) {
  if (!VI_PILOT.live.includes(path)) return null
  const { lang } = await params
  const onVi = lang === 'vi'
  const target = onVi ? 'en' : 'vi'
  return (
    <LangPilotLink
      href={onVi ? path : localizedHref(path, 'vi')}
      target={target}
      hrefLang={onVi ? 'en' : 'vi-VN'}
      label={LANGUAGES.find((l) => l.code === target)!.native}
    />
  )
}
