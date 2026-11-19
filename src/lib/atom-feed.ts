import { db } from '@/lib/db'
import { publicFeedListingWhere } from '@/lib/schema-feed'
import { siteOrigin } from '@/lib/sitemap'
import { listedAt } from '@/lib/stale'

/**
 * /feed.xml — an Atom feed (RFC 4287) of the newest public listings, declared in the home page's head as
 * `<link rel="alternate" type="application/atom+xml">` and in its `Link:` header (owner, 2026-11-19, from an agent-readiness
 * scan: "No RSS or Atom feed declared in the page head. A declared RSS or Atom feed gives agents a clean, dated list of new
 * content").
 *
 * The SAME public set as /schema-feed.jsonl (publicFeedListingWhere: the sitemap's listings, edition-scoped, minus every row of
 * a teacher's shop) — newest ATOM_FEED_CAP by listing date. Each entry is what the listing's page already says publicly: its
 * title, its link, its date, its category and the start of its description. ⛔ No seller name, contact or price text that the
 * card does not show: the page is the source, the feed only points at it.
 */
export const ATOM_FEED_PATH = '/feed.xml'
export const ATOM_FEED_CAP = 50
const SUMMARY_CHARS = 280

export type AtomFeedRow = {
  id: string
  title: string
  description: string | null
  postedAt: Date
  createdAt: Date
  listingType: string | null
  category: { slug: string; name: string }
}

/** XML 1.0 text: the five entities, and the control characters XML forbids dropped (a pasted description can hold them). */
export function xmlText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** The start of a description, on one line, cut at a word. */
export function summaryOf(description: string | null): string {
  const flat = (description ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= SUMMARY_CHARS) return flat
  const cut = flat.slice(0, SUMMARY_CHARS)
  const space = cut.lastIndexOf(' ')
  return `${(space > SUMMARY_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The document, newest entry first. `updated` is the newest entry's date (or `now` with no entries), as RFC 4287 asks. */
export function atomFeedXml(rows: AtomFeedRow[], origin: string, now: Date = new Date()): string {
  const dated = rows.map((r) => ({ r, at: listedAt(r) })).sort((a, b) => b.at.getTime() - a.at.getTime() || (a.r.id < b.r.id ? 1 : -1))
  const updated = (dated[0]?.at ?? now).toISOString()
  // The publisher's name is the feed's own host, so the name and every link in the document can never name two sites.
  const site = new URL(origin).host
  const entries = dated.map(({ r, at }) => {
    const url = `${origin}/listings/${r.id}`
    const summary = summaryOf(r.description)
    return [
      '  <entry>',
      `    <id>${xmlText(url)}</id>`,
      `    <title>${xmlText(r.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${xmlText(url)}"/>`,
      `    <published>${at.toISOString()}</published>`,
      `    <updated>${at.toISOString()}</updated>`,
      `    <category term="${xmlText(r.category.slug)}" label="${xmlText(r.category.name)}"/>`,
      ...(summary ? [`    <summary type="text">${xmlText(summary)}</summary>`] : []),
      '  </entry>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${xmlText(`${origin}${ATOM_FEED_PATH}`)}</id>`,
    `  <title>${xmlText(`${site} — newest listings`)}</title>`,
    `  <link rel="self" type="application/atom+xml" href="${xmlText(`${origin}${ATOM_FEED_PATH}`)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xmlText(`${origin}/`)}"/>`,
    `  <updated>${updated}</updated>`,
    `  <author><name>${xmlText(site)}</name><uri>${xmlText(`${origin}/`)}</uri></author>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n')
}

/** One bounded read (the schema feed's public set, newest first), then the document. */
export async function atomFeedBody(): Promise<string> {
  const rows = await db.listing.findMany({
    // edition-lint-allow: publicFeedListingWhere() is submittedListingWhere() (edition-scoped) minus teachers' shops.
    where: await publicFeedListingWhere(),
    select: { id: true, title: true, description: true, postedAt: true, createdAt: true, listingType: true, category: { select: { slug: true, name: true } } },
    orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    take: ATOM_FEED_CAP,
  })
  return atomFeedXml(rows, siteOrigin())
}
