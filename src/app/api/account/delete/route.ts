import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { currentAppleClaims, getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { appleStatusAfterErasure, eraseAccount } from '@/lib/core/account-erasure'
import { appReviewGate } from '@/lib/app-review-gates'
import { COMPANY } from '@/lib/site-legal'

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
// WHAT IS DELETED vs KEPT, and the investigation hold: src/lib/core/account-erasure.ts — the ONE
// erasure procedure, shared with the admin Users console since 2026-09-05. This route is the
// self-service wrapper: origin gate, session, typed confirmation, strict rate limit.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


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
  if (!profile) return (await repeatAfterErasure(req)) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { confirm?: string } = {}
  try { body = await req.json() } catch {}
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })
  }

  const gate = await rateLimit('account-delete', profile.id, 3, '1 h', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 })

  // The session's own word on Apple (verified locally, no round trip): it can only ADD the Apple notice (C1).
  const claims = await currentAppleClaims()
  const result = await eraseAccount(profile.id, { kind: 'self' }, { appleLinked: claims?.appleLinked === true })
  if (!result.ok) {
    if (result.code === 'under_review') {
      return NextResponse.json(
        // App Store gate `site-brand-copy` (R7): this edition's own support address once switched on —
        // support@eno.forum on eno.forum, support@eno.vn on eno.vn (the site both apps render since 2026-10-06), from site-legal.
        { error: 'under_review', message: `Your account has open reports or an active review — contact ${appReviewGate('site-brand-copy') ? COMPANY.email : 'support@eno.vn'} to complete deletion.` },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // `apple` (none | revoked | queued | manual — EraseResult in src/lib/core/account-erasure.ts): the deletion
  // dialog shows its last notice — "remove eno in your Apple Account" — for queued and manual.
  return NextResponse.json({ ok: true, apple: result.apple })
}

/**
 * ⛔ A REPEATED REQUEST AFTER A DELETION THAT SUCCEEDED (commit gate round 2, O3). A slow erasure can outlast a proxy:
 * the dialog then says "something went wrong", the person presses Delete again — and, the account being gone, got 401
 * "your session has expired — sign in again to delete your account" for a deletion that had worked (a new sign-in then
 * makes a NEW, empty account). So it answers what the first request would have — { ok: true, apple } — but only on
 * proof: the typed confirmation, a token verified LOCALLY (signature and expiry — so only within the deleted session's
 * own token lifetime) whose account has no profile, the strict limiter keyed on it as above, and GoTrue's own word that
 * the auth user is gone (appleStatusAfterErasure). Anything short of that is the old 401.
 * NOT ABUSABLE: it deletes and changes nothing, and tells the holder of the deleted account's own token only that the
 * account is gone. A session that merely failed to resolve (GoTrue down) fails the GoTrue check — 401, as before.
 */
async function repeatAfterErasure(req: Request): Promise<NextResponse | null> {
  let body: { confirm?: string } = {}
  try { body = await req.json() } catch {}
  if (body.confirm !== 'DELETE') return null
  const claims = await currentAppleClaims()
  if (!claims) return null
  const profile = await db.profile.findUnique({ where: { id: claims.id }, select: { id: true } }).catch(() => 'unknown' as const)
  if (profile) return null
  const gate = await rateLimit('account-delete', claims.id, 3, '1 h', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 })
  const apple = await appleStatusAfterErasure(claims.id, claims)
  if (!apple) return null
  console.log('[account-delete] repeat request — already erased', claims.id, { apple })
  return NextResponse.json({ ok: true, apple })
}
