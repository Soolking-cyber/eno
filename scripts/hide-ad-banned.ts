/**
 * Hide LIVE listings that advertise goods Vietnamese law forbids advertising (src/lib/ad-banned.ts):
 * spirits ≥ 15% ABV, tobacco, e-cigarettes/heated tobacco, breast-milk substitutes for under-24-month
 * children, feeding bottles and teats, prescription and veterinary prescription drugs.
 *
 * ⛔ ONLY AN OWNERLESS STOREFRONT'S IMPORTED OR LINKED ROW — NEVER A PERSON'S OWN POST (2026-10-01,
 * review). The scan reads `seller.ownerId IS NULL` and (externalId OR affiliateUrl) and the hide's SQL
 * re-checks both (src/lib/journaled-hide.ts). `hidden` is a seller state the seller can undo in one
 * click, and this writes no audit row and sends no notice — on a user post it would be an unannounced
 * takedown. User posts are screened at publish (publish-guard.ts) and policed by reports and moderation.
 *
 * ⛔ "LIVE" IS verified AND status IN ('active','sold'), NOT ONLY 'active' (2026-10-01, review). A SOLD
 * listing still renders: the PDP serves a 200 "this item has been sold" page naming it, with its
 * photos, for every verified + sold row (src/app/[lang]/listings/[id]/(pdp)/get-listing.ts,
 * listingIsViewable). The stock crons retire imported rows to 'sold', so a banned product that went out
 * of stock was still advertised there. Both are scanned and reported separately; the journal keeps
 * each row's prior status, and --rollback restores it.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/hide-ad-banned.ts                       # DRY RUN (default)
 *   …                         npx tsx scripts/hide-ad-banned.ts --list                # every flagged row, not 5 per rule
 *   …                         npx tsx scripts/hide-ad-banned.ts --apply               # hide every 'ban' row
 *   …                         npx tsx scripts/hide-ad-banned.ts --rollback scripts/journals/hide-ad-banned-<ts>.json [--apply]
 *   (--rollback also restores an importer's scripts/journals/import-hide-<importer>-<ts>.json — the
 *    rows its content screen hid, src/lib/import-screen.ts)
 *
 * ⛔ ONLY 'ban' IS EVER HIDDEN. 'review' rows are counted and sampled for a human and left exactly as
 * they are — the classifier's contract is that an ambiguous row never auto-bans.
 *
 * ⛔ RAW SQL, NEVER `db.listing.update*`. Prisma stamps `updatedAt` (@updatedAt) on every write it
 * makes, and the sitemaps and the "recently changed" orderings read updatedAt — a Prisma bulk hide
 * would reorder the sitemap for thousands of rows that did not change in any way a reader cares
 * about (and trust.ts dates legacy sales by updatedAt — see the #26 notes there). A raw UPDATE leaves
 * updatedAt alone.
 *
 * ⛔ HIDDEN, NEVER DELETED. Law 122/2025 Art 17.1(e) keeps posted information for at least a year,
 * and the row is the evidence of what was published. `status='hidden'` removes it from every public
 * read (the feeds and search pin status='active'; the PDP renders only active or sold) while keeping
 * every column.
 *
 * ⛔ A JOURNAL IS WRITTEN BEFORE THE UPDATE — {id, priorStatus, updatedAt} per row, read immediately
 * before the hide, in scripts/journals/ — and the hide is conditional on both. `--rollback <journal>`
 * restores a row ONLY while it is still exactly what the hide left: 'hidden', the same `updatedAt`
 * (every app write — a moderator's hide, an unverify, an edit, a removal — bumps it; this script's raw
 * SQL does not), and no compliance_audit row on it since the journal (src/lib/journaled-hide.ts).
 * Rollback is also a dry run without --apply.
 *
 * ⚠️ THE DRY RUN OPENS A READ-ONLY SESSION (default_transaction_read_only=on): it cannot write even
 * by mistake. Only --apply connects read-write.
 *
 * ⚠️ AFTER --apply, PURGE THE BAKED PAGES: a PDP is ISR-cached for up to 30 days and a status change
 * made outside the app purges nothing. Run `node scripts/purge-isr-listings.mjs` (route-wide
 * tombstone) — the script prints the reminder.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { AD_BAN_RULES, classifyAdBanned, type AdBanRule } from '../src/lib/ad-banned'
import { journaledHide, journaledRestore, rollbackPathArg, type HideJournal } from '../src/lib/journaled-hide'

const APPLY = process.argv.includes('--apply')
// ⛔ `--rollback --apply` with no path is an ERROR, not a request to read a file named "--apply".
const { path: ROLLBACK, error: rollbackError } = rollbackPathArg(process.argv)
if (rollbackError) { console.error(rollbackError); process.exit(1) }
const SAMPLES = process.argv.includes('--list') ? Infinity : 5
const PAGE = 2000

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }),
  log: ['warn', 'error'],
})

const LIVE_STATUSES = ['active', 'sold'] as const
type LiveStatus = (typeof LIVE_STATUSES)[number]
const JOURNAL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'journals')

/** Rollback also reads the journals the importers' content screen writes before IT hides a live row
 *  (src/lib/import-screen.ts, ImportScreen.applyHides — `kind: 'import-screen-hide'`, same rows). */
