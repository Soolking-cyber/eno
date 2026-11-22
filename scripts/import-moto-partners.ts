/**
 * eno's motorbike rental partners (src/lib/moto-partners.ts) → their own storefronts: The Extra Mile's bikes and Saigon
 * Scooter Centre's one scooter listing, created ONCE.
 *
 * What is written and why: src/lib/moto-partners.ts. This file is the I/O around it, after scripts/import-car-partners.ts.
 *
 *   DRY (reads the research and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-moto-partners.ts all
 *   WRITE (journal first):
 *     … scripts/import-moto-partners.ts <theextramile|saigonscootercentre|all> --journal-dir <durable dir> --identity-gate on|off --apply
 *   --research-dir <dir>  defaults to ~/eno-moto-partners-2026-11-22 (<research>/data.json, photos/, photo-verdicts.json,
 *                         raw/logo/logo.{webp,png} per shop)
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB. After this run the listings belong to the account eno's admin signs in with. A listing whose
 * row exists is SKIPPED, whatever it now says, so a re-run never overwrites an admin's edit. Nothing schedules this file.
 *
 * ⛔ PHOTOS: only those photo-verdicts.json keeps (looked at one by one on 2026-11-22: another shop's watermark, a
 * measurement overlay, a face, another model, a near-duplicate → dropped), the verdict's cover first. A listing left with
 * fewer than the category's floor (3, publish-guard.ts) is NOT written: an admin's edit could never pass it again.
 *
 * ⛔ THE DOLLAR RATE IS READ ONCE, FAIL CLOSED (no plausible rate, no run), and every converted price and its text use it.
 *
 * ⛔ THE SELLER IDENTITY GATE, as import-car-partners.ts: asked once per storefront before anything is uploaded;
 * --identity-gate states production's IDENTITY_GATE_ENFORCED, which this machine cannot read.
 *
 * ⚠️ A run that dies between a create and the storefront's queue call leaves those rows unqueued for the photo check, and a
 * re-run skips them: their ids are in the journal (one line each, written right after the create) — queue them by hand.
 *
 * Undo (journal `moto-partners-created-rows-<time>.jsonl`): set those rows' status to 'stale' and tombstone their pages
 * (pdp-tombstone.ts; a PDP is ISR for 30 days). Never delete: a chat may hang off one.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { SHARED_SEAT_SELLERS } from '../src/lib/feed-diversity'
import { journalDirProblem, vndPerUsdFrom } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'
import {
  EXTRA_MILE_BIKES, MOTO_PARTNERS, SSC_SLUG, extraMileResearchProblem, motoPartnerSellerRefusal, sscResearchProblem,
  stageExtraMileBike, stageSscListing, type Fx, type MotoPartner, type MotoPartnerRow, type MotoPartnerSeller, type ResearchBike,
} from '../src/lib/moto-partners'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, renderPartnerAvatar } from '../src/lib/partner-avatar'
import { minPhotosFor } from '../src/lib/publish-guard'
import { browseRankScore } from '../src/lib/ranking-formula'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const WHICH = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--')) ?? null
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
const RESEARCH = resolve(str('--research-dir') ?? join(homedir(), 'eno-moto-partners-2026-11-22'))
if (!WHICH || (WHICH !== 'all' && !MOTO_PARTNERS.some((p) => p.handle === WHICH))) {
  throw new Error(`name a shop or all: ${MOTO_PARTNERS.map((p) => p.handle).join(' | ')} | all`)
}
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
const SEAT = 'moto-partners'
/** A listing shows its first photos; more than this adds weight, not information. */
const MAX_PHOTOS = 6
/** ⛔ The category's own floor (3 distinct for rentals), as import-car-partners.ts: an admin's edit re-checks it. */
const MIN_PHOTOS = minPhotosFor('rentals')
const PHOTO_FLOOR = { minShortEdge: 300 }
/** USD base (honeycomb-listing.ts vndPerUsdFrom: the VND-base feed was 1.3% off), as import-saigoncribs.ts. */
const FX_URL = 'https://open.er-api.com/v6/latest/USD'

type Verdicts = Record<string, { cover: string; photos: Record<string, { keep: boolean; why?: string }> }>
/** One listing to write: its row, and where its photos are (research photos/<folder>/). */
type Item = { row: MotoPartnerRow; folder: string }

