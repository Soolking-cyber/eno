/**
 * eno's housing agency partners (src/lib/housing-partners.ts) → their own storefronts: Alpha Housing's Hà Nội rentals,
 * Housing Saigon's Ho Chi Minh City rentals, CVR's Đà Nẵng / Hội An rentals (2026-11-23) and JHouse's Ho Chi Minh City
 * rentals (2026-11-25), created ONCE.
 *
 * What is written and why: src/lib/housing-partners.ts. This file is the I/O around it, after scripts/import-moto-partners.ts.
 *
 *   DRY (reads the research and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-housing-partners.ts all
 *   WRITE (journal first):
 *     … scripts/import-housing-partners.ts <alphahousing|housingsaigon|cvr|jhouse|all> --journal-dir <durable dir> --identity-gate on|off --apply
 *   --research-dir <dir>  overrides every partner's research root (<research>/data.json, photos/<id>/NN.ext,
 *                         photo-verdicts.json, raw/logo/logo.{png,webp,jpg}). Defaults: RESEARCH_ROOT below —
 *                         ~/eno-housing-partners-2026-11-22 for Alpha and Housing Saigon, ~/eno-cvr-partner-2026-11-23 for CVR,
 *                         ~/eno-jhouse-partner-2026-11-25 for JHouse.
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB: a listing whose row exists is SKIPPED, whatever it now says; nothing schedules this file.
 * ⛔ PHOTOS: only those photo-verdicts.json keeps (photo-check.mjs: decode + size floor, OCR for a phone, link or email,
 * a photo shared by 3+ listings never the cover; the covers then looked at by a person), the verdict's order. A listing
 * left with fewer than the category's floor (3, publish-guard.ts) is NOT written.
 * ⛔ THE DOLLAR RATE IS READ ONCE, FAIL CLOSED, and every converted price uses it (prices are shown in đồng only).
 * ⛔ THE SELLER IDENTITY GATE, as the other partner importers: asked once per storefront before any upload.
 *
 * ⚠️ A run that dies between a create and the storefront's queue call leaves those rows unqueued for the photo check: their
 * ids are in the journal (a line each, written right after the create) — queue them by hand.
 * Undo (journal `housing-partners-created-rows-<time>.jsonl`): set those rows' status to 'stale' and tombstone their pages.
 * Never delete: a chat may hang off one.
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
import {
  HOUSING_PARTNERS, housingSellerRefusal, mapHousingRecord, type HousingPartner, type HousingRecord, type HousingRow, type HousingSeller,
} from '../src/lib/housing-partners'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'
import { nhatotStartingRank } from '../src/lib/nhatot-listing'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, renderPartnerAvatar } from '../src/lib/partner-avatar'
import { minPhotosFor } from '../src/lib/publish-guard'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const WHICH = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--')) ?? null
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
const RESEARCH_ROOT: Record<HousingPartner['handle'], string> = {
  alphahousing: join(homedir(), 'eno-housing-partners-2026-11-22'),
  housingsaigon: join(homedir(), 'eno-housing-partners-2026-11-22'),
  cvr: join(homedir(), 'eno-cvr-partner-2026-11-23'),
  jhouse: join(homedir(), 'eno-jhouse-partner-2026-11-25'),
}
const researchOf = (p: HousingPartner) => resolve(str('--research-dir') ?? RESEARCH_ROOT[p.handle], p.research)
if (!WHICH || (WHICH !== 'all' && !HOUSING_PARTNERS.some((p) => p.handle === WHICH))) {
  throw new Error(`name a shop or all: ${HOUSING_PARTNERS.map((p) => p.handle).join(' | ')} | all`)
}
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
const SEAT = 'housing-partners'
const MAX_PHOTOS = 10
const MIN_PHOTOS = minPhotosFor('rentals')
const PHOTO_FLOOR = { minShortEdge: 300 }
const FX_URL = 'https://open.er-api.com/v6/latest/USD'

/** photo-check.mjs's verdicts: per record id, the photo files to show in order (cover first), and why the rest went. */
type Verdicts = Record<string, { keep: string[]; drop: Record<string, string> }>

