/**
 * Guide pictures, reading time and the question outline — the auspia-style additions to Reach's guides
 * (owner 2026-11-22: "i liked they have images and nice looking content with outline questions").
 *
 * Pure helpers over a parsed guide (schema.ts): no I/O, so the renderer and its tests share one definition.
 */
import type { TeachGuide } from '@/lib/teach-guides/schema'

/** OUR storage origin only (the same pin as listing-image.ts): a guide names a picture by its SHA-256, never by a URL. */
const HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

/** The public address of a guide picture, or null where no storage origin is configured (then no picture renders). */
export function guideImageSrc(id: string): string | null {
  if (!HOST || !/^[0-9a-f]{64}$/.test(id)) return null
  return `${HOST}/storage/v1/object/public/listings/guides/${id}.webp`
}

/** The carry stores a picture at most 1600 px wide (scripts/carry-guides.mjs): the size of the file a share card points at. */
export const STORED_MAX_WIDTH = 1600
export function storedSize(pic: { w: number; h: number }): { w: number; h: number } {
  return pic.w <= STORED_MAX_WIDTH ? { w: pic.w, h: pic.h } : { w: STORED_MAX_WIDTH, h: Math.round((pic.h * STORED_MAX_WIDTH) / pic.w) }
}

/** Words a reader goes through: the lede, the key points, every block and the FAQ (headings and sources aside). */
export function guideWords(g: TeachGuide): number {
  const parts: string[] = [g.intro, ...g.keyPoints, ...g.faqs.flatMap((f) => [f.q, f.a])]
  for (const s of g.sections)
    for (const b of s.blocks) {
      if (b.type === 'p' || b.type === 'callout') parts.push(b.text)
      else if (b.type === 'ul' || b.type === 'ol') parts.push(...b.items)
      else if (b.type === 'table') parts.push(b.caption, ...b.rows.flat())
      else if (b.type === 'steps') parts.push(...b.items.flatMap((i) => [i.title, i.text]))
    }
  return parts.join(' ').replace(/\{\{vnd:[^}]*\}\}/g, ' x ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/\s+/).filter(Boolean).length
}

/**
 * Minutes to read, rounded up. English ~230 words a minute; Vietnamese is written in syllables split by spaces, so its
 * count runs higher for the same content and is read faster per "word" — ~280.
 */
export function readingMinutes(g: TeachGuide, lang: 'en' | 'vi'): number {
  return Math.max(1, Math.ceil(guideWords(g) / (lang === 'vi' ? 280 : 230)))
}

const QUESTION = /[?？]\s*$/

/**
 * The question sub-headings of each section — the h3 blocks phrased as a question — with a stable anchor:
 * `<section id>-q<n>` (n counts that section's questions from 1). Index = the h3's block index in its section.
 * Positional, not slugged text: Vietnamese headings slug badly, and an anchor must not move when a word is fixed.
 */
export function questionAnchors(g: TeachGuide): { id: string; title: string; block: number }[][] {
  return g.sections.map((s) => {
    let n = 0
    const out: { id: string; title: string; block: number }[] = []
    s.blocks.forEach((b, i) => {
      if (b.type === 'h3' && QUESTION.test(b.text)) out.push({ id: `${s.id}-q${++n}`, title: b.text, block: i })
    })
    return out
  })
}

/** The label every guide picture carries: they are made with AI, and the page says so. */
export const AI_ILLUSTRATION = { en: 'AI illustration', vi: 'Ảnh minh hoạ tạo bằng AI' } as const
