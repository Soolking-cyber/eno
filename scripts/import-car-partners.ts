/**
 * eno's car rental partners (src/lib/car-partners.ts) → their own storefronts: each shop's self-drive cars, created ONCE.
 *
 * What is written and why: src/lib/car-partners.ts. This file is the I/O around it, after scripts/import-blvck.ts.
 *
 *   DRY (reads the research and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-car-partners.ts all
 *   WRITE (journal first):
 *     … scripts/import-car-partners.ts <handle|all> --journal-dir <durable dir> --identity-gate on|off --apply
 *   --research-dir <dir>  defaults to ~/eno-car-partners-2026-11-17 (data.json, raw/, photo-verdicts.json per shop)
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB. After this run the cars belong to the account eno's admin signs in with. A car whose row
 * exists is SKIPPED, whatever it now says, so re-running can never overwrite an admin's edit, a price they changed or a car
 * they took down. Nothing schedules this file.
 *
 * ⛔ PHOTOS: only those photo-verdicts.json keeps (a contact, a price, another business, a face, a duplicate → dropped,
 * looked at one by one on 2026-11-17), or crops it names (a price band along an edge). A car left with fewer than the
 * category's floor (3) is NOT written (MIN_PHOTOS below): the admin adds it once the shop sends photos.
 *
 * ⛔ THE SELLER IDENTITY GATE, as import-blvck.ts: asked once per storefront before anything is uploaded; --identity-gate
 * states production's IDENTITY_GATE_ENFORCED, which this machine cannot read. No row is ever written held.
 *
 * Undo (journal `car-partners-created-rows-<time>.jsonl`): set those rows' status to 'stale' and tombstone their pages
 * (pdp-tombstone.ts; a PDP is ISR for 30 days). Never delete: a chat may hang off one.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaPg } from '@prisma/adapter-pg'
import sharp from 'sharp'
import { PrismaClient } from '../src/generated/prisma/client'
import {
  CAR_PARTNERS, carPartnerSellerRefusal, carResearchProblem, stageCarPartnerCar,
  type CarPartner, type CarPartnerCar, type CarPartnerSeller, type ResearchCar,
} from '../src/lib/car-partners'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { SHARED_SEAT_SELLERS } from '../src/lib/feed-diversity'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { minPhotosFor } from '../src/lib/publish-guard'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, renderPartnerAvatar } from '../src/lib/partner-avatar'
import { browseRankScore } from '../src/lib/ranking-formula'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const WHICH = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--')) ?? null
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
const RESEARCH = resolve(str('--research-dir') ?? join(homedir(), 'eno-car-partners-2026-11-17'))
if (!WHICH || (WHICH !== 'all' && !CAR_PARTNERS.some((p) => p.handle === WHICH))) {
  throw new Error(`name a shop or all: ${CAR_PARTNERS.map((p) => p.handle).join(' | ')} | all`)
}
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
/** A listing shows its first photos; more than this adds weight, not information. */
const MAX_PHOTOS = 6
/**
 * ⛔ THE CATEGORY'S OWN PHOTO FLOOR (3 distinct for rentals, publish-guard.ts), NOT A LOWER ONE: an admin's edit in the app
 * re-checks it and the wizard resends the photos, so a car written with fewer could never be edited again — not even its
 * price (plan review, Opus 2026-11-17). Blvck's BLVCK_MIN_PHOTOS = 3 for the same reason.
 */
const MIN_PHOTOS = minPhotosFor('rentals')
const PHOTO_FLOOR = { minShortEdge: 300 }

type Verdict = { keep: boolean; why?: string; crop?: { topPct?: number; bottomPct?: number } | null }
/** photos-extra.json: more photos of a car from its own page (gallery pass, 2026-11-17), each already looked at. */
type Extra = { file: string; keep: boolean; why?: string }
type Research = { cars: ResearchCar[]; verdicts: Record<string, Verdict>; extra: Record<string, Extra[]> }

function readResearch(p: CarPartner): Research {
  const dir = join(RESEARCH, p.research)
  const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as { cars: ResearchCar[] }
  const vf = join(dir, 'photo-verdicts.json')
  if (!existsSync(vf)) throw new Error(`${p.handle}: no photo-verdicts.json in ${dir} — every photo is looked at before it is published`)
  const xf = join(dir, 'photos-extra.json')
  const extra = existsSync(xf) ? JSON.parse(readFileSync(xf, 'utf8')) as Record<string, Extra[]> : {}
  return { cars: data.cars, verdicts: JSON.parse(readFileSync(vf, 'utf8')) as Record<string, Verdict>, extra }
}

