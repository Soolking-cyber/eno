/**
 * Bring back the AccessTrade USED shelves the 2026-10-13 removal hid — owner, 2026-11-14: "import all 2nd hand one
 * with comission". Which rows come back, and why only those, is in src/lib/accesstrade-restore.ts.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/restore-accesstrade-used.ts --journal <hide-accesstrade-….json>                 # DRY RUN
 *   …                         npx tsx scripts/restore-accesstrade-used.ts --journal <hide-accesstrade-….json> --journal-dir <dir> --apply
 *   …                         npx tsx scripts/restore-accesstrade-used.ts --undo <restore-accesstrade-used-….json | import-accesstrade-created-….json> [--apply [--hide <id,…>]]
 *   …                         npx tsx scripts/restore-accesstrade-used.ts --retombstone <either journal>   # retry the PDP tombstones
 *
 * ⛔ THE ROWS COME BACK AT TODAY'S PRICE AND LINK, IN THE SAME CONDITIONAL STATEMENT (RESTORE_PRICED_SQL), only while
 * each is still exactly what the hide left. A journaled `sold` row goes back to `sold`; the nightly job's screened
 * restock flips it once the timer runs. Rows not picked stay hidden and keep the 10-13 journal's rollback.
 * ⛔ THE RESTORE IS JOURNALED TOO (after each chunk, with each row's new status and `"updatedAt"::text`), so `--undo`
 * hides exactly what this run brought back and nothing a later write has touched. `--undo` also reads the created-ids
 * journal of scripts/import-accesstrade.ts.
 * ⚠️ `--undo` IS A WAY BACK ONLY UNTIL SOMETHING ELSE WRITES THE ROW (commit gate, opus 2026-11-14): the nightly job's
 * first reprice or restock, a translation, an admin edit all move `updatedAt`, and --undo then leaves that row. Decide on
 * undo BEFORE enabling the timer; after it, scripts/hide-accesstrade.ts is the way back. An undone restore cannot be
 * re-run: its rows no longer match the 10-13 journal (changed_since_hide).
 * ⚠️ RUN IT AFTER THE DEPLOY THAT MAPS THE TWO STOREFRONTS (affiliate-price-refresh.ts MERCHANT_NAMES) and before
 * enabling eno-cron-affiliate-prices.timer; then import-accesstrade.ts for the used SKUs that were never imported.
 * ⚠️ It tombstones each restored PDP (en + vi). Home, /c/* and the price pages still need the root layout tag or their
 * ISR window, and Cloudflare a tag purge (eno-html, eno-public) on BOTH zones.
 */
import { readFileSync } from 'node:fs'
import { writeFileDurably } from '../src/lib/durable-file'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { RESTORE_PRICED_SQL, UNDO_COUNT_SQL, UNDO_SQL, isUndoJournal, pickRestores, SKIP_REASONS, type FeedItem, type HeldRow, type RestoreJournalRow, type RestorePick, type UndoJournal, PENDING_UNDO_SQL } from '../src/lib/accesstrade-restore'
import { ACCESSTRADE_SOURCED_SELLERS } from '../src/lib/accesstrade-removal'
import { campaignIdFor, fetchFeedPrices, merchantNameFor } from '../src/lib/affiliate-price-refresh'
import { partitionRestock, type RestockRow } from '../src/lib/restock-screen'
import { tombstonePdps } from '../src/lib/pdp-tombstone'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); const v = i >= 0 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : undefined }
const APPLY = process.argv.includes('--apply')
const JOURNAL = arg('journal')
const UNDO = arg('undo')
const JOURNAL_DIR = arg('journal-dir')
const RETOMBSTONE = arg('retombstone')
// ⛔ `--hide <id,…>`: the unstamped rows a crashed run may have left, hidden only BY ID, as a human names them after
// reading the list (codex, gate rounds 14–18): no seller, SKU or time window can prove which run made a row, so the
// script lists the candidates and never decides ownership itself. Each id must be one this journal lists as pending.
const HIDE_IDS = (arg('hide') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
if ([JOURNAL, UNDO, RETOMBSTONE].filter(Boolean).length !== 1) { console.error('give exactly one of --journal <hide-accesstrade journal>, --undo <journal> or --retombstone <journal>'); process.exit(1) }
if (JOURNAL && APPLY && !JOURNAL_DIR) { console.error('--apply needs --journal-dir <durable dir outside the repo> — the restore journal is the only way back'); process.exit(1) }
const MIRROR_DIR = join(homedir(), 'eno-journals', 'accesstrade')

/** The two campaigns the owner brought back, and the storefront ids their 10-13 journal rows carry. */
const CAMPAIGNS = ['cellphones_cps', 'dienthoaivui'] as const

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ...(APPLY || RETOMBSTONE ? {} : { options: '-c default_transaction_read_only=on' }) }),
  log: ['warn', 'error'],
})

