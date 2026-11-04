import { contentDigest } from '@/lib/teach-guides/digest'
import { teachGuideSchema, type TeachGuide } from '@/lib/teach-guides/schema'
import { GUIDE_CONTENT } from './content.generated'
import { bannedWordIn } from './edition'
import { GUIDES } from './registry'

/** Parsed at module load, so a malformed guide fails `next build`, like the Teach in Vietnam library (src/lib/teach-guides/content.ts). */
const PARSED: ReadonlyMap<string, TeachGuide> = new Map(
  Object.entries(GUIDE_CONTENT).map(([slug, raw]) => {
    const parsed = teachGuideSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`guides: src/content/guides/${slug}.json is invalid: ${parsed.error.message}`)
    if (parsed.data.slug !== slug) throw new Error(`guides: ${slug}.json declares slug "${parsed.data.slug}"`)
    const banned = bannedWordIn(raw)
    if (banned) throw new Error(`guides: ${slug}.json says "${banned}", which may not appear on eno.vn`)
    return [slug, parsed.data] as const
  }),
)

// The registry's own words print on the hub, in Keep reading and in llms.txt, and a red CI run blocks nothing: these hold at build time too.
for (const e of GUIDES) {
  if (GUIDES.filter((x) => x.slug === e.slug).length > 1) throw new Error(`guides: ${e.slug} is listed twice`)
  if (e.pair) {
    const pair = GUIDES.find((x) => x.slug === e.pair)
    if (!pair || pair.pair !== e.slug || pair.lang === e.lang) throw new Error(`guides: ${e.slug} and ${e.pair} are not a pair in two languages`)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.slug)) throw new Error(`guides: "${e.slug}" is not a slug the address can pin to its language`)
  const banned = bannedWordIn(e.slug)
  if (banned) throw new Error(`guides: the address ${e.slug} says "${banned}", which may not appear on eno.vn`)
}

// ⛔ A review is of this text, not of a slug: the page must never stand over words nobody approved.
for (const e of GUIDES) {
  if (!e.reviewed) continue
  const raw = GUIDE_CONTENT[e.slug]
  if (raw === undefined) continue // registry and content one to one is guides.test.ts's job; isGuideLive also requires it
  if (!e.reviewedDigest) throw new Error(`guides: ${e.slug} has a reviewed date but no reviewedDigest`)
  if (e.reviewedDigest !== contentDigest(raw)) throw new Error(`guides: ${e.slug} changed after its review (${e.reviewed}): it needs a new review`)
}

export const guideContent = (slug: string): TeachGuide | null => PARSED.get(slug) ?? null
