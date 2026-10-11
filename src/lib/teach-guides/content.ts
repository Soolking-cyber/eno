import { teachGuideSchema, type TeachGuide } from './schema'
import { TEACH_CONTENT } from './content.generated'
import { TEACH_GUIDES } from './registry'
import { contentDigest } from './digest'

/**
 * Every guide, PARSED AT MODULE LOAD — not lazily per request.
 *
 * ⛔ EAGER ON PURPOSE. The library is released in waves (registry.ts), so most guides are rendered for
 * the first time at RUNTIME, weeks after the deploy, the hour their date arrives. A lazy parse would turn
 * a malformed scheduled guide into a 500 on its release day, with nobody watching. Parsing all of them
 * here (inline grammar and source URLs included — schema.ts) makes the guide route, which imports this
 * module and which `next build` evaluates, fail the build the moment any one guide is malformed; and
 * teach-guides.test.ts runs the same parse.
 */
const GUIDES: ReadonlyMap<string, TeachGuide> = new Map(
  Object.entries(TEACH_CONTENT).map(([slug, raw]) => {
    const parsed = teachGuideSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`teach-guides: src/content/teach-in-vietnam/${slug}.json is invalid: ${parsed.error.message}`)
    if (parsed.data.slug !== slug) throw new Error(`teach-guides: ${slug}.json declares slug "${parsed.data.slug}"`)
    return [slug, parsed.data] as const
  }),
)

/**
 * ⛔ A REVIEW IS OF THIS CONTENT, NOT OF A SLUG. Every reviewed guide must carry the digest of what was
 * reviewed, and it must still match: otherwise the page would say "reviewed by the eno.vn team" over words
 * nobody reviewed. Fails `next build` (the guide route imports this module), like a malformed guide.
 */
for (const e of TEACH_GUIDES) {
  if (!e.reviewed) continue
  const raw = TEACH_CONTENT[e.slug]
  if (raw === undefined) continue // registry ↔ content 1:1 is teach-guides.test.ts's job; isLive also requires content
  if (!e.reviewedDigest) throw new Error(`teach-guides: ${e.slug} has a reviewed date but no reviewedDigest — record what was reviewed`)
  if (e.reviewedDigest !== contentDigest(raw))
    throw new Error(`teach-guides: ${e.slug} changed after its review (${e.reviewed}) — it needs a new review before it can be released`)
}

export function teachGuideContent(slug: string): TeachGuide | null {
  return GUIDES.get(slug) ?? null
}

export function allTeachGuideContent(): TeachGuide[] {
  return [...GUIDES.values()]
}
