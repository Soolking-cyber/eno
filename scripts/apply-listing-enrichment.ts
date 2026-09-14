/**
 * Write the Gemini product pass (scripts/enrich-listings-gemini.ts) into the listings — or undo it.
 *
 *   npx tsx scripts/apply-listing-enrichment.ts --dir /staging/enrich --backup-dir /staging/enrich-backup           # DRY RUN
 *   npx tsx scripts/apply-listing-enrichment.ts --dir /staging/enrich --backup-dir /staging/enrich-backup --apply
 *   npx tsx scripts/apply-listing-enrichment.ts --restore /staging/enrich-backup [--apply]
 *   npx tsx scripts/apply-listing-enrichment.ts --recount-brands [--apply]
 *
 * ⛔ RUN ON THE BOX, next to the database.
 *
 * ⛔ THE FILES ARE NOT TRUSTED. Every row is shape-checked (enrich-files.ts isDoneRow), must carry the current
 * prompt version, and is re-gated here from the stored model answer with the current decideEnrichment(). Both
 * ends are checked again: the row must be IN a product aisle (read from the database, never from the file) and may
 * only land in one, on a shelf that belongs to it. Nothing can be filed under `services`.
 *
 * ⛔ A ROW IS WRITTEN ONLY WHILE IT IS STILL THE ROW THE MODEL SAW. The write's own WHERE carries the export
 * snapshot (title, titleVi, both descriptions, category, subcategory, attributes), everything the new search text
 * is built from (district, location, brand, model) plus the search text it replaces, and "still an imported,
 * verified, active-or-sold listing".
 *
 * ⛔ UNDO IS REAL. Each chunk writes its own backup file, fsynced before the chunk's first update; each line holds
 * the row's values BEFORE, the values WRITTEN, and the context the search text was built from. `--restore` walks the
 * files newest first and puts `before` back only where the row still holds exactly that `after` AND that context —
 * so an edit made since (a new title included), or a write that never landed, is left alone. A torn last line from a
 * crash is skipped without costing the rest of the file.
 */
import 'dotenv/config'
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/lib/db'
import { buildSearchText } from '../src/lib/fold'
import { decideEnrichment, ENRICH_TARGET_CATEGORIES, ENRICH_VERSION, inputFromSnapshot } from '../src/lib/listing-enrich'
import { CATEGORY_BY_SLUG, facetsFor, subcategoriesFor } from '../src/lib/taxonomy'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'
import { readParts, type DoneRow } from './enrich-files'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const DIR = arg('dir')
const BACKUP_DIR = arg('backup-dir')
const RESTORE = arg('restore')
/** `--recount-brands --apply`: recompute Brand.listingCount for EVERY brand — the repair after any interrupted apply or restore. */
const RECOUNT = process.argv.includes('--recount-brands')
const APPLY = process.argv.includes('--apply')
if (!RECOUNT && !RESTORE && (!DIR || !BACKUP_DIR)) { console.error('--dir <answers dir> --backup-dir <dir> required (or --restore <backup dir>)'); process.exit(1) }

const CHUNK = 200
const TARGETS = new Set<string>(ENRICH_TARGET_CATEGORIES)
type Fields = { description: string; descriptionVi: string | null; categoryId: string; subcategorySlug: string | null; attributes: string | null; brandSlug: string | null; model: string | null; searchText: string }
type Context = { title: string; titleVi: string | null; district: string | null; location: string }
/** `newBrand`: a catalogue brand this write needs that did not exist — created in the same transaction as the listing write. */
type NewBrand = { slug: string; name: string; normalized: string }
type BackupLine = { id: string; before: Fields; after: Fields; context: Context; newBrand?: NewBrand | null }
const FIELD_KEYS = ['description', 'descriptionVi', 'categoryId', 'subcategorySlug', 'attributes', 'brandSlug', 'model', 'searchText'] as const
const CONTEXT_KEYS = ['title', 'titleVi', 'district', 'location'] as const

