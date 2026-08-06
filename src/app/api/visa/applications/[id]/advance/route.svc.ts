import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
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

// ⚠️ WS6 MIGRATION — auth AND the limiter both move, and this is the shape where the wrapper
// actually pays. The preamble was `getCurrentProfileId()` + 401 `auth_required` (= `auth:
// 'userId'`, and `userId` is right: the flow only needs the caller's id to scope the case) followed
// immediately by `rateLimit('visa-dm-advance', userId, 180, '1 h', { strict: true })` answering
// `{"error":"rate_limited"}` 429. route()'s fixed order is auth → limiter → handler, which is this
// route's order exactly; the key is the caller alone, and there is no env gate or early-out in
// front of the limiter to be re-ordered past. `strict` is preserved verbatim.
//
// ⚠️ Generous BY DESIGN, unchanged: an active applicant advances on every upload and every tap and
// the call is idempotent — 180/hour stops a runaway client loop, it does not pace a human.
//
// THE WIRE, ENUMERATED. Guest → 401 `auth_required`; throttled → 429 `rate_limited`; non-uuid `id`
// → 404 `not_found`; a refusal from advanceVisaDmFlow → `{error,[step],[complete]}` at its own
// status (4xx/5xx, never a 200 that looks like progress); success → 200
// `{step,messageId,complete[,picker]}`; a throw inside the flow → visaDmFailureFor()'s `{error}` at
// its status. No request body is read — the body is ignored on purpose (see the header above), so
// there is no schema to hoist and no 400 branch to preserve.
//
// ⚠️ ACCEPTED EXCEPTION: the uuid test sits outside the try, so any unhandled throw in this handler
// before it enters the try moves from Next's default 500 HTML to `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'userId', rateLimit: { bucket: 'visa-dm-advance', limit: 180, window: '1 h', strict: true } }, async ({ params, userId }) => {
  const { id } = params
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
})
