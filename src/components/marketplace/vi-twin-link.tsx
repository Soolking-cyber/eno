import { LANGUAGES } from '@/lib/languages'
import { VI_PILOT, hasViTwin, localizedHref } from '@/lib/lang-pinned'
import { LangPilotLink } from './lang-pilot-link'

/**
 * "Tiếng Việt" at the end of an English page that has a `/vi` twin — the phase-1 families (categories, districts, help,
 * schools, the rent index, the calculators, the tools; lang-pinned.ts VI_TWIN_FAMILIES). Owner, 2026-11-24 ("Add the link"):
 * Seobility's crawl found 979 pages only in the sitemap, most of them these twins, reached by hreflang alone — no link.
 *
 * ⛔ ENGLISH → VIETNAMESE ONLY. A family's plain URL negotiates, so an "English" link from the twin would serve a reader
 * holding `lang=vi` the Vietnamese page again (lang-pilot-switch.tsx); the way back stays `setLang` (header, Account,
 * footer). The `/vi` twin renders Vietnamese for everyone, so this direction is always right.
 * ⛔ NOT ON A PILOT PAGE: those mount LangPilotSwitch (both directions) themselves.
 * ⚠️ HIDDEN BELOW sm, AS THE HOME PAGE'S SWITCH (owner's answer): sr-only, still in the HTML for crawlers and screen readers,
 * and shown when a keyboard reaches it. Built from the page's own known path, never usePathname (lang-pilot-switch.tsx says why).
 * Synchronous for a page that holds `lang` already (a synchronous render, renderToString in tests, can draw it);
 * ViTwinLinkFromParams for a layout or page that passes the `params` promise through (its own code awaits nothing new).
 */
/** `name`: the twin's Vietnamese name (its h1), after the label for screen readers and crawlers (lang-pilot-link.tsx). */
export function ViTwinLink({ path, lang, name }: { path: string; lang: string; name?: string }) {
  if (lang !== 'en' || VI_PILOT.live.includes(path) || !hasViTwin(path)) return null
  return (
    <div className="max-sm:sr-only max-sm:focus-within:not-sr-only">
      <div className="mt-8 flex justify-end">
        <LangPilotLink href={localizedHref(path, 'vi')} target="vi" hrefLang="vi-VN" label={LANGUAGES.find((l) => l.code === 'vi')!.native} name={name} />
      </div>
    </div>
  )
}

/** ViTwinLink with the variant read from the route's `params` promise. */
export async function ViTwinLinkFromParams({ path, params, name }: { path: string; params: Promise<{ lang: string }>; name?: string }) {
  return <ViTwinLink path={path} lang={(await params).lang} name={name} />
}