/** The FX rate, read ONCE. ⛔ FAIL CLOSED: no plausible rate, no run — a guessed rate mis-prices every converted row. */
async function readFx(): Promise<Fx & { updated: string }> {
  let res: Response
  try {
    res = await fetch(FX_URL, { headers: { accept: 'application/json', 'user-agent': 'eno-import/1.0 (+https://eno.vn)' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  } catch (e) { throw new Error(`${FX_URL} unreachable (${(e as Error).message}) — no rate, no import`) }
  if (!res.ok) throw new Error(`${FX_URL} answered HTTP ${res.status} — no rate, no import`)
  let json: unknown = null
  try { json = await res.json() } catch { /* null → refused below */ }
  const r = vndPerUsdFrom(json)
  if (r === null) throw new Error(`no plausible VND/USD rate from ${FX_URL} — no import`)
  // The day in Vietnam (UTC+7), as the text prints it.
  const d = new Date(Date.now() + 7 * 3_600_000)
  const dayEn = `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
  const dayVi = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
  return { vndPerUsd: Math.round(r), dayEn, dayVi, updated: (json as { time_last_update_utc?: string }).time_last_update_utc ?? '?' }
}

/** What this shop's research says to write, checked against the module: a moved price stops the whole run. */
function itemsFor(p: MotoPartner, fx: Fx): Item[] {
  const data = JSON.parse(readFileSync(join(RESEARCH, p.research, 'data.json'), 'utf8')) as { bikes?: ResearchBike[]; scooters?: { key: string; perDayUsd: number }[] }
  if (p.handle === 'saigonscootercentre') {
    const problem = sscResearchProblem(data.scooters)
    if (problem) throw new Error(`the research disagrees — nothing written:\n  ${problem}`)
    return [{ row: stageSscListing(fx), folder: SSC_SLUG }]
  }
  const problems = EXTRA_MILE_BIKES.map((b) => extraMileResearchProblem(b, data.bikes?.find((r) => r.slug === b.slug))).filter(Boolean)
  if (problems.length) throw new Error(`the research disagrees — nothing written:\n  ${problems.join('\n  ')}`)
  return EXTRA_MILE_BIKES.map((b) => ({ row: stageExtraMileBike(b, fx), folder: b.slug }))
}

function readVerdicts(p: MotoPartner): Verdicts {
  const f = join(RESEARCH, p.research, 'photo-verdicts.json')
  if (!existsSync(f)) throw new Error(`${p.handle}: no photo-verdicts.json in ${join(RESEARCH, p.research)} — every photo is looked at before it is published`)
  return JSON.parse(readFileSync(f, 'utf8')) as Verdicts
}

/**
 * Every photo file a listing may show: its verdict's cover first, then every other kept photo in file order. NOT capped
 * here: the cap applies to photos that pass the decode/size check, so a bad file among the first six never costs a listing
 * its floor while good ones wait behind it (commit-gate review, Opus 2026-11-22).
 */
function keptPhotos(p: MotoPartner, v: Verdicts, folder: string): string[] {
  const entry = v[folder]
  if (!entry) throw new Error(`${p.handle}:${folder}: no photo verdicts — look at its photos first`)
  const kept = Object.entries(entry.photos).filter(([, x]) => x.keep).map(([f]) => f).sort()
  if (!kept.includes(entry.cover)) throw new Error(`${p.handle}:${folder}: the cover ${entry.cover} is not a kept photo`)
  return [entry.cover, ...kept.filter((f) => f !== entry.cover)].map((f) => join(RESEARCH, p.research, 'photos', folder, f))
}

/** The first MAX_PHOTOS kept photos that decode and clear the size floor — what the run would host. Read-only. */
async function passingPhotos(files: string[]): Promise<{ file: string; body: Buffer }[]> {
  const out: { file: string; body: Buffer }[] = []
  for (const file of files) {
    if (out.length >= MAX_PHOTOS) break
    const body = readFileSync(file)
    const verdict = imageVerdict(await measureImage(body), PHOTO_FLOOR)
    if (verdict === 'undecodable' || verdict === 'tooSmall') { console.warn(`  ! ${verdict} ${file}`); continue }
    out.push({ file, body })
  }
  return out
}

function logoFile(p: MotoPartner): string | null {
  for (const f of ['logo.webp', 'logo.png']) { const path = join(RESEARCH, p.research, 'raw', 'logo', f); if (existsSync(path)) return path }
  return null
}

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, `${line}\n`); fsyncSync(fd) } finally { closeSync(fd) }
}

function prepareJournalDir(dir: string): string {
  const abs = resolve(dir)
  mkdirSync(abs, { recursive: true })
  const real = realpathSync(abs)
  const problem = journalDirProblem(real, ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()])
  if (problem) throw new Error(problem)
  return real
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  // ⛔ A dry run is read-only at the database: a bug that reaches a write fails.
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  const partners = MOTO_PARTNERS.filter((p) => WHICH === 'all' || p.handle === WHICH)
  let created = 0, failed = 0, skippedNoPhoto = 0
  const photoIds: string[] = []
  try {
    const fx = await readFx()
    console.log(`FX           ${fx.vndPerUsd} đ per US$ (${FX_URL}, updated ${fx.updated}) — every converted price this run uses it`)
    const category = await db.category.findUnique({ where: { slug: 'rentals' }, select: { id: true } })
    if (!category) throw new Error('no rentals category')

    // Everything is checked for every shop before anything is written for any.
    const plans: { p: MotoPartner; v: Verdicts; seller: MotoPartnerSeller | null; createdAt: Date | null; avatarUrl: string | null; todo: Item[] }[] = []
    for (const p of partners) {
      const items = itemsFor(p, fx)
      const v = readVerdicts(p)
      const h = await db.handle.findUnique({ where: { handle: p.handle }, select: { sellerId: true } })
      const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, location: true, avatarUrl: true, owner: { select: { email: true, createdAt: true } } } }) : null
      const seller: MotoPartnerSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore, location: s.location } : null
      const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: `${p.handle}:` } }, select: { externalId: true } }) : []
      const have = new Set(existing.map((x) => x.externalId))
      const todo = items.filter((i) => !have.has(i.row.externalId))
      // The logo is checked now, before any listing is written for any shop: a missing file must not stop a run halfway.
      if (!logoFile(p)) throw new Error(`${p.handle}: no raw/logo/logo.{webp,png} in the research — nothing written`)
      // ⛔ AND IN THE FEED'S SHARED SEAT (feed-diversity.ts 'moto-partners'): a storefront outside it takes a home-feed seat of
      // its own for every listing written at once (the car partners' plan review, Opus 2026-11-17).
      const refusal = motoPartnerSellerRefusal(p, seller) ?? (seller && !SHARED_SEAT_SELLERS[SEAT]?.includes(seller.id)
        ? `the "${p.handle}" storefront (${seller.id}) is not in feed-diversity.ts's '${SEAT}' seat — add its id first` : null)
      console.log(`\n${p.name} (/${p.handle})`)
      console.log(`  storefront   ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)
      console.log(`  listings     ${items.length} in the module · ${have.size} already written (skipped) · ${todo.length} to create`)
      for (const i of todo) {
        // Measured as the write would (decode + size floor), so the dry run's count is the run's.
        const n = (await passingPhotos(keptPhotos(p, v, i.folder))).length
        console.log(`    ${i.row.title.slice(0, 58).padEnd(58)} ${String(i.row.price).padStart(10)} ${i.row.priceUnit.padEnd(9)} ${n >= MIN_PHOTOS ? `${n} photos` : `only ${n} usable — left out`}`)
      }
      plans.push({ p, v, seller, createdAt: s?.owner?.createdAt ?? null, avatarUrl: s?.avatarUrl ?? null, todo })
    }
    const refused = plans.map(({ p, seller }) => motoPartnerSellerRefusal(p, seller)
      ?? (seller && !SHARED_SEAT_SELLERS[SEAT]?.includes(seller.id) ? `${p.handle}: not in the '${SEAT}' feed seat` : null)).filter(Boolean)
    if (!APPLY) { console.log('\nDRY RUN — nothing written.'); if (refused.length) process.exitCode = 1; return }
    if (refused.length) throw new Error(refused.join('\n'))

    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })
    const journal = prepareJournalDir(JOURNAL_DIR!)
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    const CREATED = join(journal, `moto-partners-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `moto-partners-uploaded-objects-${t}.txt`)
    console.log(`\njournal      ${CREATED}`)

    for (const { p, v, seller, createdAt, avatarUrl, todo } of plans) {
      // ⛔ THE GATE, once per storefront, before any upload (the header).
      let decision: SellerPublishDecision | null = decideBeforeStatus({ enforced: GATE_ENFORCED, ownerId: seller!.ownerId, accountCreatedAt: createdAt, now: new Date() })
      if (!decision) {
        const rows = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
          FROM identity_verifications WHERE "profileId" = ${seller!.ownerId}::uuid ORDER BY "submittedAt" DESC`
        decision = decideOwned(deriveVerification(rows, new Date()).status, createdAt, new Date())
      }
      console.log(`\n${p.name}: identity gate ${GATE_ENFORCED ? 'ON' : 'off'} → ${decision.ok ? 'may publish' : `REFUSED (${decision.code})`}`)
      if (!decision.ok) { failed += todo.length; console.warn(`  ⛔ nothing written for ${p.handle}`); continue }

      const createdBefore = created
      try {
        for (const { row, folder } of todo) {
          const files = await passingPhotos(keptPhotos(p, v, folder))
          if (files.length < MIN_PHOTOS) { skippedNoPhoto++; continue }
          const urls: string[] = []
          for (const { file, body } of files) {
            const url = await host.fromBuffer(body, `${p.handle}-${sha1(body).slice(0, 16)}`)
            if (url) { recordDurably(UPLOADED, url); urls.push(url) } else console.warn(`  ! ${folder}: upload failed ${file}`)
          }
          const distinct = [...new Set(urls)] // the host keys a photo by its bytes: the same shot twice is one URL
          if (distinct.length < MIN_PHOTOS) { failed++; console.warn(`  ⛔ ${folder}: only ${distinct.length} distinct photos hosted, not created`); continue }
          recordDurably(CREATED, JSON.stringify({ planned: row.externalId, at: new Date().toISOString() }))
          const now = new Date()
          const made = await db.listing.create({
            data: {
              ...row, categoryId: category.id, sellerId: seller!.id,
              // ⛔ `verified` is the publication gate (feed-query pins it), asked above; the badge is Seller.verified.
              status: 'active', verified: true,
              images: JSON.stringify(distinct),
              postedAt: now, availabilityConfirmedAt: now,
              sellerTrustScore: seller!.trustScore,
              rankScore: browseRankScore({ sellerTrustScore: seller!.trustScore, postedAt: now, featured: false }, Date.now()),
            },
            select: { id: true },
          })
          // Queued for the photo check BEFORE the journal line: a failed write there must not drop it from the queue.
          photoIds.push(made.id); created++
          recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, at: new Date().toISOString() }))
          console.log(`  created ${made.id}  ${row.title}  (${distinct.length} photos)`)
        }
      } finally {
        // Per storefront, so a later shop's failure never drops an earlier shop's queue; an empty list writes nothing.
        // ⛔ The ids are cleared only AFTER the queue took them: a re-run skips these rows, so ids lost here would never be
        // checked — a failure prints them for a hand enqueue (commit-gate review, codex 2026-11-22).
        try {
          if (APPLY) await enqueuePhotoChecks(db, [...photoIds])
          photoIds.length = 0
        } catch (e) {
          console.error(`  ⛔ photo checks NOT queued for ${photoIds.join(', ')} — queue them by hand (src/lib/listing-photo-queue.ts)`)
          throw e
        }
      }

      // ⛔ A storefront this run meant to fill and left EMPTY fails the run: the strip links to it, and an empty storefront
      // 404s (commit-gate review, codex 2026-11-22).
      if (todo.length && created === createdBefore && !(await db.listing.count({ where: { sellerId: seller!.id, status: 'active' } }))) {
        failed++
        console.warn(`  ⛔ /${p.handle} has NO live listing after this run — keep it off the strip until it has one`)
      }

      // The shop's address is the storefront's (a listing text may not carry one). An admin's own stands.
      await db.seller.updateMany({ where: { id: seller!.id, location: null }, data: { location: p.address } })
      // Their logo, unless the account has set one: the same render and visibility floor as scripts/set-partner-avatar.ts.
      if (!avatarUrl) {
        const { out, visiblePct } = await renderPartnerAvatar(readFileSync(logoFile(p)!))
        if (visiblePct < PARTNER_AVATAR_MIN_VISIBLE_PCT) { failed++; console.warn(`  ! logo only ${visiblePct.toFixed(1)}% visible on white: the storefront keeps its initials`) } else {
          const name = `partner/avatar-${seller!.id}-${Date.now().toString(36)}.webp`
          const { error } = await sb.storage.from('listings').upload(name, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
          if (error) { failed++; console.warn(`  ! logo upload failed: ${error.message}`) } else {
            recordDurably(UPLOADED, name)
            await db.seller.updateMany({ where: { id: seller!.id, avatarUrl: null }, data: { avatarUrl: `${storageUrl.replace(/\/+$/, '')}/storage/v1/object/public/listings/${name}` } })
            console.log(`  avatar       ${name}`)
          }
        }
      }
    }

    console.log(`\ncreated ${created} · left out (fewer than ${MIN_PHOTOS} usable photos) ${skippedNoPhoto} · failed ${failed}`)
    // Run BEFORE the deploy that puts these shops on the home strip: an empty storefront 404s.
    console.log('NEXT: the deploy (strip, inbox, feed seat), purge Cloudflare by tag {eno-html,eno-public} on both zones, then Reach › Translations › Run now.')
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
