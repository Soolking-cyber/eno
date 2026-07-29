import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
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

export async function POST(request: Request) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  // ⚠️ The zod error is DROPPED rather than returned: its issues quote the input, and the input is
  // a sentence the traveller typed.
  if (!parsed.success) return NextResponse.json({ error: 'question_required' }, { status: 400 })

  // TIGHT AND STRICT. Every success spends real Gemini money AND writes two messages into a
  // two-party thread the desk cannot mute. Keyed per (actor, conversation) so one traveller
  // hammering their own thread cannot throttle anyone else; strict fails CLOSED, so a limiter
  // outage means no spend and no message rather than an unbounded one.
  const limit = await rateLimit('trip-dm-concierge', `${userId}:${parsed.data.conversationId}`, 12, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  try {
    const asked = await askTripConcierge({
      conversationId: parsed.data.conversationId,
      userId,
      question: parsed.data.question,
      language: parsed.data.lang === 'vi' ? 'vi' : 'en',
    })
    if (!asked.ok) {
      return NextResponse.json(
        { error: asked.error, ...(asked.questionPosted ? { questionPosted: true } : {}) },
        { status: asked.status },
      )
    }
    return NextResponse.json({ messageId: asked.messageId })
  } catch (error) {
    // Class of failure only — never a driver message, which can quote row contents.
    console.error('[trip-concierge] route failed', error instanceof Error ? error.name : 'Error')
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
