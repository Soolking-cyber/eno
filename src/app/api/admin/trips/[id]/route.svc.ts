import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getTripDeskScope, tripRequestInScope } from '@/lib/desk-operator'
import { moveAssistanceAsAdmin } from '@/lib/trips/assistance'

/**
 * Move one trip-assistance case. The operator half of the lifecycle.
 *
 * ⚠️ THE SAME ADMIN GATE AS THE VISA QUEUE — getAdmin(), which checks the Supabase session's email
 * against ADMIN_EMAILS. A trips queue that authorised differently would be a second answer to "who
 * is an operator", and the two would drift the first time somebody changed one.
 *
 * ⚠️ THE TRANSITION GOES THROUGH applyTripTransition, never a bare update. That helper's WHERE
 * carries the expected prior status, so an operator who double-clicks — or two operators on the same
 * case — writes once and the loser is told to reload rather than overwriting a status somebody else
 * set. It also stamps timestamps and appends the audit event.
 *
 * ⚠️ NO MONEY HERE. The 10% fee is quoted in chat by quoteAssistance, which is the only writer of
 * the money columns and validates its own admin session. This route moves a case and nothing else:
 * there is no amount in its body and no monetary column in its reach.
 */
const bodySchema = z.object({ next: z.string().min(1).max(32) }).strict()

// ⚠️ WS6 — NOT MIGRATED: this IS a `getAdmin()`/ADMIN_EMAILS gate, so `auth: 'admin'` is the right
// FAMILY and still the wrong wire. A non-admin (and a guest) gets `{"error":"not_found"}` **404**
// here; the wrapper's admin branch is a hardcoded `apiFail('Forbidden', 403)`
// (src/lib/api/handler.ts:189). That is a different status AND a different body, and the 404 is not
// an accident — the line below says why in one sentence: an operator surface must not confirm to a
// non-admin that it exists. The `result.error === 'forbidden' → 404` collapse further down keeps
// the same promise for a caller who passes the gate but loses the domain's own admin check, so
// changing the first one to a 403 would make the endpoint self-contradicting as well as leaky.
//
// With the gate pinned, `body:` cannot move either: the wrapper's fixed auth → rateLimit → body
// order would parse ahead of a hand-rolled 404, so a non-admin probing with malformed JSON would
// get 400 `invalid_body` instead of 404 — the existence signal the 404 exists to withhold, handed
// over by the error code instead of the status. No limiter on this route, and `invalidBodyCode:`
// is meaningless without `body:`. All four options empty.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  /**
   * ⛔ SCOPE, NOT JUST IDENTITY. This route mutates a request's lifecycle and its quoted amounts, and
   * `TripAssistanceRequest` is shared by both deployments — so proving the caller runs A trip desk is
   * not proving the request is theirs. Same split as the visa routes: entitlement, then ownership.
   */
  const scope = await getTripDeskScope()
  // 404, not 403: an operator surface should not confirm to a non-operator that it exists — the
  // contract this route already documents above, kept unchanged by the scoping.
  if (!scope) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // ⛔ AND THIS REQUEST MUST BE THIS DESK'S — entitlement is not ownership. Same 404, so a partner
  // cannot use this route to discover that another deployment's request exists.
  if (!(await tripRequestInScope(id, scope))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const admin = scope.operator

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  // ⚠️ ONE CALL, AND THAT IS THE POINT. This route used to read the status, check the map, call
  // applyTripTransition and then re-implement the "only announce a REAL move" rule — a second copy
  // of when a card gets posted, which I flagged at the time because assistance.ts was not in T320's
  // owned paths. moveAssistanceAsAdmin now owns the whole composition, resolves its own admin, and
  // is shared with the traveller-facing paths, so the two surfaces cannot disagree.
  const result = await moveAssistanceAsAdmin({ requestId: id, next: parsed.data.next })
  if (!result.ok) {
    const status = result.error === 'request_not_found'
      ? 404
      : result.error === 'forbidden'
        // Same reasoning as the gate above: an operator surface does not confirm it exists.
        ? 404
        : result.error === 'update_failed'
          ? 500
          : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ status: parsed.data.next })
}
