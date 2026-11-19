import { describe, expect, it, vi } from 'vitest'

// The Atom feed's document (owner 2026-11-19: "No RSS or Atom feed declared in the page head"). The read is the schema feed's
// public set (publicFeedListingWhere, pinned by the schema feed's own tests); this pins the XML: well-formed, escaped, newest
// first, dated, and nothing but what the listing page says.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/schema-feed', () => ({ publicFeedListingWhere: async () => ({}) }))
vi.mock('@/lib/sitemap', () => ({ siteOrigin: () => 'https://eno.vn' }))

import { ATOM_FEED_CAP, atomFeedXml, summaryOf, xmlText } from './atom-feed'

const row = (id: string, title: string, at: string, description: string | null = 'A good bike') => ({
  id, title, description, postedAt: new Date(at), createdAt: new Date(at), listingType: 'sell',
  category: { slug: 'vehicles', name: 'Vehicles' },
})

describe('atomFeedXml', () => {
  it('a valid Atom document: self link, alternate, author, updated = the newest entry, newest first', () => {
    const xml = atomFeedXml([row('a', 'Old bike', '2026-11-01T00:00:00Z'), row('b', 'New bike', '2026-11-18T08:00:00Z')], 'https://eno.vn')
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true)
    expect(xml).toContain('<id>https://eno.vn/feed.xml</id>')
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://eno.vn/feed.xml"/>')
    expect(xml).toContain('<updated>2026-11-18T08:00:00.000Z</updated>')
    expect(xml).toContain('<title>eno.vn — newest listings</title>')
    expect(xml).toContain('<author><name>eno.vn</name><uri>https://eno.vn/</uri></author>')
    expect(xml.indexOf('New bike')).toBeLessThan(xml.indexOf('Old bike'))
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://eno.vn/listings/b"/>')
    expect(xml).toContain('<category term="vehicles" label="Vehicles"/>')
    expect(xml.trimEnd().endsWith('</feed>')).toBe(true)
  })

  it('⛔ escapes every text and attribute, and drops the control characters XML forbids', () => {
    const xml = atomFeedXml([row('x', 'Tom & Jerry <b>"rare"</b>', '2026-11-18T00:00:00Z', 'ok\u0007 fine')], 'https://eno.vn')
    expect(xml).toContain('<title>Tom &amp; Jerry &lt;b&gt;&quot;rare&quot;&lt;/b&gt;</title>')
    expect(xml).toContain('<summary type="text">ok fine</summary>')
    expect(xml).not.toContain('\u0007')
    expect(xmlText("it's")).toBe('it&apos;s')
  })

  it('no entries: still a valid feed, dated now', () => {
    const xml = atomFeedXml([], 'https://eno.vn', new Date('2026-11-19T00:00:00Z'))
    expect(xml).toContain('<updated>2026-11-19T00:00:00.000Z</updated>')
    expect(xml).not.toContain('<entry>')
  })

  it('a row with no description carries no empty summary', () => {
    expect(atomFeedXml([row('n', 'No text', '2026-11-18T00:00:00Z', null)], 'https://eno.vn')).not.toContain('<summary')
  })

  it('bounded: the newest 50', () => expect(ATOM_FEED_CAP).toBe(50))
})

describe('summaryOf', () => {
  it('one line, cut at a word with an ellipsis', () => {
    expect(summaryOf('a\n\n  b')).toBe('a b')
    const s = summaryOf(`${'word '.repeat(100)}`)
    expect(s.length).toBeLessThanOrEqual(281)
    expect(s.endsWith('word…')).toBe(true)
  })
})
