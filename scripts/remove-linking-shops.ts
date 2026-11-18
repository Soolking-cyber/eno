/**
 * Remove the partner shops that send buyers to their own website (owner, 2026-11-18: "remove shops that link to other
 * stores make a list first and i will approve shop by shop" — all 15 below approved one by one; then Ty Store and Điện Máy
 * Sài Gòn, which had nothing live to hide, approved for retirement only).
 *
 * Every live (active or sold) row of each shop is hidden through src/lib/journaled-hide.ts: the journal is on disk before
 * any write, the hide is conditional on status + updatedAt, raw SQL, and its SQL re-checks "ownerless storefront, imported
 * row" in the UPDATE itself — a row that is neither is skipped, never hidden. With nothing live the storefront answers 404.
 * All 17 shops are `retired` in src/lib/partner-stores.ts so the Monday showcase, the stock cron and the importer never bring
 * them back (each reads `retired` before `refreshOnly`).
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/remove-linking-shops.ts                  # DRY RUN (read-only session)
 *   …                         npx tsx scripts/remove-linking-shops.ts --apply --journal-dir <durable dir>
 *   …                         npx tsx scripts/remove-linking-shops.ts --rollback <journal> [--seller <id>] [--apply]
 * Then: node scripts/purge-isr-listings.mjs, and a Cloudflare tag purge (eno-html, eno-public) on BOTH zones (eno.vn, eno.forum).
 * ⚠️ A rollback republishes rows into a retired shop: also delete its `retired` line, or nothing keeps them fresh.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journaledHide, journaledRestore, rollbackPathArg, type HideJournal } from '../src/lib/journaled-hide'

/** id → name, as approved. The run refuses unless every id still carries this name and has no owner. */
export const REMOVED_SHOPS: Readonly<Record<string, string>> = {
  cmtseuzlc00029zq4klh3p6u1: 'Tuấn Nguyễn Mobile',
  cmtseuzo900039zq409fzi9ap: 'Bàn Ghế Thanh Lý',
  cmtsev07l00089zq4tdg845f8: 'Minh Tuấn Mobile',
  cmtv9qx9h00000ip8fdvpidi4: 'ZShop',
  cmtseuzeq00009zq43gnkqw8p: 'Phương Tín',
  cmtw4s5h000000iqlqtxmk3j0: 'Bạch Long Store',
  cmtseuzhd00019zq47d60jlh5: 'Thế Giới Số 365',
  cmtsev0cj000a9zq4oxzqnx45: 'Di Động Việt',
  cmtsev0f2000b9zq41nbihmvl: '24hStore',
  cmtvfh3jm00000imkn1r515do: 'Điện Thoại Giá Kho',
  cmtseuzt100049zq4qj6dgpo1: 'Laptop Giá Rẻ',
  cmtseuzvs00059zq40hhhnjrs: 'Digiphone',
  cmtsev0a200099zq4pfke5vsi: 'Máy Ảnh 24h',
  cmtseuzyf00069zq4ssl2nnvk: 'VN Laptop',
  cmtv8uoqo00000iniq1t2axyj: 'Laptop Trung Hậu',
}

const argv = process.argv.slice(2)
const flag = (f: string) => { const i = argv.indexOf(f); const v = i >= 0 ? argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : null }
const APPLY = argv.includes('--apply')
const JOURNAL_DIR = flag('--journal-dir')
const SELLER = flag('--seller')
const { path: ROLLBACK, error } = rollbackPathArg(process.argv)
if (error) { console.error(error); process.exit(1) }
if (APPLY && !ROLLBACK && !JOURNAL_DIR) { console.error('--apply needs --journal-dir <durable dir> (outside the repo)'); process.exit(1) }

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }),
  log: ['warn', 'error'],
})

async function rollback(path: string) {
  const journal = JSON.parse(readFileSync(path, 'utf8')) as HideJournal
  if (journal.kind !== 'remove-linking-shops' || !Array.isArray(journal.rows)) { console.error(`${path} is not a remove-linking-shops journal`); process.exit(1) }
  const rows = SELLER ? journal.rows.filter((r) => r.sellerId === SELLER) : journal.rows
  const r = await journaledRestore(db, { createdAt: journal.createdAt, rows }, { apply: APPLY })
  console.log(`${r.restorable.length} of ${r.total} rows still as the hide left them${APPLY ? ` · RESTORED ${r.restored.length}` : ' (DRY RUN)'}`)
}

async function main() {
  const ids = Object.keys(REMOVED_SHOPS)
  const sellers = await db.$queryRawUnsafe<{ id: string; name: string; owned: boolean }[]>(
    `SELECT id, name, "ownerId" IS NOT NULL AS owned FROM "Seller" WHERE id = ANY($1::text[])`, ids)
  const wrong = ids.filter((id) => { const s = sellers.find((x) => x.id === id); return !s || s.name !== REMOVED_SHOPS[id] || s.owned })
  if (wrong.length) { console.error(`refused — missing, renamed or owned: ${wrong.join(', ')}`); process.exit(2) }

  const rows = await db.$queryRawUnsafe<{ id: string; sellerId: string; status: string; title: string; updatedAt: string; linked: boolean }[]>(
    `SELECT id, "sellerId", status, title, "updatedAt"::text AS "updatedAt", ("externalId" IS NOT NULL OR "affiliateUrl" IS NOT NULL) AS linked
       FROM "Listing" WHERE "sellerId" = ANY($1::text[]) AND status IN ('active','sold')`, ids)
  for (const id of ids) {
    const mine = rows.filter((r) => r.sellerId === id)
    const n = (s: string) => mine.filter((r) => r.status === s).length
    const notImported = mine.filter((r) => !r.linked).length
    console.log(`${REMOVED_SHOPS[id].padEnd(20)} active ${String(n('active')).padStart(4)} · sold ${String(n('sold')).padStart(5)}${notImported ? ` · ⚠️ ${notImported} not imported (left alone)` : ''}`)
  }
  console.log(`total ${rows.length} live rows`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written.'); return }

  const path = join(JOURNAL_DIR!, `remove-linking-shops-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const linked = rows.filter((r) => r.linked)
  const out = await journaledHide(db, linked.map((r) => ({ id: r.id, rule: 'links-to-own-website', matched: null, title: r.title, sellerId: r.sellerId, expectUpdatedAt: r.updatedAt })),
    { path, kind: 'remove-linking-shops' })
  console.log(`\nHIDDEN ${out.hidden.length} of ${out.journaled} journaled → ${out.journal}`)
  if (out.hidden.length < linked.length) { console.error('⚠️ some imported rows were not hidden (written since the read) — re-run the dry run'); process.exitCode = 3 }
  console.log('Next: node scripts/purge-isr-listings.mjs, then a Cloudflare tag purge (eno-html, eno-public) on BOTH zones.')
}

;(ROLLBACK ? rollback(ROLLBACK) : main())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
