import { schemamapXml } from '@/lib/schema-feed'
import { siteOrigin, xmlResponse } from '@/lib/sitemap'

/**
 * /schemamap.xml — the NLWeb Schema Map robots.txt names (`schemamap:`): it lists the site's one structured-data feed,
 * /schema-feed.jsonl. Format and reasons: src/lib/schema-feed.ts.
 */

export const revalidate = 86400

export function GET() {
  return xmlResponse(schemamapXml(siteOrigin()))
}
