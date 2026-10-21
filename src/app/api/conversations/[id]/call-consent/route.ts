import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { counterpartOf, hasCallConsent, loadConversationForCall, setCallConsent, threadPermitRefusal } from '@/lib/calls/server/eligibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: "ALLOW CALLS FROM <NAME>" (DESIGN.md v3 §4) ──────────────────────────────────────────────────────
//
// The callee's explicit yes, for ONE person in ONE thread, stored with the version of the words they were shown and
// when (call_consent — the consent evidence PDPL 91/2025 + Decree 356/2025 Art 6 ask for). Nothing grants it by
// default; withdrawing it (allow: false) is one tap and takes effect for the next call.
// GET  → { theyAllowMe, iAllowThem }
// POST { allow } → 200 { allow } · not_found 404 · not_participant / calls_thread_unavailable 403
// ⚠️ WITHDRAWING IS ALWAYS POSSIBLE for a participant (round-6 review): the thread rules gate a GRANT only — a listing
// sold or a thread turned desk must not leave a "yes" stuck in call_consent that its giver cannot take back.
// ⚠️ Granting consent does not make a call possible on its own: the caller still has to pass every gate in
// eligibility.ts at call time (verified, no block, the switch). It only removes "they never said yes".

const consentBody = z.strictObject({ allow: z.boolean() })

async function thread(conversationId: string, userId: string) {
  const convo = await loadConversationForCall(conversationId)
  if (!convo) throw new ApiError('not_found', 404)
  // The SAME thread rules a call obeys (eligibility.ts threadPermitRefusal): no consent is stored where no call may go.
  const refusal = await threadPermitRefusal(convo, userId)
  return { convo, refusal, other: counterpartOf(convo, userId) }
}

export const GET = route({ auth: 'userId', rateLimit: { bucket: 'calls:consent:get', limit: 120, window: '1 m' } }, async ({ params, userId }) => {
  const convo = await loadConversationForCall(params.id)
  if (!convo) throw new ApiError('not_found', 404)
  const other = counterpartOf(convo, userId)
  // The STORED answer, whatever the thread is now (round-7 review): a "yes" a participant can withdraw must also be
  // one they can see — a thread that stopped qualifying must not hide it.
  if (!other || other === userId) return { theyAllowMe: false, iAllowThem: false }
  const [theyAllowMe, iAllowThem] = await Promise.all([hasCallConsent(convo.id, other, userId), hasCallConsent(convo.id, userId, other)])
  return { theyAllowMe, iAllowThem }
})

export const POST = route(
  // A loose cap on the route; GRANTS have their own tighter one below — so no amount of toggling ever leaves a person
  // unable to withdraw (round-9 review: one shared 30 / h bucket could).
  { auth: 'userId', rateLimit: { bucket: 'calls:consent', limit: 300, window: '1 h' }, body: consentBody },
  async ({ params, userId, body }) => {
    const { convo, refusal, other } = await thread(params.id, userId)
    if (body.allow && refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    if (body.allow && !(await rateLimit('calls:consent:grant', userId, 30, '1 h')).success) throw new ApiError('rate_limited', 429)
    if (convo.buyerProfileId !== userId && convo.sellerProfileId !== userId) throw new ApiError('not_participant', 403)
    // Nobody on the other side (an unclaimed storefront) has nothing to withdraw from.
    if (other && other !== userId) await setCallConsent(convo.id, userId, other, body.allow)
    return { allow: body.allow }
  },
)
