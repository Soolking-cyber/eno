/**
 * Blvck Motorbike (thuexemaysaigon.vn) → eno: the partner's rental bikes, created ONCE on their own storefront.
 *
 * What is written and why: src/lib/blvck-listing.ts. This file is the I/O around it.
 *
 *   DRY (reads the partner's feed and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-blvck.ts
 *   WRITE (journal first):
 *     … scripts/import-blvck.ts --journal-dir <durable dir> --identity-gate on|off --apply
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB. After this run the partner's listings belong to the account eno's admin signs in with
 * (owner: "so our admin can manage listings"). A bike whose row exists is SKIPPED, whatever it now says, so re-running can
 * never overwrite an admin's edit, a price they changed or a bike they took down. Nothing schedules this file.
 *
 * ⛔ THE SELLER IDENTITY GATE. An owned storefront is not outside it (src/lib/compliance/public-state-writes.test.ts): the
 * run asks the app's own rules once, before anything is uploaded, and REFUSES when they refuse. --identity-gate states
 * production's IDENTITY_GATE_ENFORCED: this machine cannot read it. No row is ever written held.
 *
 * ⛔ THE TRANSLATIONS ARE WRITTEN WITH THE ROWS. A reader in any of the 9 languages without a column gets the partner's
 * conditions from the Translation cache (sha1 of the English source, translate.ts), so a page never waits on, or depends
 * on, a machine translation of terms a renter will act on. An admin's later edit changes the source and so falls back to
 * the normal machine translation.
 *
 * Undo (journal `blvck-created-rows-<time>.jsonl`): set those rows' status to 'stale' and tombstone their pages
 * (pdp-tombstone.ts, a PDP is ISR for 30 days). Never delete: a chat may hang off one.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import {
  BLVCK_ADDRESS, BLVCK_BIKES, BLVCK_FEED_URL, BLVCK_HANDLE, BLVCK_LOGO_RIDER, BLVCK_LOGO_URL, BLVCK_MIN_PHOTOS, BLVCK_PHOTO_FLOOR,
  blvckFeedProblem, blvckSellerRefusal, blvckTranslations, stageBlvckBike, type BlvckBike, type BlvckFeedItem, type BlvckSeller,
} from '../src/lib/blvck-listing'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { browseRankScore } from '../src/lib/ranking-formula'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
const UA = 'eno.vn partner import (Blvck Motorbike)'

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

async function readFeed(): Promise<Map<string, BlvckFeedItem>> {
  const res = await fetch(BLVCK_FEED_URL, { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (!res.ok) throw new Error(`the partner's feed answered ${res.status}`)
  const rows = await res.json() as { slug: string; is_in_stock: boolean; prices: { price: string }; images: { src: string }[] }[]
  return new Map(rows.map((r) => [r.slug, { slug: r.slug, isInStock: r.is_in_stock, price: Number(r.prices.price), photos: r.images.map((i) => i.src) }]))
}

async function fetchImage(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null
  return Buffer.from(await res.arrayBuffer())
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  // ⛔ A dry run is read-only at the database: a bug that reaches a write fails.
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  try {
    const feed = await readFeed()
    const known = new Set(BLVCK_BIKES.map((b) => b.slug))
    const unknown = [...feed.keys()].filter((s) => !known.has(s))
    console.log(`feed              ${feed.size} products; ${unknown.length ? `NOT in the tables, left out: ${unknown.join(', ')}` : 'all in the tables'}`)

    const h = await db.handle.findUnique({ where: { handle: BLVCK_HANDLE }, select: { sellerId: true } })
    const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, location: true, avatarUrl: true, owner: { select: { email: true, createdAt: true } } } }) : null
    const seller: BlvckSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore, location: s.location } : null
    const refusal = blvckSellerRefusal(seller)
    console.log(`storefront        ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)

    const category = await db.category.findUnique({ where: { slug: 'rentals' }, select: { id: true } })
    if (!category) throw new Error('no rentals category')
    const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: 'blvck:' } }, select: { externalId: true } }) : []
    const have = new Set(existing.map((r) => r.externalId))
    const todo = BLVCK_BIKES.filter((b) => !have.has(`blvck:${b.slug}`))
    console.log(`bikes             ${BLVCK_BIKES.length} in the tables · ${have.size} already written (skipped) · ${todo.length} to create`)
    // Only the bikes this run will write: a bike that left the feed since must not stop a re-run finishing a partial one.
    const problems = todo.map((b) => blvckFeedProblem(b, feed.get(b.slug))).filter(Boolean)
    if (problems.length) throw new Error(`the partner's feed disagrees — nothing written:\n  ${problems.join('\n  ')}`)
    for (const b of todo) console.log(`  ${b.name.padEnd(20)} ${String(b.perDay).padStart(9)} đ/day  ${b.tiers ? `tiers ${b.tiers.join(' / ')}` : 'one price'}`)

    if (!APPLY) { console.log('\nDRY RUN — nothing written.'); if (refusal) process.exitCode = 1; return }
    if (refusal) throw new Error(refusal)

    // ⛔ THE GATE, once, before any upload (the header).
    let decision: SellerPublishDecision | null = decideBeforeStatus({ enforced: GATE_ENFORCED, ownerId: seller!.ownerId, accountCreatedAt: s!.owner?.createdAt ?? null, now: new Date() })
    if (!decision) {
      const rows = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
        FROM identity_verifications WHERE "profileId" = ${seller!.ownerId}::uuid ORDER BY "submittedAt" DESC`
      decision = decideOwned(deriveVerification(rows, new Date()).status, s!.owner?.createdAt ?? null, new Date())
    }
    console.log(`identity gate     ${GATE_ENFORCED ? 'ON' : 'off'} → ${decision.ok ? 'may publish' : `REFUSED (${decision.code})`}`)
    if (!decision.ok) throw new Error(`the identity gate refuses this storefront (${decision.code}) — nothing written`)

    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })

    const journal = prepareJournalDir(JOURNAL_DIR!)
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    const CREATED = join(journal, `blvck-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `blvck-uploaded-objects-${t}.txt`)
    console.log(`journal           ${CREATED}`)

    // ⛔ THE TRANSLATIONS GO IN BEFORE ANY ROW (a reviewer's catch): a row is public the moment it exists, and a run that
    // dies between the two would leave its conditions to machine translation. All bikes', so a re-run leaves them all in
    // place. Keyed by the sha1 of the exact text this module composes, so an admin's edited text is a different key.
    let translated = 0
    for (const bike of BLVCK_BIKES) {
      for (const r of blvckTranslations(bike)) {
        const hash = sha1(r.source)
        await db.translation.upsert({ where: { hash_target: { hash, target: r.target } }, create: { hash, target: r.target, value: r.value }, update: { value: r.value } })
        translated++
      }
    }
    console.log(`translations      ${translated} written`)

    let created = 0, failed = 0
    const hostPhotos = async (bike: BlvckBike): Promise<string[]> => {
      const urls: string[] = []
      for (const src of feed.get(bike.slug)!.photos) {
        const body = await fetchImage(src)
        if (!body) { console.warn(`  ! ${bike.slug}: could not read ${src}`); continue }
        // ⚠️ 'placeholder' is NOT refused here: their catalogue shots are bikes cut out on white, which read as flat. Looked at by eye 2026-11-04.
        const verdict = imageVerdict(await measureImage(body), BLVCK_PHOTO_FLOOR)
        if (verdict === 'undecodable' || verdict === 'tooSmall') { console.warn(`  ! ${bike.slug}: ${verdict} ${src}`); continue }
        const url = await host.fromBuffer(body, `blvck-${sha1(src).slice(0, 16)}`)
        if (url) { recordDurably(UPLOADED, url); urls.push(url) }
        else console.warn(`  ! ${bike.slug}: upload failed ${src}`)
      }
      return urls
    }
    for (const bike of todo) {
      const row = stageBlvckBike(bike)
      const photos = await hostPhotos(bike)
      if (photos.length < BLVCK_MIN_PHOTOS) { failed++; console.warn(`  ⛔ ${bike.slug}: only ${photos.length} photos hosted, not created`); continue }
      recordDurably(CREATED, JSON.stringify({ planned: row.externalId, at: new Date().toISOString() }))
      const now = new Date()
      const made = await db.listing.create({
        data: {
          ...row, categoryId: category.id, sellerId: seller!.id,
          // ⛔ `verified` is the publication gate (feed-query pins it), asked above; the badge is Seller.verified.
          status: 'active', verified: true,
          images: JSON.stringify(photos),
          postedAt: now, availabilityConfirmedAt: now,
          sellerTrustScore: seller!.trustScore,
          rankScore: browseRankScore({ sellerTrustScore: seller!.trustScore, postedAt: now, featured: false }, Date.now()),
        },
        select: { id: true },
      })
      recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, at: new Date().toISOString() }))
      created++
      console.log(`  created ${made.id}  ${row.title}  (${photos.length} photos)`)
    }

    // The shop's address is the storefront's; a listing text may not carry one (blvck-listing.ts). An admin's own stands.
    await db.seller.updateMany({ where: { id: seller!.id, location: null }, data: { location: BLVCK_ADDRESS } })
    // Their logo, unless the account has set one. scripts/set-partner-avatar.ts refuses an owned storefront by design, and
    // no deploy is wanted for a file in public/. The same upload and the same flatten as there; no eno mark on a shop's logo.
    if (!s!.avatarUrl) {
      const res = await fetch(BLVCK_LOGO_URL, { headers: { 'user-agent': UA } })
      if (!res.ok) { failed++; console.warn(`  ! logo answered ${res.status}: the storefront keeps its initials`) } else {
        const sharp = (await import('sharp')).default
        // Two steps: in one chain sharp trims BEFORE it extracts, and the crop then falls outside the trimmed image.
        const cropped = await sharp(Buffer.from(await res.arrayBuffer())).extract(BLVCK_LOGO_RIDER).png().toBuffer()
        const rider = await sharp(cropped).trim().toBuffer()
        const out = await sharp(rider).resize(440, 440, { fit: 'contain', background: '#ffffff' })
          .extend({ top: 36, bottom: 36, left: 36, right: 36, background: '#ffffff' }).flatten({ background: '#ffffff' }).webp({ quality: 92 }).toBuffer()
        const name = `partner/avatar-${seller!.id}-${Date.now().toString(36)}.webp`
        const { error } = await sb.storage.from('listings').upload(name, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
        if (error) { failed++; console.warn(`  ! logo upload failed: ${error.message}`) } else {
          recordDurably(UPLOADED, name)
          await db.seller.updateMany({ where: { id: seller!.id, avatarUrl: null }, data: { avatarUrl: `${storageUrl.replace(/\/+$/, '')}/storage/v1/object/public/listings/${name}` } })
          console.log(`avatar            ${name}`)
        }
      }
    }

    console.log(`\ncreated ${created} · failed ${failed} · translations ${translated}`)
    console.log('NEXT: scripts/retire-broker-rentals.ts --motorbike-imports, then purge Cloudflare by tag {eno-html,eno-public} on both zones.')
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
