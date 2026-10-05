import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { SCHOOL_LOGO_STAMPS } from '@/generated/school-logos'
import { schoolLogo } from './logos'

// The /schools logo tiles (scripts/build-school-logos.mjs). They are served with a ONE-YEAR immutable cache
// (next.config.ts STAMPABLE_STATIC) because every URL carries the stamp from the manifest — so the stamp
// MUST be the hash of the bytes, or a re-captured logo stays stale in every browser for a year.
const DIR = 'public/schools/logos'
const entries = Object.entries(SCHOOL_LOGO_STAMPS)
type Override = { url?: string; selector?: string; use?: string; why?: string; crop?: unknown; bg?: string }
const schools = (JSON.parse(readFileSync('data/schools/hcmc.json', 'utf8')) as { schools: { slug: string; website?: string | null }[] }).schools
const overrides = JSON.parse(readFileSync('data/schools/logo-overrides.json', 'utf8')) as Record<string, Override>
const madeFrom = JSON.parse(readFileSync('data/schools/logo-sources.json', 'utf8')) as Record<string, unknown>
const stampOf = (slug: string) =>
  createHash('sha256').update(readFileSync(`${DIR}/${slug}.webp`)).update(readFileSync(`${DIR}/${slug}-2x.webp`)).digest('hex').slice(0, 8)

describe('school logo tiles', () => {
  it('every stamp is the hash of both files on disk', () => {
    expect(entries.length).toBeGreaterThan(100)
    expect(entries.filter(([slug, v]) => stampOf(slug) !== v).map(([slug]) => slug), 're-run scripts/build-school-logos.mjs').toEqual([])
  })

  it('the folder is exactly the manifest: no orphan file, no missing one', () => {
    const expected = entries.flatMap(([slug]) => [`${slug}.webp`, `${slug}-2x.webp`]).sort()
    // Dotfiles aside: Finder drops a .DS_Store in any folder it opens (git ignores it).
    expect(readdirSync(DIR).filter((f) => !f.startsWith('.')).sort()).toEqual(expected)
  })

  it('every logo belongs to a school in the directory file', () => {
    const slugs = new Set(schools.map((s) => s.slug))
    expect(entries.map(([slug]) => slug).filter((slug) => !slugs.has(slug))).toEqual([])
  })

  it('every tile was made under the override the file says NOW (logo-sources.json)', () => {
    // A changed url/selector/use without a re-harvest must not leave the old school's mark in place.
    // Everything that decides the pixels (build-school-logos.mjs `decision`): an edited crop or bg counts too.
    // And the school's website: a capture from a site the school no longer has is not its logo.
    const website = new Map(schools.map((s) => [s.slug, s.website ?? null]))
    const sourceOf = (o: Override, slug: string) => ({ website: website.get(slug), url: o.url ?? null, selector: o.selector ?? null, use: o.use ?? null, crop: o.crop ?? null, bg: o.bg ?? null })
    expect(Object.keys(madeFrom).sort()).toEqual(entries.map(([slug]) => slug).sort())
    const drifted = entries.filter(([slug]) => JSON.stringify(madeFrom[slug]) !== JSON.stringify(sourceOf(overrides[slug] ?? {}, slug)))
    expect(drifted.map(([slug]) => slug), 're-harvest these slugs, then rebuild').toEqual([])
  })

  it('every school has a tile, or a reviewed reason it has none', () => {
    // No website, or `use: "none"` with a `why` — a failed capture never silently becomes a monogram.
    const missing = schools.filter((s) => s.website && !SCHOOL_LOGO_STAMPS[s.slug] && !(overrides[s.slug]?.use === 'none' && overrides[s.slug]?.why))
    expect(missing.map((s) => s.slug)).toEqual([])
  })

  it('tiles are 2:1 WebP at 240×120 and 480×240, and small', async () => {
    const bad: string[] = []
    for (const [slug] of entries) {
      for (const [file, w, h] of [[`${slug}.webp`, 240, 120], [`${slug}-2x.webp`, 480, 240]] as const) {
        const buf = readFileSync(`${DIR}/${file}`)
        const m = await sharp(buf).metadata()
        if (m.format !== 'webp' || m.width !== w || m.height !== h || buf.length > 40_000) bad.push(`${file} ${m.format} ${m.width}×${m.height} ${buf.length}B`)
      }
    }
    expect(bad).toEqual([])
  })

  it('schoolLogo: the stamp for a school with a tile, null otherwise — never a prototype key', () => {
    const [slug, v] = entries[0]
    expect(schoolLogo(slug)).toBe(v)
    expect(schoolLogo('no-such-school')).toBeNull()
    expect(schoolLogo('constructor')).toBeNull()
    expect(schoolLogo('__proto__')).toBeNull()
  })
})
