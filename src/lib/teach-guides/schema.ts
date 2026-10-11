import { z } from 'zod'
import { checkSourceUrl, parseInline } from './inline'

/**
 * THE TEACH-IN-VIETNAM GUIDES ARE DATA, NOT JSX — and this file is the contract that data must meet.
 *
 * ⚠️ WHY DATA. The library is ~40 long-form guides written from one verified fact base. Hand-writing each
 * one as a `page.tsx` (the house pattern for a handful of guides) would mean ~40 copies of the same
 * scaffolding, ~40 places for an unescaped apostrophe to break a build, and no way to check the WORDS of
 * the whole set at once. As data, every guide goes through one renderer (teach-guide-body.tsx), one set of
 * guards (teach-guides.test.ts — vocabulary, money, links, uniqueness) and one route.
 *
 * ⚠️ PARSED AT MODULE LOAD (content.ts), SO A MALFORMED GUIDE FAILS `next build`. That is the blast radius
 * the rest of the guide machinery chose too (seo-article.tsx `marketplaceHref` throws for the same
 * reason): a broken page should be loud in CI, never a half-rendered article in front of a crawler.
 *
 * INLINE MARKUP (every string field marked "inline" below; see inline.ts for the grammar):
 *   **bold**   ·   [link text](/internal-path | https://external)   ·   {{vnd:25000000}} / {{vnd:25000000-35000000}}
 * Nothing else. No HTML, no headings inside a paragraph, no images.
 */

/**
 * Ids the page itself gives elements around a guide's sections (teach-guide-body.tsx's "Sources" section and
 * "Key points" box, SeoArticle's `<main>`) — a content section with one of them would duplicate a DOM id
 * and send an "On this page" link to the wrong place.
 */
export const RESERVED_SECTION_IDS: readonly string[] = ['sources', 'key-points', 'main', 'faq', 'faqs', 'related', 'keep-reading', 'on-this-page']
/** Plain-text fields may not carry inline markup: it would render literally. */
const MARKUP_IN_PLAIN = /\*\*|\{\{|\]\(/

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case slug')
/** A REAL calendar date, not only the shape: '2026-99-99' would reach the reader as "facts last checked on …". */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, 'a real calendar date')
/** Inline-markup string (inline.ts). Non-empty, trimmed. */
const inline = z.string().trim().min(1)

export const teachBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: inline }),
  /** A sub-heading inside a section — plain text (no inline markup: it is a heading, and it is an anchor). */
  z.object({ type: z.literal('h3'), text: z.string().trim().min(1).max(90) }),
  z.object({ type: z.literal('ul'), items: z.array(inline).min(2) }),
  z.object({ type: z.literal('ol'), items: z.array(inline).min(2) }),
  z.object({
    type: z.literal('table'),
    /** What the table shows and, where it matters, where the numbers come from. Inline. */
    caption: inline,
    headers: z.array(z.string().trim().min(1)).min(2).max(5),
    rows: z.array(z.array(inline)).min(2),
  }),
  z.object({
    type: z.literal('callout'),
    tone: z.enum(['note', 'warning', 'tip']),
    title: z.string().trim().min(1).max(80).optional(),
    text: inline,
  }),
  z.object({
    type: z.literal('steps'),
    items: z.array(z.object({ title: z.string().trim().min(1).max(90), text: inline })).min(2),
  }),
])

