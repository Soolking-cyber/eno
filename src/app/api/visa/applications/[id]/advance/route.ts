import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { advanceVisaDmFlow, visaDmFailureFor } from '@/lib/visa/dm-flow'

// THE LOOP. Recompute which of the five steps the case is on and make sure the card for it
// exists in the thread.
//
// ⚠️ IDEMPOTENT BY CONTRACT — this is the property the whole chat surface leans on. The
// client calls it after every upload, every card tap and every reconnect, so it must mean
// "ensure the card for the current step exists", never "post one". A second call with
// nothing changed returns the SAME messageId and writes nothing (see advanceVisaDmFlow).
//
// ⚠️ ENTITLEMENT LIVES HERE. dm-thread.ts authors cards without asking who is calling; this
// route proves it. `userId` from the verified session is carried into the flow, which scopes
// the case read by `user_id` AND checks Conversation.buyerProfileId, so a caller can neither
// advance somebody else's case nor make a card appear in somebody else's thread.
//
// The body is ignored on purpose: there is nothing a client could usefully say here. The
// step is a function of the encrypted payload and the uploaded documents, both server-side.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // Generous: an active applicant advances on every upload and every tap, and the call is
  // idempotent — the limit is there to stop a runaway client loop, not to pace a human.
  const limit = await rateLimit('visa-dm-advance', userId, 180, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params
  // A non-uuid segment would 400 at the uuid column rather than 404 (the visa-admin idiom).
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    const advanced = await advanceVisaDmFlow({ applicationId: id, userId })
    // FAIL CLOSED, LOUDLY. A finished form the desk cannot price (FX down, payments
    // dormant, the product withdrawn) answers a specific code with a 4xx/5xx — never a 200
    // that looks like progress. `step`/`complete` ride along so the UI keeps its place.
    if (!advanced.ok) {
      return NextResponse.json(
        { error: advanced.error, ...(advanced.step ? { step: advanced.step } : {}), ...(advanced.complete !== undefined ? { complete: advanced.complete } : {}) },
        { status: advanced.status },
      )
    }
    // messageId is null only when nothing may be posted — an admin has taken the thread
    // over (requirement 5: the wizard does not talk over a human).
    // `picker: true` = the flow's next thing is the step-0 product picker, not a form step.
    return NextResponse.json({
      step: advanced.step, messageId: advanced.messageId, complete: advanced.complete,
      ...(advanced.picker ? { picker: true } : {}),
    })
  } catch (error) {
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
