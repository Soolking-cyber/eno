/**
 * ⛔ NO-BROKER RENTAL CLEANUP (owner, 2026-10-16: "go with nha tot only ... no broker policy which we will
 * enforce harshly"). Takes every WHOLE-BROKER rental import seller off the public surface — Batdongsan,
 * Muaban, Honeycomb and Rever. These are pure broker feeds with no reliable owner signal and NO owners among
 * their rows (ownerless import sellers scraped from broker sites), so under the no-broker policy ALL of their
 * rental inventory goes — apartments AND houses/rooms/offices alike (see [[eno-nobroker-apartments-2026-10-16]]).
 *
 * ⛔ BOTH `active` AND `hidden` ROWS, AND THE `hidden` HALF IS THE POINT: `hide-imageless-imports.ts
 * --restore` re-activates every HIDDEN import row that has a photo, so a hidden broker is one --restore away
 * from going public (Batdongsan alone carries ~1,300 hidden non-apartment broker rows). Converting hidden→stale
 * closes that (--restore only touches 'hidden'). The journal records each row's ORIGINAL status so the rollback
 * restores it per row (active→active, hidden→hidden), never blanket. (`expired`/`sold` are left alone: already
 * invisible, and only an importer's 7-day revive touches them — and these sources are dropped from the job.)
 *
 * ⛔ Nhà Tốt is NOT here. It keeps individual owners (company_ad filter), so its brokers are removed by the
 * set-difference pass instead:  expire-apartment-rentals.ts --seller nhatot-import-seller-0001 --fresh
 * <owner-set> --state-dir <dir> --force --apply  (the shrink from all-Nhà Tốt to owners is a legitimate
 * --force one-off; the share guard would otherwise refuse it).
 *
 *   DRY (read-only session):  set -a; . ./.env; set +a; npx tsx scripts/retire-broker-rentals.ts
 *   WRITE (journal first):     … scripts/retire-broker-rentals.ts --journal-dir <durable dir> --apply
 *   Scope to some sellers:     … --seller muaban-net-import-seller-0001 --seller honeycomb-import-seller-0001
 *
 * ⛔ STATUS 'stale', NOT 'hidden', AND THE DIFFERENCE IS LOAD-BEARING: `hide-imageless-imports.ts --restore`
 * re-activates every hidden import row that has a photo, so it would republish these. 'stale' is publicly
 * exactly as invisible as 'hidden' (listingIsViewable admits only active|sold; every feed pins active), and no
 * ROUTINE job touches these sellers — they are out of apartments-weekly's SOURCES_DEFAULT and the APT_ALLOW_BROKER
 * guard refuses them. ⚠️ 'stale' is NOT permanently un-revivable: an importer's 7-day rule revives expired/stale
 * rows, so a DELIBERATE `APT_ALLOW_BROKER=1` hand-run of a dropped source can bring them back — the documented
 * override, not an accident. Rollback = the .sql written beside each seller's journal.
 * ⛔ HIDES, NEVER DELETES (Law 122/2025: imported rows kept ≥1 year). Only `active`/`hidden` rows, only of the
 * pinned ownerless import sellers, each verified by id AND name AND ownerId===null (fail closed).
 */
import 'dotenv/config'
import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journalDirProblem } from '../src/lib/honeycomb-listing'

