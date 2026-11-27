/**
 * FPT Telecom home internet (src/lib/fpt-internet-partner.ts) → its own storefront, /fpttelecom: the three plans in Ho Chi
 * Minh City, Hanoi and Da Nang, nine listings, created ONCE (owner, 2026-11-27). What is written and why:
 * src/lib/fpt-internet-partner.ts. This file is the I/O around it, after scripts/import-haga.ts.
 *
 * ⛔ DEPLOY FIRST, THEN THIS (commit gate, opus 2026-11-27): the live build must already know Services › Internet & TV and
 * the `fpttelecom` inbox handle, or nine live rows sit in an aisle it lacks and their chats miss the partner inbox.
 *
 *   DRY (reads the photo and the DB read-only; writes nothing, uploads nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/import-fpt-internet.ts
 *   WRITE (journal first):
 *     … scripts/import-fpt-internet.ts --journal-dir ~/eno-import-journals/fpt-internet --identity-gate on|off --apply
 *   --photo <file>  defaults to ~/eno-fpt-partner-2026-11-27/price-sheet-nov2026.png
 *   --accept-sheet-footer  needed to write with THAT sheet: its footer shows "FREE connection" and "200,000 đ voucher",
 *     which the text leaves out until FPT confirms them — the flag says someone looked and the owner decided.
 *
 * ⛔ CREATE-ONLY, AND NOT A JOB: a listing whose row exists is SKIPPED, whatever it now says; nothing schedules this file.
 * A price change is an edit of those rows, not a re-run.
 * ⛔ ONE PHOTO FOR ALL NINE (owner, 2026-11-27): the eno-branded price sheet, as supplied, uploaded ONCE the way
 * import-haga.ts uploads (makeImageHost 'overlay': stored clean at the 1600 px edge, eno's mark drawn by the app) and that
 * one URL written on every row. A shared object is safe: the storage sweep deletes an object only once no listing still
 * references it (src/lib/core/storage-tombstones.ts). The edit path keeps these rows at one photo (publish-guard.ts
 * ONE_PHOTO_IMPORT_PREFIXES), and the listing photo pass never reads an official partner's photos (listing-photo-check.ts
 * partnerPhotoExempt).
 * ⛔ THE SELLER IDENTITY GATE, as the other partner importers: asked once before any upload.
 *
 * ⚠️ A run that dies between a create and the queue call leaves those rows unqueued for the photo check: their ids are in
 * the journal (a line each, written right after the create) — queue them by hand (src/lib/listing-photo-queue.ts).
 * Undo (journal `fpt-internet-created-rows-<time>.jsonl`): set those rows' status to 'stale' and tombstone their pages.
 * Never delete: a chat may hang off one.
 * After it: scripts/backfill-partner-source-links.ts fpttelecom (the staff-only link to FPT's home-internet page).
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
import { FPT, FPT_EXTERNAL_PREFIX, fptInternetListings, fptSellerRefusal, type FptSeller } from '../src/lib/fpt-internet-partner'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { makeImageHost } from '../src/lib/host-product-image'
import { HOST_EDGE, imageVerdict, measureImage } from '../src/lib/import-photo-check'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'
import { nhatotStartingRank } from '../src/lib/nhatot-listing'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const str = (k: string) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] ?? null : null }
const JOURNAL_DIR = str('--journal-dir')
const GATE_ARG = str('--identity-gate')
const PHOTO = resolve(str('--photo') ?? join(homedir(), 'eno-fpt-partner-2026-11-27', 'price-sheet-nov2026.png'))
if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
if (APPLY && GATE_ARG !== 'on' && GATE_ARG !== 'off') throw new Error('--apply needs --identity-gate on|off: production\'s IDENTITY_GATE_ENFORCED, stated')
const GATE_ENFORCED = GATE_ARG === 'on'
const ACCEPT_SHEET_FOOTER = argv.includes('--accept-sheet-footer')
const PHOTO_FLOOR = { minShortEdge: 300 }
/** sha1 of the sheet as supplied on 2026-11-27. ⚠️ Its footer shows "FREE connection" and "200,000 đ voucher" — the two claims
 *  the listing text leaves out until FPT confirms them (src/lib/fpt-internet-partner.ts). Using it as is was the owner's
 *  instruction ("Do not alter the image"); the dry run says so, and writing with it needs --accept-sheet-footer. */
