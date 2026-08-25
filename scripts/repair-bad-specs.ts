/**
 * One-off: strip attribute values that are illegal for their subcategory.
 *
 *   npx tsx scripts/repair-bad-specs.ts          # DRY RUN
 *   npx tsx scripts/repair-bad-specs.ts --apply
 *
 * ⛔ WHY IT EXISTS. enrich-electronics.ts parsed `title + titleVi` as one string, doubling every
 * capacity, so a single-capacity product ("iPhone 14 Plus 128GB", written twice) read as
 * "128GB RAM + 128GB storage". 134 live listings claimed an iPhone had 128GB of RAM. The cause is
 * fixed (extractSpecsFromTitles) and the gate is now subcategory-aware (isLegalSpec), but neither
 * repairs rows already written — hence this.
 *
 * ⚠️ IT ALSO CATCHES THE LEGACY CHIP VALUES (`intel-i5`, `512-up`, `4-8`) left behind when the
 * hand-written facets were replaced by generated ones. Those match no chip, so they were invisible
 * dead weight that the "existing wins" merge would have preserved forever.
 *
 * This deletes only ILLEGAL values. A legal value is never touched, so re-running is a no-op.
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { extractSpecsFromTitles, isLegalSpec, type SpecKey } from '../src/lib/electronics-specs'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SELLER = arg('seller') ?? 'CellphoneS'
const SPEC_KEYS = ['storage', 'ram', 'screenSize', 'laptopSize', 'caseSize', 'cpu', 'connectivity',
  'resolution', 'refreshRate', 'wattage', 'capacity', 'storageType', 'audioType', 'deviceKind',
  'wifiStandard', 'cameraKind', 'printerKind', 'compatibleWith']

async function main() {
  const rows = await db.listing.findMany({
    /**
     * ⛔ IMPORTED MERCHANT ROWS ONLY. This scanned EVERY listing with attributes, so a real
     * person's phone carrying `ram: "32"` — legal before the per-subcategory narrowing, not after —
     * would have had that value silently deleted by a script written to clean up an import. A
     * repair for one merchant's data must not be able to reach a stranger's listing.
     * `ownerId: null` because Seller.name is not unique and an owned storefront is someone's.
     */
    where: { attributes: { not: null }, externalId: { not: null }, seller: { name: SELLER, ownerId: null } },
    select: { id: true, title: true, titleVi: true, attributes: true, subcategorySlug: true },
  })
  const fixes: { id: string; attributes: string | null; dropped: string[]; title: string }[] = []

  for (const r of rows) {
    let a: Record<string, unknown>
    try { a = JSON.parse(r.attributes ?? '{}') } catch { continue }
    if (!a || typeof a !== 'object') continue
    const kept: Record<string, unknown> = {}
    const dropped: string[] = []
    /**
     * ⛔ RE-DERIVE, DO NOT JUST DELETE. The first version of this script dropped every illegal
     * value, and its dry run showed it would have stripped "16GB 512GB" off real MacBooks — the
     * values were correct and the SUBCATEGORY was wrong (a laptop sold with a 70W charger had been
     * filed under cables-chargers). Deleting good data to satisfy a schema is the wrong repair.
     * So: re-run the extractor on the titles, prefer what it finds, and only drop a value that
     * neither survives the gate nor can be re-derived.
     */
    const fresh = extractSpecsFromTitles(r.subcategorySlug, [r.title, r.titleVi])
    for (const [k, v] of Object.entries(a)) {
      /**
       * ⚠️ ONLY KEYS THIS SCHEMA OWNS ARE JUDGED. Listings carry attributes from other categories
       * entirely (serviceLocation, providerType, transmission…); this script knows nothing about
       * those and must not touch them.
       * ⛔ AND AN UNOWNED VALUE IS COPIED BY REFERENCE, NEVER `String(v)`. Stringifying every value
       * to inspect one of them turns a nested object into "[object Object]" and a number into a
       * string — silent, lossy corruption of data this script has no business reading.
       */
      if (!SPEC_KEYS.includes(k)) { kept[k] = v; continue }
      const val = String(v)
      if (isLegalSpec(k as SpecKey, val, r.subcategorySlug)) { kept[k] = val; continue }
      const rederived = fresh[k]
      if (rederived) { kept[k] = rederived; dropped.push(`${k}=${val}→${rederived}`) }
      else dropped.push(`${k}=${val}✗`)
    }
    if (!dropped.length) continue
    fixes.push({ id: r.id, title: r.title, dropped, attributes: Object.keys(kept).length ? JSON.stringify(kept) : null })
  }

  console.log(`${rows.length} listings scanned, ${fixes.length} carry an illegal value\n`)
  const tally = new Map<string, number>()
  for (const f of fixes) for (const d of f.dropped) tally.set(d.split('=')[0], (tally.get(d.split('=')[0]) ?? 0) + 1)
  console.table([...tally].map(([key, n]) => ({ key, rows: n })))
  for (const f of fixes.slice(0, 8)) console.log(`  drop ${f.dropped.join(', ')}  <-  ${f.title.slice(0, 58)}`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written.'); await db.$disconnect(); return }

  // ⛔ SNAPSHOT, like every other bulk writer here. This one shipped without one, which a reviewer
  // caught: it is the script MOST likely to be wrong, because it acts on rows already known to be
  // in a bad state.
  const snap = `data/repair-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
  writeFileSync(snap, fixes.map((f) => JSON.stringify({
    id: f.id, attributes: rows.find((r) => r.id === f.id)!.attributes,
  })).join('\n'))
  console.log(`snapshot: ${snap}`)
  for (let i = 0; i < fixes.length; i += 200) {
    await Promise.all(fixes.slice(i, i + 200).map((f) =>
      db.listing.update({ where: { id: f.id }, data: { attributes: f.attributes } })))
  }
  console.log(`\nAPPLIED: ${fixes.length} rows repaired`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
