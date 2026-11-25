/**
 * HAGA Smartech (src/lib/haga-partner.ts) → its own storefront, /hagasmartech: the used devices one by one and the repair
 * services grouped, created ONCE (owner, 2026-11-25). What is written and why: src/lib/haga-partner.ts. This file is the I/O
 * around it, after scripts/import-housing-partners.ts.
 *
 *   DRY (reads the research and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-haga.ts
 *   WRITE (journal first):
 *     … scripts/import-haga.ts --journal-dir <durable dir> --identity-gate on|off --apply
 *   --research-dir <dir>  defaults to ~/eno-haga-partner-2026-11-25 (data.json, photos/<slug>.jpg, raw/logo/logo.png)
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB: a listing whose row exists is SKIPPED, whatever it now says; nothing schedules this file.
 * ⛔ PHOTOS: HAGA's own images, decoded and held to the size floor. A used device has ONE, the manufacturer's (owner,
 * 2026-11-25: "List used with the stock photo"; the text says so) — so the floor here is one photo, and the edit path keeps
 * these rows at one (publish-guard.ts isOnePhotoImport). Every image was looked at on contact sheets before the first run.
 * ⛔ THE SELLER IDENTITY GATE, as the other partner importers: asked once before any upload.
 *
 * ⚠️ A run that dies between a create and the queue call leaves those rows unqueued for the photo check: their ids are in
 * the journal (a line each, written right after the create) — queue them by hand (src/lib/listing-photo-queue.ts).
 * Undo (journal `haga-created-rows-<time>.jsonl`): set those rows' status to 'stale' and tombstone their pages. Never delete:
 * a chat may hang off one.
 * After it: scripts/backfill-partner-source-links.ts hagasmartech (the staff-only original-page links), then the deploy
 * (strip, inbox).
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { inferBrand } from '../src/lib/brand-infer'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import {
  HAGA, groupHagaServices, hagaSellerRefusal, mapHagaServiceGroup, mapHagaUsed, type HagaPlan, type HagaRecord, type HagaSeller,
} from '../src/lib/haga-partner'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'
import { nhatotStartingRank } from '../src/lib/nhatot-listing'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, renderPartnerAvatar } from '../src/lib/partner-avatar'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
const RESEARCH = resolve(str('--research-dir') ?? join(homedir(), 'eno-haga-partner-2026-11-25'))
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
const PHOTO_FLOOR = { minShortEdge: 300 }

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

/** HAGA image path → the file the research downloaded for it (photos/<record slug>.jpg, one image per record). */
function photoFiles(records: HagaRecord[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of records) {
    const img = r.vi?.image
    const f = join(RESEARCH, 'photos', `${r.slug.replace(/\.html$/, '')}.jpg`)
    if (img && existsSync(f) && !m.has(img)) m.set(img, f)
  }
  return m
}

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

