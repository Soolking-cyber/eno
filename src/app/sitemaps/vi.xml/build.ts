import { buildPagesSitemap } from '@/app/sitemaps/pages.xml/build'
import { pinnedVariant, type ViPilot } from '@/lib/lang-pinned'
import { siteOrigin, sitemapViLists, urlsetXml } from '@/lib/sitemap'

/**
 * THE BODY OF /sitemaps/vi.xml (2026-11-27, for Cốc Cốc): THE VIETNAMESE PAGES OF pages.xml, AND NOTHING ELSE.
 *
 * Cốc Cốc, the Vietnamese search engine, favours Vietnamese-language pages, reads a sitemap only from a `Sitemap:` line in
 * robots.txt, and crawls a few hundred pages a day — on 2026-11-27 it held 1,262 English listing pages and 4 of the 40
 * Vietnamese guides. This file puts the Vietnamese pages where it looks first (robots.txt names it first).
 *
 * ⛔ A FILTER OF pages.xml'S OWN ENTRIES, NEVER A LIST OF ITS OWN. Each `<url>` line is pages.xml's, byte for byte (its
 * lastmod, and a `/vi` twin's xhtml:link alternates), from the same builder in the same `'require'` mode, so this file can
 * never submit a URL pages.xml does not — nothing a page answers noindex, 404 or a redirect to — and an unknown rent snapshot
 * throws here too (the route keeps its last good copy).
 * ⛔ THE LANGUAGE IS THE PROXY'S OWN RESOLVER (`pinnedVariant`, src/lib/lang-pinned.ts): a URL is here when every reader gets
 * its Vietnamese render — a `/vi` twin, a Vietnamese guide, /huong-dan, a /gia page or the /gia hub. A plain URL that
 * negotiates (/c/rentals, /help) is not: Cốc Cốc may get its English render; its `/vi` twin is here instead. `/vi` itself is
 * not in pages.xml (pilot decision V-c), so it is not here either. On eno.forum (`sitemapViLists`: no twins) only the
 * guides and the /gia pages qualify.
 * ⚠️ NOT A CHILD OF /sitemap.xml: its URLs are already there through pages.xml, and the IndexNow cron reads only the
 * index's children (src/app/api/cron/indexnow/collect.ts), so it never diffs this file.
 */
export function viSitemapEntries(entries: readonly string[], origin: string = siteOrigin(), lists: ViPilot = sitemapViLists()): string[] {
  const host = new URL(origin).host
  return entries.filter((entry) => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(entry)?.[1]
    if (!loc) return false
    let url: URL
    try {
      url = new URL(loc)
    } catch {
      return false
    }
    return url.host === host && pinnedVariant(url.pathname, lists) === 'vi'
  })
}

export async function buildViSitemap(): Promise<string> {
  const { entries } = await buildPagesSitemap({ rentIndex: 'require' })
  return urlsetXml(viSitemapEntries(entries), 'vi.xml')
}
