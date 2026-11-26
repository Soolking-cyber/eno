/**
 * ONE-SHOT: adds `attributes.dayPrice` to The Extra Mile's live city bikes — the first-day price the shop lists on each bike's
 * page (src/lib/moto-partners.ts EXTRA_MILE_BIKES `city.firstDay`), which the importer now writes and the motorbike hub's day
 * figures read (src/lib/vehicle-hub-stats.ts publishedDayPrice). OpenSEO audit 2026-11-26: the hub's day block said "too few to
 * summarise" (4 of 22 bikes) while 18 of them had a day price the shop publishes; each listing's own text already states it.
 *
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/backfill-moto-day-price.ts                 # dry run, read-only
 *     … scripts/backfill-moto-day-price.ts --apply --journal-dir ~/eno-import-journals/moto-day-price
 *
 * ⛔ RUN --apply ONLY AFTER THE DEPLOY THAT HIDES `dayPrice` ON THE LISTING PAGE ((pdp)/page.tsx hiddenAttrs): before it, the
 * page would print a raw "Day price 280000" row.
 * ⛔ ONLY A ROW AS THE IMPORTER LEFT IT: priced by the month at the bike page's month price, no dayPrice yet. An admin who changed
 * the price or the period is left alone (the day price would no longer be the shop's for that row). Each write is guarded on the
 * exact attributes text read, so a second run, or an edit in between, changes nothing. Journal + rollback lines per row.
 */
import 'dotenv/config'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { EXTRA_MILE_BIKES } from '../src/lib/moto-partners'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const at = argv.indexOf('--journal-dir')
const JOURNAL_DIR = at > -1 ? argv[at + 1] : null
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL is not set')
const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })

async function main() {
  const journal = APPLY ? join(JOURNAL_DIR!, `moto-day-price-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`) : null
  if (journal) mkdirSync(JOURNAL_DIR!, { recursive: true })
  let would = 0, wrote = 0
  for (const b of EXTRA_MILE_BIKES) {
    if (!b.city) continue // road-only bikes are priced by the day already
    const externalId = `theextramile:${b.slug}`
    const row = await db.listing.findFirst({ where: { externalId }, select: { id: true, price: true, priceUnit: true, attributes: true, status: true } })
    if (!row) { console.log(`skip ${externalId}: no row`); continue }
    let attrs: Record<string, unknown>
    try { attrs = JSON.parse(row.attributes ?? '{}') } catch { console.log(`skip ${externalId}: attributes not JSON`); continue }
    if ('dayPrice' in attrs) { console.log(`skip ${externalId}: already has dayPrice ${String(attrs.dayPrice)}`); continue }
    if (attrs.rentalPeriod !== 'monthly' || row.priceUnit !== 'VND/month' || row.price !== b.city.month) {
      console.log(`skip ${externalId}: edited since the import (${row.price} ${row.priceUnit}, ${String(attrs.rentalPeriod)})`); continue
    }
    const next = JSON.stringify({ ...attrs, dayPrice: String(b.city.firstDay) })
    would++
    console.log(`${APPLY ? 'write' : 'would write'} ${externalId} [${row.status}]: dayPrice ${b.city.firstDay}`)
    if (!APPLY) continue
    const r = await db.listing.updateMany({ where: { id: row.id, attributes: row.attributes }, data: { attributes: next } })
    if (r.count !== 1) { console.log(`  changed under us, skipped`); continue }
    wrote++
    appendFileSync(journal!, JSON.stringify({ id: row.id, externalId, before: row.attributes, after: next, rollback: `update "Listing" set attributes = ${pgQuote(row.attributes ?? '')} where id = ${pgQuote(row.id)} and attributes = ${pgQuote(next)};` }) + '\n')
  }
  console.log(APPLY ? `wrote ${wrote} of ${would}; journal ${journal}` : `dry run: ${would} rows would get a dayPrice`)
}

const pgQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

main().finally(() => db.$disconnect())
