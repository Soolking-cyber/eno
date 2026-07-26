import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import { announceTripStatus } from '@/lib/trips/dm-flow'
import { applyTripTransition, canTransition } from '@/lib/trips/status'

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await getAdmin()
  // 404, not 403: an operator surface should not confirm to a non-admin that it exists.
  if (!admin) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const current = await db.tripAssistanceRequest.findUnique({ where: { id }, select: { status: true } })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Checked here for an honest error message; applyTripTransition re-checks against the ONE map
  // regardless, so this is convenience rather than the enforcement point.
  if (!canTransition(current.status, parsed.data.next)) {
    return NextResponse.json({ error: 'invalid_status_transition', from: current.status }, { status: 409 })
  }

  const result = await applyTripTransition({
    id,
    expectedPrior: current.status,
    next: parsed.data.next,
    actorType: 'admin',
    actorRef: admin,
  })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'update_failed' ? 500 : 409
    return NextResponse.json({ error: result.error }, { status })
  }

  // ⚠️ ANNOUNCE ONLY A REAL MOVE. applyTripTransition returns ok for a repeat of the same status —
  // a double-clicked button has not failed at anything — but records no audit event for one, and a
  // card must follow the same rule or the second click posts a duplicate into the traveller's
  // thread. This is the rule assistance.ts's own transitionAsAdmin applies.
  //
  // ⚠️ AND THAT IS A SECOND COPY OF IT, which is worth naming rather than hiding: assistance.ts has
  // a private transitionAsAdmin doing exactly this composition, but it is not exported and
  // src/lib/trips/assistance.ts is not in this task's owned paths. Flagged for Alex — exporting it
  // is one line, and then the traveller path and this one cannot disagree about when a card is
  // posted. Until then the rule is duplicated here deliberately, not accidentally.
  if (current.status !== parsed.data.next) {
    await announceTripStatus({ requestId: id, status: parsed.data.next })
  }
  return NextResponse.json({ status: result.status })
}
