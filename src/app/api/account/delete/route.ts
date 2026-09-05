import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { purgeStorageObjects } from '@/lib/core/storage-purge'

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
//  and the Supabase auth user. Storage images are purged ON the response path —
//  see purgeStorageObjects. Kept: reviews the user WROTE are anonymized (author name scrubbed +
//  authorProfileId → null), and
//  resolved report records are DETACHED from the dying listings first so they
//  survive by bare target/reporter ids for the statutory retention window
//  (e-commerce records: 3 years).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY


// ⚠️ WS6 — NOT MIGRATED, ON FOUR INDEPENDENT COUNTS. This is the irreversible route in the cluster,
// so the bar is byte-identity, not "close enough":
//  1. THE ORIGIN GATE MUST RUN BEFORE AUTH. It answers 403 `{"error":"Forbidden"}` to a cross-site
//     POST *without* consulting the session. route()'s fixed order is auth → rateLimit → body, so
//     under the wrapper a signed-out cross-site POST would flip from 403 to 401 — the CSRF gate
//     would still hold, but its verdict would stop being the one on the wire.
//  2. A GUEST GETS `{"error":"Unauthorized"}` (capital U), not `auth_required`. The wrapper's auth
//     code is hardcoded and not configurable.
//  3. THE 400 AND 429 BODIES ARE HUMAN SENTENCES, NOT CODES — `{"error":"Confirmation required"}`
//     and `{"error":"Too many attempts — try again later"}`. Neither is an ApiErrorCode, so neither
//     can be expressed as `invalidBodyCode` or reproduced by `rateLimit:`; the delete dialog renders
//     `error` straight to the user, so "tidying" them to codes would put `rate_limited` in front of
//     a person mid-deletion.
//  4. THE LIMITER MUST STAY AFTER THE CONFIRMATION CHECK. Hoisting it would let an empty drive-by
//     POST — the case the typed confirmation exists to absorb — burn one of the 3/h strict tokens
//     and lock a real user out of deleting their own account.
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
    const s = await tx.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, avatarUrl: true, bannerUrl: true } })
    if (s) {
      const listings = await tx.listing.findMany({ where: { sellerId: s.id }, select: { id: true, images: true, video: true } })
      for (const l of listings) {
        try { imageUrls.push(...(JSON.parse(l.images) as string[])) } catch {}
        // ⚠️ THE LISTING VIDEO TOO — it was never queued, so a deleted seller's clips stayed public.
        if (l.video) imageUrls.push(l.video)
      }
      if (s.avatarUrl) imageUrls.push(s.avatarUrl)
      if (s.bannerUrl) imageUrls.push(s.bannerUrl)
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

  // Audit line (id only — no PII), then the storage purge ON the response path.
  console.log('[account-delete] completed', profile.id)
  const { residue, ...purge } = await purgeStorageObjects(imageUrls)
  // A non-zero `failed` is an INCOMPLETE ERASURE and needs a human: the DB no longer holds
  // these URLs, so nothing can retry it automatically. `residue` carries the bare storage
  // keys precisely so that remediation is possible from the log alone.
  if (purge.failed > 0) console.error('[account-delete] storage purge INCOMPLETE', profile.id, purge, residue)
  else console.log('[account-delete] storage purged', profile.id, purge)

  return NextResponse.json({ ok: true })
}
