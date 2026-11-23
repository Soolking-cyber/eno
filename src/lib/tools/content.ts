import { GUIDE_BANNED } from '@/lib/guides/edition'
import { RENT_TOOL_SLUGS } from '@/lib/rent-tools/registry'
import { toolDigest } from './canonical'
import { TOOL_CONTENT } from './content.generated'
import { TOOLS, type ToolEntry } from './registry'
import { TOOL_INTERNALS_BANNED, TOOL_LINKS, validateToolSpec, type ToolCtx, type ToolSpec } from './spec'

/**
 * The generated tools as eno.vn serves them. SERVER ONLY (canonical.ts hashes with node:crypto).
 * Validated at module load, like the guides (src/lib/guides/content.ts), so a malformed or unapproved tool fails `next build`
 * rather than reach a page: the spec rules (spec.ts) with eno.vn's own edition rule, and the reviewed digest.
 */

/** eno.vn's half of the rules: the paths a tool may link, and its edition rule (GUIDE_BANNED = src/test/edition-words.ts) with the internals list. */
export const TOOL_CTX: ToolCtx = { relatedPaths: Object.keys(TOOL_LINKS), banned: [GUIDE_BANNED, TOOL_INTERNALS_BANNED] }

const PARSED: ReadonlyMap<string, ToolSpec> = new Map(
  Object.entries(TOOL_CONTENT).map(([slug, raw]) => {
    const problems = validateToolSpec(raw, TOOL_CTX)
    if (problems.length) throw new Error(`tools: src/content/tools/${slug}.json is invalid: ${problems.slice(0, 5).join('; ')}`)
    const spec = raw as ToolSpec
    if (spec.slug !== slug) throw new Error(`tools: ${slug}.json declares slug "${spec.slug}"`)
    // One address per tool: a generated one named like a hand-built tool would be the same tool twice.
    if ((RENT_TOOL_SLUGS as readonly string[]).includes(slug)) throw new Error(`tools: ${slug} is a hand-built tool's address`)
    return [slug, spec] as const
  }),
)

// ⛔ A review is of this spec, not of a slug: the page must never stand over words or formulas nobody approved.
for (const e of TOOLS) {
  if (TOOLS.filter((x) => x.slug === e.slug).length > 1) throw new Error(`tools: ${e.slug} is listed twice`)
  const raw = TOOL_CONTENT[e.slug]
  if (raw === undefined) continue // registry and content one to one is tools.test.ts's job; liveTool also requires it
  if (!e.reviewed) continue // not reviewed: a 404, like an unregistered one
  if (!e.reviewedDigest) throw new Error(`tools: ${e.slug} has a reviewed date but no reviewedDigest`)
  if (e.reviewedDigest !== toolDigest(raw)) throw new Error(`tools: ${e.slug} changed after its review (${e.reviewed}): it needs a new review`)
}

const live = (e: ToolEntry) => !!e.reviewed && !!e.reviewedDigest && PARSED.has(e.slug)

/** A tool eno.vn shows, or null: unregistered, unreviewed or without its spec is a 404. */
export function liveTool(slug: string): ToolSpec | null {
  const e = TOOLS.find((x) => x.slug === slug)
  return e && live(e) ? PARSED.get(slug)! : null
}

/** Every tool eno.vn shows, in the registry's order (the order they were carried). */
export function liveTools(): { entry: ToolEntry; spec: ToolSpec }[] {
  return TOOLS.filter(live).map((entry) => ({ entry, spec: PARSED.get(entry.slug)! }))
}

/** A generated tool's address in a language: /tools/<slug>, and its `/vi` twin for Vietnamese. */
export const toolPath = (slug: string, lang: string) => (lang === 'vi' ? `/vi/tools/${slug}` : `/tools/${slug}`)
