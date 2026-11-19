import { schemamapXml } from '@/lib/schema-feed'
import { siteOrigin, xmlResponse } from '@/lib/sitemap'

/**
 * /schemamap.xml — the NLWeb Schema Map, linked from /llms.txt (robots.txt stopped naming it on 2026-11-19: Lighthouse fails
 * robots.txt on the unknown `schemamap:` line; src/app/robots.txt/route.ts). It lists the site's one structured-data feed,
 * /schema-feed.jsonl. Format and reasons: src/lib/schema-feed.ts.
 */

export const revalidate = 86400

export function GET() {
  return xmlResponse(schemamapXml(siteOrigin()))
}
