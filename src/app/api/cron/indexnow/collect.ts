import { sitemapIndexChildren } from '@/app/sitemap.xml/build'
import { GET as childGET } from '@/app/sitemaps/[file]/route'
import { buildPagesSitemap } from '@/app/sitemaps/pages.xml/build'
import { parseUrlset } from '@/lib/indexnow-diff'
import { PAGES_SITEMAP_PATH, parseListingSitemapFile } from '@/lib/sitemap'

/**
 * THE SITEMAPS, BUILT IN-PROCESS FOR THE INDEXNOW CRON (SEO wave B, I4).
 *
 * ⛔ NOT FETCHED, AND NOT THROUGH THE PUBLIC HOST. The first design fetched https://eno.vn/sitemap.xml,
 * which reads Cloudflare's copy and the route's 24-hour ISR copy — so a ping could only ever describe
 * yesterday's sitemap (round-1 review, O2d/A2a). This calls the same `GET` handlers the routes serve
 * (precedent: src/app/md/home/route.ts), which query the database directly. It never imports a
 * route's `revalidate`. `pages.xml` comes from its builder rather than its `GET`, in `'optional'` mode:
 * an unknown rent snapshot FREEZES the rent index's URLs instead of failing the run (build.ts).
 *
 * ⛔ EVERY OTHER PROBLEM IS A SOURCE FAILURE, AND A SOURCE FAILURE STOPS THE WHOLE RUN (a 503 that
 * leaves the stored snapshot and the hold untouched). On purpose: a diff against a sitemap missing an
 * unknown part turns that part into removal pings. The failures: a child answering
 * non-200, a child the index names that no route here serves, a child with no `<loc>` or no
 * `https://eno.vn` one, an index with no child, or any throw — from a handler or from the builder.
 */
export class SitemapSourceError extends Error {}

export type Collected = {
  urls: Map<string, string>
  frozen: string[]
  /** Per child: its path and how many `<loc>`s it held (before the host filter). */
  children: Array<{ path: string; locs: number }>
}

export async function collectSitemaps(): Promise<Collected> {
  // ⚠️ THE CHILDREN, NOT /sitemap.xml ITSELF (2026-11-18): /sitemap.xml is one flat urlset while the site
  // is small (src/app/sitemap.xml/build.ts), and its pages half comes from the builder's 'require' mode.
  // The children the index would name are what this diff is kept per (pages.xml in 'optional' mode).
  const { locs: childLocs } = await sitemapIndexChildren()
  if (!childLocs.length) throw new SitemapSourceError('the sitemap index names no child')

  const urls = new Map<string, string>()
  const frozen: string[] = []
  const children: Collected['children'] = []
  for (const loc of childLocs) {
    let path: string
    try {
      path = new URL(loc).pathname
    } catch {
      throw new SitemapSourceError(`the sitemap index names an unparseable child: ${loc}`)
    }
    let xml: string
    if (path === PAGES_SITEMAP_PATH) {
      const built = await buildPagesSitemap({ rentIndex: 'optional' })
      xml = built.xml
      frozen.push(...built.frozen)
    } else {
      const file = path.startsWith('/sitemaps/') ? path.slice('/sitemaps/'.length) : ''
      if (parseListingSitemapFile(file) === null) throw new SitemapSourceError(`the sitemap index names an unknown child: ${path}`)
      const res = await childGET(new Request(loc), { params: Promise.resolve({ file }) })
      if (res.status !== 200) throw new SitemapSourceError(`${path} answered ${res.status}`)
      xml = await res.text()
    }
    const parsed = parseUrlset(xml)
    if (!parsed.rawCount) throw new SitemapSourceError(`${path} lists no URL`)
    // ⛔ EVERY CHILD MUST HOLD AN https://eno.vn URL (codex, diff review: a total-only check let one
    // child of other hosts contribute nothing while the rest kept the run valid). Other hosts are not
    // "nothing changed": the child's previous URLs would all read as removed. This also covers a
    // NEXT_PUBLIC_APP_URL that is not https://eno.vn.
    if (!parsed.urls.size) throw new SitemapSourceError(`${path} lists no URL on https://eno.vn`)
    for (const [u, lastmod] of parsed.urls) urls.set(u, lastmod)
    children.push({ path, locs: parsed.rawCount })
  }
  return { urls, frozen, children }
}
