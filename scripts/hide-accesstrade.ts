/**
 * Remove every AccessTrade product from the site — owner, 2026-10-13: "remove all accesstrade products from the
 * website". The rule, the kept storefronts and why are in src/lib/accesstrade-removal.ts (VinWonders stays).
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/hide-accesstrade.ts --journal-dir <durable dir>            # DRY RUN (default)
 *   …                         npx tsx scripts/hide-accesstrade.ts --journal-dir <durable dir> --apply    # hide + tombstone the PDPs
 *   …                         npx tsx scripts/hide-accesstrade.ts --rollback <journal.json> [--apply]
 *   …                         npx tsx scripts/hide-accesstrade.ts --retombstone <journal.json>      # retry the PDP tombstones
 *
 * ⛔ HIDDEN, NEVER DELETED, THROUGH THE ONE JOURNALED PATH (src/lib/journaled-hide.ts): each row's status and
 * updatedAt are read just before the hide and journaled ON DISK first; the hide is raw SQL conditional on both and
 * leaves updatedAt alone; --rollback restores a row only while it is still exactly what the hide left. The
 * existing tool (scripts/retire-new-retail.ts) cannot be reused: it exempts these shops on purpose and its guard
 * refuses rows labelled 'used', which is most of what is left.
 *
 * ⛔ LIVE = status IN ('active','sold'). A sold row still renders a public "sold" page with its photo and a
 * "more from this seller" rail, so both go. Once hidden the PDP 404s (these ids are not on the gone-page list,
 * src/data/gone-listing-ids.json) and the ownerless storefront 404s when nothing public is left (storefront-gone).
 *
 * ⚠️ DO NOT RUN DURING THE NIGHTLY AccessTrade WALK (20:00–20:15 UTC, eno-cron-affiliate-prices): a price write
 * between the snapshot and the hide bumps updatedAt and that row is skipped. Stop that timer first — after this
 * removal it has nothing left to refresh.
 *
 * ⚠️ AFTER --apply the script tombstones each hidden PDP (both languages); home, /c/* and the iPhone price pages
 * still need the root layout tag or their ISR window, and Cloudflare a tag purge of eno-html,eno-public on BOTH zones.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { journaledHide, journaledRestore, rollbackPathArg, type HideJournal } from '../src/lib/journaled-hide'
import { ACCESSTRADE_KEPT_SELLERS, ACCESSTRADE_SOURCED_SELLERS, ACCESSTRADE_URL_PREFILTER, accessTradeKeepReason } from '../src/lib/accesstrade-removal'
import { tombstonePdps } from '../src/lib/pdp-tombstone'

const APPLY = process.argv.includes('--apply')
const { path: ROLLBACK, error: rollbackError } = rollbackPathArg(process.argv)
if (rollbackError) { console.error(rollbackError); process.exit(1) }
// `--retombstone <journal>`: re-write the PDP tombstones of a journal's still-hidden rows — the retry path when the
// tombstone step failed after a successful hide (a re-run of the hide finds nothing left and would skip it).
const reAt = process.argv.indexOf('--retombstone')
const RETOMBSTONE = reAt >= 0 ? process.argv[reAt + 1] : null
if (reAt >= 0 && (!RETOMBSTONE || RETOMBSTONE.startsWith('--'))) { console.error('--retombstone needs a journal path'); process.exit(1) }
/** A second copy of every journal, outside the first directory: the journal is the only way back. */
const MIRROR_DIR = join(homedir(), 'eno-journals', 'accesstrade')
const hostOf = (url: string | null) => { try { return url ? new URL(url).hostname : null } catch { return null } }
const dirAt = process.argv.indexOf('--journal-dir')
const JOURNAL_DIR = dirAt >= 0 ? process.argv[dirAt + 1] : null
if (!ROLLBACK && !RETOMBSTONE && APPLY && (!JOURNAL_DIR || JOURNAL_DIR.startsWith('--'))) {
  console.error('--apply needs --journal-dir <durable dir outside the repo> — the journal is the only way back'); process.exit(1)
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ...(APPLY || RETOMBSTONE ? {} : { options: '-c default_transaction_read_only=on' }) }),
  log: ['warn', 'error'],
})

