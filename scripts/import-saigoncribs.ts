/**
 * Saigon Cribs (src/lib/saigoncribs-listing.ts) → its own storefront: every listing the agency publishes, created ONCE.
 *
 * What is written and why: src/lib/saigoncribs-listing.ts (owner, 2026-11-18; the plan: ~/eno-saigoncribs-2026-11-18/
 * PLAN.md). This file is the I/O around it, in scripts/import-car-partners.ts's shape.
 *
 *   DRY (reads the research, the FX feed and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-saigoncribs.ts [--limit N | --only <post id,…>]
 *   WRITE (journal first):
 *     … scripts/import-saigoncribs.ts --journal-dir <durable dir> --identity-gate on|off --apply [--limit N | --only …]
 *   UNDO one run (dry first, then --apply):
 *     … scripts/import-saigoncribs.ts --rollback <journal dir>/saigoncribs-created-rows-<time>.jsonl [--apply]
 *   --research-dir <dir>  defaults to ~/eno-saigoncribs-2026-11-18 (data.json, photo-verdicts.json, bodies.json, photos/,
 *                         _logos/). The research is READ, never the live site: nothing here requests saigoncribs.com.
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB. After this run the rows belong to the account eno's admin signs in with. A listing whose
 * externalId (`saigoncribs:<post id>`) exists on the storefront is SKIPPED, whatever it now says, so re-running can never
 * overwrite an admin's edit, a price they changed or a listing they took down. Nothing schedules this file; lets, edits
 * and takedowns are made by hand in the account. ⛔ NEVER add the storefront to import-sellers.ts: the daily sweeps and
 * expiries act on ownerless import storefronts only, and that list is what would hand these rows to them.
 *
 * ⛔ PHOTOS ARE THE LOCAL FILES A PERSON JUDGED (photo-verdicts.json: photos/<post id>/<nn>.<ext>, the first 20 of the
 * gallery). A verdict that does not cover every candidate exactly once, or a kept photo with no file on disk, REFUSES THE
 * --apply (photoVerdictProblem; the dry run lists them all and exits 1). Then each kept
 * file, unit photos before building shots (orderedKeep), meets the shared real-photo test (import-photo-check.ts
 * measureImage + imageVerdict: text cards, logos, slivers out), near-duplicates count once, at most 10 are kept, and a
 * listing left with fewer than the category's floor (3 distinct — never lower: an admin's edit re-checks it) or with no
 * photo of the unit itself is NOT written. An official partner's photos are exempt from the photo-check cron
 * (listing-photo-check.ts), which is why this screen is here — and every row created is still queued for the check, in a
 * `finally`. Stored clean under listings/affiliate/m/ with the app-drawn eno.vn mark (makeImageHost mark 'overlay'), every
 * object listed (fsync) in the run's manifest before its row is written.
 *
 * ⛔ THE SELLER IDENTITY GATE, as import-car-partners.ts: asked once before anything is uploaded; --identity-gate states
 * production's IDENTITY_GATE_ENFORCED, which this machine cannot read. Refused → nothing is written. No row is ever
 * written held. The storefront must be Handle `saigoncribs` AND owner support+saigoncribs@eno.vn AND an official partner
 * (saigoncribsSellerRefusal) — else nothing is uploaded or written. Rows carry NO affiliateUrl: a renter's Message reaches
 * the eno-held account (a row with one answers chat 409).
 *
 * ⛔ PRICES: the agency's dollars converted at ONE rate, read once from open.er-api.com's USD-base feed at the start of the
 * run (vndPerUsdFrom, band-checked, FAIL CLOSED — no rate, no run) and printed; the description names the rate and day.
 *
 * Undo (journal `saigoncribs-created-rows-<time>.jsonl`, `--rollback` above): every journaled row still 'active' with the
 * updatedAt it was created with → 'stale', and its pages tombstoned (pdp-tombstone.ts; a PDP is ISR for 30 days). A row
 * someone has edited since is LEFT ALONE and listed. Never deleted: a chat may hang off one, and Law 122/2025 keeps rows a
 * year. The photos (`saigoncribs-uploaded-objects-<time>.txt`) may be removed only after their rows are stale.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { journalDirProblem, vndPerUsdFrom } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { countDistinctAngles } from '../src/lib/image-hash-url'
import { HOST_EDGE, imageVerdict, measureImage, type PhotoOutcome } from '../src/lib/import-photo-check'
import { ImportScreen } from '../src/lib/import-screen'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'
import { nhatotStartingRank } from '../src/lib/nhatot-listing'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, renderPartnerAvatar } from '../src/lib/partner-avatar'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { formatMoneyFull } from '../src/lib/vnd'
import {
  EXTERNAL_ID_PREFIX, SAIGONCRIBS_CANDIDATES, SAIGONCRIBS_CATEGORY_SLUG, SAIGONCRIBS_EMAIL, SAIGONCRIBS_HANDLE, SAIGONCRIBS_MAX_PHOTOS,
  SAIGONCRIBS_MIN_PHOTOS, SAIGONCRIBS_NAME, SAIGONCRIBS_PHOTO_FLOOR, mapSaigoncribsListing, orderedKeep, photoUses, photoVerdictProblem,
  readBodies, readPhotoVerdicts, readSaigoncribsRecords, saigoncribsExternalId, saigoncribsPhotoPlan, saigoncribsPhotoSlug,
  saigoncribsSellerRefusal, type BodyVerdict, type PhotoPlan, type PhotoVerdict, type SaigoncribsMapped, type SaigoncribsRecord,
  type SaigoncribsSeller,
} from '../src/lib/saigoncribs-listing'

// ─── arguments ──────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
/** ⛔ AN UNKNOWN FLAG IS AN ERROR — `--limt 5` silently meaning "no limit" is how a sample becomes a full write. */
const FLAGS = new Set(['--apply'])
const VALUED = new Set(['--journal-dir', '--identity-gate', '--research-dir', '--limit', '--only', '--rollback'])
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (FLAGS.has(a)) continue
  if (VALUED.has(a)) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); i++; continue }
  throw new Error(`unknown argument "${a}"`)
}
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const APPLY = argv.includes('--apply')
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
const ROLLBACK = str('--rollback')
const RESEARCH = resolve(str('--research-dir') ?? join(homedir(), 'eno-saigoncribs-2026-11-18'))
const LIMIT_RAW = str('--limit')
const LIMIT = LIMIT_RAW === null ? 0 : Number(LIMIT_RAW)
if (LIMIT_RAW !== null && (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > 1000)) throw new Error(`--limit must be a whole number 1–1000, not "${LIMIT_RAW}"`)
const ONLY = (str('--only') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
if (ONLY.some((x) => !/^\d{1,9}$/.test(x))) throw new Error('--only takes WordPress post ids, comma-separated (e.g. --only 14464,13538)')
if (LIMIT && ONLY.length) throw new Error('--limit and --only are two different samples — pass one')
if (GATE_ARG !== null && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error(`--identity-gate must be on or off, not "${GATE_ARG}"`)
// A rollback unpublishes and journals nothing new, so it needs neither (the printed rollback command must run as printed).
if (APPLY && !ROLLBACK && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir> (upload manifest + created rows)')
if (APPLY && !ROLLBACK && GATE_ARG === null) throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'

/** USD base (honeycomb-listing.ts vndPerUsdFrom: the VND-base feed was 1.3% off). */
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
/** The agency's own logo (2026-11-18): black on yellow, 2397² — the avatar when the account has none. */
const LOGO_FILE = join('_logos', 'logo-revised-black.png')
/** Kept candidates measured per listing: the cap plus spares for a refused or duplicate shot. */
const MEASURE_MAX = SAIGONCRIBS_MAX_PHOTOS + 4

// ─── journal ────────────────────────────────────────────────────────────────────────────────────
function fsyncDir(dir: string) { const fd = openSync(dir, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } }
/** Append + fsync, and the directory too the first time a file appears — a kill cannot lose the record. */
function recordDurably(file: string, line: string) {
  const isNew = !existsSync(file)
  const fd = openSync(file, 'a')
  try { writeSync(fd, `${line}\n`); fsyncSync(fd) } finally { closeSync(fd) }
  if (isNew) fsyncDir(dirname(resolve(file)))
}
/** A durable dir (not /tmp: macOS empties it on reboot and the journal is the only undo list), created and write-tested. */
function prepareJournalDir(dir: string): string {
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()].flatMap((p) => { try { return [p, realpathSync(p)] } catch { return [p] } })
  const abs = resolve(dir)
  const early = journalDirProblem(abs, roots)
  if (early) throw new Error(early)
  mkdirSync(abs, { recursive: true })
  const real = realpathSync(abs)
  const late = journalDirProblem(real, roots) // a symlink into /tmp is still /tmp
  if (late) throw new Error(late)
  if (!statSync(real).isDirectory()) throw new Error(`--journal-dir ${real} is not a directory`)
  const probe = join(real, `.saigoncribs-write-test-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return real
}
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex')
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

// ─── the research ───────────────────────────────────────────────────────────────────────────────
type Research = { recs: SaigoncribsRecord[]; photos: Record<string, PhotoVerdict>; bodies: Record<string, BodyVerdict>; readAt: Date }

/** data.json + the two verdict files. ⛔ Both verdict files are REQUIRED, and one naming a listing data.json lacks refuses. */
function readResearch(): Research {
  const dataFile = join(RESEARCH, 'data.json')
  const recs = readSaigoncribsRecords(JSON.parse(readFileSync(dataFile, 'utf8')))
  const need = (f: string) => {
    const p = join(RESEARCH, f)
    if (!existsSync(p)) throw new Error(`no ${f} in ${RESEARCH} — every listing's photos and text are read by a person before anything is published`)
    return JSON.parse(readFileSync(p, 'utf8')) as unknown
  }
  const photos = readPhotoVerdicts(need('photo-verdicts.json'))
  const bodies = readBodies(need('bodies.json'))
  const ids = new Set(recs.map((r) => String(r.id)))
  for (const [f, v] of [['photo-verdicts.json', photos], ['bodies.json', bodies]] as const) {
    const stray = Object.keys(v).filter((id) => !ids.has(id))
    if (stray.length) throw new Error(`${f} judges listing(s) data.json does not have (${stray.slice(0, 5).join(', ')}) — written for another read; nothing done`)
  }
  return { recs, photos, bodies, readAt: statSync(dataFile).mtime }
}

/** photos/<post id>/<nn>.<ext> — exactly one file for photo n, or null. */
function photoFile(postId: number, n: number): string | null {
  const dir = join(RESEARCH, 'photos', String(postId))
  if (!existsSync(dir)) return null
  const prefix = `${String(n).padStart(2, '0')}.`
  const hits = readdirSync(dir).filter((f) => f.startsWith(prefix) && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(f))
  return hits.length === 1 ? join(dir, hits[0]) : null
}

/** The FX rate, read ONCE. ⛔ FAIL CLOSED: no plausible rate, no run — a guessed rate mis-prices every row. */
async function readFx(): Promise<{ vndPerUsd: number; updated: string }> {
  let res: Response
  try {
    res = await fetch(FX_URL, { headers: { accept: 'application/json', 'user-agent': 'eno-import/1.0 (+https://eno.vn)' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  } catch (e) { throw new Error(`${FX_URL} unreachable (${(e as Error).message}) — no rate, no import`) }
  if (!res.ok) throw new Error(`${FX_URL} answered HTTP ${res.status} — no rate, no import`)
  let json: unknown = null
  try { json = await res.json() } catch { /* null → refused below */ }
  const r = vndPerUsdFrom(json)
  if (r === null) throw new Error(`no plausible VND/USD rate from ${FX_URL} — no import`)
  return { vndPerUsd: r, updated: (json as { time_last_update_utc?: string }).time_last_update_utc ?? '?' }
}

// ─── the database ───────────────────────────────────────────────────────────────────────────────
function openDb(write: boolean) {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  // ⛔ A dry run is read-only at the database: a bug that reaches a write fails.
  return new PrismaClient({ adapter: new PrismaPg(write ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
}
type Db = ReturnType<typeof openDb>
async function resolveSeller(db: Db) {
  const h = await db.handle.findUnique({ where: { handle: SAIGONCRIBS_HANDLE }, select: { sellerId: true } })
  const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, avatarUrl: true, owner: { select: { email: true, createdAt: true } } } }) : null
  const seller: SaigoncribsSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore } : null
  return { seller, createdAt: s?.owner?.createdAt ?? null, avatarUrl: s?.avatarUrl ?? null }
}
async function gateDecision(db: Db, seller: SaigoncribsSeller, createdAt: Date | null): Promise<SellerPublishDecision> {
  const decision = decideBeforeStatus({ enforced: GATE_ENFORCED, ownerId: seller.ownerId, accountCreatedAt: createdAt, now: new Date() })
  if (decision) return decision
  const rows = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
    FROM identity_verifications WHERE "profileId" = ${seller.ownerId}::uuid ORDER BY "submittedAt" DESC`
  return decideOwned(deriveVerification(rows, new Date()).status, createdAt, new Date())
}

// ─── rollback ───────────────────────────────────────────────────────────────────────────────────
type JournalLine = { planned?: string; id?: string; externalId?: string; updatedAt?: string; at?: string }
async function rollback(path: string) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as JournalLine)
  const made = lines.filter((l) => l.id)
  if (made.some((l) => !/^c[a-z0-9]{20,30}$/.test(l.id!) || !l.externalId?.startsWith(EXTERNAL_ID_PREFIX) || !l.updatedAt || !Number.isFinite(Date.parse(l.updatedAt)))) throw new Error(`${path}: a malformed created-row line — refusing`)
  if (lines.some((l) => !l.id && !l.planned?.startsWith(EXTERNAL_ID_PREFIX))) throw new Error(`${path}: a line that is neither a plan nor a created row — not a saigoncribs journal; refusing`)
  // A plan with no created line: the run died between the two (or the write failed). Found by its key, below.
  const plannedOnly = lines.filter((l) => l.planned && !made.some((m) => m.externalId === l.planned))
  const db = openDb(APPLY)
  try {
    const { seller } = await resolveSeller(db)
    if (!seller) throw new Error(`no "${SAIGONCRIBS_HANDLE}" storefront — nothing to roll back`)
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — rollback of ${made.length} created row(s) (+ ${plannedOnly.length} planned with no id line) on ${seller.id}`)
    type Target = { id: string; externalId: string; updatedAt: Date }
    const targets: Target[] = made.map((l) => ({ id: l.id!, externalId: l.externalId!, updatedAt: new Date(l.updatedAt!) }))
    for (const l of plannedOnly) {
      const row = await db.listing.findUnique({ where: { sellerId_externalId: { sellerId: seller.id, externalId: l.planned! } }, select: { id: true, status: true, createdAt: true, updatedAt: true } })
      if (!row) { console.log(`  ${l.planned}: planned, never created`); continue }
      // ⚠️ Only a row nobody has edited since it was made (its updatedAt still at its creation): its creation time is not
      // in the journal, so an edit would be indistinguishable from the create.
      if (row.updatedAt.getTime() - row.createdAt.getTime() > 5000 || row.createdAt.getTime() < Date.parse(l.at ?? '') - 60_000) {
        console.log(`  ${l.planned} → ${row.id}: planned with no id line and changed since (or older than the plan) — LEFT ALONE, check it by hand`)
        continue
      }
      targets.push({ id: row.id, externalId: l.planned!, updatedAt: row.updatedAt })
    }
    const now = await db.listing.findMany({ where: { id: { in: targets.map((t) => t.id) }, sellerId: seller.id }, select: { id: true, status: true, updatedAt: true } })
    const cur = new Map(now.map((r) => [r.id, r]))
    const ok = targets.filter((t) => { const r = cur.get(t.id); return r && r.status === 'active' && r.updatedAt.getTime() === t.updatedAt.getTime() })
    for (const t of targets.filter((x) => !ok.includes(x))) {
      const r = cur.get(t.id)
      console.log(`  ${t.externalId} → ${t.id}: ${r ? `${r.status}, updated ${r.updatedAt.toISOString()}` : 'not on this storefront'} — changed since the run, LEFT ALONE`)
    }
    console.log(`  ${ok.length} still exactly as the run made them → 'stale'`)
    if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); return }
    const moved: string[] = []
    for (const t of ok) {
      // ⛔ Guarded on the state the run left (still active, the updatedAt it was created with), on this storefront only.
      const w = await db.listing.updateMany({ where: { id: t.id, sellerId: seller.id, status: 'active', updatedAt: t.updatedAt }, data: { status: 'stale' } })
      if (w.count === 1) moved.push(t.id)
    }
    for (let i = 0; i < moved.length; i += 500) console.log(`  PDP tombstones: ${await tombstonePdps(db, moved.slice(i, i + 500))}`)
    console.log(`STALE ${moved.length} of ${ok.length}. NEXT: Cloudflare tag purge {"tags":["eno-html","eno-public"]} on both zones; the photos in the run's saigoncribs-uploaded-objects-*.txt may go now.`)
  } finally { await db.$disconnect() }
}