/** The plan's photos that decode and clear the size floor, in order. ⛔ The cover must pass, or nothing does. */
async function passingPhotos(plan: HagaPlan, files: Map<string, string>): Promise<Buffer[]> {
  const out: Buffer[] = []
  const seen = new Set<string>()
  for (const [i, img] of plan.images.entries()) {
    const f = files.get(img)
    if (!f) { if (i === 0) return []; continue }
    const body = readFileSync(f)
    // HAGA reuses one workshop photo across many repair pages: the same bytes once.
    const key = sha1(body)
    if (seen.has(key)) continue
    seen.add(key)
    const verdict = imageVerdict(await measureImage(body), PHOTO_FLOOR)
    if (verdict === 'undecodable' || verdict === 'tooSmall') { if (i === 0) return []; continue }
    out.push(body)
  }
  return out
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  let created = 0, failed = 0, skippedNoPhoto = 0
  const photoIds: string[] = []
  try {
    const records = (JSON.parse(readFileSync(join(RESEARCH, 'data.json'), 'utf8')) as { records: HagaRecord[] }).records
    const files = photoFiles(records)
    const logo = join(RESEARCH, 'raw', 'logo', 'logo.png')
    if (!existsSync(logo)) throw new Error(`no ${logo} — nothing written`)

    const categories = await db.category.findMany({ where: { slug: { in: ['electronics', 'services'] } }, select: { id: true, slug: true } })
    const categoryId = (slug: string) => { const c = categories.find((x) => x.slug === slug); if (!c) throw new Error(`no ${slug} category`); return c.id }
    const knownBrands = (await db.brand.findMany({ select: { slug: true } })).map((b) => b.slug)

    const h = await db.handle.findUnique({ where: { handle: HAGA.handle }, select: { sellerId: true } })
    const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, avatarUrl: true, owner: { select: { email: true, createdAt: true } } } }) : null
    const seller: HagaSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore } : null
    const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: 'hagasmartech:' } }, select: { externalId: true } }) : []
    const have = new Set(existing.map((x) => x.externalId))

    // What would be written: every used device, then every service group.
    const tally: Record<string, number> = {}
    const examples: Record<string, string> = {}
    const note = (k: string, ex: string) => { tally[k] = (tally[k] ?? 0) + 1; examples[k] ??= ex }
    const todo: HagaPlan[] = []
    for (const r of records.filter((x) => x.kind === 'used')) {
      const m = mapHagaUsed(r)
      if (!m.ok) { note(`used ${m.reason}`, `${r.slug} ${m.detail}`); continue }
      if (have.has(m.plan.row.externalId)) { note('already written', m.plan.row.externalId); continue }
      todo.push(m.plan)
    }
    const { groups, refused } = groupHagaServices(records)
    for (const x of refused) note(`service ${x.reason.split(' ')[0]}`, `${x.slug} ${x.reason}`)
    for (const g of groups) {
      const m = mapHagaServiceGroup(g.group, g.items)
      if (!m.ok) { note(`group ${m.reason}`, m.detail); continue }
      if (have.has(m.plan.row.externalId)) { note('already written', m.plan.row.externalId); continue }
      todo.push(m.plan)
    }
    let short = 0
    for (const t of todo) if ((await passingPhotos(t, files)).length < 1) short++
    const refusal = hagaSellerRefusal(seller)
    console.log(`${HAGA.name} (/${HAGA.handle})`)
    console.log(`  storefront   ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)
    console.log(`  records      ${records.length} · to create ${todo.length} (used ${todo.filter((t) => t.row.listingType === 'sell').length}, service groups ${todo.filter((t) => t.row.listingType === 'service').length}; ${short} without a usable photo — left out)`)
    for (const [k, n] of Object.entries(tally)) console.log(`    ${k.padEnd(28)} ${String(n).padStart(4)}   e.g. ${examples[k] ?? ''}`)
    if (!APPLY) {
      for (const t of todo.slice(0, 3)) console.log(`\n  e.g. ${t.row.externalId} · ${t.row.categorySlug}/${t.row.subcategorySlug} · ${t.row.price} đ · ${t.images.length} photo(s)\n       ${t.row.title}\n       ${t.row.titleVi}`)
      console.log('\nDRY RUN — nothing written.'); if (refusal) process.exitCode = 1; return
    }
    if (refusal) throw new Error(refusal)

    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })
    const journal = prepareJournalDir(JOURNAL_DIR!)
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    const CREATED = join(journal, `haga-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `haga-uploaded-objects-${t}.txt`)
    console.log(`\njournal      ${CREATED}`)

    let decision: SellerPublishDecision | null = decideBeforeStatus({ enforced: GATE_ENFORCED, ownerId: seller!.ownerId, accountCreatedAt: s?.owner?.createdAt ?? null, now: new Date() })
    if (!decision) {
      const rows = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
        FROM identity_verifications WHERE "profileId" = ${seller!.ownerId}::uuid ORDER BY "submittedAt" DESC`
      decision = decideOwned(deriveVerification(rows, new Date()).status, s?.owner?.createdAt ?? null, new Date())
    }
    console.log(`identity gate ${GATE_ENFORCED ? 'ON' : 'off'} → ${decision.ok ? 'may publish' : `REFUSED (${decision.code})`}`)
    if (!decision.ok) { console.warn('  ⛔ nothing written'); process.exitCode = 1; return }

    const now = new Date()
    try {
      for (const plan of todo) {
        const { row } = plan
        const bodies = await passingPhotos(plan, files)
        if (!bodies.length) { skippedNoPhoto++; continue }
        const urls: string[] = []
        for (const [i, body] of bodies.entries()) {
          const url = await host.fromBuffer(body, `${HAGA.handle}-${sha1(body).slice(0, 16)}`)
          if (url) { recordDurably(UPLOADED, url); urls.push(url) } else console.warn(`  ! ${row.externalId}: an upload failed`)
          if (i === 0 && !url) break
        }
        if (!urls.length) { failed++; console.warn(`  ⛔ ${row.externalId}: the cover did not upload, not created`); continue }
        const { categorySlug, ...fields } = row
        const brandSlug = categorySlug === 'electronics' ? inferBrand(row.title, row.titleVi, row.subcategorySlug, knownBrands) : null
        recordDurably(CREATED, JSON.stringify({ planned: row.externalId, at: new Date().toISOString() }))
        const made = await db.listing.create({
          data: {
            ...fields, brandSlug,
            categoryId: categoryId(categorySlug), sellerId: seller!.id,
            // ⛔ `verified` is the publication gate (feed-query pins it), asked above.
            status: 'active', verified: true,
            images: JSON.stringify([...new Set(urls)]),
            postedAt: now, availabilityConfirmedAt: now,
            sellerTrustScore: seller!.trustScore,
            rankScore: nhatotStartingRank(now, seller!.trustScore, Date.now()),
          },
          select: { id: true },
        })
        photoIds.push(made.id); created++
        recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, source: plan.sourceUrl, at: new Date().toISOString() }))
        if (created % 20 === 0) console.log(`  … ${created} created`)
      }
    } finally {
      // ⛔ Ids cleared only after the queue took them (a re-run skips these rows).
      try {
        await enqueuePhotoChecks(db, [...photoIds])
        photoIds.length = 0
      } catch (e) {
        console.error(`  ⛔ photo checks NOT queued for ${photoIds.join(', ')} — queue them by hand (src/lib/listing-photo-queue.ts)`)
        throw e
      }
    }

    // The shop's address is the storefront's (a listing text never carries one). An admin's own stands.
    await db.seller.updateMany({ where: { id: seller!.id, location: null }, data: { location: HAGA.address } })
    if (!s?.avatarUrl) {
      const { out, visiblePct } = await renderPartnerAvatar(readFileSync(logo))
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
    console.log(`\ncreated ${created} · left out (no usable photo) ${skippedNoPhoto} · failed ${failed}`)
    console.log(`NEXT: scripts/backfill-partner-source-links.ts ${HAGA.handle} (dry, then --journal-dir … --apply), then the deploy (strip, inbox).`)
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