async function rollback(path: string) {
  const journal = JSON.parse(readFileSync(path, 'utf8')) as Omit<HideJournal, 'kind'> & { kind: string }
  if (journal.kind !== 'hide-accesstrade' || !Array.isArray(journal.rows) || typeof journal.createdAt !== 'string') {
    console.error(`${path} is not a hide-accesstrade journal`); process.exit(1)
  }
  const r = await journaledRestore(db, journal, { apply: APPLY })
  console.log(`journal ${path}: ${r.total} rows hidden at ${journal.createdAt}`)
  console.log(`  ${r.restorable.length} still exactly as the hide left them → restorable`)
  console.log(`  ${r.total - r.unstamped - r.restorable.length} changed since → LEFT ALONE`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to restore.'); return }
  console.log(`\nRESTORED ${r.restored.length} rows.`)
  await tombstoneAll(r.restored)
}

/** Tombstone `ids` (en + vi) and FAIL unless every page got its tags — a silent miss keeps serving the buy link for 30 days.
 *  (Both editions read the one shared next_cache_tag table — ENO_ISR_PG=1 on both containers.) */
async function tombstoneAll(ids: string[]): Promise<void> {
  const msg = await tombstonePdps(db, ids)
  console.log(`PDP tombstones: ${msg}`)
  const written = Number(/^(\d+) tags/.exec(msg)?.[1] ?? NaN)
  if (ids.length && written !== ids.length * 2) throw new Error(`tombstones incomplete (${msg}): expected ${ids.length * 2} tags for ${ids.length} pages — re-run with --retombstone <journal>`)
}

async function retombstone(path: string) {
  const journal = JSON.parse(readFileSync(path, 'utf8')) as HideJournal
  if (journal.kind !== 'hide-accesstrade') { console.error(`${path} is not a hide-accesstrade journal`); process.exit(1) }
  // EVERY journal id, whatever its status now: a tombstone only forces a re-render, so it is right after a hide (the
  // page must 404) AND after a --rollback (the page must stop serving its cached 404) — commit gate, 2026-10-13.
  const ids = journal.rows.map((r) => r.id)
  console.log(`journal ${path}: ${ids.length} rows → tombstoning every one`)
  await tombstoneAll(ids)
}

/** The read's prefilter: an AccessTrade link host, OR a row of an AccessTrade-sourced storefront (provenance). */
const PREFILTER = [
  ...ACCESSTRADE_URL_PREFILTER.map((host) => ({ affiliateUrl: { contains: host, mode: 'insensitive' as const } })),
  { sellerId: { in: [...ACCESSTRADE_SOURCED_SELLERS.keys()] } },
]

/** What is still removable right now (the same rule as the scan) — must be 0 after an --apply. */
async function removableLeft(): Promise<number> {
  const rows = await db.listing.findMany({
    where: { status: { in: ['active', 'sold'] }, OR: PREFILTER },
    select: { sellerId: true, affiliateUrl: true, seller: { select: { ownerId: true } } },
  })
  return rows.filter((l) => accessTradeKeepReason({ sellerId: l.sellerId, affiliateUrl: l.affiliateUrl, ownerId: l.seller.ownerId }) === null).length
}

async function scan() {
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — AccessTrade-linked rows, status IN ('active','sold')\n`)
  const rows = await db.listing.findMany({
    where: { status: { in: ['active', 'sold'] }, OR: PREFILTER },
    orderBy: { id: 'asc' },
    select: { id: true, title: true, status: true, verified: true, affiliateUrl: true, sellerId: true, seller: { select: { name: true, ownerId: true } } },
  })
  const take: typeof rows = []
  const kept = new Map<string, number>()
  for (const l of rows) {
    const why = accessTradeKeepReason({ sellerId: l.sellerId, affiliateUrl: l.affiliateUrl, ownerId: l.seller.ownerId })
    if (why) kept.set(`${l.seller.name}: ${why}`, (kept.get(`${l.seller.name}: ${why}`) ?? 0) + 1)
    else take.push(l)
  }
  const tally = new Map<string, { active: number; sold: number; unverified: number }>()
  for (const l of take) {
    const t = tally.get(l.seller.name) ?? { active: 0, sold: 0, unverified: 0 }
    t[l.status as 'active' | 'sold']++
    if (!l.verified) t.unverified++
    tally.set(l.seller.name, t)
  }
  console.log('to hide, by storefront:')
  for (const [name, t] of tally) console.log(`   ${name.padEnd(20)} active ${String(t.active).padStart(5)}   sold ${String(t.sold).padStart(5)}   (unverified ${t.unverified})`)
  console.log(`   ${'TOTAL'.padEnd(20)} ${take.length}`)
  console.log('\nleft alone:')
  for (const [k, n] of kept) console.log(`   ${String(n).padStart(5)}  ${k}`)
  for (const [id, why] of ACCESSTRADE_KEPT_SELLERS) console.log(`   (kept by decision: ${id} — ${why})`)

  if (!APPLY) { console.log(`\nDRY RUN — nothing written. --apply would hide ${take.length} rows.`); return }
  if (!take.length) { console.log('\nnothing to hide.'); return }
  const journalPath = join(resolve(JOURNAL_DIR!), `hide-accesstrade-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const out = await journaledHide(
    db,
    take.map((l) => ({ id: l.id, rule: 'accesstrade-link', matched: hostOf(l.affiliateUrl), title: l.title.slice(0, 140), sellerId: l.sellerId })),
    { path: journalPath, kind: 'hide-accesstrade' },
  )
  if (!out.journal) { console.log('\nnothing to hide — every row left active|sold since the scan.'); return }
  // ⛔ ORDER (commit gate): the journal path and the way back are printed first, the tombstones run next, and the
  // mirror copy LAST and non-fatally — nothing that can throw may sit between a hide and its tombstones.
  console.log(`\njournal written: ${journalPath} (${out.journaled} rows)`)
  console.log(`HIDDEN ${out.hidden.length} of ${take.length}.`)
  console.log(`ROLLBACK: npx tsx scripts/hide-accesstrade.ts --rollback ${journalPath} --apply   (rows only — also re-enable the timer and campaigns if prices must refresh again)`)
  await tombstoneAll(out.hidden)
  console.log(`journal sha256 ${createHash('sha256').update(readFileSync(journalPath)).digest('hex')}`)
  try {
    const mirror = join(MIRROR_DIR, basename(journalPath))
    if (resolve(mirror) !== resolve(journalPath)) { mkdirSync(MIRROR_DIR, { recursive: true }); copyFileSync(journalPath, mirror); console.log(`journal copy: ${mirror}`) }
  } catch (e) { console.warn(`⚠️ journal copy to ${MIRROR_DIR} failed (${(e as Error).message}) — copy ${journalPath} by hand`) }
  const left = await removableLeft()
  console.log(`re-scan: ${left} AccessTrade row(s) still active|sold outside the kept storefronts`)
  if (out.hidden.length !== take.length || left !== 0) {
    console.error(`INCOMPLETE — ${take.length - out.hidden.length} row(s) changed between the snapshot and the write. Re-run --apply (a fresh journal) until the re-scan reads 0.`)
    process.exitCode = 2
    return
  }
  console.log('NEXT: root layout ISR tag (home, /c/*, iPhone pages) + Cloudflare a tag purge of eno-html,eno-public on BOTH zones (never purge_everything).')
}

;(ROLLBACK ? rollback(ROLLBACK) : RETOMBSTONE ? retombstone(RETOMBSTONE) : scan())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