function isBackupLine(v: unknown): v is BackupLine {
  const l = v as BackupLine
  const strOrNull = (x: unknown) => x === null || typeof x === 'string'
  const fields = (f: Fields) => !!f && typeof f.description === 'string' && strOrNull(f.descriptionVi) && typeof f.categoryId === 'string'
    // brandSlug/model are optional so backups written before they became written fields still restore.
    && strOrNull(f.subcategorySlug) && strOrNull(f.attributes) && (f.brandSlug === undefined || strOrNull(f.brandSlug)) && (f.model === undefined || strOrNull(f.model)) && typeof f.searchText === 'string'
  const c = l?.context
  const nb = l?.newBrand
  const newBrandOk = nb === undefined || nb === null || (typeof nb === 'object' && typeof nb.slug === 'string' && typeof nb.name === 'string' && typeof nb.normalized === 'string')
  return !!l && typeof l.id === 'string' && fields(l.before) && fields(l.after) && newBrandOk
    && !!c && typeof c.title === 'string' && strOrNull(c.titleVi) && strOrNull(c.district) && typeof c.location === 'string'
}

/**
 * Brand.listingCount for the brands a run touched. ⚠️ It is only incremented by the post wizard, never by an importer or
 * this pass, and the brand directory and search suggestions hide a brand whose count is 0 — so a brand the pass fills
 * would stay invisible, and one it empties would keep showing (opus). Same "live" definition as the public feed.
 */
async function recountBrands(slugs: Iterable<string>): Promise<number> {
  let n = 0
  for (const slug of slugs) {
    const count = await db.listing.count({ where: { brandSlug: slug, status: 'active', verified: true } })
    n += (await db.brand.updateMany({ where: { slug }, data: { listingCount: count } })).count
  }
  return n
}

async function restore() {
  const files = readdirSync(RESTORE!).filter((f) => f.endsWith('.jsonl')).sort().reverse()
  // ⚠️ VALIDATE EVERYTHING BEFORE WRITING ANYTHING. A corrupt line anywhere — including a last line that is complete
  // JSON of the wrong shape — aborts the whole restore up front, so a failed restore never leaves half the rows
  // restored (codex, agy). Only a final line that is not even complete JSON is a torn write, and is skipped.
  const plan: BackupLine[][] = []
  let torn = 0
  const corrupt: string[] = []
  for (const file of files) {
    const rawLines = readFileSync(join(RESTORE!, file), 'utf8').split('\n').filter((l) => l.trim())
    const lines: BackupLine[] = []
    rawLines.forEach((raw, idx) => {
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch {
        // Torn = the LAST line and visibly incomplete (a write cut short never ends in "}"); anything else is corruption.
        if (idx === rawLines.length - 1 && !raw.trimEnd().endsWith('}')) torn++
        else corrupt.push(`${file}:${idx + 1}`)
        return
      }
      if (isBackupLine(parsed)) lines.push(parsed)
      else corrupt.push(`${file}:${idx + 1}`)
    })
    plan.push(lines.reverse())
  }
  if (corrupt.length) {
    console.error(`REFUSING TO RESTORE: ${corrupt.length} corrupt backup line(s): ${corrupt.slice(0, 10).join(', ')}${corrupt.length > 10 ? ' …' : ''}`)
    process.exitCode = 1
    return
  }

  let restored = 0
  let skipped = 0
  const simulated = new Map<string, Fields & Context>()
  const touchedBrands = new Set<string>()
  for (const lines of plan) {
    if (APPLY) {
      // ⚠️ ONE TRANSACTION PER BACKUP FILE (≤200 rows): a connection lost mid-file rolls that file back whole instead of
      // leaving it half restored; a re-run then picks the file up again (codex). ⚠️ NO in-scope requirement: a listing
      // enriched and later delisted or unverified must still be undoable (codex, opus). `after` + `context` guard it.
      const counts = await db.$transaction(lines.map(({ id, before, after, context }) => db.listing.updateMany({
        where: { id, ...Object.fromEntries(FIELD_KEYS.filter((k) => after[k] !== undefined).map((k) => [k, after[k]])), ...Object.fromEntries(CONTEXT_KEYS.map((k) => [k, context[k]])) },
        data: Object.fromEntries(FIELD_KEYS.filter((k) => before[k] !== undefined).map((k) => [k, before[k]])) as Fields,
      })))
      counts.forEach((c, i) => {
        if (c.count) { restored++; for (const b of [lines[i].before.brandSlug, lines[i].after.brandSlug]) if (b) touchedBrands.add(b) } else skipped++
      })
      continue
    }
    for (const { id, before, after, context } of lines) {
      let hit = false
      {
        // The dry run replays the unwind in memory from the rows as they are now, so a row written twice previews both steps.
        let now = simulated.get(id)
        if (!now) {
          const row = await db.listing.findUnique({ where: { id }, select: { description: true, descriptionVi: true, categoryId: true, subcategorySlug: true, attributes: true, searchText: true, title: true, titleVi: true, district: true, location: true, brandSlug: true, model: true } })
          if (row) { now = row; simulated.set(id, row) }
        }
        hit = !!now && FIELD_KEYS.every((k) => after[k] === undefined || now![k] === after[k]) && CONTEXT_KEYS.every((k) => now![k] === context[k])
        if (hit && now) simulated.set(id, { ...now, ...before })
      }
      if (hit) restored++
      else skipped++
    }
  }
  console.log(`${APPLY ? 'RESTORED' : 'DRY RUN'}: ${restored} rows ${APPLY ? 'restored' : 'would be restored'}, ${skipped} left alone (changed since, or the write never landed)${torn ? `, ${torn} torn last lines ignored` : ''}`)
  if (APPLY && touchedBrands.size) console.log(`recounted ${await recountBrands(touchedBrands)} brands`)
  // ⚠️ BRANDS THE PASS ADDED ARE NOT REMOVED BY A RESTORE, deliberately. They are real makers the gate proved from the
  // titles, and a brand with no listings is already invisible — the directory and search suggestions only show brands
  // with listingCount > 0 (brands/page.tsx, api/search/suggest). Tracking "who created it" across crashes and shared
  // brands proved more fragile than the harmless row it would delete (four review rounds).
  if (APPLY && restored) console.log('\nNEXT: purge the listing ISR tags (scripts/purge-isr-listings.mjs) and Cloudflare (purge_everything on both zones).')
}