const ROLLBACK_KINDS = new Set(['hide-ad-banned', 'import-screen-hide'])

async function rollback(path: string) {
  const journal = JSON.parse(readFileSync(path, 'utf8')) as Omit<HideJournal, 'kind'> & { kind: string }
  if (!ROLLBACK_KINDS.has(journal.kind) || !Array.isArray(journal.rows) || typeof journal.createdAt !== 'string') {
    console.error(`${path} is not a hide-ad-banned or import-screen-hide journal`); process.exit(1)
  }
  const r = await journaledRestore(db, journal, { apply: APPLY })
  const prior = new Map<string, number>()
  const ok = new Set(r.restorable)
  for (const row of journal.rows) if (ok.has(row.id)) prior.set(row.priorStatus, (prior.get(row.priorStatus) ?? 0) + 1)
  console.log(`journal ${path}: ${r.total} rows hidden at ${journal.createdAt}`)
  console.log(`  ${r.restorable.length} still exactly as the hide left them → restorable${[...prior].map(([p, n]) => ` · ${n} to '${p}'`).join('')}`)
  console.log(`  ${r.total - r.unstamped - r.restorable.length} changed since (no longer hidden, touched by a later write, or under a later compliance decision) → LEFT ALONE`)
  if (r.unstamped) console.log(`  ${r.unstamped} journal row(s) carry no updatedAt stamp → never restored automatically`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to restore.'); return }
  console.log(`\nRESTORED ${r.restored.length} rows. Purge the baked pages: node scripts/purge-isr-listings.mjs`)
}

async function scan() {
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — scanning verified=true AND status IN ('active','sold'), ownerless imported/linked rows only\n`)
  type Tally = Record<'ban' | 'review', Record<LiveStatus, number>>
  const counts = new Map<AdBanRule, Tally>(AD_BAN_RULES.map((r) => [r, { ban: { active: 0, sold: 0 }, review: { active: 0, sold: 0 } }]))
  const scannedBy: Record<LiveStatus, number> = { active: 0, sold: 0 }
  const samples = new Map<string, { id: string; title: string; seller: string; matched: string | null }[]>()
  const bySeller = new Map<string, number>()
  const toHide: { id: string; rule: string; matched: string | null; title: string; status: LiveStatus }[] = []
  let scanned = 0
  let cursor: string | undefined
  for (;;) {
    const rows = await db.listing.findMany({
      // ⛔ OWNERLESS IMPORTED/LINKED ROWS ONLY — never a person's own post (see the header); the hide's
      // SQL re-checks the same predicate (src/lib/journaled-hide.ts).
      where: {
        status: { in: [...LIVE_STATUSES] }, verified: true, seller: { ownerId: null },
        OR: [{ externalId: { not: null } }, { affiliateUrl: { not: null } }],
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, title: true, titleVi: true, description: true, descriptionVi: true, subcategorySlug: true, status: true,
        category: { select: { slug: true } }, seller: { select: { name: true } },
      },
    })
    if (!rows.length) break
    cursor = rows[rows.length - 1].id
    for (const l of rows) {
      scanned++
      const st = l.status as LiveStatus
      scannedBy[st]++
      const r = classifyAdBanned({
        title: l.title, titleVi: l.titleVi, description: l.description, descriptionVi: l.descriptionVi,
        category: l.category.slug, subcategory: l.subcategorySlug, merchant: l.seller.name,
      })
      if (r.verdict === 'ok' || !r.rule) continue
      counts.get(r.rule)![r.verdict][st]++
      const key = `${r.verdict}:${r.rule}`
      const s = samples.get(key) ?? []
      if (s.length < SAMPLES) s.push({ id: l.id, title: `${st === 'sold' ? '[sold] ' : ''}${(l.titleVi || l.title).slice(0, 90)}`, seller: l.seller.name, matched: r.matched })
      samples.set(key, s)
      if (r.verdict === 'ban') {
        bySeller.set(l.seller.name, (bySeller.get(l.seller.name) ?? 0) + 1)
        toHide.push({ id: l.id, status: st, rule: r.rule, matched: r.matched, title: (l.titleVi || l.title).slice(0, 140) })
      }
    }
  }

  console.log(`scanned ${scanned} live listings (${scannedBy.active} active, ${scannedBy.sold} sold — a sold row renders the public sold page)\n`)
  const col = (n: number, w: number) => String(n).padStart(w)
  console.log('rule             ban:active  ban:sold  review:active  review:sold')
  for (const [rule, c] of counts) console.log(`${rule.padEnd(16)} ${col(c.ban.active, 10)} ${col(c.ban.sold, 9)} ${col(c.review.active, 14)} ${col(c.review.sold, 12)}`)
  const sum = (v: 'ban' | 'review', st: LiveStatus) => [...counts.values()].reduce((n, c) => n + c[v][st], 0)
  const totalBan = toHide.length
  const totalReview = sum('review', 'active') + sum('review', 'sold')
  console.log(`${'TOTAL'.padEnd(16)} ${col(sum('ban', 'active'), 10)} ${col(sum('ban', 'sold'), 9)} ${col(sum('review', 'active'), 14)} ${col(sum('review', 'sold'), 12)}`)
  console.log(`(ban ${totalBan} = would be hidden · review ${totalReview} = never hidden)\n`)
  for (const verdict of ['ban', 'review'] as const) {
    for (const rule of AD_BAN_RULES) {
      const s = samples.get(`${verdict}:${rule}`)
      if (!s?.length) continue
      console.log(`── ${verdict.toUpperCase()} · ${rule} (samples)`)
      for (const x of s) console.log(`   ${x.id}  ${x.title}  [${x.seller}]  ← ${x.matched}`)
    }
  }
  if (bySeller.size) {
    console.log('\nban by seller:')
    for (const [name, n] of [...bySeller].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${name}`)
  }

  if (!APPLY) { console.log(`\nDRY RUN — nothing written. --apply would hide ${totalBan} rows (review rows are never hidden).`); return }
  if (!totalBan) { console.log('\nnothing to hide.'); return }
  const journalPath = join(JOURNAL_DIR, `hide-ad-banned-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  // ⛔ THE JOURNAL IS ON DISK BEFORE A SINGLE ROW CHANGES (journaledHide): each row's status and
  // updatedAt are read just before the hide, journaled, and the hide is conditional on both.
  const out = await journaledHide(db, toHide.map(({ status: _s, ...c }) => c), { path: journalPath, kind: 'hide-ad-banned' })
  if (!out.journal) { console.log('\nnothing to hide — every flagged row left active|sold since the scan.'); return }
  console.log(`\njournal written: ${journalPath} (${out.journaled} rows)`)
  console.log(`HIDDEN ${out.hidden.length} of ${totalBan} (a row no longer live, or changed between the snapshot and the write, is skipped).`)
  console.log(`ROLLBACK: npx tsx scripts/hide-ad-banned.ts --rollback ${journalPath} --apply`)
  console.log('NEXT: purge the baked PDPs — node scripts/purge-isr-listings.mjs')
}

;(ROLLBACK ? rollback(ROLLBACK) : scan())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