/** The whole-broker rental sellers, pinned by id and verified by name. NOT Nhà Tốt (owner-filtered). */
const BROKER_SELLERS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'bds-vn-import-seller-0001', name: 'Batdongsan.com.vn' },
  { id: 'muaban-net-import-seller-0001', name: 'Muaban.net' },
  { id: 'honeycomb-import-seller-0001', name: 'Honeycomb House' },
  { id: 'cmub0wead0000zrq418bqq27m', name: 'Rever.vn' },
]
const STALE = 'stale'
/** The statuses a routine op could still make public: `active` (already live) and `hidden` (hide-imageless --restore). */
const RETIRE_STATUSES = ['active', 'hidden'] as const
const BATCH = 500

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const strs = (f: string) => argv.flatMap((a, i) => (argv[i - 1] === f ? [a] : []))
const JOURNAL_DIR = (() => { const i = argv.indexOf('--journal-dir'); return i >= 0 ? argv[i + 1] ?? null : null })()
const SCOPE = strs('--seller')

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}
function ensureJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.broker-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}
/** A compact `{apartment-rental:N, house-rental:M, …}` breakdown for the log. */
function bySubcat(rows: ReadonlyArray<{ subcategorySlug: string | null }>): string {
  const m = new Map<string, number>()
  for (const r of rows) { const k = r.subcategorySlug ?? '(none)'; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '—'
}

async function main() {
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  if (JOURNAL_DIR && JOURNAL_DIR.startsWith('--')) throw new Error(`--journal-dir needs a path, got the flag "${JOURNAL_DIR}" (did you write "--journal-dir --apply"?)`)
  if (argv.includes('--seller') && SCOPE.length === 0) throw new Error('--seller needs a seller id value (a bare --seller must NOT silently fall back to all sellers)')
  const unknown = SCOPE.filter((id) => !BROKER_SELLERS.some((s) => s.id === id))
  if (unknown.length) throw new Error(`--seller ${unknown.join(', ')} is not a known whole-broker rental seller (known: ${BROKER_SELLERS.map((s) => s.id).join(', ')})`)
  const targets = SCOPE.length ? BROKER_SELLERS.filter((s) => SCOPE.includes(s.id)) : BROKER_SELLERS
  const journalDir = APPLY ? ensureJournalDir(JOURNAL_DIR!) : null

  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
  try {
    let grandTotal = 0, grandDone = 0, skipped = 0
    for (const target of targets) {
      const seller = await db.seller.findUnique({ where: { id: target.id }, select: { name: true, ownerId: true } })
      // ⛔ fail closed per seller: a missing id, a renamed seller, or an owned (real-shop) seller is SKIPPED, loudly.
      if (!seller || seller.name !== target.name || seller.ownerId) {
        console.log(`⛔ SKIP ${target.name} (${target.id}): ${!seller ? 'no such seller' : seller.ownerId ? `owned by ${seller.ownerId} — a real shop, never touched` : `name is "${seller.name}", expected "${target.name}"`}`)
        skipped++
        continue
      }
      const rows = await db.listing.findMany({
        // ⛔ RENTALS ONLY: any *-rental subcategory, plus unclassified (null) rows of these rental-only sellers —
        //    never a non-rental classified row, even for a pinned seller (codex). The seller is also verified above.
        where: { sellerId: target.id, status: { in: [...RETIRE_STATUSES] }, OR: [{ subcategorySlug: { endsWith: '-rental' } }, { subcategorySlug: null }] },
        select: { id: true, status: true, subcategorySlug: true }, orderBy: { id: 'asc' },
      })
      const nActive = rows.filter((r) => r.status === 'active').length
      grandTotal += rows.length
      console.log(`${target.name.padEnd(18)} ${String(rows.length).padStart(6)} rental rows → '${STALE}'   (${nActive} active + ${rows.length - nActive} hidden)   [${bySubcat(rows)}]`)
      if (!APPLY) continue

      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeId = target.id.replace(/[^a-z0-9-]/gi, '_')
      const JOURNAL = join(journalDir!, `broker-${safeId}-stale-${stamp}.ids`)
      const ROLLBACK = join(journalDir!, `broker-${safeId}-stale-${stamp}.rollback.sql`)
      recordDurably(ROLLBACK, `-- rollback ${target.name} (${target.id}): replay with psql, THEN purge ISR (scripts/purge-isr-listings.mjs) + Cloudflare tags {eno-html,eno-public} on both zones.`)
      let done = 0
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const ids = chunk.map((r) => r.id)
        // Journal AND rollback FIRST (fsync), before the write. Journal line = `id<TAB>originalStatus`.
        recordDurably(JOURNAL, chunk.map((r) => `${r.id}\t${r.status}`).join('\n'))
        // Rollback restores each row to its ORIGINAL status (active→active, hidden→hidden) — only rows still 'stale' from this run.
        for (const orig of RETIRE_STATUSES) {
          const idsOf = chunk.filter((r) => r.status === orig).map((r) => r.id)
          if (idsOf.length) recordDurably(ROLLBACK, `UPDATE "Listing" SET status='${orig}', "updatedAt"=now() WHERE status='${STALE}' AND "sellerId"='${target.id}' AND id IN (${idsOf.map((x) => `'${x}'`).join(',')});`)
        }
        const res = await db.listing.updateMany({
          // seller.ownerId null re-checked in the write too — closes the find→update race against a seller being claimed.
          // The rentals-only predicate is repeated here so the write can never touch a non-rental row.
          where: { id: { in: ids }, sellerId: target.id, status: { in: [...RETIRE_STATUSES] }, seller: { ownerId: null }, OR: [{ subcategorySlug: { endsWith: '-rental' } }, { subcategorySlug: null }] },
          data: { status: STALE },
        })
        done += res.count
      }
      grandDone += done
      console.log(`  → marked ${STALE}   ${done} of ${rows.length}   journal ${JOURNAL}`)
    }

    console.log(`\n${targets.length - skipped} seller(s): ${APPLY ? `marked ${grandDone} ` : ''}${grandTotal} rental rows (active+hidden)${skipped ? ` · ${skipped} seller(s) SKIPPED (see above)` : ''}`)
    // ⛔ A SKIP means a pinned id/name is stale or the seller gained an owner — exit non-zero so a cleanup with
    //    a skipped seller is NOT read as complete (its broker rows may still be public).
    if (skipped) { console.error(`⛔ ${skipped} seller(s) SKIPPED — exiting non-zero; that seller's broker rows were NOT retired. Fix the pin (id/name) and re-run.`); process.exitCode = 1 }
    if (!APPLY) { console.log('\nDRY RUN — nothing changed (DB session read-only). Re-run with --journal-dir <durable dir> --apply.'); return }
    if (grandDone) console.log('NEXT: purge cached listing pages — node scripts/purge-isr-listings.mjs (PDPs are ISR for 30 days), then purge Cloudflare by tag {eno-html,eno-public} on both zones.')
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