async function apply() {
  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]))
  // The brand catalogue inferBrand checks against; a brand the gate proves but the catalogue lacks is created (below).
  const brands = await db.brand.findMany({ select: { slug: true, normalized: true } })
  const knownBrands = new Set(brands.map((b) => b.slug))
  const normBySlug = new Map(brands.map((b) => [b.slug, b.normalized]))
  const slugByNorm = new Map(brands.map((b) => [b.normalized, b.slug]))
  if (APPLY) mkdirSync(BACKUP_DIR!, { recursive: true })
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — answers in ${DIR}\n`)

  const n = { seen: 0, malformed: 0, oldVersion: 0, written: 0, unchanged: 0, moved: 0, refused: 0, stale: 0, texts: 0, refiled: 0, branded: 0, modelled: 0, failed: 0 }
  const plannedNewBrand = new Map<string, NewBrand>() // normalized → the first spelling, so "North Bayou"/"NorthBayou" share one slug (agy)
  const newBrandNames = new Set<string>() // distinct, not once per listing (agy)
  const touchedBrands = new Set<string>()
  const samples: string[] = []
  let chunkNo = 0

  async function runChunk(chunk: DoneRow[]) {
    const live = await db.listing.findMany({
      where: { id: { in: chunk.map((r) => r.id) } },
      select: {
        id: true, title: true, titleVi: true, description: true, descriptionVi: true, categoryId: true, subcategorySlug: true,
        attributes: true, searchText: true, district: true, location: true, brandSlug: true, model: true,
        verified: true, status: true, affiliateUrl: true,
      },
    })
    const byId = new Map(live.map((l) => [l.id, l]))
    const planned: { line: BackupLine; where: Record<string, unknown>; text: boolean; refile: boolean; brand: boolean; modelChange: boolean }[] = []

    for (const r of chunk) {
      const l = byId.get(r.id)
      const s = r.snap
      if (!l || l.title !== s.title || l.titleVi !== s.titleVi || l.description !== s.description || l.descriptionVi !== s.descriptionVi
        || l.categoryId !== s.categoryId || l.subcategorySlug !== s.subcategorySlug || l.attributes !== s.attributes
        || l.brandSlug !== s.brandSlug || l.model !== s.model
        || !l.verified || !l.affiliateUrl || (l.status !== 'active' && l.status !== 'sold')) { n.stale++; continue }
      // ⛔ WHERE THE ROW IS COMES FROM THE DATABASE, NEVER FROM THE FILE (a forged `from` could steer the write).
      const from = { category: catSlug.get(l.categoryId) ?? '', subcategory: l.subcategorySlug }
      if (!TARGETS.has(from.category)) { n.refused++; continue }
      const d = decideEnrichment(inputFromSnapshot(r.id, s, from), r.answer, { knownBrands })
      const shelfOk = d.subcategory === null || subcategoriesFor(d.category).some((x) => x.slug === d.subcategory)
      const categoryId = catId.get(d.category)
      if (!categoryId || !CATEGORY_BY_SLUG[d.category] || !TARGETS.has(d.category) || !shelfOk) { n.refused++; continue }

      // Attributes: the gate works on string values; a stored non-string value (a number) is kept while the listing
      // stays on its shelf, or when its new shelf offers that key, and dropped otherwise.
      let stored: Record<string, unknown> = {}
      try { const v = l.attributes ? JSON.parse(l.attributes) : {}; if (v && typeof v === 'object' && !Array.isArray(v)) stored = v } catch { stored = {} }
      const placementChanged = d.category !== from.category || d.subcategory !== from.subcategory
      const offered = new Set(facetsFor(d.category, d.subcategory).map((f) => f.key))
      const nonString = Object.fromEntries(Object.entries(stored).filter(([k, v]) => typeof v !== 'string' && (!placementChanged || offered.has(k))))
      const merged: Record<string, unknown> = { ...nonString, ...d.attributes }
      const canon = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
      const attributes = canon(stored) === canon(merged) ? l.attributes : Object.keys(merged).length ? JSON.stringify(merged) : null

      const description = d.description ?? l.description
      const descriptionVi = d.descriptionVi ?? l.descriptionVi
      // A brand the gate proved but the catalogue does not have: a spelling variant resolves to the existing row; a
      // genuinely new one is NOT created here — it rides with the listing write (one transaction) and in the backup, so
      // a write that loses its race or is restored leaves no orphan brand behind (codex, astra, opus).
      let brandSlug = d.brand
      let newBrand: NewBrand | null = null
      // ⚠️ SAME SLUG, DIFFERENT MAKER: the gate sees a catalogue slug and asks for no new brand, but the catalogue row under
      // that slug may be another company's (a different normalized name). Then this is a NEW brand after all (opus).
      const answerName = r.answer.brand?.trim() ?? ''
      const answerNorm = answerName ? normalizeBrand(answerName) : ''
      const slugOwner = d.brand ? normBySlug.get(d.brand) : undefined
      // ⛔ ONLY WHEN THE GATE ADOPTED THE ANSWER'S BRAND. The decision may keep, clear or refuse; anything else here would
      // put back a brand the gate refused (opus, astra).
      const adopted = !!d.brand && !!answerName && d.brand === brandSlugify(answerName) && d.brand !== l.brandSlug
      const brandName = d.brandName ?? (adopted && slugOwner && slugOwner !== answerNorm && !slugByNorm.has(answerNorm) ? answerName.slice(0, 40) : null)
      if (adopted && !d.brandName && slugByNorm.has(answerNorm)) brandSlug = slugByNorm.get(answerNorm)!
      if (d.brand && brandName && (d.brandName ? !knownBrands.has(d.brand) : adopted && !!slugOwner && slugOwner !== answerNorm)) {
        const norm = normalizeBrand(brandName)
        const existing = slugByNorm.get(norm)
        if (existing) brandSlug = existing
        else {
          // A slug another brand already holds (same prettified form, different name) takes the resolver's suffix (opus).
          const base = brandSlugify(brandName)
          // …including a slug another NEW brand in this run already reserved (agy), and until the slug is actually free (codex).
          const taken = (sl: string) => (normBySlug.has(sl) && normBySlug.get(sl) !== norm) || [...plannedNewBrand.values()].some((b) => b.slug === sl && b.normalized !== norm)
          let nslug = base
          for (let k = 0; taken(nslug); k++) nslug = k === 0 ? `${base}-${norm.slice(0, 4)}` : `${base}-${norm.slice(0, 4)}-${k}`
          newBrand = plannedNewBrand.get(norm) ?? { slug: nslug, name: brandName, normalized: norm }
          plannedNewBrand.set(norm, newBrand)
          brandSlug = newBrand.slug; newBrandNames.add(norm)
        }
      }
      const model = d.model
      if (description === l.description && descriptionVi === l.descriptionVi && categoryId === l.categoryId
        && d.subcategory === l.subcategorySlug && attributes === l.attributes && brandSlug === l.brandSlug && model === l.model) { n.unchanged++; continue }

      const cat = CATEGORY_BY_SLUG[d.category]
      const sub = d.subcategory ? subcategoriesFor(d.category).find((x) => x.slug === d.subcategory) : undefined
      const after: Fields = {
        description, descriptionVi, categoryId, subcategorySlug: d.subcategory, attributes, brandSlug, model,
        searchText: buildSearchText([
          l.title, l.titleVi, description, descriptionVi, l.district, l.location,
          cat.name, cat.nameVi, sub?.name, sub?.nameVi, brandSlug, model, d.attributes.author, d.attributes.publisher,
        ]),
      }
      const before: Fields = { description: l.description, descriptionVi: l.descriptionVi, categoryId: l.categoryId, subcategorySlug: l.subcategorySlug, attributes: l.attributes, brandSlug: l.brandSlug, model: l.model, searchText: l.searchText }
      const context: Context = { title: l.title, titleVi: l.titleVi, district: l.district, location: l.location }
      if (samples.length < 5) samples.push(`  ${(l.titleVi ?? l.title).slice(0, 60)}\n    ${from.category}/${from.subcategory ?? '-'} → ${d.category}/${d.subcategory ?? '-'}${d.descriptionVi ? `\n    ${d.descriptionVi.split('\n')[0].slice(0, 90)}` : ''}`)
      planned.push({
        line: { id: r.id, before, after, context, newBrand },
        text: d.descriptionVi !== null,
        refile: categoryId !== l.categoryId || d.subcategory !== l.subcategorySlug,
        brand: brandSlug !== l.brandSlug,
        modelChange: model !== l.model,
        where: {
          id: r.id, affiliateUrl: { not: null }, status: { in: ['active', 'sold'] }, verified: true, searchText: l.searchText,
          // title/titleVi come from `context`, which equals the snapshot here (checked above).
          description: s.description, descriptionVi: s.descriptionVi,
          categoryId: s.categoryId, subcategorySlug: s.subcategorySlug, attributes: s.attributes, brandSlug: s.brandSlug, model: s.model,
          ...context,
        },
      })
    }

    if (!APPLY) {
      n.written += planned.length
      for (const p of planned) { if (p.text) n.texts++; if (p.refile) n.refiled++; if (p.brand) n.branded++; if (p.modelChange) n.modelled++ }
      return
    }
    if (!planned.length) return
    // Before, after and context, durably, in this chunk's own file, before the chunk's first write.
    const fd = openSync(join(BACKUP_DIR!, `${runStamp}-${String(++chunkNo).padStart(5, '0')}.jsonl`), 'a')
    for (const p of planned) writeSync(fd, JSON.stringify(p.line) + '\n')
    fsyncSync(fd)
    closeSync(fd)
    // …and the directory entry too, so a power loss cannot keep the updates and lose the file that undoes them (astra).
    // On Linux (the box) a failure here stops the run before any write; only macOS, which refuses fsync on a directory,
    // is excused (astra).
    try { const dirFd = openSync(BACKUP_DIR!, 'r'); try { fsyncSync(dirFd) } finally { closeSync(dirFd) } } catch (e) { if (process.platform === 'linux') throw e }
    for (const p of planned) {
      let count = 0
      const nb = p.line.newBrand
      if (nb) {
        // Brand and listing in ONE transaction: if the listing guard misses, the brand is rolled back with it.
        count = await db.$transaction(async (tx) => {
          const had = await tx.brand.findUnique({ where: { normalized: nb.normalized }, select: { slug: true } })
          if (had && had.slug !== nb.slug) throw new Error('brand-slug-mismatch')
          if (!had) await tx.brand.create({ data: { slug: nb.slug, name: nb.name, normalized: nb.normalized } })
          const res = await tx.listing.updateMany({ where: p.where, data: p.line.after })
          if (!res.count) throw new Error('listing-moved')
          return res.count
        }).catch((e: Error) => {
          // ⚠️ Only a lost race is benign; anything else is a real failure and is reported, not counted as "moved" (codex).
          if (e.message === 'listing-moved' || e.message === 'brand-slug-mismatch') return 0
          console.error(`  write failed for ${p.line.id}: ${e.message.slice(0, 160)}`)
          n.failed++
          return 0
        })
        if (count) { knownBrands.add(nb.slug); slugByNorm.set(nb.normalized, nb.slug); normBySlug.set(nb.slug, nb.normalized) }
      } else {
        count = (await db.listing.updateMany({ where: p.where, data: p.line.after })).count
      }
      if (!count) { n.moved++; continue }
      for (const b of [p.line.before.brandSlug, p.line.after.brandSlug]) if (b) touchedBrands.add(b)
      // Counted only once the write matched — the report must not claim what a lost race did not do.
      n.written++
      if (p.text) n.texts++
      if (p.refile) n.refiled++
      if (p.brand) n.branded++
      if (p.modelChange) n.modelled++
    }
    // Counts reconciled PER CHUNK, so an interrupted run leaves at most one chunk's brands stale; `--recount-brands`
    // repairs every brand after any interruption (codex, astra).
    if (touchedBrands.size) { await recountBrands(touchedBrands); touchedBrands.clear() }
  }

  // ⚠️ ONE ANSWER PER LISTING — the LAST one written, across every part: duplicates would plan writes the apply can
  // only land once, making the dry run disagree with the real run (astra, agy). A first pass records each id's last key.
  const lastKey = new Map<string, string>()
  for await (const r of readParts(DIR!)) if (r.version === ENRICH_VERSION) lastKey.set(r.id, r.key)
  let chunk = new Map<string, DoneRow>()
  const taken = new Set<string>()
  for await (const r of readParts(DIR!, () => { n.malformed++ })) {
    n.seen++
    if (r.version !== ENRICH_VERSION) { n.oldVersion++; continue }
    if (lastKey.get(r.id) !== r.key || taken.has(r.id)) continue
    taken.add(r.id)
    chunk.set(r.id, r)
    if (chunk.size >= CHUNK) { await runChunk([...chunk.values()]); chunk = new Map() }
    if (n.seen % 5000 === 0) console.log(`  ${n.seen} …`)
  }
  if (chunk.size) await runChunk([...chunk.values()])

  console.log(samples.join('\n'))
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${n.written} listings ${APPLY ? 'updated' : 'would be updated'} (${n.texts} new descriptions, ${n.refiled} re-filed, ${n.branded} brands, ${n.modelled} models; ${newBrandNames.size} brands new to the catalogue) of ${n.seen} answers`)
  console.log(`  ${n.unchanged} nothing to change, ${n.stale} changed since the export (skipped), ${n.moved} changed during the write (skipped), ${n.refused} refused at apply, ${n.oldVersion} from another prompt version, ${n.malformed} malformed lines`)
  if (n.failed) { console.error(`\n${n.failed} WRITES FAILED with a database error — see above; re-run to retry them.`); process.exitCode = 1 }
  if (APPLY && touchedBrands.size) console.log(`recounted ${await recountBrands(touchedBrands)} brands`)
  if (APPLY) console.log('\nNEXT: purge the listing ISR tags (scripts/purge-isr-listings.mjs) and Cloudflare (purge_everything on both zones), or pages keep the old text for hours.')
}

;(RECOUNT ? (async () => { const all = await db.brand.findMany({ select: { slug: true } }); console.log(`${APPLY ? 'recounted' : 'would recount'} ${APPLY ? await recountBrands(all.map((b) => b.slug)) : all.length} brands`) })() : RESTORE ? restore() : apply())
  .then(() => db.$disconnect())
  .catch((e) => { console.error(e); process.exit(1) })