/** The photo files this car may show, in the research's order: kept ones as they are, croppable ones with their crop. */
function usablePhotos(p: CarPartner, r: Research, c: CarPartnerCar): { file: string; crop: Verdict['crop'] }[] {
  const out: { file: string; crop: Verdict['crop'] }[] = []
  for (const f of r.cars[c.src]?.photoFiles ?? []) {
    const v = r.verdicts[f]
    if (!v) throw new Error(`${p.handle}:${c.slug}: ${f} has no verdict — look at it first`)
    if (v.keep) out.push({ file: f, crop: null })
    else if (v.crop && ((v.crop.topPct ?? 0) > 0 || (v.crop.bottomPct ?? 0) > 0)) {
      // A crop is an edge band (a price strip): one that would leave less than half the photo is a misread verdict.
      if ((v.crop.topPct ?? 0) + (v.crop.bottomPct ?? 0) >= 50) throw new Error(`${p.handle}:${c.slug}: ${f} crops ${v.crop.topPct ?? 0}% + ${v.crop.bottomPct ?? 0}% — re-check its verdict`)
      out.push({ file: f, crop: v.crop })
    }
  }
  for (const x of r.extra[String(c.src)] ?? []) if (x.keep) out.push({ file: x.file, crop: null })
  return out.slice(0, MAX_PHOTOS)
}

async function readPhoto(p: CarPartner, f: { file: string; crop: Verdict['crop'] }): Promise<Buffer> {
  const body = readFileSync(join(RESEARCH, p.research, f.file))
  if (!f.crop) return body
  const meta = await sharp(body).metadata()
  const h = meta.height!, w = meta.width!
  const top = Math.round(h * (f.crop.topPct ?? 0) / 100)
  const bottom = Math.round(h * (f.crop.bottomPct ?? 0) / 100)
  return sharp(body).extract({ left: 0, top, width: w, height: h - top - bottom }).jpeg({ quality: 92 }).toBuffer()
}

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, `${line}\n`); fsyncSync(fd) } finally { closeSync(fd) }
}

