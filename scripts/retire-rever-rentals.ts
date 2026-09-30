/**
 * Hide Rever.vn reference rentals that Rever itself now shows as let (or that are gone). Owner,
 * 2026-09-30: "leave only apartments that are available, i checked couple have expired or rented out".
 *
 *   Check (DRY — database session read-only at the server, writes only the --save file):
 *     set -a; . ./.env; set +a; npx tsx scripts/retire-rever-rentals.ts [--limit N] [--save <status.jsonl>]
 *   Write (hides only; journal first) — from the saved check, so Rever is not crawled twice:
 *     … scripts/retire-rever-rentals.ts --src <status.jsonl> --journal-dir <durable dir> --apply
 *   (--src re-judges every saved row with the CURRENT rule and refuses a check older than 24 h.)
 *
 * Why this exists rather than `import-rever-rentals.ts --retire`: that path needs a status file with
 * ≥98% coverage of the whole 3,555-row SOURCE scrape, and the crawler that produced it was never
 * committed. This checks exactly the rows that are live on eno — one request each, ≥1.5 s apart.
 *
 * ⛔ THE VERDICT COMES FROM THE LISTING'S OWN BADGE, NOT FROM "THE PAGE SAYS Đã thuê" — related-listing
 * cards print that phrase on live pages. See src/lib/rever-liveness.ts.
 * ⛔ STATUS 'stale', NOT 'hidden' (Opus, commit gate): `hide-imageless-imports.ts --restore` re-activates
 * every hidden import row that HAS a photo — every Rever flat has five — so a routine restore would
 * republish the let flats. 'stale' is as invisible publicly (listingIsViewable admits active|sold only)
 * and nothing else sets it, so the rollback cannot revive a row some other process hid either.
 * ⛔ HIDES, NEVER DELETES (`Order` is onDelete:Restrict and six relations cascade), only on a positive
 * signal, and only `active` rows of the Rever seller PINNED BY ID. A run where more than half of the
 * answered pages look gone is refused whole (massRetireRefusal): that is a site change, not churn.
 * ⛔ THE JOURNAL IS WRITTEN (fsync) BEFORE EACH WRITE, and a rollback .sql naming exactly the hidden
 * ids is written beside it.
 */
import 'dotenv/config'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { classifyReverLiveness, verdictFromLabels, type ReverLiveness } from '../src/lib/rever-liveness'
import { massRetireRefusal } from './muaban-net-map'

const SELLER_ID = 'cmub0wead0000zrq418bqq27m' // Rever.vn — pinned by id; Seller.name is user-settable
const UA = 'Mozilla/5.0 (compatible; eno-property-import/1.0; +https://eno.vn)'
const DELAY_MS = 1500

