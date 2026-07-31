import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { askVisaConcierge, VISA_CONCIERGE_QUESTION_MAX } from '@/lib/visa/concierge'
import { visaDmFailureFor } from '@/lib/visa/dm-flow'

// ASK ENO CONCIERGE — "also hook ai gemini 3.5 flash there so it can answer all related
// latest updates about visa application name is Eno concierge" (owner).
//
// Thin by design, exactly like the sibling visa routes: this file authenticates, throttles
// and unwraps params. Every decision — ownership, the thread binding, THE MODE GATE, the
// grounding, the AI call and the two message writes — lives in src/lib/visa/concierge.ts,
// where it is unit-tested. Nothing about the gate can be bypassed by adding a second caller.
//
// ⚠️ THE GATE, RESTATED HERE SO IT IS NOT REDISCOVERED AS A BUG: a thread in
// 'human_requested' or 'admin' gets a 409 with its own code ('human_help_pending' /
// 'admin_takeover') and NO answer. The chip is not rendered in those modes either — this is
// the second lock on the same door, because the owner said it twice and a UI-only rule is
// not a rule.
//
// ⚠️ THE QUESTION IS THE APPLICANT'S OWN TEXT. It is stored verbatim as their message (the
// /help route's note precedent) and reaches the model only through
// scrubVisaConciergeQuestion. It is never logged here, never echoed in an error, and never
// put in a URL.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ `lang` is deliberately a loose string, not z.enum(['en','vi']). The app ships ELEVEN
// interface languages (src/lib/i18n/langs.ts) while this surface's copy is EN/VI, so a
// Korean or Thai viewer really does send 'ko'/'th' — and a strict enum would answer 400 and
// swallow their question over a preference. Anything that is not 'vi' degrades to English.
const bodySchema = z.object({
  question: z.string().trim().min(1).max(VISA_CONCIERGE_QUESTION_MAX),
  lang: z.string().max(16).optional(),
}).strict()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  // A non-uuid segment would 400 at the uuid column rather than 404 (the visa-admin idiom).
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // TIGHT AND STRICT. Every success spends real Gemini money AND writes two messages into a
  // two-party thread the desk cannot mute. Keyed per (actor, application) so one applicant
  // hammering their own case cannot throttle anyone else; strict:true fails CLOSED, so a
  // limiter outage means no spend and no message rather than an unbounded one.
  const limit = await rateLimit('visa-dm-concierge', `${userId}:${id}`, 12, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  // ⚠️ The zod error is DROPPED, not returned: its issues can quote the input, and the input
  // is a sentence the applicant typed.
  if (!parsed.success) return NextResponse.json({ error: 'question_required' }, { status: 400 })

  try {
    const asked = await askVisaConcierge({
      applicationId: id,
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
    return NextResponse.json({ messageId: asked.messageId, step: asked.step })
  } catch (error) {
    // Class of failure only — these queries carry passport ciphertext (visaDmFailureFor
    // never echoes a driver message).
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
