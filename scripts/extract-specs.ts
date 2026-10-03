/**
 * Fill `Listing.attributes` for feed-imported products so the spec filters actually match.
 *
 *   npx tsx scripts/extract-specs.ts --seller <id>            # DRY RUN + coverage
 *   npx tsx scripts/extract-specs.ts --seller <id> --apply
 *
 * ⛔ WITHOUT THIS EVERY SPEC CHIP RETURNS NOTHING. feed-query.ts matches a facet as an exact
 * `"key":"value"` substring of the `attributes` JSON blob, and that column is written on the POST
 * path — which a direct Prisma import never runs. Measured: 0 of 9,726 imported products had one,
 * so "256GB" or "16GB RAM" found zero results on a catalogue full of both.
 *
 * ⚠️ VALUES MUST BE THE TAXONOMY'S `.value` STRINGS EXACTLY. The match is a substring test, not a
 * numeric comparison — writing "256GB" where the facet says "256" silently matches nothing, and
 * writing "1TB" where it says "1024" does the same. Storage is normalised to GB for that reason.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { resolveImportSeller, sellerIdArg } from '../src/lib/script-seller-arg'
import { liveRowsOnly } from '../src/lib/partner-import-rules'

const APPLY = process.argv.includes('--apply')
// ⛔ --seller <id> IS REQUIRED — no CellphoneS default, an id not a name, never an owned storefront
// (second-hand focus, 2026-10-03; src/lib/script-seller-arg.ts).
const { id: SELLER_ID, error: sellerArgError } = sellerIdArg(process.argv)
if (sellerArgError) { console.error(sellerArgError); process.exit(1) }

/** Capacities the storage facet offers, in GB. Anything else is left unset rather than rounded. */
const STORAGE = new Set([32, 64, 128, 256, 512, 1024, 2048])
const RAM = new Set([4, 6, 8, 12, 16, 24, 32])
const TV_IN = new Set([24, 27, 32, 43, 50, 55, 65, 75, 85])
const LAPTOP_IN = new Set([13, 14, 15, 16, 17])

function specsFor(title: string, subcat: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  /**
   * ⚠️ STORAGE AND RAM ARE BOTH "<n> GB" AND ONLY ORDER TELLS THEM APART. Vietnamese listings read
   * "8GB 256GB" — RAM first, storage second. So a value that is a plausible CAPACITY is storage and
   * a smaller one is RAM; 32GB is genuinely ambiguous, and it goes to storage only when no larger
   * capacity is present.
   */
  const sizes: { n: number; unit: string }[] = []
  for (const m of title.matchAll(/(\d+)\s?(gb|tb)\b/gi)) sizes.push({ n: Number(m[1]), unit: m[2].toLowerCase() })
  const asGb = sizes.map((s) => (s.unit === 'tb' ? s.n * 1024 : s.n))
  const storage = asGb.filter((g) => STORAGE.has(g) && g >= 32).sort((a, b) => b - a)[0]
  if (storage !== undefined) out.storage = String(storage)
  // RAM is the smaller GB figure that is a real RAM tier and is not the one we took as storage.
  const ram = sizes.filter((s) => s.unit === 'gb' && RAM.has(s.n) && String(s.n) !== out.storage)
    .map((s) => s.n).sort((a, b) => a - b)[0]
  if (ram !== undefined) out.ram = String(ram)

  // ⚠️ "13-inch", "13 inch", '13"' and the bare "Swift Lite 14" all occur; the last only counts
  // for laptops, where a two-digit number in that range is always the screen.
  const inch = title.match(/(\d{2})(?:\.\d)?[\s-]?(?:inch|"|”)/i)
    ?? (subcat === 'laptops-pcs' ? title.match(/\b(1[3-7])\b/) : null)
  if (inch) {
    const n = Number(inch[1])
    if (subcat === 'tv-monitors' && TV_IN.has(n)) out.screenSize = String(n)
    if (subcat === 'laptops-pcs' && LAPTOP_IN.has(n)) out.laptopSize = String(n)
  }
  if (subcat === 'laptops-pcs') {
    // The CPU facet's own value strings.
    if (/\b(m[1-5])\b/i.test(title)) out.cpu = 'apple-silicon'
    else if (/i7|i9|core ultra/i.test(title)) out.cpu = 'intel-i7-i9'
    else if (/\bi5\b/i.test(title)) out.cpu = 'intel-i5'
    else if (/\bi3\b/i.test(title)) out.cpu = 'intel-i3'
    else if (/ryzen/i.test(title)) out.cpu = 'amd-ryzen'
  }
  return out
}

async function main() {
  const seller = await resolveImportSeller(db, SELLER_ID!)
  const rows = await db.listing.findMany({
    // ⛔ LIVE ROWS ONLY (liveRowsOnly): a hidden row edited here bumps `updatedAt` and its hide's rollback refuses it.
    where: { sellerId: seller.id, ...liveRowsOnly() },
    select: { id: true, title: true, titleVi: true, subcategorySlug: true, attributes: true },
  })

  const cover: Record<string, number> = {}
  const planned: { id: string; json: string }[] = []
  for (const r of rows) {
    const specs = specsFor(`${r.title} ${r.titleVi ?? ''}`, r.subcategorySlug)
    if (!Object.keys(specs).length) continue
    for (const k of Object.keys(specs)) cover[k] = (cover[k] ?? 0) + 1
    const json = JSON.stringify(specs)
    if (json !== r.attributes) planned.push({ id: r.id, json })
  }
  console.log(`${rows.length} products; ${planned.length} would get attributes`)
  for (const [k, n] of Object.entries(cover).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${n}`)
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  let n = 0, written = 0, failed = 0
  for (const p of planned) {
    // ⛔ STILL LIVE AT WRITE TIME (liveRowsOnly): a row hidden after the selection is skipped, not bumped. A
    // database error is counted apart from a skip and printed (commit-gate review, 2026-10-04).
    const c = await db.listing.updateMany({ where: { id: p.id, ...liveRowsOnly() }, data: { attributes: p.json } })
      .then((r) => r.count)
      .catch((e) => { console.error(`  ${p.id}: ${String(e).slice(0, 80)}`); return -1 })
    if (c > 0) written++
    else if (c < 0) failed++
    if (++n % 1000 === 0) console.log(`  ${n}/${planned.length}`)
  }
  const skipped = n - written - failed
  console.log(`\nAPPLIED: ${written} of ${n}${skipped ? ` · ${skipped} skipped: no longer live` : ''}${failed ? `  ⛔ ${failed} FAILED` : ''}`)
  // A partial apply fails the process, so nothing downstream can read it as a finished one.
  if (failed) process.exitCode = 1
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
