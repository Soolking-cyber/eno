import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import {
  advanceTripWizard, completeTripWizard, gotoTripWizardStep, startTripWizard, tripWizardEligibility,
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
  // Recovery only — moving BACK to an earlier step when the client's draft has outlived its
  // answers. gotoTripWizardStep refuses any forward jump, so this cannot be used to skip a step.
  z.object({
    action: z.literal('goto'),
    conversationId: z.string().min(1).max(64),
    step: z.number().int().min(1).max(5),
    // Optional CAS: the step the client believes the card is on. A changed card refuses the move.
    expectedStep: z.number().int().min(1).max(5).optional(),
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

// ⚠️ WS6 — NOT MIGRATED: a guest gets `{"error":"not_signed_in"}` 401, and the wrapper's
// `auth: 'profile'` branch is a hardcoded `apiFail('auth_required', 401)`
// (src/lib/api/handler.ts:195). Same status, different body bytes, so the auth block cannot move.
//
// With auth pinned in the handler, the other three options are empty too, and each for its own
// reason rather than by inheritance:
//   · `rateLimit:` — the wrapper runs the limiter for `auth: 'public'` keyed on `clientIp(req)`.
//     This one is keyed on `profile.id`, which only exists after the getCurrentProfile() above, so
//     hoisting it would re-key the bucket from the traveller to their IP.
//   · `body:` — the wrapper's fixed order is auth → rateLimit → body. Hoisting the schema alone
//     would parse the body BEFORE the hand-rolled 401 below, turning a signed-out caller with a
//     malformed body from 401 `not_signed_in` into 400 `invalid_body`.
//   · `invalidBodyCode:` — meaningless without `body:`.
// Four empty options is churn, so the code stands as written.
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
    case 'goto':
      result = await gotoTripWizardStep({
        conversationId: parsed.data.conversationId,
        step: parsed.data.step,
        expectedStep: parsed.data.expectedStep,
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

/**
 * Whether this thread can run a wizard. The messages page asks once per thread so it knows whether
 * to offer the entry point at all — without it the whole feature is unreachable, because nothing
 * else tells the client that a thread belongs to the trip desk.
 *
 * Deliberately NOT an existence oracle: a thread that is not the caller's answers exactly as one
 * that does not exist, and a signed-out caller gets 401 before anything is looked up.
 *
 * ⚠️ WS6 — NOT MIGRATED: same 401 body as the POST — `{"error":"not_signed_in"}`, where the wrapper
 * emits `{"error":"auth_required"}`. Nothing else here is hoistable in any case: no limiter, and no
 * JSON body (the one input is a `?conversationId=` search param, which `body:` cannot validate), so
 * all four options are empty.
 */
export async function GET(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })
  const conversationId = new URL(req.url).searchParams.get('conversationId')
  if (!conversationId) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  return NextResponse.json(await tripWizardEligibility({ conversationId }))
}
