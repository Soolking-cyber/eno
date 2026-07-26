import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import {
  advanceTripWizard, completeTripWizard, startTripWizard,
  type WizardError, type WizardResult,
} from '@/lib/trips/wizard-flow'

/**
 * The in-chat itinerary wizard.
 *
 * ⚠️ THIS ROUTE NEVER GENERATES. It moves a card through five steps; the traveller's client posts
 * the finished body to /api/itineraries/generate itself. That is deliberate and it is the single
 * most important property of the whole feature: generation is the most expensive path in the app
 * and it keeps exactly ONE entrance, so aiGuard('itinerary', 8), the global daily cap and the
 * Gemini daily cap all apply unchanged and are shared with the dashboard builder. One traveller,
 * one budget, whichever surface they use. A generate call proxied from here would be a second
 * entrance with its own accounting — the thing the task explicitly forbids.
 *
 * ⚠️ `answers` ARE VALIDATED AND DROPPED. They exist in the body only so a bad answer is caught on
 * the step that asked for it; nothing persists them. The wizard's card carries a step number and a
 * state, never a city, a date or the notes field.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), conversationId: z.string().min(1).max(64) }).strict(),
  z.object({
    action: z.literal('advance'),
    conversationId: z.string().min(1).max(64),
    step: z.number().int().min(1).max(5),
    // Shape-checked per step by tripWizardStepSchema inside the flow, against the SAME partition
    // the card was written from. Left loose here so there is one validator, not two.
    answers: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    action: z.literal('complete'),
    conversationId: z.string().min(1).max(64),
    // Ownership of this itinerary is proven against the session inside completeTripWizard — the
    // body naming it is not evidence that it belongs to the caller.
    itineraryId: z.string().min(1).max(64),
  }).strict(),
])

const STATUS: Record<WizardError, number> = {
  not_signed_in: 401,
  // Also the answer for a conversation that does not exist, so this cannot be used to probe which
  // thread ids are real.
  forbidden: 403,
  thread_not_found: 403,
  itinerary_not_found: 403,
  desk_unavailable: 503,
  no_active_wizard: 409,
  step_mismatch: 409,
  // The card moved under the write. Same family as step_mismatch: the client reloads, it does not
  // edit the payload and retry.
  case_changed_reload: 409,
  invalid_answers: 400,
  update_failed: 500,
}

export async function POST(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })

  // Generous enough for a real wizard run (five advances plus retries) and low enough that a loop
  // cannot fill a thread. Fails OPEN like the other trip routes: this writes no money and triggers
  // no generation, so a limiter outage must not strand somebody mid-plan.
  const limit = await rateLimit('trip-wizard', profile.id, 120, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  let result: WizardResult
  switch (parsed.data.action) {
    case 'start':
      result = await startTripWizard({ conversationId: parsed.data.conversationId })
      break
    case 'advance':
      result = await advanceTripWizard({
        conversationId: parsed.data.conversationId,
        step: parsed.data.step,
        answers: parsed.data.answers,
      })
      break
    case 'complete':
      result = await completeTripWizard({
        conversationId: parsed.data.conversationId,
        itineraryId: parsed.data.itineraryId,
      })
      break
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 })
  return NextResponse.json({ step: result.step, messageId: result.messageId })
}