export const teachGuideSchema = z
  .object({
    slug,
    /** `<title>` WITHOUT the " | eno.vn" suffix the page adds. */
    title: z.string().trim().min(20).max(62),
    /** Meta description — what the search result says under the title. */
    description: z.string().trim().min(110).max(165),
    h1: z.string().trim().min(10).max(110),
    eyebrow: z.string().trim().min(2).max(40),
    /** The answer-first lede: PLAIN TEXT (it is also the Article JSON-LD description). */
    intro: z.string().trim().min(80).max(520),
    /** The "Key points" box under the lede — the page's answer in 3-6 lines. Inline. */
    keyPoints: z.array(inline).min(3).max(6),
    sections: z
      .array(
        z.object({
          id: slug,
          title: z.string().trim().min(3).max(100),
          blocks: z.array(teachBlockSchema).min(1),
        }),
      )
      .min(3),
    /** Visible FAQ + FAQPage JSON-LD. PLAIN TEXT answers (JSON-LD carries them verbatim). */
    faqs: z.array(z.object({ q: z.string().trim().min(8).max(160), a: z.string().trim().min(20).max(700) })).max(10),
    /** Where the facts come from — rendered as the last section, outbound links to the authority. */
    sources: z
      .array(
        z.object({
          title: z.string().trim().min(3).max(200),
          publisher: z.string().trim().min(2).max(120),
          url: z.string().url().startsWith('https://'),
        }),
      )
      .min(1)
      .max(25),
    /** Sibling guides for "Keep reading" — slugs from the registry. */
    related: z.array(slug).max(8),
    /** The date the facts in this guide were last checked against their sources. */
    lastChecked: isoDate,
  })
  .strict()
  .superRefine((g, ctx) => {
    const ids = new Set<string>()
    for (const s of g.sections) {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', message: `duplicate section id "${s.id}"`, path: ['sections'] })
      if (RESERVED_SECTION_IDS.includes(s.id)) ctx.addIssue({ code: 'custom', message: `section id "${s.id}" is reserved by the page`, path: ['sections'] })
      ids.add(s.id)
    }
    // One source, one entry: the URL is the list's React key and a duplicate is an editing slip anyway.
    const urls = new Set<string>()
    for (const [i, s] of g.sources.entries()) {
      if (urls.has(s.url)) ctx.addIssue({ code: 'custom', message: `duplicate source ${s.url}`, path: ['sources'] })
      urls.add(s.url)
      try {
        checkSourceUrl(s.url)
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e), path: ['sources', i, 'url'] })
      }
    }
    // ⛔ THE INLINE GRAMMAR IS PART OF THE SCHEMA, so content.ts's parse at module load fails the build on a
    // malformed token — not the first render on a wave's release day, weeks later, with nobody watching.
    forEachInline(g, (src, path) => {
      try {
        parseInline(src)
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e), path })
      }
    })
    forEachPlain(g, (text, path) => {
      if (MARKUP_IN_PLAIN.test(text)) ctx.addIssue({ code: 'custom', message: `inline markup in a plain-text field: ${JSON.stringify(text.slice(0, 80))}`, path })
    })
    if (g.related.includes(g.slug)) ctx.addIssue({ code: 'custom', message: 'a guide may not relate to itself', path: ['related'] })
    for (const [i, s] of g.sections.entries())
      for (const b of s.blocks)
        if (b.type === 'table')
          for (const row of b.rows)
            if (row.length !== b.headers.length)
              ctx.addIssue({ code: 'custom', message: `table row width ${row.length} ≠ ${b.headers.length} headers`, path: ['sections', i] })
  })

export type TeachBlock = z.infer<typeof teachBlockSchema>
export type TeachGuide = z.infer<typeof teachGuideSchema>

type Walkable = {
  keyPoints: string[]
  sections: { blocks: TeachBlock[] }[]
}

/** Every INLINE-markup string in a guide, with its path — for the schema, the renderer's tests and the guards. */
export function forEachInline(g: Walkable, fn: (src: string, path: (string | number)[]) => void): void {
  g.keyPoints.forEach((k, i) => fn(k, ['keyPoints', i]))
  g.sections.forEach((s, si) =>
    s.blocks.forEach((b, bi) => {
      const at = ['sections', si, 'blocks', bi]
      if (b.type === 'p' || b.type === 'callout') fn(b.text, at)
      else if (b.type === 'ul' || b.type === 'ol') b.items.forEach((t, i) => fn(t, [...at, 'items', i]))
      else if (b.type === 'table') {
        fn(b.caption, [...at, 'caption'])
        b.rows.forEach((r, ri) => r.forEach((c, ci) => fn(c, [...at, 'rows', ri, ci])))
      } else if (b.type === 'steps') b.items.forEach((t, i) => fn(t.text, [...at, 'items', i, 'text']))
    }),
  )
}

/** Every PLAIN-text string a reader sees (titles, lede, headings, FAQ) — markup there would print literally. */
type PlainWalkable = {
  title: string
  description: string
  h1: string
  eyebrow: string
  intro: string
  faqs: { q: string; a: string }[]
  sections: { title: string; blocks: TeachBlock[] }[]
}

export function forEachPlain(g: PlainWalkable, fn: (text: string, path: (string | number)[]) => void): void {
  for (const k of ['title', 'description', 'h1', 'eyebrow', 'intro'] as const) fn(g[k], [k])
  g.faqs.forEach((f, i) => {
    fn(f.q, ['faqs', i, 'q'])
    fn(f.a, ['faqs', i, 'a'])
  })
  g.sections.forEach((s, si) => {
    fn(s.title, ['sections', si, 'title'])
    s.blocks.forEach((b, bi) => {
      const at = ['sections', si, 'blocks', bi]
      if (b.type === 'h3') fn(b.text, at)
      else if (b.type === 'table') b.headers.forEach((h, i) => fn(h, [...at, 'headers', i]))
      else if (b.type === 'callout' && b.title) fn(b.title, [...at, 'title'])
      else if (b.type === 'steps') b.items.forEach((t, i) => fn(t.title, [...at, 'items', i, 'title']))
    })
  })
}