const CHUNK = 500
const chunks = <T>(xs: T[]): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK)); return out }

/** Written whole to a temp file and renamed over the journal, so an interrupted write never leaves a torn one (codex). */
function writeJournal(name: string, body: unknown) {
  const text = JSON.stringify(body, null, 1)
  for (const dir of [JOURNAL_DIR!, MIRROR_DIR]) writeFileDurably(dir, name, text)
}

/** Tombstone `ids` (en + vi) and FAIL unless every page got its tags — the same check hide-accesstrade.ts makes. */
async function tombstoneAll(ids: string[]) {
  const msg = await tombstonePdps(db, ids)
  console.log(`PDP tombstones: ${msg}`)
  const written = Number(/^(\d+) tags/.exec(msg)?.[1] ?? NaN)
  if (ids.length && written !== ids.length * 2) throw new Error(`tombstones incomplete (${msg}): expected ${ids.length * 2} tags for ${ids.length} pages — re-run with --retombstone <journal>`)
}

/**
 * The SKUs an import run was creating when it stopped (no stamp): resolved to the row made at or after its start
 * (sellerId + externalId is unique; a minute of slack for the clock of the machine that ran it).
 */
async function pendingCreated(journal: UndoJournal): Promise<{ id: string; status: string; createdAt: string }[]> {
  if (!journal.pendingExternalIds?.length || !journal.sellerId) return []
  return db.$queryRawUnsafe<{ id: string; status: string; createdAt: string }[]>(
    // NO upper time bound (codex, gate round 20): a run suspended past any window could have created its row later, and
    // a person picks every --hide id — so every candidate is listed, with its createdAt (and the journal's savedAt) to judge by.
    `SELECT id, status, "createdAt"::text AS "createdAt" FROM "Listing" WHERE "sellerId" = $1 AND "externalId" = ANY($2::text[]) AND "createdAt" >= (($3::timestamptz - interval '1 minute') AT TIME ZONE 'UTC') ORDER BY "createdAt"`,
    journal.sellerId, journal.pendingExternalIds, journal.createdAt)
}

