import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

// ── Self-service account deletion (PDPL 91/2025: delete ≤20 days — we do it now) ──
//
// SECURITY MODEL (designed against mass-deletion abuse, 2026-07-06):
//  • No target parameter exists — the route deletes ONLY the authenticated caller's
//    own account (full JWT verify + DB profile via getCurrentProfile). There is no
//    id to enumerate, so no IDOR / bulk-deletion surface.
//  • Same-origin check: browsers' SameSite=Lax cookies already block cross-site
//    POSTs; the Origin check is defense-in-depth against CSRF regressions.
//  • Typed confirmation ("DELETE") must round-trip in the body — a drive-by script
//    can't trigger it with an empty POST.
//  • Strict rate limit (3/h per profile) — fail CLOSED; a Redis outage pauses
//    deletions (the manual support@ path still satisfies the legal deadline).
//  • Investigation hold: accounts that are held/suspended or the target of OPEN
//    reports cannot self-delete (evidence destruction by scammers); they get the
//    manual support path, which the law permits (retention for legal defense).
//
// WHAT IS DELETED vs KEPT:
//  Deleted: listings (+stats via cascade), storefront, reviews RECEIVED by the
//  storefront (required FK; the storefront they describe is gone), API keys,
//  webhooks, conversations + messages (both sides of the user's threads),
//  notifications, trust events, saved searches, push subscriptions, profile,
//  and the Supabase auth user. Storage images are purged best-effort after the
//  response. Kept: reviews the user WROTE are anonymized (author name scrubbed +
//  authorProfileId → null), and
//  resolved report records are DETACHED from the dying listings first so they
//  survive by bare target/reporter ids for the statutory retention window
//  (e-commerce records: 3 years).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY

// True if any SURVIVING row still references this image URL. Storage object paths
// are flat (`${ts}-${rand}.webp`, no per-owner namespace) and the images array is
// user-supplied, so a caller could paste a VICTIM's image URL into their own
// listing and, on deletion, wipe someone else's image with the service-role key
// (cross-tenant destruction — 2026-07-06 launch audit). Gate every delete on this
// check: run AFTER the caller's own profile/seller/listings are already removed
// from the DB, so a match means another user genuinely owns the object → skip it.
// `contains` is a substring match on the JSON blob; it can only OVER-match (leave a
// harmless orphan), never under-match the exact URL — so it can't reintroduce the bug.
async function isStillReferenced(url: string): Promise<boolean> {
  const [inListing, sellerAvatar, profileAvatar] = await Promise.all([
    db.listing.count({ where: { images: { contains: url } } }),
    db.seller.count({ where: { avatarUrl: url } }),
    db.profile.count({ where: { avatarUrl: url } }),
  ])
  return inListing > 0 || sellerAvatar > 0 || profileAvatar > 0
}

// Best-effort storage purge — never blocks or fails the deletion.
async function purgeStorageObjects(urls: string[]): Promise<void> {
  if (!SUPABASE_URL || !SECRET_KEY) return
  for (const url of [...new Set(urls)]) {
    const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (!m) continue
    // Never delete an object another (surviving) user still references.
    try { if (await isStillReferenced(url)) continue } catch { continue }
    try {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${m[1]}/${m[2]}`, {
        method: 'DELETE',
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
    } catch { /* best-effort */ }
  }
}

export async function POST(req: Request) {
  // Same-origin gate (defense-in-depth CSRF)
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (origin && host && (!URL.canParse(origin) || new URL(origin).host !== host)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { confirm?: string } = {}
  try { body = await req.json() } catch {}
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })
  }

  const gate = await rateLimit('account-delete', profile.id, 3, '1 h', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 })

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, avatarUrl: true } })

  // Investigation hold — no evidence destruction while reports are open or the
  // account is under enforcement. These users go through support (manual review).
  const underEnforcement = ['held', 'suspended'].includes(profile.enforcementState)
  const openReports = await db.report.count({
    where: {
      status: 'open',
      OR: [{ targetProfileId: profile.id }, ...(seller ? [{ targetSellerId: seller.id }] : [])],
    },
  })
  if (underEnforcement || openReports > 0) {
    return NextResponse.json(
      { error: 'under_review', message: 'Your account has open reports or an active review — contact support@eno.vn to complete deletion.' },
      { status: 409 },
    )
  }

  // Interactive transaction: re-resolve the seller INSIDE the tx (a storefront
  // created concurrently must not survive as an orphan), then reports → reviews →
  // listings → storefront → profile. FK cascades take the rest (conversations +
  // messages on both sides, notifications, trust events, keys, webhooks,
  // subscriptions); reviews the user WROTE anonymize via SetNull.
  const imageUrls: string[] = profile.avatarUrl ? [profile.avatarUrl] : []
  await db.$transaction(async (tx) => {
    const s = await tx.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, avatarUrl: true } })
    if (s) {
      const listings = await tx.listing.findMany({ where: { sellerId: s.id }, select: { id: true, images: true } })
      for (const l of listings) { try { imageUrls.push(...(JSON.parse(l.images) as string[])) } catch {} }
      if (s.avatarUrl) imageUrls.push(s.avatarUrl)
      // Resolved reports must SURVIVE for the statutory retention window, but
      // Report.listingId cascades with the listing — detach them first so the
      // record (with its bare target/reporter ids) outlives the listing. Open
      // reports can't exist here (the hold above blocks deletion).
      await tx.report.updateMany({
        where: { listingId: { in: listings.map((l) => l.id) } },
        data: { listingId: null },
      })
      // Reviews RECEIVED by this storefront: Review.sellerId is a required FK
      // (restrict) — deleting the seller with reviews attached would throw. The
      // storefront they describe is being erased; remove them with it.
      await tx.review.deleteMany({ where: { sellerId: s.id } })
      await tx.listing.deleteMany({ where: { sellerId: s.id } })
      await tx.seller.delete({ where: { id: s.id } })
    }
    // Reviews the user WROTE stay (they belong to the reviewed storefront), but the
    // captured author DISPLAY NAME renders publicly and must be erased too — nulling
    // only authorProfileId (via SetNull) would leave the name visible forever after a
    // PDPL erasure request (2026-07-06 launch audit). Scrub it before deleting the FK.
    await tx.review.updateMany({ where: { authorProfileId: profile.id }, data: { author: 'Anonymous' } })
    await tx.profile.delete({ where: { id: profile.id } })
  })

  // Remove the auth user (invalidates every session/device). Loud log on failure:
  // ensureProfile would recreate an EMPTY profile on a later sign-in — no data
  // comes back, but the orphan auth user should be cleaned up by hand.
  if (SUPABASE_URL && SECRET_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profile.id}`, {
        method: 'DELETE',
        headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) console.error('[account-delete] auth user removal failed', profile.id, res.status)
    } catch (e) {
      console.error('[account-delete] auth user removal errored', profile.id, (e as Error).name)
    }
  } else {
    console.error('[account-delete] SUPABASE_SECRET_KEY missing — auth user not removed', profile.id)
  }

  // Audit line (id only — no PII) + off-path storage purge.
  console.log('[account-delete] completed', profile.id)
  after(() => purgeStorageObjects(imageUrls))

  return NextResponse.json({ ok: true })
}