const argv = process.argv.slice(2)
const str = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] ?? null : null }
const APPLY = argv.includes('--apply')
const LIMIT = str('--limit') === null ? null : Number(str('--limit'))
if (LIMIT !== null && !(Number.isInteger(LIMIT) && LIMIT > 0)) throw new Error(`--limit must be a positive integer, got ${str('--limit')}`)
const SAVE = str('--save')
const SRC = str('--src')
const MAX_SRC_AGE_H = 24
const JOURNAL_DIR = str('--journal-dir')

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
  const probe = join(abs, `.rever-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}

/** ⛔ Only ever request Rever itself (codex, commit gate): the URL comes from the database, and a
 *  malformed or repointed row must not turn this operator script into a fetch of an arbitrary host. */
const isReverUrl = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'rever.vn' || x.hostname === 'www.rever.vn') } catch { return false } }

async function check(url: string): Promise<ReverLiveness> {
  if (!isReverUrl(url)) return { verdict: 'unknown', http: 0, label: null }
  try {
    // ⛔ REDIRECTS ARE NOT FOLLOWED (codex, commit gate): following one would reach a host the guard above
    // never saw. A live Rever listing answers 200 directly; any 3xx is saved as http 0 — no evidence — so
    // the --src re-judge can never read a redirect's landing page as 'gone'.
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (res.status === 429) throw new Error(`HTTP 429 at ${url} — rate limited; stopping`)
    if (res.status >= 300 && res.status < 400) return { verdict: 'unknown', http: 0, label: null }
    return classifyReverLiveness(res.status, res.status === 200 ? await res.text() : '')
  } catch (e) {
    if (e instanceof Error && e.message.includes('429')) throw e
    return { verdict: 'unknown', http: 0, label: null }
  }
}

async function main() {
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  if (APPLY && !SRC) throw new Error('--apply writes only from a saved check: --src <status.jsonl> (run the dry check with --save first)')
  if (SRC && SAVE) throw new Error('--src re-reads a saved check; it cannot also --save one')
  const journalDir = APPLY ? ensureJournalDir(JOURNAL_DIR!) : null
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
  try {
    const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true } })
    if (!seller || seller.name !== 'Rever.vn' || seller.ownerId) throw new Error(`seller ${SELLER_ID} is not the ownerless Rever.vn reference seller — refusing`)

    const rows = await db.listing.findMany({
      // APARTMENTS ONLY — the owner's scope ("leave only apartments that are available"); codex + Opus
      // both caught the first cut sweeping Rever's houses and offices too.
      where: { sellerId: SELLER_ID, status: 'active', subcategorySlug: 'apartment-rental', affiliateUrl: { not: null } },
      select: { id: true, affiliateUrl: true, subcategorySlug: true, title: true },
      orderBy: { createdAt: 'asc' },
      ...(LIMIT ? { take: LIMIT } : {}),
    })
    console.log(`retire pass       checking ${rows.length} active Rever rows, ≥${DELAY_MS} ms apart, UA "${UA}"`)

    const tally: Record<string, number> = { live: 0, rented: 0, gone: 0, unknown: 0 }
    const hide: { id: string; url: string; verdict: string; sub: string | null }[] = []
    // --src: the saved check, re-judged with the current rule. Rows not in it are left alone.
    const saved = new Map<string, ReverLiveness>()
    const savedUrl = new Map<string, string>()
    if (SRC) {
      for (const l of readFileSync(SRC, 'utf8').split('\n')) {
        if (!l.trim()) continue
        const r = JSON.parse(l) as { id: string; url: string; http: number; label: string | null; verdict: string; checkedAt: string }
        const ageH = (Date.now() - Date.parse(r.checkedAt)) / 3_600_000
        if (!(ageH >= 0 && ageH <= MAX_SRC_AGE_H)) throw new Error(`${SRC}: row ${r.id} was checked ${ageH.toFixed(1)} h ago — re-run the check (max ${MAX_SRC_AGE_H} h)`)
        // A saved 'unknown' with no badge text was a redirect, timeout or bare page — the re-judge may only
        // ever SHARPEN a verdict it had the badges for (a price-drop badge beside the status), never turn
        // "no evidence" into "gone" from a status code alone.
        savedUrl.set(r.id, r.url)
        saved.set(r.id, r.verdict === 'unknown' && !r.label
          ? { verdict: 'unknown', http: r.http, label: null }
          : verdictFromLabels(r.http, r.label ? r.label.split(' | ') : []))
      }
      console.log(`saved check       ${saved.size} rows from ${SRC}`)
    }
    for (const [i, r] of rows.entries()) {
      if (SRC && !saved.has(r.id)) continue
      // The verdict belongs to the URL that was checked; a row repointed since then is not judged by it (codex).
      if (SRC && savedUrl.get(r.id) !== r.affiliateUrl) { tally.unknown++; continue }
      const v = SRC ? saved.get(r.id)! : await check(r.affiliateUrl!)
      tally[v.verdict]++
      if (SAVE) recordDurably(SAVE, JSON.stringify({ id: r.id, url: r.affiliateUrl, ...v, checkedAt: new Date().toISOString() }))
      if (v.verdict === 'rented' || v.verdict === 'gone') hide.push({ id: r.id, url: r.affiliateUrl!, verdict: v.verdict, sub: r.subcategorySlug })
      if (SRC) continue
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${rows.length}  ${JSON.stringify(tally)}`)
      await new Promise((ok) => setTimeout(ok, DELAY_MS))
    }
    console.log(`\nverdicts          ${JSON.stringify(tally)}`)
    const bySub: Record<string, number> = {}
    for (const h of hide) bySub[h.sub ?? '(none)'] = (bySub[h.sub ?? '(none)'] ?? 0) + 1
    console.log(`would hide        ${hide.length}  by subcategory ${JSON.stringify(bySub)}`)
    for (const h of hide.slice(0, 15)) console.log(`  ${h.verdict.padEnd(7)} ${h.url}`)

    const answered = tally.live + tally.rented + tally.gone
    const refusal = massRetireRefusal(hide.length, answered)
    if (refusal) throw new Error(refusal)
    if (!APPLY) { console.log('\nDRY RUN — nothing hidden. Re-run with --journal-dir <durable dir> --apply.'); return }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const JOURNAL = join(journalDir!, `rever-retired-rows-${stamp}.jsonl`)
    const ROLLBACK = join(journalDir!, `rever-retired-rows-${stamp}.rollback.sql`)
    console.log(`retire journal    ${JOURNAL}\nrollback          ${ROLLBACK}`)
    let hidden = 0
    for (const h of hide) {
      // Journal AND rollback line first (fsync), then the conditional write. A rollback line for a row the
      // write then skipped is harmless: it only re-activates a row that is still 'stale', which only we set.
      recordDurably(JOURNAL, JSON.stringify({ ...h, at: new Date().toISOString() }))
      recordDurably(ROLLBACK, `UPDATE "Listing" SET status='active' WHERE id='${h.id}' AND "sellerId"='${SELLER_ID}' AND status='stale';`)
      // The URL is part of the condition: a row repointed after the check is not judged by the old verdict (codex).
      const res = await db.listing.updateMany({ where: { id: h.id, sellerId: SELLER_ID, status: 'active', subcategorySlug: 'apartment-rental', affiliateUrl: h.url }, data: { status: 'stale' } })
      if (res.count === 1) hidden++
    }
    console.log(`hidden            ${hidden} of ${hide.length}`)
    if (hidden) console.log('NEXT: purge cached listing pages — node scripts/purge-isr-listings.mjs (PDPs are ISR for 30 days)')
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