// ─── photos ─────────────────────────────────────────────────────────────────────────────────────
type Judged = { n: number; shared: boolean; outcome: PhotoOutcome; hash: string | null; file: string | null }
/** Measure a listing's kept files in display order (orderedKeep), stopping once MEASURE_MAX real ones are in hand. */
async function judgePhotos(rec: SaigoncribsRecord, v: PhotoVerdict, uses: ReadonlyMap<string, number>): Promise<{ judged: Judged[]; plan: PhotoPlan }> {
  const judged: Judged[] = []
  for (const { n, shared } of orderedKeep(rec, v, uses)) {
    if (judged.filter((j) => j.outcome === 'ok').length >= MEASURE_MAX) break
    const file = photoFile(rec.id, n)
    if (!file) { judged.push({ n, shared, outcome: 'fetchFailed', hash: null, file: null }); continue }
    const m = await measureImage(readFileSync(file))
    judged.push({ n, shared, outcome: imageVerdict(m, SAIGONCRIBS_PHOTO_FLOOR), hash: m?.hash ?? null, file })
  }
  return { judged, plan: saigoncribsPhotoPlan(judged) }
}

// ─── main ───────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (ROLLBACK) return rollback(ROLLBACK)
  /** ⛔ FIRST on --apply, before the network, the DB or storage. */
  const journal = APPLY ? prepareJournalDir(JOURNAL_DIR!) : null
  const research = readResearch()
  const ageH = (Date.now() - research.readAt.getTime()) / 3_600_000
  console.log(`research          ${RESEARCH} — ${research.recs.length} listings (data.json ${research.readAt.toISOString()}, ${ageH.toFixed(0)} h old) · ${Object.keys(research.photos).length} photo verdicts · ${Object.keys(research.bodies).length} bodies`)
  if (ageH > 72) console.log(`  ⚠️ the research is over 72 h old: listings may have been let since — re-read before a full --apply`)
  if (ONLY.length) {
    const missing = ONLY.filter((id) => !research.recs.some((r) => String(r.id) === id))
    if (missing.length) throw new Error(`--only names post(s) data.json does not have: ${missing.join(', ')}`)
  }
  const fx = await readFx()
  console.log(`FX                ${formatMoneyFull(fx.vndPerUsd, '₫', 'en')} per US$ (${FX_URL}, updated ${fx.updated}) — every price this run converts at this one rate`)

  const db = openDb(APPLY)
  let created = 0, failed = 0, leftOut = 0
  const photoIds: string[] = []
  try {
    const category = await db.category.findUnique({ where: { slug: SAIGONCRIBS_CATEGORY_SLUG }, select: { id: true } })
    if (!category) throw new Error(`no ${SAIGONCRIBS_CATEGORY_SLUG} category`)
    const { seller, createdAt, avatarUrl } = await resolveSeller(db)
    const refusal = saigoncribsSellerRefusal(seller)
    console.log(`storefront        ${refusal ?? `${seller!.id} · ${SAIGONCRIBS_EMAIL} · official partner · trust ${seller!.trustScore}`}`)
    const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: EXTERNAL_ID_PREFIX } }, select: { externalId: true } }) : []
    const have = new Set(existing.map((x) => x.externalId))

    // ── map every listing; report every drop and hold with its evidence ──
    const now = Date.now()
    const scope = ONLY.length ? research.recs.filter((r) => ONLY.includes(String(r.id))) : research.recs
    const mapped: { rec: SaigoncribsRecord; m: SaigoncribsMapped }[] = []
    const refused: Record<string, string[]> = {}
    const note = (key: string, line: string) => { (refused[key] ??= []).push(line) }
    let skipped = 0
    const verdictProblems: string[] = []
    for (const rec of scope) {
      if (have.has(saigoncribsExternalId(rec.id))) { skipped++; continue }
      const r = mapSaigoncribsListing(rec, { vndPerUsd: fx.vndPerUsd, now, body: research.bodies[String(rec.id)] })
      if (!r.ok) { note(`${r.kind} ${r.reason}`, `${rec.id}  ${r.detail}`); continue }
      const pv = research.photos[String(rec.id)]
      if (!pv) { note('hold noPhotoVerdict', `${rec.id}  no entry in photo-verdicts.json`); continue }
      // ⛔ A verdict that does not cover this gallery exactly REFUSES THE RUN (below): it was written for another read.
      const problem = photoVerdictProblem(rec, pv)
      if (problem) { verdictProblems.push(problem); continue }
      if (pv.hold) { note('hold photoHold', `${rec.id}  ${pv.hold}`); continue }
      mapped.push({ rec, m: r.mapped })
    }
    if (verdictProblems.length) {
      console.error(`⛔ photo-verdicts.json does not match the galleries it judges — ${APPLY ? 'nothing written' : 'an --apply would refuse'}:\n  ${verdictProblems.join('\n  ')}`)
      if (APPLY) throw new Error('photo-verdicts.json disagrees with data.json — fix it and re-run')
      process.exitCode = 1
    }
    console.log(`listings          ${scope.length}${ONLY.length ? ' (--only)' : ''} · ${skipped} already on the storefront (skipped, create-only) · ${mapped.length} mapped`)
    for (const [k, rows] of Object.entries(refused).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${k.padEnd(28)} ${rows.length}`)
      for (const l of rows) console.log(`      ${l}`)
    }
    const overrides = mapped.filter(({ m }) => m.place.overrode)
    console.log(`building overrides ${overrides.length} (the building's district over the agency's region tag)`)
    for (const { rec, m } of overrides) console.log(`      ${rec.id}  ${m.place.overrode} → ${m.row.district}  (${m.place.buildingNames.join(' + ')})`)
    const ambiguous = mapped.filter(({ m }) => m.place.buildingNames.length > 1)
    if (ambiguous.length) console.log(`  ${ambiguous.length} name two buildings (no pin, district agreed): ${ambiguous.map(({ rec, m }) => `${rec.id} ${m.place.buildingNames.join('+')}`).join(' · ')}`)

    // ── the content screen every importer runs (banned words, advertising-banned goods) ──
    const screen = new ImportScreen('saigoncribs', { db, ...(journal ? { dir: journal } : {}) })
    const screened: typeof mapped = []
    for (const x of mapped) {
      const t = x.m.row
      if (await screen.check({ title: t.title, titleVi: t.titleVi, description: t.description, descriptionVi: null, category: SAIGONCRIBS_CATEGORY_SLUG, subcategory: t.subcategorySlug, merchant: SAIGONCRIBS_NAME, extraTexts: [t.location, t.district], externalId: t.externalId, url: null }, null)) screened.push(x)
    }
    screen.report()

    // ── photos: every kept file measured now, dry run and apply alike, so the dry run's counts are the apply's ──
    const uses = photoUses(research.recs)
    type Todo = { rec: SaigoncribsRecord; m: SaigoncribsMapped; judged: Judged[]; plan: PhotoPlan }
    const todo: Todo[] = []
    const photoOut: string[] = []
    const missingFiles: string[] = []
    for (const { rec, m } of screened) {
      if (LIMIT && todo.length >= LIMIT) break
      const { judged, plan } = await judgePhotos(rec, research.photos[String(rec.id)], uses)
      for (const j of judged) if (!j.file) missingFiles.push(`${rec.id}/${String(j.n).padStart(2, '0')}`)
      const refusedTxt = Object.entries(plan.refused).map(([k, c]) => `${c} ${k}`).join(', ')
      const line = `${String(rec.id).padEnd(6)} ${String(plan.keep.length).padStart(2)} photos${plan.duplicates ? ` (−${plan.duplicates} dup)` : ''}${refusedTxt ? ` (refused: ${refusedTxt})` : ''}  ${m.row.title}`
      if (plan.decision !== 'create') { leftOut++; photoOut.push(`${line}  — LEFT OUT: ${plan.decision === 'noOwnPhoto' ? 'no photo of the unit itself, only building shots' : `fewer than ${SAIGONCRIBS_MIN_PHOTOS} real distinct photos`}`); continue }
      photoOut.push(line)
      todo.push({ rec, m, judged, plan })
    }
    console.log(`\nphotos            (kept of the first ${SAIGONCRIBS_CANDIDATES}, at most ${SAIGONCRIBS_MAX_PHOTOS}, ≥ ${SAIGONCRIBS_MIN_PHOTOS} distinct)`)
    for (const l of photoOut) console.log(`  ${l}`)
    // ⛔ A KEPT photo with no file under photos/ is research not yet complete (the download), not a photo to skip: the
    // person's verdict is honoured whole or the run waits.
    if (missingFiles.length) {
      console.error(`⛔ ${missingFiles.length} kept photo(s) have no file under ${join(RESEARCH, 'photos')}: ${missingFiles.slice(0, 12).join(', ')}${missingFiles.length > 12 ? ' …' : ''}`)
      if (APPLY) throw new Error('the photo files are incomplete — nothing written')
      process.exitCode = 1
    }

    // ── the plan, in numbers ──
    const hist = (f: (t: Todo) => string) => Object.entries(todo.reduce<Record<string, number>>((a, t) => { const k = f(t); a[k] = (a[k] ?? 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
    console.log(`\nTO CREATE         ${todo.length}${LIMIT ? ` (--limit ${LIMIT})` : ''} · left out on photos ${leftOut}`)
    if (todo.length) {
      console.log(`  by aisle        ${hist((t) => `${t.m.row.subcategorySlug} ${t.m.row.priceUnit}`)}`)
      console.log(`  by district     ${hist((t) => t.m.row.location)}`)
      console.log(`  pinned          ${todo.filter((t) => t.m.row.buildingKey).length} on a map building · ${todo.filter((t) => !t.m.row.buildingKey).length} unpinned (no single building named)`)
      for (const period of ['month', 'night', 'day'] as const) {
        const xs = todo.filter((t) => t.m.period === period)
        if (!xs.length) continue
        const lo = xs.reduce((a, b) => (b.m.usd < a.m.usd ? b : a)), hi = xs.reduce((a, b) => (b.m.usd > a.m.usd ? b : a))
        console.log(`  per ${period.padEnd(5)}       ${xs.length}: US$${lo.m.usd} → ${formatMoneyFull(lo.m.row.price, '₫', 'en')} … US$${hi.m.usd} → ${formatMoneyFull(hi.m.row.price, '₫', 'en')}`)
      }
      const dates = todo.map((t) => t.m.postedAt.getTime()).sort((a, b) => a - b)
      console.log(`  posted          ${new Date(dates[0]).toISOString().slice(0, 10)} → ${new Date(dates[dates.length - 1]).toISOString().slice(0, 10)} (postedAt = the agency's own date; rank from it)`)
    }

    // ── the logo, read and measured now: a missing or blank one must not stop a run halfway ──
    const logoPath = join(RESEARCH, LOGO_FILE)
    if (!existsSync(logoPath)) throw new Error(`no ${LOGO_FILE} in the research — nothing written`)
    const logo = await renderPartnerAvatar(readFileSync(logoPath))
    console.log(`logo              ${LOGO_FILE}: ${logo.visiblePct.toFixed(1)}% visible on white (floor ${PARTNER_AVATAR_MIN_VISIBLE_PCT}%) · ${avatarUrl ? 'the account already has an avatar — kept' : 'set as the avatar at --apply'}`)

    if (!APPLY) {
      for (const t of todo.slice(0, 2)) {
        console.log(`\n── ${t.m.row.externalId} (as create would store it, photos ${t.plan.keep.join(', ')}) ──`)
        console.log(JSON.stringify({ ...t.m.row, description: undefined, postedAt: t.m.postedAt.toISOString() }, null, 2))
        console.log(t.m.row.description)
      }
      if (GATE_ARG !== null && seller && !refusal) console.log(`\nidentity gate     ${GATE_ENFORCED ? 'ON' : 'off'} → ${(await gateDecision(db, seller, createdAt)).ok ? 'may publish' : 'REFUSED — an --apply would write nothing'}`)
      console.log('\nDRY RUN — nothing written, nothing uploaded.')
      if (refusal) process.exitCode = 1
      return
    }

    // ─── APPLY ────────────────────────────────────────────────────────────────────────────────
    /** ⛔ Before storage is even opened: no upload for a storefront we will not write to. */
    if (refusal) throw new Error(refusal)
    const storageUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    // ⛔ The retired hosted project (set-partner-listing-cover.ts, import-goplus.ts): a photo there would die with it.
    if (/supabase\.co$/.test(new URL(storageUrl).hostname)) throw new Error(`refusing to upload to ${storageUrl} — retired project`)
    // ⛔ THE GATE, once, before any upload (the header).
    const decision = await gateDecision(db, seller!, createdAt)
    console.log(`\nidentity gate     ${GATE_ENFORCED ? 'ON' : 'off'} (--identity-gate ${GATE_ARG}) → ${decision.ok ? 'may publish' : `REFUSED (${decision.code})`}`)
    if (!decision.ok) { console.warn('  ⛔ nothing written'); process.exitCode = 1; return }

    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })
    const t = stamp()
    const CREATED = join(journal!, `saigoncribs-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal!, `saigoncribs-uploaded-objects-${t}.txt`)
    console.log(`journal           ${CREATED}\nupload manifest   ${UPLOADED}`)

    try {
      for (const { rec, m, judged, plan } of todo) {
        const urls: string[] = []
        let uploadFailed = false
        for (const n of plan.keep) {
          const file = judged.find((j) => j.n === n)!.file!
          const body = readFileSync(file)
          let url: string | null = null
          for (let attempt = 0; attempt < 3 && !url; attempt++) {
            if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt))
            url = await host.fromBuffer(body, saigoncribsPhotoSlug(sha1(body)))
          }
          if (!url) { uploadFailed = true; break }
          /** Listed BEFORE its row is written, so an object a later failure orphans is on the cleanup list. */
          recordDurably(UPLOADED, url)
          urls.push(url)
        }
        if (uploadFailed) { failed++; console.warn(`  ⛔ ${rec.id}: an upload failed — not created`); continue }
        /** The publish gate's own count, on the dHash each stored URL carries — the last word. */
        if (countDistinctAngles(urls) < SAIGONCRIBS_MIN_PHOTOS) { failed++; console.warn(`  ⛔ ${rec.id}: only ${countDistinctAngles(urls)} distinct photos hosted — not created`); continue }
        /** The INTENT, fsynced BEFORE the write: a kill between the two leaves the externalId on the undo list. */
        recordDurably(CREATED, JSON.stringify({ planned: m.row.externalId, at: new Date().toISOString() }))
        const at = Date.now()
        const made = await db.listing.create({
          data: {
            ...m.row, categoryId: category.id, sellerId: seller!.id,
            // ⛔ `verified` is the publication gate (feed-query pins it), asked above; the badge is Seller.verified.
            status: 'active', verified: true,
            images: JSON.stringify(urls),
            // ⛔ The agency's own date, and the rank it earns (never a fresh-post boost for old stock); createdAt is the
            // row's real arrival and is never written (stale.ts listedAt).
            postedAt: m.postedAt, rankScore: nhatotStartingRank(m.postedAt, seller!.trustScore, at),
            availabilityConfirmedAt: new Date(at),
            sellerTrustScore: seller!.trustScore,
          },
          select: { id: true, updatedAt: true },
        })
        recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: m.row.externalId, updatedAt: made.updatedAt.toISOString(), at: new Date().toISOString() }))
        created++; photoIds.push(made.id)
        console.log(`  created ${made.id}  ${m.row.title}  (${urls.length} photos)`)
      }
    } finally {
      // A throw out of the loop still queues the rows already written for the photo check (listing-photo-queue.test.ts).
      if (APPLY) await enqueuePhotoChecks(db, photoIds.splice(0))
    }

    // The agency's logo, unless the account has set one: the same render and floor as scripts/set-partner-avatar.ts.
    if (!avatarUrl) {
      if (logo.visiblePct < PARTNER_AVATAR_MIN_VISIBLE_PCT) { failed++; console.warn(`  ! logo only ${logo.visiblePct.toFixed(1)}% visible on white: the storefront keeps its initials`) } else {
        const name = `partner/avatar-${seller!.id}-${Date.now().toString(36)}.webp`
        const { error } = await sb.storage.from('listings').upload(name, logo.out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
        if (error) { failed++; console.warn(`  ! logo upload failed: ${error.message}`) } else {
          recordDurably(UPLOADED, name)
          await db.seller.updateMany({ where: { id: seller!.id, avatarUrl: null }, data: { avatarUrl: `${storageUrl}/storage/v1/object/public/listings/${name}` } })
          console.log(`  avatar       ${name}`)
        }
      }
    }

    console.log(`\ncreated ${created} · left out (photos) ${leftOut} · failed ${failed}`)
    console.log(`ROLLBACK: npx tsx scripts/import-saigoncribs.ts --rollback ${CREATED}   (dry; then --apply)`)
    // Run BEFORE the deploy that puts the shop on the home strip: an empty storefront 404s (import-car-partners.ts).
    console.log('NEXT: Cloudflare tag purge {"tags":["eno-html","eno-public"]} on both zones, Reach › Translations › Run now (the Vietnamese descriptions), then check one row\'s /vi page.')
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
