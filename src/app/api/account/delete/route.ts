import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { eraseAccount } from '@/lib/core/account-erasure'

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
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { confirm?: string } = {}
  try { body = await req.json() } catch {}
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })
  }

  const gate = await rateLimit('account-delete', profile.id, 3, '1 h', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 })

  const result = await eraseAccount(profile.id, { kind: 'self' })
  if (!result.ok) {
    if (result.code === 'under_review') {
      return NextResponse.json(
        { error: 'under_review', message: 'Your account has open reports or an active review — contact support@eno.vn to complete deletion.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
