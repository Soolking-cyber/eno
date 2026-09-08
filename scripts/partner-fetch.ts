/**
 * FETCH A PARTNER SHOP'S CATALOGUE — the shops that are NOT on an affiliate network.
 *
 *   npx tsx scripts/partner-fetch.ts --store phuongtin.vn            # DRY RUN, prints a sample
 *   npx tsx scripts/partner-fetch.ts --store phuongtin.vn --out x.json
 *   npx tsx scripts/partner-fetch.ts --all --out staging.json
 *
 * ⛔ IT FETCHES AND STAGES. IT DOES NOT PUBLISH. Writing these products into `Listing` rows is a
 * separate, deliberate step (`--apply` on the importer that consumes this file), because every one
 * of these shops is marked "Not contact yet" in the owner's own sheet. Their photos and copy are
 * theirs; a staged JSON the owner can read is the artefact that lets a partnership conversation
 * happen BEFORE anything of theirs appears on a licensed sàn TMĐT under their name.
 *
 * ⛔ WHY THERE ARE ONLY THREE ADAPTERS FOR TWENTY-ODD SHOPS. Recon measured the platforms: they are
 * overwhelmingly WooCommerce and Haravan/Sapo, both of which ship a STANDARD read-only product API.
 * One adapter each covers most of the list, and neither parses HTML — so a shop redesigning its
 * theme does not break the import. Only the custom-PHP and Next.js shops need the slower
 * sitemap→JSON-LD path, which is deliberately not in this first cut.
 *
 * ⚠️ EVERY CONFIG IN src/lib/partner-stores.ts WAS PROVEN BY FETCHING TWO REAL PRODUCTS THROUGH IT.
 * A guessed endpoint that 404s is worse than an honest gap, so nothing is listed there on
 * inference — see each entry's `note` for what was measured and what it cost.
 *
 * ⚠️ THE ADAPTERS LIVE IN src/lib/partner-fetch.ts — this file is the CLI around them. They moved
 * so /api/cron/partner-stock could import them without triggering a full scrape at module load.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fetchStore, type StoreConfig, type PartnerProduct } from '../src/lib/partner-fetch'
import { PARTNER_STORES } from '../src/lib/partner-stores'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const ALL = process.argv.includes('--all')
const STORE = arg('store')
const OUT = arg('out')
const LIMIT = Number(arg('limit') ?? 0)

async function main() {
  // ⚠️ ONE SOURCE, AND IT IS A MODULE — see src/lib/partner-stores.ts for why the JSON file went
  // away: `output: 'standalone'` traces imports, so a file read by path never reached the container.
  const stores: StoreConfig[] = PARTNER_STORES
  const targets = ALL ? stores : stores.filter((s) => s.domain === STORE)
  if (!targets.length) {
    console.error(STORE ? `no config for "${STORE}"` : 'pass --store <domain> or --all')
    console.error(`known: ${stores.map((s) => s.domain).join(', ')}`)
    process.exit(1)
  }

  const all: PartnerProduct[] = []
  for (const cfg of targets) {
    try { all.push(...(await fetchStore(cfg, LIMIT)).products) }
    catch (e) { console.error(`  ${cfg.domain} FAILED: ${(e as Error).message}`) }
  }

  console.log(`\n${'='.repeat(60)}\ntotal usable products: ${all.length}`)
  const byDomain = new Map<string, number>()
  for (const p of all) byDomain.set(p.domain, (byDomain.get(p.domain) ?? 0) + 1)
  for (const [d, n] of byDomain) console.log(`  ${d.padEnd(26)} ${n}`)

  if (OUT) {
    writeFileSync(OUT, JSON.stringify(all, null, 1))
    console.log(`\nstaged → ${OUT}   (nothing published; review before importing)`)
  } else {
    console.log('\nsample:')
    for (const p of all.slice(0, 8)) console.log(`  ${String(Math.round(p.price)).padStart(12)} ₫  ${p.name.slice(0, 58)}`)
    console.log('\nno --out given, so nothing was written.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

