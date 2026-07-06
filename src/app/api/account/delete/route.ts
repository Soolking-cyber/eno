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
//  Deleted: listings (+their reports/stats via cascade), storefront, API keys,
//  webhooks, conversations + messages (both sides of the user's threads),
//  notifications, trust events, saved searches, push subscriptions, profile,
//  and the Supabase auth user. Storage images are purged best-effort after the
//  response. Kept: reviews the user WROTE are anonymized (author → null), and
//  resolved report records referencing the user by bare id remain for the
//  statutory retention window (e-commerce records: 3 years).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY

// Best-effort storage purge — never blocks or fails the deletion.
async function purgeStorageObjects(urls: string[]): Promise<void> {
  if (!SUPABASE_URL || !SECRET_KEY) return
  for (const url of urls) {
    const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
    if (!m) continue
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
  if (origin && host && new URL(origin).host !== host) {
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

  // Collect storage URLs before rows disappear.
  const listings = seller
    ? await db.listing.findMany({ where: { sellerId: seller.id }, select: { images: true } })
    : []
  const imageUrls = [
    ...listings.flatMap((l) => { try { return JSON.parse(l.images) as string[] } catch { return [] } }),
    ...(seller?.avatarUrl ? [seller.avatarUrl] : []),
    ...(profile.avatarUrl ? [profile.avatarUrl] : []),
  ]

  // One transaction: listings → storefront → profile. FK cascades take the rest
  // (conversations + messages on both sides, notifications, trust events, keys,
  // webhooks, subscriptions); authored reviews anonymize via SetNull.
  await db.$transaction([
    ...(seller
      ? [db.listing.deleteMany({ where: { sellerId: seller.id } }), db.seller.delete({ where: { id: seller.id } })]
      : []),
    db.profile.delete({ where: { id: profile.id } }),
  ])

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
