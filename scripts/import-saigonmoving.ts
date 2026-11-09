/**
 * Saigon Moving (saigonmoving.com) → eno: their ONE home-moving listing, created ONCE on their own storefront.
 *
 * What is written and why: src/lib/saigonmoving-listing.ts. This file is the I/O around it.
 *
 * ── RUNBOOK — the owner, from the main checkout (~/eno.vn) once this is on main. Every step is a dry run first. ──────────
 *  1. The account and storefront (handle saigonmoving, their published email; business account, no daily reminder mail):
 *       PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs saigonmoving
 *       PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs saigonmoving --apply
 *     Hand the password to eno's admin, then rotate it: it has been through a shell.
 *  2. Official partner — chat-only (no phone reveal; the contact route answers partner_chat_only). This run refuses without it:
 *       node --env-file=.env scripts/set-official-partner.mjs saigonmoving
 *       node --env-file=.env scripts/set-official-partner.mjs saigonmoving --apply
 *  3. The avatar is NOT scripts/set-partner-avatar.ts: that script refuses an OWNED storefront, and one with no affiliate
 *     listing, by design. Step 4 sets it from public/partners/saigonmoving.png — the same rendering
 *     (src/lib/partner-avatar.ts) — and only while the storefront has none.
 *  4. The listing. The dry run reads the DB read-only and fetches the partner's two photos; it writes and uploads nothing:
 *       npx tsx scripts/import-saigonmoving.ts
 *       npx tsx scripts/import-saigonmoving.ts --journal-dir ~/eno-import-journals/saigonmoving --identity-gate on --apply
 *     --identity-gate states production's IDENTITY_GATE_ENFORCED (this machine cannot read it). `on` asks the real rules,
 *     so it can never publish what production would refuse; a new account is inside its grace period either way.
 *  5. Purge Cloudflare by tag {"tags":["eno-html","eno-public"]} on both zones.
 * (`import 'dotenv/config'` below reads ~/eno.vn/.env from the checkout, as every importer here does.)
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB. After this run the listing belongs to the account eno's admin signs in with. If the row
 * exists it is SKIPPED, whatever it now says, so re-running can never overwrite an admin's edit or a price they changed.
 * Nothing schedules this file.
 *
 * ⛔ THE SELLER IDENTITY GATE. An owned storefront is not outside it (src/lib/compliance/public-state-writes.test.ts): the
 * run asks the app's own rules once, before anything is uploaded, and REFUSES when they refuse. No row is ever written held.
 *
 * ⛔ THE PHOTOS ARE THE ONES LOOKED AT. Each is fetched from the partner's site and must match its pinned sha256
 * (SAIGONMOVING_PHOTOS) and pass the importers' photo check; a changed file is skipped, never published unseen.
 *
 * ⚠️ No Translation-cache rows: the text is en + vi, the row's own columns (saigonmoving-listing.ts header).
 *
 * Undo (journal `saigonmoving-created-rows-<time>.jsonl`): set that row's status to 'stale' and tombstone its page
 * (pdp-tombstone.ts, a PDP is ISR for 30 days). Never delete: a chat may hang off it. The avatar and the storefront address
 * are plain Seller fields an admin can change; the uploaded objects are listed in `saigonmoving-uploaded-objects-<time>.txt`.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, renderPartnerAvatar } from '../src/lib/partner-avatar'
import { minPhotosFor } from '../src/lib/publish-guard'
import { browseRankScore } from '../src/lib/ranking-formula'
import {
  type PhotoBox, SAIGONMOVING_ADDRESS, SAIGONMOVING_EXTERNAL_ID, SAIGONMOVING_HANDLE, SAIGONMOVING_LOGO_FILE, SAIGONMOVING_PHOTO_FLOOR, SAIGONMOVING_PHOTOS,
  saigonmovingSellerRefusal, stageSaigonmovingListing, type SaigonmovingSeller,
} from '../src/lib/saigonmoving-listing'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
const UA = 'eno.vn partner import (Saigon Moving)'
/** Services take one photo (publish-guard minPhotosFor); both are written when both pass. */
const MIN_PHOTOS = minPhotosFor('services')

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

const sha = (alg: 'sha1' | 'sha256', b: string | Buffer) => createHash(alg).update(b).digest('hex')

