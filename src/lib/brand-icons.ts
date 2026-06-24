import 'server-only'
import * as simpleIcons from 'simple-icons'
import { normalizeBrand } from './brand-normalize'

// Monotone brand logos from simple-icons (~3,400 brands). SERVER-ONLY — the whole
// icon set never reaches the client; we resolve a brand → its SVG path string here
// and ship only that. Brands not in the set fall back to a monogram chip.

type Icon = { slug: string; title: string; path: string }

let bySlug: Map<string, string> | null = null // simple-icons slug → svg path
let byKey: Map<string, Icon> | null = null     // normalized title/slug → icon

function build() {
  bySlug = new Map()
  byKey = new Map()
  for (const k of Object.keys(simpleIcons)) {
    const ic = (simpleIcons as unknown as Record<string, Icon>)[k]
    if (!ic || !ic.slug || !ic.path) continue
    bySlug.set(ic.slug, ic.path)
    byKey.set(ic.slug, ic)
    byKey.set(normalizeBrand(ic.title), ic)
  }
}
function ensure() { if (!bySlug) build() }

/** Best simple-icons match for an already-normalized brand key, or null. */
export function iconForBrand(normalized: string): { slug: string; title: string } | null {
  if (!normalized) return null
  ensure()
  const ic = byKey!.get(normalized)
  return ic ? { slug: ic.slug, title: ic.title } : null
}

/** The monotone SVG path (24x24 viewBox) for a stored iconSlug, or null. */
export function iconPathForSlug(slug: string | null | undefined): string | null {
  if (!slug) return null
  ensure()
  return bySlug!.get(slug) ?? null
}

/** Effective monotone path for a brand: the admin-curated `logoPath` wins, else the
 *  simple-icons logo for `iconSlug`, else null (→ monogram fallback). */
export function brandIconPath(brand: { logoPath?: string | null; iconSlug?: string | null }): string | null {
  return (brand.logoPath && brand.logoPath.trim()) || iconPathForSlug(brand.iconSlug)
}