const SUPPLIED_SHEET_SHA1 = 'a7d239f4533da97b9e67da930aa9c8fe8efb255d'

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
  // ⛔ The photo before the database: a run with no usable photo writes nothing and reads nothing.
  if (!existsSync(PHOTO)) throw new Error(`no ${PHOTO} — nothing written`)
  const photo = readFileSync(PHOTO)
  const measured = await measureImage(photo)
  // A designed sheet is mostly flat colour, which the measure calls 'placeholder': only a file that does not decode or is
  // too small is refused, as import-haga.ts does.
  const verdict = imageVerdict(measured, PHOTO_FLOOR)
  if (verdict === 'undecodable' || verdict === 'tooSmall') throw new Error(`${PHOTO}: ${verdict} — nothing written`)

  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  let created = 0
  const photoIds: string[] = []
  try {
    const rows = fptInternetListings()
    const category = await db.category.findUnique({ where: { slug: 'services' }, select: { id: true } })
    if (!category) throw new Error('no services category')

    const h = await db.handle.findUnique({ where: { handle: FPT.handle }, select: { sellerId: true } })
    const s = h?.sellerId ? await db.seller.findUnique({ where: { id: h.sellerId }, select: { id: true, ownerId: true, officialPartner: true, trustScore: true, owner: { select: { email: true, createdAt: true } } } }) : null
    const seller: FptSeller | null = s ? { id: s.id, ownerId: s.ownerId, ownerEmail: s.owner?.email ?? null, officialPartner: s.officialPartner, trustScore: s.trustScore } : null
    const existing = seller ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { startsWith: FPT_EXTERNAL_PREFIX } }, select: { externalId: true } }) : []
    const have = new Set(existing.map((x) => x.externalId))
    const todo = rows.filter((r) => !have.has(r.externalId))

    const refusal = fptSellerRefusal(seller)
    console.log(`${FPT.name} (/${FPT.handle})`)
    console.log(`  storefront   ${refusal ?? `${seller!.id} · official partner · trust ${seller!.trustScore}`}`)
    console.log(`  photo        ${PHOTO} · ${measured?.width}×${measured?.height} · ${verdict === 'placeholder' ? 'flat graphic, accepted' : verdict} · sha1 ${sha1(photo).slice(0, 12)}`)
    if (sha1(photo) === SUPPLIED_SHEET_SHA1) console.log('  ⚠️ this sheet\'s footer shows "FREE connection" and "200,000 đ voucher", which the listing text does not claim — the owner\'s call; writing needs --accept-sheet-footer')
    console.log(`  listings     ${rows.length} · to create ${todo.length} · already written ${rows.length - todo.length}`)
    for (const r of todo) console.log(`    ${r.externalId.padEnd(28)} ${String(r.price).padStart(8)} đ / month · ${r.city}\n      ${r.title}\n      ${r.titleVi}`)
    if (!APPLY) {
      console.log('\nDRY RUN — nothing written.'); if (refusal) process.exitCode = 1; return
    }
    if (refusal) throw new Error(refusal)
    if (sha1(photo) === SUPPLIED_SHEET_SHA1 && !ACCEPT_SHEET_FOOTER) throw new Error('this sheet\'s footer claims a free connection and a 200,000 đ voucher: pass --accept-sheet-footer once the owner has decided, or --photo a sheet without them — nothing written')
    if (!todo.length) { console.log('\nnothing to create.'); return }

    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SECRET = process.env.SUPABASE_SECRET_KEY
    if (!storageUrl || !SECRET) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    const sb = createClient(storageUrl, SECRET, { auth: { persistSession: false } })
    const host = makeImageHost({ storage: sb.storage.from('listings'), storageUrl, bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay' })
    const journal = prepareJournalDir(JOURNAL_DIR!)
    const t = new Date().toISOString().replace(/[:.]/g, '-')
    const CREATED = join(journal, `fpt-internet-created-rows-${t}.jsonl`)
    const UPLOADED = join(journal, `fpt-internet-uploaded-objects-${t}.txt`)
    console.log(`\njournal      ${CREATED}`)

    let decision: SellerPublishDecision | null = decideBeforeStatus({ enforced: GATE_ENFORCED, ownerId: seller!.ownerId, accountCreatedAt: s?.owner?.createdAt ?? null, now: new Date() })
    if (!decision) {
      const verifications = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
        FROM identity_verifications WHERE "profileId" = ${seller!.ownerId}::uuid ORDER BY "submittedAt" DESC`
      decision = decideOwned(deriveVerification(verifications, new Date()).status, s?.owner?.createdAt ?? null, new Date())
    }
    console.log(`identity gate ${GATE_ENFORCED ? 'ON' : 'off'} → ${decision.ok ? 'may publish' : `REFUSED (${decision.code})`}`)
    if (!decision.ok) { console.warn('  ⛔ nothing written'); process.exitCode = 1; return }

    // The one upload. ⛔ No URL, no rows.
    const url = await host.fromBuffer(photo, `${FPT.handle}-${sha1(photo).slice(0, 16)}`)
    if (!url) throw new Error('the price sheet did not upload — nothing written')
    recordDurably(UPLOADED, url)
    console.log(`photo        ${url}`)

    const now = new Date()
    try {
      for (const row of todo) {
        const { categorySlug, ...fields } = row
        if (categorySlug !== 'services') throw new Error(`${row.externalId}: ${categorySlug} is not services`)
        recordDurably(CREATED, JSON.stringify({ planned: row.externalId, at: new Date().toISOString() }))
        const made = await db.listing.create({
          data: {
            ...fields, brandSlug: null,
            categoryId: category.id, sellerId: seller!.id,
            // ⛔ `verified` is the publication gate (feed-query pins it), asked above.
            status: 'active', verified: true,
            images: JSON.stringify([url]),
            postedAt: now, availabilityConfirmedAt: now,
            sellerTrustScore: seller!.trustScore,
            rankScore: nhatotStartingRank(now, seller!.trustScore, Date.now()),
          },
          select: { id: true },
        })
        photoIds.push(made.id); created++
        recordDurably(CREATED, JSON.stringify({ id: made.id, externalId: row.externalId, source: FPT.site, at: new Date().toISOString() }))
      }
    } catch (e) {
      // Said before the queue runs, so a queue failure below cannot hide why the loop stopped (commit gate, opus 2026-11-27).
      console.error(`  ⛔ stopped after ${created} created: ${e instanceof Error ? e.message : String(e)}`)
      throw e
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

    console.log(`\ncreated ${created}`)
    console.log(`NEXT: scripts/backfill-partner-source-links.ts ${FPT.handle} (dry, then --journal-dir … --apply).`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