async function readFx(): Promise<number> {
  let res: Response
  try {
    res = await fetch(FX_URL, { headers: { accept: 'application/json', 'user-agent': 'eno-import/1.0 (+https://eno.vn)' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  } catch (e) { throw new Error(`${FX_URL} unreachable (${(e as Error).message}) — no rate, no import`) }
  if (!res.ok) throw new Error(`${FX_URL} answered HTTP ${res.status} — no rate, no import`)
  let json: unknown = null
  try { json = await res.json() } catch { /* refused below */ }
  const r = vndPerUsdFrom(json)
  if (r === null) throw new Error(`no plausible VND/USD rate from ${FX_URL} — no import`)
  return Math.round(r)
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

function logoFile(p: HousingPartner): string | null {
  for (const f of ['logo.png', 'logo.webp', 'logo.jpg']) { const path = join(researchOf(p), 'raw', 'logo', f); if (existsSync(path)) return path }
  return null
}

/** The first MAX_PHOTOS kept photos that decode and clear the size floor — what the run would host. Read-only. */
async function passingPhotos(p: HousingPartner, id: number | string, v: Verdicts): Promise<Buffer[]> {
  const out: Buffer[] = []
  const keep = v[String(id)]?.keep ?? []
  for (const [i, f] of keep.entries()) {
    if (out.length >= MAX_PHOTOS) break
    const body = readFileSync(join(researchOf(p), 'photos', String(id), f))
    const verdict = imageVerdict(await measureImage(body), PHOTO_FLOOR)
    // ⛔ The cover was looked at by a person: if IT fails, the listing is left out rather than another photo promoted into
    // its place unseen (commit-gate review, codex 2026-11-22).
    if (verdict === 'undecodable' || verdict === 'tooSmall') { if (i === 0) return []; continue }
    out.push(body)
  }
  return out
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

type Plan = { p: HousingPartner; seller: HousingSeller | null; createdAt: Date | null; avatarUrl: string | null; verdicts: Verdicts; todo: { rec: HousingRecord; row: HousingRow; postedAt: Date }[] }

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  const partners = HOUSING_PARTNERS.filter((p) => WHICH === 'all' || p.handle === WHICH)
  let created = 0, failed = 0, skippedNoPhoto = 0
  const photoIds: string[] = []
  try {
    const vndPerUsd = await readFx()
    const now = Date.now()
    console.log(`FX           ${vndPerUsd} đ per US$ (${FX_URL}) — every converted price this run uses it`)
    const category = await db.category.findUnique({ where: { slug: 'rentals' }, select: { id: true } })
    if (!category) throw new Error('no rentals category')

    const plans: Plan[] = []
    for (const p of partners) {
      const recs = (JSON.parse(readFileSync(join(researchOf(p), 'data.json'), 'utf8')) as { records: HousingRecord[] }).records
      const vf = join(researchOf(p), 'photo-verdicts.json')
      if (!existsSync(vf)) throw new Error(`${p.handle}: no photo-verdicts.json — every photo is screened before it is published`)
      const verdicts = JSON.parse(readFileSync(vf, 'utf8')) as Verdicts
      if (!logoFile(p)) throw new Error(`${p.handle}: no raw/logo/logo.{png,webp,jpg} in the research — nothing written`)
      const h = await db.handle.findUnique({ where: { handle: p.handle }, select: { sellerId: true } })
      const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, avatarUrl: true, owner: { select: { email: true, createdAt: true } } } }) : null
      const seller: HousingSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore } : null
      const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: `${p.handle}:` } }, select: { externalId: true } }) : []
      const have = new Set(existing.map((x) => x.externalId))
      const tally: Record<string, number> = {}
      const examples: Record<string, string> = {}
      const todo: Plan['todo'] = []
      for (const rec of recs) {
        const m = mapHousingRecord(p, rec, { vndPerUsd, now })
        if (!m.ok) { const k = `${m.kind} ${m.reason}`; tally[k] = (tally[k] ?? 0) + 1; examples[k] ??= `#${rec.id} ${m.detail}`; continue }
        if (have.has(m.row.externalId)) { tally['already written'] = (tally['already written'] ?? 0) + 1; continue }
        todo.push({ rec, row: m.row, postedAt: m.postedAt })
      }
      let short = 0
      for (const t of todo) if ((await passingPhotos(p, t.rec.id, verdicts)).length < MIN_PHOTOS) short++
      const refusal = housingSellerRefusal(p, seller) ?? (seller && !SHARED_SEAT_SELLERS[SEAT]?.includes(seller.id)
        ? `the "${p.handle}" storefront (${seller.id}) is not in feed-diversity.ts's '${SEAT}' seat — add its id first` : null)
      console.log(`\n${p.name} (/${p.handle})`)
      console.log(`  storefront   ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)
      console.log(`  records      ${recs.length} · to create ${todo.length} (${short} of them below ${MIN_PHOTOS} photos — left out)`)
      for (const [k, n] of Object.entries(tally)) console.log(`    ${k.padEnd(24)} ${String(n).padStart(4)}   e.g. ${examples[k] ?? ''}`)
      plans.push({ p, seller, createdAt: s?.owner?.createdAt ?? null, avatarUrl: s?.avatarUrl ?? null, verdicts, todo })
    }
    const refused = plans.map(({ p, seller }) => housingSellerRefusal(p, seller)
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
    const CREATED = join(journal, `housing-partners-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `housing-partners-uploaded-objects-${t}.txt`)
    console.log(`\njournal      ${CREATED}`)

    for (const { p, seller, createdAt, avatarUrl, verdicts, todo } of plans) {
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
        for (const { rec, row, postedAt } of todo) {
          const bodies = await passingPhotos(p, rec.id, verdicts)
          if (bodies.length < MIN_PHOTOS) { skippedNoPhoto++; continue }
          const urls: string[] = []
          for (const [i, body] of bodies.entries()) {
            const url = await host.fromBuffer(body, `${p.handle}-${sha1(body).slice(0, 16)}`)
            if (url) { recordDurably(UPLOADED, url); urls.push(url) } else console.warn(`  ! #${rec.id}: an upload failed`)
            // The checked cover must be the cover: if its upload failed, nothing else takes its place.
            if (i === 0 && !url) break
          }
          if (!urls.length) { failed++; console.warn(`  ⛔ #${rec.id}: the cover did not upload, not created`); continue }
          const distinct = [...new Set(urls)]
          if (distinct.length < MIN_PHOTOS) { failed++; console.warn(`  ⛔ #${rec.id}: only ${distinct.length} distinct photos hosted, not created`); continue }
          recordDurably(CREATED, JSON.stringify({ planned: row.externalId, at: new Date().toISOString() }))
          const made = await db.listing.create({
            data: {
              ...row, categoryId: category.id, sellerId: seller!.id,
              // ⛔ `verified` is the publication gate (feed-query pins it), asked above.
              status: 'active', verified: true,
              images: JSON.stringify(distinct),
              // Dated with the agency's own post date and ranked from it: old stock ranks by its real age (Saigon Cribs').
              postedAt, availabilityConfirmedAt: new Date(),
              sellerTrustScore: seller!.trustScore,
              rankScore: nhatotStartingRank(postedAt, seller!.trustScore, Date.now()),
            },
            select: { id: true },
          })
          photoIds.push(made.id); created++
          recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, at: new Date().toISOString() }))
          if (created % 25 === 0) console.log(`  … ${created} created`)
        }
      } finally {
        // ⛔ Ids cleared only after the queue took them (a re-run skips these rows).
        try {
          if (APPLY) await enqueuePhotoChecks(db, [...photoIds])
          photoIds.length = 0
        } catch (e) {
          console.error(`  ⛔ photo checks NOT queued for ${photoIds.join(', ')} — queue them by hand (src/lib/listing-photo-queue.ts)`)
          throw e
        }
      }
      console.log(`  ${p.handle}: created ${created - createdBefore}`)
      if (todo.length && created === createdBefore && !(await db.listing.count({ where: { sellerId: seller!.id, status: 'active' } }))) {
        failed++
        console.warn(`  ⛔ /${p.handle} has NO live listing after this run — keep it off the strip until it has one`)
      }

      // The agency's office is the storefront's address (a listing text may not carry one). An admin's own stands.
      await db.seller.updateMany({ where: { id: seller!.id, location: null }, data: { location: p.address } })
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
    console.log('NEXT: the deploy (strip, inbox, feed seat), then Reach › Translations (the daily run writes the other languages).')
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
