import { z } from 'zod'
import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { askTripConcierge, TRIP_CONCIERGE_QUESTION_MAX } from '@/lib/trips/concierge'

// ASK ENO CONCIERGE, TRIP THREAD EDITION — the sibling of
// /api/visa/applications/[id]/concierge, and thin for the same reason: this file authenticates,
// throttles and unwraps the body. Ownership, the human-requested gate, the grounding, the model
// call and the two message writes all live in src/lib/trips/concierge.ts where they are tested.
// Nothing about the gate can be bypassed by adding a second caller.
//
// ⚠️ KEYED ON THE CONVERSATION, not on an itinerary. A traveller can ask about their trip before
// any assistance case exists, and the thread is the only thing that always exists — the visa
// version keys on the application because a visa thread cannot exist without one.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ `lang` is a loose string, not z.enum(['en','vi']). The app ships eleven interface languages
// while this surface's copy is EN/VI, so a Korean viewer really does send 'ko' — a strict enum
// would answer 400 and swallow their question over a preference. Anything not 'vi' is English.
const bodySchema = z.object({
  conversationId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(TRIP_CONCIERGE_QUESTION_MAX),
  lang: z.string().max(16).optional(),
}).strict()

// ⚠️ WS6 MIGRATION. `auth: 'userId'` because the old preamble WAS getCurrentProfileId() — same
// local JWT read, no Profile row, and the same 401 `auth_required`. The body schema moves into the
// wrapper with `invalidBodyCode: 'question_required'`, which reproduces both old 400 branches:
// `request.json().catch(() => null)` → safeParse(null) failed, and a well-formed body that failed
// the schema — one code for both, exactly as before.
//
// ⚠️ THE RATE LIMIT STAYS IN THE HANDLER, TWICE OVER. Its key is composite
// (`${userId}:${conversationId}`) and the wrapper only ever keys on the caller; and it must run
// AFTER validation, because conversationId comes out of the body. Hoisting it into `rateLimit:`
// would both re-key the bucket per-user (one traveller's thread throttling their others) and flip
// the order, turning a malformed body from a free 400 into a metered one.
export const POST = route(
  { auth: 'userId', body: bodySchema, invalidBodyCode: 'question_required' },
  // ⚠️ The zod error is DROPPED rather than returned: its issues quote the input, and the input is
  // a sentence the traveller typed. `invalidBodyCode` keeps that true — route() never echoes issues.
  async ({ userId, body }) => {
    // TIGHT AND STRICT. Every success spends real Gemini money AND writes two messages into a
    // two-party thread the desk cannot mute. Keyed per (actor, conversation) so one traveller
    // hammering their own thread cannot throttle anyone else; strict fails CLOSED, so a limiter
    // outage means no spend and no message rather than an unbounded one.
    const limit = await rateLimit('trip-dm-concierge', `${userId}:${body.conversationId}`, 12, '1 h', { strict: true })
    if (!limit.success) throw new ApiError('rate_limited', 429)

    // ⚠️ THE TRY/CATCH IS KEPT rather than delegated to route()'s. Both answer `internal_error`
    // 500, so the wire is the same either way — but this one logs the error's CLASS ONLY, and that
    // is deliberate: a driver message here can quote row contents. Nothing thrown inside is an
    // ApiError, so nothing gets swallowed by it.
    try {
      const asked = await askTripConcierge({
        conversationId: body.conversationId,
        userId,
        question: body.question,
        language: body.lang === 'vi' ? 'vi' : 'en',
      })
      if (!asked.ok) {
        // Returned as a Response, not thrown: the body carries `questionPosted` alongside the code,
        // and the status is the domain's own.
        return NextResponse.json(
          { error: asked.error, ...(asked.questionPosted ? { questionPosted: true } : {}) },
          { status: asked.status },
        )
      }
      return { messageId: asked.messageId }
    } catch (error) {
      // Class of failure only — never a driver message, which can quote row contents.
      console.error('[trip-concierge] route failed', error instanceof Error ? error.name : 'Error')
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  },
)
