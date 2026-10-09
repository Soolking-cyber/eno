import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'
import { optInWrites } from '@/lib/teachers/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

// Token-scoped, NO auth session required (the token IS the credential, per-Profile and
// unguessable). Flips Profile.weeklyDigestOptIn — or, with `list=teacher-matches`, switches the
// teacher job-match emails off (below).
//
// POST /api/unsubscribe?token=… — RFC 8058 one-click target (mail clients POST here) and
//   the /unsubscribe page's fetch. Body {optIn:true} re-subscribes the weekly digest; default unsubscribes.
// GET  /api/unsubscribe?token=… — a bare GET (or a link scanner) must NOT mutate, so it
//   just redirects to the confirm page. Only the POST changes state.
//
// ⚠️ WS6 — NOT MIGRATED, BOTH METHODS, AND `auth:` IS THE TRAP TO NAME OUT LOUD. This is reached
// from an EMAIL by a reader who is signed out — often from the mail client itself, on a different
// device, with no cookie in sight. The token IS the credential. `auth: 'userId'`/`'profile'` would
// 401 every real unsubscribe link and leave RFC 8058 one-click broken in a way nothing would report,
// so `'public'` is the only correct mode — which means auth contributes nothing.
// Nor does anything else:
//  · NO `body:` SCHEMA IS POSSIBLE. One-click POSTs are form-encoded (`List-Unsubscribe=One-Click`),
//    NOT JSON, so `req.json()` throws on the single most important caller and the catch treats that
//    as "unsubscribe". A schema turns that into 400 and the mail client reports a failed
//    unsubscribe — the same class of change as /api/notifications/read, and worse consequences.
//  · No rate limit today, and adding one is a behaviour change, not a migration.
// That leaves all four options empty on POST. GET is a bare redirect (and a synchronous function),
// which the wrapper can only wrap in an async layer.
export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 400 })

  let optIn = false
  try {
    const body = await req.json()
    if (typeof body?.optIn === 'boolean') optIn = body.optIn
  } catch {
    /* one-click POST bodies are form-encoded (List-Unsubscribe=One-Click), not JSON → unsubscribe */
  }

  // ⛔ VERIFY A SIGNATURE FIRST, DO NOT LOOK A SECRET UP. A plaintext lookup means the
  // database holds working unsubscribe capabilities for every profile, so a backup, a
  // dump or an injection hands over the ability to toggle anyone's email preference.
  // The signed form carries the profile id and proves itself — nothing is stored, so
  // nothing can leak. See src/lib/unsubscribe-token.ts for why hashing the stored
  // column could not work: the digest rebuilds the link from that column on every send.
  const signedProfileId = verifyUnsubscribeToken(token)

  // `list=teacher-matches` (2026-09-30): the teacher job-match emails, a SEPARATE list — unsubscribing
  // from them must not touch the weekly digest, and vice versa. Signed tokens only (no legacy cuid:
  // these emails never carried one).
  if (new URL(req.url).searchParams.get('list') === 'teacher-matches') {
    if (!signedProfileId) return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
    // ⛔ NO ONE-TAP RE-SUBSCRIBE (plan review D5/E3). Turning match emails ON is a consent to AI matching (Anthropic,
    // outside Vietnam) and must be given where that notice is shown — the teacher profile (/teachers/edit), whose save
    // stamps the notice version. It used to flip matchEmailOptIn back on here, with no consent record at all.
    if (optIn) return NextResponse.json({ error: 'resubscribe_in_profile' }, { status: 400 })
    return unsubscribeTeacherMatches(signedProfileId)
  }

  const res = signedProfileId
    ? await db.profile.updateMany({ where: { id: signedProfileId }, data: { weeklyDigestOptIn: optIn } })
    // ⚠️ LEGACY FALLBACK, DELIBERATELY KEPT AND DELIBERATELY TEMPORARY. Emails already
    // sitting in inboxes carry the old cuid, and an unsubscribe link that stops working
    // is a compliance failure, not a hardening win. Remove this branch — and the
    // Profile.unsubscribeToken column with it — once the digests that used it have aged
    // out. Tracked in docs/security-checklist.md.
    : await db.profile.updateMany({ where: { unsubscribeToken: token }, data: { weeklyDigestOptIn: optIn } })

  if (res.count === 0) return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  return NextResponse.json({ ok: true, optIn })
}

/**
 * ⛔ A WITHDRAWAL IS RECORDED, NOT JUST APPLIED (PDP Law 91/2025; plan review B9/C2): matchEmailOptIn goes off and
 * matchEmailWithdrawnAt is stamped — through optInWrites, the SAME rule the profile form's save uses, so the last grant
 * (time + AI notice version) stays on record. An opt-in already off is left as it is (a repeated one-click is a no-op).
 * ⚠️ COMPARE-AND-SET, not a blind write: the update applies only if the four stored fields are still what was read, so a
 * profile save landing in between is never overwritten with stale consent evidence — the read is simply retried.
 * A valid signature for an account with no teacher profile (deleted) answers ok: there is nothing left to email.
 */
async function unsubscribeTeacherMatches(profileId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.teacherProfile.findUnique({
      where: { profileId },
      select: { id: true, matchEmailOptIn: true, matchEmailOptInAt: true, matchEmailNoticeVersion: true, matchEmailWithdrawnAt: true },
    })
    if (!row || !row.matchEmailOptIn) return NextResponse.json({ ok: true, optIn: false })
    const w = optInWrites(false, { on: true, at: row.matchEmailOptInAt, version: row.matchEmailNoticeVersion, withdrawnAt: row.matchEmailWithdrawnAt }, new Date())
    const res = await db.teacherProfile.updateMany({
      where: {
        id: row.id, matchEmailOptIn: true, matchEmailOptInAt: row.matchEmailOptInAt,
        matchEmailNoticeVersion: row.matchEmailNoticeVersion, matchEmailWithdrawnAt: row.matchEmailWithdrawnAt,
      },
      data: { matchEmailOptIn: w.on, matchEmailOptInAt: w.at, matchEmailNoticeVersion: w.version, matchEmailWithdrawnAt: w.withdrawnAt },
    })
    if (res.count === 1) return NextResponse.json({ ok: true, optIn: false })
  }
  // Three saves in a row raced this one: say so (try again) rather than claim a withdrawal that did not land.
  return NextResponse.json({ error: 'retry' }, { status: 409 })
}

export function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams
  const token = q.get('token') ?? ''
  const list = q.get('list') === 'teacher-matches' ? '&list=teacher-matches' : ''
  return NextResponse.redirect(`${ORIGIN}/unsubscribe?token=${encodeURIComponent(token)}${list}`)
}
