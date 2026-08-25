/**
 * Fill in electronics specs on imported listings, so the filter chips, search and the AI
 * concierge all have something to work with.
 *
 *   npx tsx scripts/enrich-electronics.ts --report          # coverage per subcategory, writes nothing
 *   npx tsx scripts/enrich-electronics.ts                   # DRY RUN — shows what would change
 *   npx tsx scripts/enrich-electronics.ts --apply
 *   npx tsx scripts/enrich-electronics.ts --apply --seller CellphoneS
 *
 * ⛔ DETERMINISTIC ONLY. This script never calls a model: it reads specs that are already written
 * in the merchant's own title and validates every one against the closed list in
 * electronics-specs.ts. The LLM pass is a SEPARATE script for what this cannot reach, because the
 * two have different risk profiles and must be reviewable — and revertable — independently.
 *
 * ⚠️ MERGES, NEVER REPLACES. A listing's existing attributes win: 614 phones already carry
 * hand-checked values and a regex must not overwrite them. Only absent keys are added.
 *
 * ⛔ SNAPSHOT BEFORE APPLY. `--apply` writes a JSONL of every row's prior attributes to
 * data/enrich-snapshot-<ts>.jsonl first. Bulk-rewriting live listings is the highest-risk step in
 * this whole exercise (an external reviewer flagged exactly this), and a one-file revert is the
 * difference between a mistake and an outage.
 */
import 'dotenv/config'
import { appendFileSync, writeFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { extractSpecsFromTitles, specsFor } from '../src/lib/electronics-specs'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const REPORT = process.argv.includes('--report')
const SELLER = arg('seller') ?? 'CellphoneS'

type Row = { id: string; title: string; titleVi: string | null; subcategorySlug: string | null; attributes: string | null }

const parseAttrs = (s: string | null): Record<string, string> => {
  if (!s) return {}
  try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch { return {} }
}

async function main() {
  const rows = (await db.listing.findMany({
    // ⛔ `ownerId: null`. `Seller.name` IS NOT UNIQUE — anyone can open a storefront called
    // "CellphoneS". A storefront with an owner belongs to a real person, and this script rewrites
    // placement and attributes in bulk; the importer refuses owned storefronts for the same reason.
    where: { seller: { name: SELLER, ownerId: null } },
    select: { id: true, title: true, titleVi: true, subcategorySlug: true, attributes: true },
  })) as Row[]
  console.log(`${rows.length} listings under "${SELLER}"\n`)

  type Bucket = { n: number; had: number; gains: number; nowHas: number; keys: Map<string, number> }
  const by = new Map<string, Bucket>()
  const updates: { id: string; attributes: string }[] = []

  for (const r of rows) {
    const sub = r.subcategorySlug ?? '(none)'
    if (!by.has(sub)) by.set(sub, { n: 0, had: 0, gains: 0, nowHas: 0, keys: new Map() })
    const b = by.get(sub)!
    b.n++
    const existing = parseAttrs(r.attributes)
    if (Object.keys(existing).length) b.had++

    // ⚠️ BOTH TITLE SLOTS, PARSED SEPARATELY. `title` is the translated English one and `titleVi`
    // the merchant's original; a spec can appear in either ("Bàn phím" only exists in the
    // Vietnamese one), so reading only English misses every keyword-driven spec on this catalogue.
    // ⛔ AND THEY ARE NOT CONCATENATED. Joining them doubles every capacity, and "iPhone 15 128GB"
    // twice reads as "128GB RAM + 128GB storage" — which is exactly what this script published to
    // 134 live rows before an external reviewer caught it.
    const found = extractSpecsFromTitles(r.subcategorySlug, [r.title, r.titleVi])
    const merged = { ...found, ...existing } // existing wins
    const added = Object.keys(found).filter((k) => !(k in existing))
    for (const k of Object.keys(merged)) b.keys.set(k, (b.keys.get(k) ?? 0) + 1)
    if (Object.keys(merged).length) b.nowHas++
    if (!added.length) continue
    b.gains++
    updates.push({ id: r.id, attributes: JSON.stringify(merged) })
  }

  const table = [...by].sort((a, b) => b[1].n - a[1].n).map(([sub, b]) => ({
    subcategory: sub,
    listings: b.n,
    'specs before': `${b.had} (${Math.round(b.had / b.n * 100)}%)`,
    'specs after': `${b.nowHas} (${Math.round(b.nowHas / b.n * 100)}%)`,
    filterable: specsFor(sub === '(none)' ? null : sub).map((s) => s.key).join(',') || '—',
  }))
  console.table(table)
  const before = rows.filter((r) => Object.keys(parseAttrs(r.attributes)).length).length
  console.log(`\noverall: ${before} -> ${before + updates.length} of ${rows.length} carry specs (${updates.length} rows gain one)`)

  if (REPORT || !APPLY) { console.log(`\n${REPORT ? 'REPORT' : 'DRY RUN'} — nothing written.`); await db.$disconnect(); return }

  const snap = `data/enrich-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
  writeFileSync(snap, '')
  for (const u of updates) {
    const prior = rows.find((r) => r.id === u.id)!.attributes
    appendFileSync(snap, `${JSON.stringify({ id: u.id, attributes: prior })}\n`)
  }
  console.log(`snapshot: ${snap} (${updates.length} rows)`)

  let done = 0
  for (let i = 0; i < updates.length; i += 200) {
    await Promise.all(updates.slice(i, i + 200).map((u) =>
      db.listing.update({ where: { id: u.id }, data: { attributes: u.attributes } })))
    done += Math.min(200, updates.length - i)
    if (i % 2000 === 0 || done === updates.length) console.log(`  ${done}/${updates.length}`)
  }
  console.log(`\nAPPLIED: ${done} rows`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