/**
 * The photo with its tobacco mark taken out (SAIGONMOVING_PHOTOS' note): cut to `crop`, then each `blur` box blurred past
 * reading through a FEATHERED mask (the box drawn white on black and itself blurred), so the edge fades into the frame
 * instead of reading as a pasted patch. Re-encoded as a high-quality JPEG; a photo with neither is returned untouched.
 */
async function cleanPhoto(body: Buffer, crop: PhotoBox | undefined, boxes: readonly PhotoBox[]): Promise<Buffer> {
  if (!crop && !boxes.length) return body
  const base = crop ? await sharp(body).extract(crop).toBuffer() : body
  if (!boxes.length) return sharp(base).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
  const { width = 0, height = 0 } = await sharp(base).metadata()
  const rects = boxes.map((b) => `<rect x="${b.left}" y="${b.top}" width="${b.width}" height="${b.height}" rx="8" fill="#fff"/>`).join('')
  const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#000"/>${rects}</svg>`))
    .blur(5).extractChannel(0).raw().toBuffer()
  // ⚠️ The alpha is joined BY HAND: sharp's joinChannel() with a raw one-channel input dropped it here (measured 2026-11-09:
  // the overlay came out RGB, so the whole photo was blurred).
  const blurred = await sharp(base).blur(12).removeAlpha().raw().toBuffer()
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = blurred[i * 3]; rgba[i * 4 + 1] = blurred[i * 3 + 1]; rgba[i * 4 + 2] = blurred[i * 3 + 2]; rgba[i * 4 + 3] = mask[i]
  }
  const softened = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
  return sharp(base).composite([{ input: softened }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
}

/** The partner's photos that are still exactly what was looked at and pass the importers' check, in order. */
async function readPhotos(): Promise<{ url: string; body: Buffer }[]> {
  const ok: { url: string; body: Buffer }[] = []
  for (const p of SAIGONMOVING_PHOTOS) {
    const res = await fetch(p.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) }).catch((e: unknown) => e as Error)
    if (res instanceof Error || !res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
      console.warn(`  ! could not read ${p.url} (${res instanceof Error ? res.message : res.status})`); continue
    }
    const body = Buffer.from(await res.arrayBuffer())
    if (sha('sha256', body) !== p.sha256) { console.warn(`  ! ${p.url} has CHANGED since it was looked at — skipped (look at it, then re-pin SAIGONMOVING_PHOTOS)`); continue }
    // ⛔ The tobacco mark goes BEFORE the check and the upload (SAIGONMOVING_PHOTOS' note): the hosted photo never carries it.
    const clean = await cleanPhoto(body, p.crop, p.blur)
    const verdict = imageVerdict(await measureImage(clean), SAIGONMOVING_PHOTO_FLOOR)
    if (verdict !== 'ok') { console.warn(`  ! ${p.url}: ${verdict} — skipped`); continue }
    ok.push({ url: p.url, body: clean })
  }
  return ok
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — run from the checkout that holds .env')
  // ⛔ A dry run is read-only at the database: a bug that reaches a write fails.
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  try {
    const h = await db.handle.findUnique({ where: { handle: SAIGONMOVING_HANDLE }, select: { sellerId: true } })
    const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, location: true, avatarUrl: true, owner: { select: { email: true, createdAt: true, accountType: true } } } }) : null
    const seller: SaigonmovingSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore } : null
    const refusal = saigonmovingSellerRefusal(seller)
    console.log(`storefront        ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)

    const category = await db.category.findUnique({ where: { slug: 'services' }, select: { id: true } })
    if (!category) throw new Error('no services category')
    const existing = seller ? await db.listing.findFirst({ where: { sellerId: seller.id, externalId: SAIGONMOVING_EXTERNAL_ID }, select: { id: true, status: true } }) : null
    // The derived facet, as createListingCore writes it: 'business' only when the account says so.
    const row = stageSaigonmovingListing(s?.owner?.accountType === 'business' ? 'business' : 'individual')
    console.log(`listing           ${existing ? `ALREADY WRITTEN (${existing.id}, ${existing.status}) — skipped, the account manages it` : `to create: ${row.title} · ${row.price} đ (${row.priceUnit}) · ${row.attributes}`}`)

    const photos = existing ? [] : await readPhotos()
    if (!existing) console.log(`photos            ${photos.length} of ${SAIGONMOVING_PHOTOS.length} match what was looked at and pass the check (${MIN_PHOTOS} needed)`)
    if (!existing && photos.length < MIN_PHOTOS) throw new Error(`only ${photos.length} usable photos — nothing written`)

    const logoPath = join(process.cwd(), SAIGONMOVING_LOGO_FILE)
    const avatar = s && !s.avatarUrl && existsSync(logoPath) ? await renderPartnerAvatar(readFileSync(logoPath)) : null
    console.log(`avatar            ${!s ? 'no storefront yet' : s.avatarUrl ? 'already set — kept' : avatar ?`${SAIGONMOVING_LOGO_FILE} → ${avatar.inner}px mark, ${avatar.visiblePct.toFixed(1)}% visible on white` : `${SAIGONMOVING_LOGO_FILE} not found — the storefront keeps its initials`}`)
    console.log(`address           ${s?.location ? `already set — kept (${s.location})` : SAIGONMOVING_ADDRESS}`)

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

    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    if (/supabase\.co$/.test(new URL(storageUrl).hostname)) throw new Error(`refusing to upload to ${storageUrl} — the retired project`)
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })

    const journal = prepareJournalDir(JOURNAL_DIR!)
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    const CREATED = join(journal, `saigonmoving-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `saigonmoving-uploaded-objects-${t}.txt`)
    console.log(`journal           ${CREATED}`)

    let failed = 0
    if (!existing) {
      const hosted: string[] = []
      for (const p of photos) {
        const url = await host.fromBuffer(p.body, `saigonmoving-${sha('sha1', p.url).slice(0, 16)}`)
        if (url) { recordDurably(UPLOADED, url); hosted.push(url) } else console.warn(`  ! upload failed ${p.url}`)
      }
      if (hosted.length < MIN_PHOTOS) throw new Error(`only ${hosted.length} photos hosted — the listing was not created`)
      recordDurably(CREATED, JSON.stringify({ planned: row.externalId, at: new Date().toISOString() }))
      const now = new Date()
      const made = await db.listing.create({
        data: {
          ...row, categoryId: category.id, sellerId: seller!.id,
          // ⛔ `verified` is the publication gate (feed-query pins it), asked above; the badge is Seller.verified.
          status: 'active', verified: true,
          images: JSON.stringify(hosted),
          postedAt: now, availabilityConfirmedAt: now,
          sellerTrustScore: seller!.trustScore,
          rankScore: browseRankScore({ sellerTrustScore: seller!.trustScore, postedAt: now, featured: false }, Date.now()),
        },
        select: { id: true },
      })
      recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, at: new Date().toISOString() }))
      console.log(`created           ${made.id}  ${row.title}  (${hosted.length} photos)`)
    }

    // The office address is the storefront's; a listing text may not carry one (saigonmoving-listing.ts). An admin's own stands.
    await db.seller.updateMany({ where: { id: seller!.id, location: null }, data: { location: SAIGONMOVING_ADDRESS } })
    // Their logo, unless the account has set one (step 3 of the runbook). No eno mark on a shop's logo.
    if (avatar) {
      if (avatar.visiblePct < PARTNER_AVATAR_MIN_VISIBLE_PCT) { failed++; console.warn(`  ! only ${avatar.visiblePct.toFixed(1)}% of the logo is visible on white — not set`) } else {
        const name = `partner/avatar-${seller!.id}-${Date.now().toString(36)}.webp`
        const { error } = await sb.storage.from('listings').upload(name, avatar.out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
        if (error) { failed++; console.warn(`  ! logo upload failed: ${error.message}`) } else {
          recordDurably(UPLOADED, name)
          await db.seller.updateMany({ where: { id: seller!.id, avatarUrl: null }, data: { avatarUrl: `${storageUrl}/storage/v1/object/public/listings/${name}` } })
          console.log(`avatar            ${name}`)
        }
      }
    } else if (!s!.avatarUrl) { failed++; console.warn(`  ! ${SAIGONMOVING_LOGO_FILE} not found — the storefront keeps its initials`) }

    console.log(`\n${existing ? 'listing already there' : 'listing created'} · failed ${failed}`)
    console.log('NEXT: purge Cloudflare by tag {eno-html,eno-public} on both zones.')
    if (failed) process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
