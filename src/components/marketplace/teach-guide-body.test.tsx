// @vitest-environment jsdom
/**
 * The teach-guide renderer on real markup: what a reader (and a crawler) gets for each inline construct.
 * The release gate is a FUNCTION the page passes in (registry.ts `isLiveTeachHref` at one request clock),
 * so here it is a stub that calls one guide live and one not.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { teachGuideSchema } from '@/lib/teach-guides/schema'
import { TeachKeyPoints, teachGuideSections } from './teach-guide-body'

const guide = teachGuideSchema.parse({
  slug: 'a-guide',
  title: 'A title that is long enough',
  description: 'd'.repeat(120),
  h1: 'A heading here',
  eyebrow: 'Topic',
  intro: 'i'.repeat(90),
  keyPoints: [
    'See [the live guide](/teach-in-vietnam/live-guide) and [the next one](/teach-in-vietnam/later-guide).',
    'Pay is **{{vnd:430000-560000}} an hour** at [centres](/schools).',
    'Make [a profile](https://teacher.eno.vn) and read [the decree](https://vanban.chinhphu.vn/x).',
  ],
  sections: [
    { id: 'one', title: 'One', blocks: [{ type: 'callout', tone: 'warning', title: 'Six months', text: 'File in time.' }] },
    { id: 'two', title: 'Two', blocks: [{ type: 'p', text: 'Text.' }] },
    { id: 'three', title: 'Three', blocks: [{ type: 'p', text: 'Text.' }] },
  ],
  faqs: [],
  sources: [{ title: 'Decree 219', publisher: 'Government of Vietnam', url: 'https://vanban.chinhphu.vn/x' }],
  related: [],
  lastChecked: '2026-10-11',
})
const isLiveHref = (href: string) => href !== '/teach-in-vietnam/later-guide'
// HereLink localises its href through the language context, as on a real page.
const html = (node: React.ReactNode) => renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>)
const points = html(<TeachKeyPoints g={guide} isLiveHref={isLiveHref} />)
const body = html(<>{teachGuideSections(guide, isLiveHref).map((s) => <section key={s.id}>{s.body}</section>)}</>)

describe('teach guide body', () => {
  it('links a live guide and prints an unreleased one as its text', () => {
    expect(points).toContain('href="/teach-in-vietnam/live-guide"')
    expect(points).not.toContain('later-guide')
    expect(points).toContain('the next one')
  })
  it('keeps money on one line and formats it in English', () => {
    expect(points).toContain('430,000–560,000 đ')
    expect(points).toMatch(/whitespace-nowrap[^>]*>430,000–560,000 đ</)
  })
  it('follows our own app (teacher.eno.vn) and marks an outside link nofollow', () => {
    expect(points).toMatch(/<a href="https:\/\/teacher\.eno\.vn" rel="noopener"/)
    expect(points).toMatch(/href="https:\/\/vanban\.chinhphu\.vn\/x"[^>]*rel="[^"]*nofollow/)
  })
  it('tells a screen reader what kind of callout it is', () => {
    expect(body).toContain('<span class="sr-only">Warning: </span>')
  })
  it('closes with the sources and the date they were checked', () => {
    expect(body).toContain('11 Oct 2026')
    expect(body).toContain('Government of Vietnam')
  })
})
