/**
 * Dump the imported listings the Gemini product pass works on (src/lib/listing-enrich.ts).
 *
 *   npx tsx scripts/export-enrich-scope.ts --out /staging/enrich-scope.jsonl            # every imported row
 *   npx tsx scripts/export-enrich-scope.ts --out /staging/pilot.jsonl --sample 300       # stratified pilot
 *
 * ⛔ RUN ON THE BOX. The model half runs on the operator's Mac (scripts/enrich-listings-gemini.ts), and
 * nothing that long may hold the SSH tunnel open — it has already dropped mid-write twice.
 *
 * ⛔ IMPORTED ROWS ONLY (`affiliateUrl` set). A user's own listing is that seller's words; rewriting it
 * would put text in their mouth. And PRODUCT aisles only (ENRICH_TARGET_CATEGORIES): `services` holds the e-Visa
 * products, whose wording is the desk's legal copy, and travel/tickets copy is not a spec sheet. Desk storefronts own
 * no imported rows at all (edition-scope's desk resolver is `server-only`, so a script cannot import it).
 *
 * ⚠️ EVERY ROW CARRIES A SNAPSHOT of the columns the apply step will overwrite or depends on. The run
 * takes days; the apply writes only where the live row still equals its snapshot, so a re-import, an
 * edit or a classify script that touched the row in between wins over a stale model answer.
 */
import 'dotenv/config'
import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs'
import { db } from '../src/lib/db'
import { ENRICH_TARGET_CATEGORIES } from '../src/lib/listing-enrich'
import type { ScopeRow } from './enrich-files'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const OUT = arg('out')
const SAMPLE = arg('sample') ? Number(arg('sample')) : null
if (!OUT) { console.error('--out <file.jsonl> required'); process.exit(1) }
if (SAMPLE !== null && (!Number.isInteger(SAMPLE) || SAMPLE < 1)) { console.error('--sample must be a positive integer'); process.exit(1) }

function parseAttributes(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch { return {} }
}

async function main() {
  // ⚠️ PAGED READS AND ONE LINE PER ROW. The full scope is ~80k rows with both descriptions; one findMany and one
  // JSON.stringify of that is a memory cliff on the box (agy). Rows are read 5,000 at a time by id cursor and written
  // as JSONL, which the runner streams back.
  const where = { affiliateUrl: { not: null }, status: { in: ['active', 'sold'] }, verified: true, category: { slug: { in: [...ENRICH_TARGET_CATEGORIES] } } }
  const select = {
    id: true, title: true, titleVi: true, description: true, descriptionVi: true,
    categoryId: true, subcategorySlug: true, attributes: true, brandSlug: true, model: true, category: { select: { slug: true } },
  } as const
  type Row = { id: string; title: string; titleVi: string | null; description: string; descriptionVi: string | null; categoryId: string; subcategorySlug: string | null; attributes: string | null; brandSlug: string | null; model: string | null; category: { slug: string } }
  const toScope = (r: Row): ScopeRow => ({
    id: r.id, titleVi: r.titleVi, title: r.title, descriptionVi: r.descriptionVi, description: r.description,
    category: r.category.slug, subcategory: r.subcategorySlug, attributes: parseAttributes(r.attributes), brand: r.brandSlug, model: r.model,
    snap: { title: r.title, titleVi: r.titleVi, description: r.description, descriptionVi: r.descriptionVi, categoryId: r.categoryId, subcategorySlug: r.subcategorySlug, attributes: r.attributes, brandSlug: r.brandSlug, model: r.model },
  })

  const fd = openSync(`${OUT}.tmp`, 'w')
  let written = 0
  if (SAMPLE !== null) {
    // Stratified: an even share per (category, has-subcategory, short-description) bucket, so a pilot sees books,
    // fashion, real electronics and the tiny descriptions — not a sample of whatever sorts first.
    const buckets = new Map<string, Row[]>()
    let cursor: string | undefined
    for (;;) {
      const page: Row[] = await db.listing.findMany({ where, select, orderBy: { id: 'asc' }, take: 5000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) })
      if (!page.length) break
      for (const r of page) {
        const k = `${r.category.slug}|${r.subcategorySlug ? 'sub' : 'nosub'}|${(r.descriptionVi ?? r.description).length < 40 ? 'tiny' : 'body'}`
        const b = buckets.get(k) ?? []
        if (b.length < SAMPLE) b.push(r) // a bucket never needs more than the whole sample
        buckets.set(k, b)
      }
      cursor = page[page.length - 1].id
    }
    const per = Math.max(1, Math.ceil(SAMPLE / buckets.size))
    const picked = [...buckets.values()].flatMap((b) => b.filter((_, i) => i % Math.max(1, Math.floor(b.length / per)) === 0).slice(0, per)).slice(0, SAMPLE)
    for (const r of picked) { writeSync(fd, JSON.stringify(toScope(r)) + '\n'); written++ }
  } else {
    let cursor: string | undefined
    for (;;) {
      const page: Row[] = await db.listing.findMany({ where, select, orderBy: { id: 'asc' }, take: 5000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) })
      if (!page.length) break
      for (const r of page) { writeSync(fd, JSON.stringify(toScope(r)) + '\n'); written++ }
      cursor = page[page.length - 1].id
    }
  }
  fsyncSync(fd)
  closeSync(fd)
  renameSync(`${OUT}.tmp`, OUT!)
  console.log(`${written} rows → ${OUT}`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
