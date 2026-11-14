/**
 * Move an eno-run partner's purchase links OFF its public listings, into the staff-only PartnerPurchaseLink table
 * (owner 2026-11-14: "same as other partners users just text our admins to buy we buy and send seperately no links that
 * lead to another website" + "only admins should see the link to purchase devices for users … and send in chat if needed").
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/move-partner-purchase-links.ts cellphones              # DRY RUN
 *   …                         npx tsx scripts/move-partner-purchase-links.ts cellphones --apply
 *   …                         npx tsx scripts/move-partner-purchase-links.ts cellphones --reverse [--apply]
 *
 * After it, every public surface shows the shop's listings as ordinary partner listings with chat (the public
 * `Listing.affiliateUrl` is NULL); staff see the link through GET /api/listings/[id]/goplus-link (kind 'purchase').
 *
 * ⛔ ONLY A STOREFRONT ENO RUNS: the shop's owner must be the login recorded in ~/eno-vault/<shop>-partner-claim.json by
 * scripts/claim-partner-storefront.mjs (status 'claimed'), with officialPartner set. Run it only AFTER the deploy that pins
 * that pair in src/lib/eno-run-partners.ts — before it, the nightly job would write links back to the public column.
 * ⛔ THE JOURNAL IS ON DISK BEFORE ANY WRITE (ids + urls), durably, in ~/eno-import-journals/accesstrade and the mirror.
 * The move is ONE statement (movePublicLinksToStaff): public rows locked, nulled, each url into the staff table only where
 * none is there yet — the nightly job runs the same statement for every pinned shop, so this script is only the immediate
 * run. A live row's `updatedAt` moves (so the nightly 48-hour purge sweep re-purges it); a hidden row's does not.
 * ⛔ --reverse puts the link back from the STAFF TABLE (the nightly job may have refreshed it since — opus, plan review),
 * only where the public column is still NULL, and only once the shop is unpinned AND ownerless (way back: unpin + deploy →
 * claim --reverse → this → delete the staff rows).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFileDurably } from '../src/lib/durable-file'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { movePublicLinksToStaff } from '../src/lib/partner-purchase-link'
import { enoRunPartnerSellerIds, isEnoRunPartner } from '../src/lib/eno-run-partners'

const SHOPS: Record<string, { sellerId: string; name: string }> = {
  cellphones: { sellerId: 'cmt78nvif0000gpq48kvzmxjw', name: 'CellphoneS' },
  dienthoaivui: { sellerId: 'cmtr9qva90000glq44fkjs18b', name: 'Điện Thoại Vui' },
}
const key = process.argv[2]
const SHOP = SHOPS[key]
const APPLY = process.argv.includes('--apply')
const REVERSE = process.argv.includes('--reverse')
if (!SHOP) { console.error(`Usage: npx tsx scripts/move-partner-purchase-links.ts <${Object.keys(SHOPS).join('|')}> [--apply] [--reverse]`); process.exit(1) }
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }) })
const JOURNAL_DIR = join(homedir(), 'eno-import-journals', 'accesstrade')
const MIRROR_DIR = join(homedir(), 'eno-journals', 'accesstrade')

async function enoRunOwner(): Promise<string> {
  const claimFile = join(homedir(), 'eno-vault', `${key}-partner-claim.json`)
  let claim: { status?: string; sellerId?: string; ownerProfileId?: string }
  try { claim = JSON.parse(readFileSync(claimFile, 'utf8')) } catch { throw new Error(`${claimFile} not found — claim the shop first (scripts/claim-partner-storefront.mjs)`) }
  const s = (await db.$queryRawUnsafe<{ ownerId: string | null; officialPartner: boolean }[]>(`SELECT "ownerId", "officialPartner" FROM "Seller" WHERE id = $1`, SHOP.sellerId))[0]
  if (claim.status !== 'claimed' || claim.sellerId !== SHOP.sellerId || !claim.ownerProfileId || s?.ownerId !== claim.ownerProfileId || !s.officialPartner) {
    throw new Error(`${SHOP.name} is not eno-run as recorded (claim status ${claim.status}, owner ${s?.ownerId ?? 'none'} vs ${claim.ownerProfileId}, officialPartner ${s?.officialPartner}) — refusing`)
  }
  // …and PINNED in the code this run carries (commit gate, codex + opus): without the pin the staff endpoint answers
  // nothing, so moving the links would leave the shop with no link anywhere.
  if (!isEnoRunPartner({ id: SHOP.sellerId, ownerId: s.ownerId, officialPartner: s.officialPartner })) {
    throw new Error(`${SHOP.name}'s pair is not pinned in src/lib/eno-run-partners.ts — pin it and deploy first; refusing`)
  }
  return claim.ownerProfileId
}

async function move() {
  await enoRunOwner()
  const rows = await db.$queryRawUnsafe<{ id: string; url: string }[]>(
    `SELECT id, "affiliateUrl" AS url FROM "Listing" WHERE "sellerId" = $1 AND "affiliateUrl" IS NOT NULL ORDER BY id`, SHOP.sellerId)
  console.log(`${SHOP.name}: ${rows.length} listings still carry a public purchase link → move them to the staff table`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return }
  if (!rows.length) {
    // Nothing public left — but a run whose purge failed must be retryable (commit gate, codex): re-purge every page of the
    // shop that holds a staff link and no public one.
    const staffOnly = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT l.id FROM "Listing" l JOIN "PartnerPurchaseLink" pl ON pl."listingId" = l.id WHERE l."sellerId" = $1 AND l."affiliateUrl" IS NULL`, SHOP.sellerId)
    console.log(`Nothing to move. Re-purging ${staffOnly.length} pages that hold a staff link only.`)
    if (staffOnly.length) console.log(`PDP tombstones: ${await tombstonePdps(db, staffOnly.map((r) => r.id))}`)
    return
  }
  const runAt = new Date().toISOString()
  const name = `move-purchase-links-${key}-${runAt.replace(/[:.]/g, '-')}.json`
  const text = JSON.stringify({ kind: 'move-purchase-links', createdAt: runAt, sellerId: SHOP.sellerId, rows }, null, 1)
  for (const dir of [JOURNAL_DIR, MIRROR_DIR]) writeFileDurably(dir, name, text)
  // ONE statement (src/lib/partner-purchase-link.ts): the public rows locked, nulled, and each url into the staff table only
  // where none is there yet — a fresher link the nightly job wrote is kept (commit gate, codex).
  const movedIds = await movePublicLinksToStaff(db, Prisma, SHOP.sellerId, { ids: rows.map((r) => r.id), urls: rows.map((r) => r.url) })
  const moved = movedIds.length
  console.log(`MOVED ${moved} of the ${rows.length} journaled (a row changed since the read is left for the nightly job)`)
  console.log(`journal: ${join(JOURNAL_DIR, name)} (+ ${MIRROR_DIR}) — way back: --reverse --apply`)
  const msg = await tombstonePdps(db, movedIds)
  console.log(`PDP tombstones: ${msg}`)
  console.log('NEXT: Cloudflare tag purge (eno-html, eno-public) on BOTH zones — cards, category and seller pages carry the old buy links until then.')
}

async function reverse() {
  // ⛔ Only once the shop is no longer eno-run: UNPINNED (else the nightly job moves the links straight back) and OWNERLESS
  // (else they would go public on a storefront someone owns) — the way back is: unpin + deploy → claim --reverse → this.
  const s = (await db.$queryRawUnsafe<{ ownerId: string | null; officialPartner: boolean }[]>(`SELECT "ownerId", "officialPartner" FROM "Seller" WHERE id = $1`, SHOP.sellerId))[0]
  if (!s) throw new Error(`no Seller ${SHOP.sellerId}`)
  if (enoRunPartnerSellerIds().includes(SHOP.sellerId)) throw new Error(`${SHOP.name} is still pinned in src/lib/eno-run-partners.ts — unpin and deploy first; refusing`)
  if (s.ownerId) throw new Error(`${SHOP.name} still has an owner (${s.ownerId}) — run claim-partner-storefront.mjs --reverse first; refusing`)
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT l.id FROM "Listing" l JOIN "PartnerPurchaseLink" pl ON pl."listingId" = l.id WHERE l."sellerId" = $1 AND l."affiliateUrl" IS NULL ORDER BY l.id`, SHOP.sellerId)
  console.log(`${SHOP.name}: ${rows.length} listings have a staff link and no public one → put the link back from the staff table`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --reverse --apply.'); return }
  const back = await db.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE "Listing" l SET "affiliateUrl" = pl.url FROM "PartnerPurchaseLink" pl WHERE pl."listingId" = l.id AND l."sellerId" = $1 AND l."affiliateUrl" IS NULL RETURNING l.id`,
    SHOP.sellerId)
  console.log(`PUT BACK ${back.length}. Then unpin the pair (src/lib/eno-run-partners.ts) and deploy; the staff rows can be deleted after that.`)
  const msg = await tombstonePdps(db, back.map((r) => r.id))
  console.log(`PDP tombstones: ${msg}; then a Cloudflare tag purge on both zones.`)
}

;(REVERSE ? reverse() : move()).then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