async function undo(path: string) {
  const journal = JSON.parse(readFileSync(path, 'utf8'))
  if (!isUndoJournal(journal)) { console.error(`${path} is not a restore-accesstrade-used or import-accesstrade-created journal`); process.exit(1) }
  // The unstamped candidates, and --hide checked against them, BEFORE any write (codex, gate round 19): a mistyped id
  // must refuse the whole call, not exit after the stamped hides have committed and before their pages are purged.
  const found = await pendingCreated(journal)
  const pendingIds = [...new Set([...(journal.pending ?? []), ...found.map((r) => r.id)])]
  const stray = HIDE_IDS.filter((id) => !pendingIds.includes(id))
  if (stray.length) { console.error(`--hide names ids this journal does not list as pending: ${stray.join(', ')} — refusing, nothing written`); process.exit(1) }
  let still = 0
  const hidden: string[] = []
  for (const part of chunks(journal.rows)) {
    const cols = [part.map((r) => r.id), part.map((r) => r.status), part.map((r) => r.updatedAt)]
    still += (await db.$queryRawUnsafe<{ n: number }[]>(UNDO_COUNT_SQL, ...cols))[0].n
    if (APPLY) hidden.push(...(await db.$queryRawUnsafe<{ id: string }[]>(UNDO_SQL, ...cols)).map((r) => r.id))
  }
  console.log(`${journal.kind} ${basename(path)}: ${journal.rows.length} rows, ${still} still exactly as that run left them (the rest changed since → left alone)`)
  const pendingVerb = 'NOT hidden — check each is this run\'s, then re-run with --hide <id,…> for the ones that are'
  if (journal.pending?.length) console.log(`⚠️ ${journal.pending.length} ids were being written when that run stopped and have no stamp — ${pendingVerb}:\n  ${journal.pending.join('\n  ')}`)
  if (journal.pendingExternalIds?.length) {
    console.log(`⚠️ ${journal.pendingExternalIds.length} SKUs were being created when that run stopped (no stamp) — ${pendingVerb}; ${found.length} exist (that run's journal last saved ${journal.savedAt ?? 'unknown'}):\n  ${found.map((r) => `${r.id} (${r.status}, created ${r.createdAt})`).join('\n  ')}`)
  }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to hide them.'); return }
  if (HIDE_IDS.length) hidden.push(...(await db.$queryRawUnsafe<{ id: string }[]>(PENDING_UNDO_SQL, HIDE_IDS)).map((r) => r.id))
  console.log(`HIDDEN ${hidden.length} rows.`)
  // ⛔ Every journal row that is hidden NOW, not only the ones this call hid (codex, gate round 10): a retry after a
  // crash between the hide and the purge finds them already hidden, and their pages must still stop rendering.
  const allIds = [...journal.rows.map((r) => r.id), ...pendingIds]
  const nowHidden = (await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Listing" WHERE id = ANY($1::text[]) AND status = 'hidden'`, allIds)).map((r) => r.id)
  await tombstoneAll([...new Set([...hidden, ...nowHidden])])
}

async function restore(path: string) {
  const hide = JSON.parse(readFileSync(path, 'utf8')) as { kind?: string; createdAt?: string; rows?: RestoreJournalRow[] }
  if (hide.kind !== 'hide-accesstrade' || typeof hide.createdAt !== 'string' || !Array.isArray(hide.rows)) { console.error(`${path} is not a hide-accesstrade journal`); process.exit(1) }
  const key = process.env.ACCESSTRADE_KEY
  if (!key) { console.error('ACCESSTRADE_KEY missing from .env'); process.exit(1) }
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — ${hide.rows.length} rows in ${basename(path)} (hidden ${hide.createdAt})\n`)

  // Today's feed per storefront. ⛔ `ownerId: null` + the provenance ids: the storefront must be the very one the
  // 10-13 journal hid rows of, never a same-named shop someone claimed.
  const feeds = new Map<string, Map<string, FeedItem>>()
  const merchantOf = new Map<string, string>()
  for (const campaign of CAMPAIGNS) {
    const name = merchantNameFor(campaign)
    const seller = await db.seller.findFirst({ where: { name, ownerId: null }, select: { id: true } })
    if (!seller || !ACCESSTRADE_SOURCED_SELLERS.has(seller.id)) { console.error(`no ownerless AccessTrade storefront named "${name}" (got ${seller?.id ?? 'none'}) — refusing`); process.exit(1) }
    const campaignId = await campaignIdFor(campaign, key)
    if (!campaignId) { console.error(`"${campaign}" is not an APPROVED campaign for this publisher — refusing`); process.exit(1) }
    const walk = await fetchFeedPrices(campaign, key, campaignId)
    console.log(`${name}: feed ${walk.seen}/${walk.total} rows${walk.complete ? '' : ' (INCOMPLETE walk)'}, ${walk.prices.size} priced`)
    feeds.set(seller.id, walk.prices)
    merchantOf.set(seller.id, name)
  }

  // The journaled rows as they stand now — `"updatedAt"::text`, the journal's own format, and the text the screen reads.
  const held = new Map<string, HeldRow>()
  const texts = new Map<string, RestockRow & { sellerId: string; images: string | null }>()
  for (const part of chunks(hide.rows.map((r) => r.id))) {
    const rows = await db.$queryRawUnsafe<(HeldRow & { title: string; titleVi: string | null; description: string; descriptionVi: string | null; subcategorySlug: string | null; categorySlug: string; images: string | null })[]>(
      `SELECT l.id, l."sellerId", l."externalId", l.status, l."updatedAt"::text AS "updatedAt", l.condition, l.title, l."titleVi", l.description, l."descriptionVi", ` +
      `l."subcategorySlug", c.slug AS "categorySlug", l.images FROM "Listing" l JOIN "Category" c ON c.id = l."categoryId" WHERE l.id = ANY($1::text[])`, part)
    for (const r of rows) {
      held.set(r.id, { id: r.id, sellerId: r.sellerId, externalId: r.externalId, status: r.status, updatedAt: r.updatedAt, condition: r.condition })
      texts.set(r.id, { id: r.id, title: r.title, titleVi: r.titleVi, description: r.description, descriptionVi: r.descriptionVi, subcategorySlug: r.subcategorySlug, category: { slug: r.categorySlug }, sellerId: r.sellerId, images: r.images })
    }
  }
  const { picks: candidates, skipped } = pickRestores(hide.rows, held, feeds)

  // ⛔ THE RESTOCK SCREEN, AS THE NIGHTLY RESTORE USES IT: a banned word or an ad-classifier 'ban' stays hidden;
  // 'review' comes back and is listed. Pure here — nothing is written for a refused row.
  const refused = new Set<string>()
  const review: string[] = []
  for (const [sellerId, merchant] of merchantOf) {
    const ids = candidates.filter((p) => p.sellerId === sellerId).map((p) => p.id)
    const d = partitionRestock(ids, ids.map((id) => texts.get(id)!).filter(Boolean), merchant)
    for (const f of d.hide) refused.add(f.id)
    for (const f of d.review) review.push(`${f.id} ${f.rule}`)
  }
  const screened: RestorePick[] = candidates.filter((p) => !refused.has(p.id))

  // ⛔ EVERY PICK'S FIRST PHOTO IS CHECKED, NOT A SAMPLE (codex, gate round 21): one that does not answer stays hidden.
  // The photos are ours (hosted at import) and the hide kept them — so if MOST do not answer, that is our storage, not
  // the rows, and the whole run is refused below.
  const firstPhoto = (id: string) => { try { return JSON.parse(texts.get(id)?.images || '[]')[0] as string | undefined } catch { return undefined } }
  const photoOk = new Map<string, boolean>()
  for (let i = 0; i < screened.length; i += 8) {
    await Promise.all(screened.slice(i, i + 8).map(async (p) => {
      const u = firstPhoto(p.id)
      photoOk.set(p.id, !!u && (await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).then((r) => r.ok, () => false)))
    }))
  }
  const picks: RestorePick[] = screened.filter((p) => photoOk.get(p.id))
  const missing = screened.length - picks.length

  for (const [sellerId, merchant] of merchantOf) {
    const mine = picks.filter((p) => p.sellerId === sellerId)
    const journaled = hide.rows.filter((r) => r.sellerId === sellerId).length
    console.log(`\n${merchant}: ${journaled} journaled → ${mine.length} to restore (${mine.filter((p) => p.prior === 'active').length} active, ${mine.filter((p) => p.prior === 'sold').length} sold)`)
  }
  console.log(`\nleft hidden: ${SKIP_REASONS.map((r) => `${r} ${skipped[r]}`).join(' · ')} · screened_out ${refused.size}`)
  if (review.length) console.log(`restock screen 'review' (restored, listed for a human): ${review.slice(0, 10).join(' | ')}${review.length > 10 ? ` … +${review.length - 10}` : ''}`)
  console.log(`photo check: ${picks.length}/${screened.length} first photos answer — ${missing} without one stay hidden`)
  for (const p of picks.slice(0, 5)) console.log(`  · ${p.id} → ${p.prior} at ${p.price.toLocaleString('vi-VN')} đ  ${texts.get(p.id)?.title.slice(0, 60)}`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --journal-dir <dir> --apply to restore.'); return }
  if (!picks.length) { console.log('\nNothing to restore — nothing written, no journal.'); return }
  if (missing > screened.length / 2) { console.error('\nmost first photos do not answer — our storage, not the rows: refusing the whole restore'); process.exit(1) }

  const runAt = new Date().toISOString()
  const name = `restore-accesstrade-used-${runAt.replace(/[:.]/g, '-')}.json`
  const restored: { id: string; status: string; updatedAt: string }[] = []
  const journal = (pending: string[]) => writeJournal(name, { kind: 'restore-accesstrade-used', createdAt: runAt, source: basename(path), rows: restored, pending })
  for (const part of chunks(picks)) {
    // ⛔ THE IDS GO TO DISK BEFORE THE WRITE (codex, diff review): a crash after the commit and before the stamp is saved
    // still leaves which rows this run was restoring; --undo lists those for a human instead of losing them.
    journal(part.map((p) => p.id))
    restored.push(...await db.$queryRawUnsafe<{ id: string; status: string; updatedAt: string }[]>(RESTORE_PRICED_SQL,
      part.map((p) => p.id), part.map((p) => p.prior), part.map((p) => p.upd), hide.createdAt, part.map((p) => p.price), part.map((p) => p.affiliateUrl)))
    journal([])
  }
  console.log(`\nRESTORED ${restored.length} of ${picks.length} picked (${picks.length - restored.length} changed between the read and the write → left hidden)`)
  console.log(`restore journal: ${join(JOURNAL_DIR!, name)} (+ ${MIRROR_DIR}) — undo: --undo <that file> --apply`)
  await tombstoneAll(restored.map((r) => r.id))
}

/** Re-write the PDP tombstones of a journal's rows — the retry when the tombstone step failed after a restore or an undo. */
async function retombstone(path: string) {
  const journal = JSON.parse(readFileSync(path, 'utf8'))
  if (!isUndoJournal(journal)) { console.error(`${path} is not a restore-accesstrade-used or import-accesstrade-created journal`); process.exit(1) }
  // Every row the run touched or may have touched, the importer's pending SKUs resolved too (codex, gate round 6):
  // after a by-hand hide of one of them, this is how its page stops rendering.
  const ids = [...new Set([...journal.rows.map((r) => r.id), ...(journal.pending ?? []), ...(await pendingCreated(journal)).map((r) => r.id)])]
  console.log(`journal ${basename(path)}: tombstoning ${ids.length} pages`)
  await tombstoneAll(ids)
}

;(RETOMBSTONE ? retombstone(RETOMBSTONE) : UNDO ? undo(UNDO) : restore(JOURNAL!)).then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
