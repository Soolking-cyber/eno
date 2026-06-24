import 'server-only'
import { db } from './db'
import { normalizeBrand, brandSlugify, levenshtein } from './brand-normalize'
import { iconForBrand } from './brand-icons'

// Brand-relevant categories live in taxonomy.ts (client-safe); re-export the guard
// so server callers can import it from here alongside the resolver.
export { categoryHasBrand, BRAND_CATEGORY_SLUGS } from './taxonomy'

const MIN_LEN = 2
const MAX_LEN = 40

// How close a typed brand must be to an existing one to be treated as the SAME
// brand (so "huawi" merges into "huawei"). Scale with length: short names need an
// exact-ish match; longer names tolerate a couple of edits.
function fuzzyBudget(len: number): number {
  if (len <= 4) return 1
  if (len <= 8) return 2
  return 3
}

/**
 * Resolve a raw brand string to a canonical Brand.slug, growing the catalogue:
 *  1. exact normalized match → that brand
 *  2. alias match (a typo already merged before) → that brand
 *  3. fuzzy match within budget → that brand, recording this spelling as an alias
 *  4. otherwise → create a new brand (with a simple-icons logo if recognized)
 * Returns the canonical slug, or null if the input isn't a usable brand.
 */
export async function resolveBrand(raw: string): Promise<string | null> {
  const norm = normalizeBrand(raw)
  if (norm.length < MIN_LEN || norm.length > MAX_LEN) return null

  // 1. exact
  const exact = await db.brand.findUnique({ where: { normalized: norm }, select: { slug: true } })
  if (exact) return exact.slug

  // Pull candidates for alias/fuzzy matching. Catalogue is small enough to scan;
  // revisit with pg_trgm if it ever grows large.
  const all = await db.brand.findMany({ select: { id: true, slug: true, normalized: true, aliases: true } })

  // 2. alias match
  for (const b of all) {
    let aliases: string[] = []
    try { aliases = JSON.parse(b.aliases) } catch {}
    if (aliases.includes(norm)) return b.slug
  }

  // 3. fuzzy match → merge this spelling as an alias of the closest brand
  const budget = fuzzyBudget(norm.length)
  let best: { id: string; slug: string; normalized: string; aliases: string } | null = null
  let bestDist = budget + 1
  for (const b of all) {
    const d = levenshtein(norm, b.normalized, budget)
    if (d <= budget && d < bestDist) { best = b; bestDist = d }
  }
  if (best) {
    try {
      const aliases: string[] = JSON.parse(best.aliases)
      if (!aliases.includes(norm)) {
        aliases.push(norm)
        await db.brand.update({ where: { id: best.id }, data: { aliases: JSON.stringify(aliases) } })
      }
    } catch {}
    return best.slug
  }

  // 4. new brand. Prefer the simple-icons display name + logo when recognized.
  const icon = iconForBrand(norm)
  const display = icon ? icon.title : raw.trim().replace(/\s+/g, ' ').slice(0, 40)
  let slug = brandSlugify(display) || norm
  // Guard against a slug collision (different normalized, same prettified slug).
  if (await db.brand.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${norm.slice(0, 4)}`
  try {
    const created = await db.brand.create({
      data: { slug, name: display, normalized: norm, iconSlug: icon?.slug ?? null, aliases: '[]' },
      select: { slug: true },
    })
    return created.slug
  } catch {
    // Lost a create race on the unique normalized → fetch the winner.
    const winner = await db.brand.findUnique({ where: { normalized: norm }, select: { slug: true } })
    return winner?.slug ?? null
  }
}

/** Bump a brand's listing count (best-effort; for ranking the directory). */
export async function bumpBrandCount(slug: string, delta = 1): Promise<void> {
  try { await db.brand.update({ where: { slug }, data: { listingCount: { increment: delta } } }) } catch {}
}