function prepareJournalDir(dir: string): string {
  const abs = resolve(dir)
  mkdirSync(abs, { recursive: true })
  const real = realpathSync(abs)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  const problem = journalDirProblem(real, roots)
  if (problem) throw new Error(problem)
  return real
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  // ⛔ A dry run is read-only at the database: a bug that reaches a write fails.
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  const partners = CAR_PARTNERS.filter((p) => (WHICH === 'all' ? !p.held : p.handle === WHICH))
  for (const p of CAR_PARTNERS) if (p.held && (WHICH === 'all' || p.handle === WHICH)) console.log(`${p.name} (/${p.handle}): HELD — ${p.held}`)
  if (!partners.length) { console.log('nothing to run'); return }
  let created = 0, failed = 0, skippedNoPhoto = 0
  const photoIds: string[] = []
  try {
    const category = await db.category.findUnique({ where: { slug: 'rentals' }, select: { id: true } })
    if (!category) throw new Error('no rentals category')

    // Everything is checked for every shop before anything is written for any (a stale price stops the whole run).
    const plans: { p: CarPartner; r: Research; seller: CarPartnerSeller | null; createdAt: Date | null; avatarUrl: string | null; todo: CarPartnerCar[] }[] = []
    for (const p of partners) {
      const r = readResearch(p)
      const h = await db.handle.findUnique({ where: { handle: p.handle }, select: { sellerId: true } })
      const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, location: true, avatarUrl: true, owner: { select: { email: true, createdAt: true } } } }) : null
      const seller: CarPartnerSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore, location: s.location } : null
      const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: `${p.handle}:` } }, select: { externalId: true } }) : []
      const have = new Set(existing.map((x) => x.externalId))
      const todo = p.cars.filter((c) => !have.has(`${p.handle}:${c.slug}`))
      const problems = todo.map((c) => carResearchProblem(p, c, r.cars[c.src])).filter(Boolean)
      if (problems.length) throw new Error(`the research disagrees — nothing written:\n  ${problems.join('\n  ')}`)
      // ⛔ AND IN THE FEED'S SHARED SEAT (feed-diversity.ts 'car-partners', ids pasted from the registration): a storefront
      // outside it would take a home-feed seat of its own for every car written at once (commit-gate review, Opus 2026-11-17).
      // The logo is read now, before any car is written for any shop: a missing file must not stop a run halfway.
      if (!existsSync(join(RESEARCH, p.research, 'raw', 'logo.png'))) throw new Error(`${p.handle}: no raw/logo.png in the research — nothing written`)
      const refusal = carPartnerSellerRefusal(p, seller) ?? (seller && !SHARED_SEAT_SELLERS['car-partners']?.includes(seller.id)
        ? `the "${p.handle}" storefront (${seller.id}) is not in feed-diversity.ts's 'car-partners' seat — add its id first` : null)
      console.log(`\n${p.name} (/${p.handle})`)
      console.log(`  storefront   ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)
      console.log(`  cars         ${p.cars.length} in the module · ${have.size} already written (skipped) · ${todo.length} to create`)
      for (const c of todo) {
        const n = usablePhotos(p, r, c).length
        console.log(`    ${c.name.padEnd(34)} ${String(c.perDay).padStart(9)} đ/day  ${n >= MIN_PHOTOS ? `${n} photos` : `only ${n} usable photo${n === 1 ? '' : 's'} — left out`}`)
      }
      plans.push({ p, r, seller, createdAt: s?.owner?.createdAt ?? null, avatarUrl: s?.avatarUrl ?? null, todo })
    }
    const refused = plans.map(({ p, seller }) => carPartnerSellerRefusal(p, seller)
      ?? (seller && !SHARED_SEAT_SELLERS['car-partners']?.includes(seller.id) ? `${p.handle}: not in the 'car-partners' feed seat` : null)).filter(Boolean)
    if (!APPLY) { console.log('\nDRY RUN — nothing written.'); if (refused.length) process.exitCode = 1; return }
    if (refused.length) throw new Error(refused.join('\n'))

    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })
    const journal = prepareJournalDir(JOURNAL_DIR!)
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    const CREATED = join(journal, `car-partners-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `car-partners-uploaded-objects-${t}.txt`)
    console.log(`\njournal      ${CREATED}`)

    for (const { p, r, seller, createdAt, avatarUrl, todo } of plans) {
      // ⛔ THE GATE, once per storefront, before any upload (the header).
      let decision: SellerPublishDecision | null = decideBeforeStatus({ enforced: GATE_ENFORCED, ownerId: seller!.ownerId, accountCreatedAt: createdAt, now: new Date() })
      if (!decision) {
        const rows = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
          FROM identity_verifications WHERE "profileId" = ${seller!.ownerId}::uuid ORDER BY "submittedAt" DESC`
        decision = decideOwned(deriveVerification(rows, new Date()).status, createdAt, new Date())
      }
      console.log(`\n${p.name}: identity gate ${GATE_ENFORCED ? 'ON' : 'off'} → ${decision.ok ? 'may publish' : `REFUSED (${decision.code})`}`)
      if (!decision.ok) { failed += todo.length; console.warn(`  ⛔ nothing written for ${p.handle}`); continue }

      try {
        for (const c of todo) {
          const files = usablePhotos(p, r, c)
          if (files.length < MIN_PHOTOS) { skippedNoPhoto++; continue }
          const urls: string[] = []
          for (const f of files) {
            const body = await readPhoto(p, f)
            const verdict = imageVerdict(await measureImage(body), PHOTO_FLOOR)
            if (verdict === 'undecodable' || verdict === 'tooSmall') { console.warn(`  ! ${c.slug}: ${verdict} ${f.file}`); continue }
            const url = await host.fromBuffer(body, `${p.handle}-${sha1(body).slice(0, 16)}`)
            if (url) { recordDurably(UPLOADED, url); urls.push(url) } else console.warn(`  ! ${c.slug}: upload failed ${f.file}`)
          }
          const distinct = [...new Set(urls)] // the host keys a photo by its bytes: the same shot twice is one URL
          if (distinct.length < MIN_PHOTOS) { failed++; console.warn(`  ⛔ ${c.slug}: only ${distinct.length} distinct photos hosted, not created`); continue }
          const row = stageCarPartnerCar(p, c)
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
          recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, at: new Date().toISOString() }))
          created++; photoIds.push(made.id)
          console.log(`  created ${made.id}  ${row.title}  (${distinct.length} photos)`)
        }
      } finally {
        // Per storefront, so a later shop's failure never drops an earlier shop's queue; an empty list writes nothing.
        if (APPLY) await enqueuePhotoChecks(db, photoIds.splice(0))
      }

      // The shop's address is the storefront's (a listing text may not carry one). An admin's own stands.
      await db.seller.updateMany({ where: { id: seller!.id, location: null }, data: { location: p.address } })
      // Their logo, unless the account has set one: the same render and visibility floor as scripts/set-partner-avatar.ts.
      if (!avatarUrl) {
        const { out, visiblePct } = await renderPartnerAvatar(readFileSync(join(RESEARCH, p.research, 'raw', 'logo.png')))
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
    // Run BEFORE the deploy that puts these shops on the home strip: an empty storefront 404s (commit-gate review).
    console.log('NEXT: scripts/retire-broker-rentals.ts --car-imports, the deploy, purge Cloudflare by tag {eno-html,eno-public} on both zones, then Reach › Translations › Run now.')
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
