/**
 * The home page's lists as schema.org ItemList JSON-LD (owner 2026-11-16, from the Elementor / ora agent-ready scan: "an
 * ItemList for each list, such as Trending now, with each item pointing to its page. Only mark up what the page shows").
 *
 * ⛔ ONLY WHAT THE PAGE DRAWS: the caller (listings-explorer.tsx, home branch) passes the arrays its rails already render
 * — the server-known ones, so the server HTML and the markup agree — under the heading each rail shows. A rail below its
 * draw floor, or empty, is left out here too.
 * ⛔ URL-ONLY ITEMS: position + the card's own link (/listings/<id>, as listing-card.tsx links it). No names, prices or
 * images: nothing a card might later change is repeated, and a teacher's profile is never re-published as data here.
 */
import { SITE_NAME } from '@/lib/edition'

export type HomeList = { name: string; items: ReadonlyArray<{ id: string }> }

/** This deployment's origin, client-safe (NEXT_PUBLIC_APP_URL is inlined at build) — as src/lib/api/oauth.ts derives it. */
export const HOME_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`).replace(/\/+$/, '')

/** The caller applies each rail's own draw floor (shelf.tsx MIN_RAIL_ITEMS); an empty list here is simply left out. */
export function homeItemListsJsonLd(lists: HomeList[], origin: string): Record<string, unknown> | null {
  const graph = lists
    .filter((l) => l.name.trim() && l.items.length > 0)
    .map((l) => ({
      '@type': 'ItemList',
      name: l.name,
      numberOfItems: l.items.length,
      itemListElement: l.items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/listings/${it.id}` })),
    }))
  return graph.length ? { '@context': 'https://schema.org', '@graph': graph } : null
}

/** JSON for a <script type="application/ld+json">: `<` escaped, so no listing id or heading can close the tag. */
export function jsonLdText(node: Record<string, unknown>): string {
  return JSON.stringify(node).replace(/</g, '\\u003c')
}
