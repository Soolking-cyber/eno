import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdmin } from '@/lib/admin'
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
