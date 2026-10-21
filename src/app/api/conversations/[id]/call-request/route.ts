import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { CALL_CONSENT_IMPLIED_VERSION, callPermit, hasCallConsent, loadConversationForCall, setCallConsent } from '@/lib/calls/server/eligibility'
import { writeCallRequest } from '@/lib/calls/server/cards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: "<NAME> WOULD LIKE TO CALL YOU" (DESIGN.md v3 §4 — the message-request pattern) ──────────────────
//
// A caller without the other person's consent asks for it: a 'call_request' row lands in the thread with an Allow
// calls button on the recipient's side, plus a bell row and a push. Asking also grants the asker's OWN consent the
// other way — whoever asked to call you may obviously call you back.
//   · the asker must already pass every call gate except consent (eligibility.ts callPermit, audio) — no request is
//     sent for a call that could not happen anyway;
//   · one request per thread per asker per 24 h (call_request_cooldown 429) — asking is not a way to nag;
//   · 200 { requested: false, alreadyAllowed: true } when they already allow calls from the asker.

export const POST = route({ auth: 'userId', rateLimit: { bucket: 'calls:request', limit: 10, window: '1 h' } }, async ({ params, userId }) => {
  const convo = await loadConversationForCall(params.id)
  if (!convo) throw new ApiError('not_found', 404)
  const permit = await callPermit(convo, userId, 'audio')
  if (!permit.ok) return NextResponse.json({ error: permit.error }, { status: permit.status })
  if (await hasCallConsent(convo.id, permit.calleeId, userId)) return { requested: false, alreadyAllowed: true }

  const key = `callreq:${convo.id}:${userId}`
  // null = this asker already asked here today. A FAILED claim throws instead (a 500) — a store outage must not tell
  // every asker they already asked (round-5 review).
  const claimed = await kv.set(key, 1, { nx: true, ex: 86_400 })
  if (claimed === null) throw new ApiError('call_request_cooldown', 429)
  try {
    // The asker's own consent first (harmless on its own, idempotent, and recorded as IMPLIED — eligibility.ts) — first
    // so that a retry after a failed card writes exactly ONE card. Then the card, BEFORE answering (commit-gate
    // review): "requested" must mean the recipient can see it. Its bell and push are best-effort inside
    // writeCallRequest; a thread gone meanwhile, or any failure, frees the cooldown so the asker can retry.
    await setCallConsent(convo.id, userId, permit.calleeId, true, CALL_CONSENT_IMPLIED_VERSION)
    if (!(await writeCallRequest(convo.id, userId, permit.calleeId))) throw new ApiError('not_found', 404)
  } catch (e) {
    await kv.del(key).catch((err) => logError(err, { op: 'calls.request.release' }))
    throw e
  }
  return { requested: true, alreadyAllowed: false }
})
