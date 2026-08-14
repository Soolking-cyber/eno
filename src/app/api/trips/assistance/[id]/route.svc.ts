import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import {
  acceptQuote, cancelAssistance, declineQuote, quoteAssistance, startReview, viewAssistance,
  type AssistanceResult,
} from '@/lib/trips/assistance'
import { assistanceHttpStatus } from '@/lib/trips/http'

/**
 * Act on an assistance case.
 *
 * ⚠️ THE `quote` ACTION CARRIES TWO MONEY FIELDS IN THE REQUEST BODY, and that is not the rule
 * being broken — it is the rule's actual shape. "No amount from a request body" exists to stop a
 * BUYER influencing a price. Here an operator types the numbers, so they can only ever arrive
 * over HTTP; what makes it safe is that quoteAssistance resolves getAdmin() itself and refuses
 * everyone else, and that the traveller-facing actions below have no amount field at all. A
 * traveller sending { action: 'quote', feeVnd: 0 } gets 403 from the domain, not a discount.
 *
 * The dispatch deliberately does NOT check admin-ness here. Each lifecycle function resolves its
 * own actor, so a second copy of that check in the route would be a second thing to drift — and
 * the one in the domain is the one that actually guards the write.
 */
const bodySchema = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('accept') }).strict(),
    z.object({ action: z.literal('decline') }).strict(),
    z.object({ action: z.literal('cancel') }).strict(),
    z.object({ action: z.literal('review') }).strict(),
    z.object({
      action: z.literal('quote'),
      // Bounds are re-checked in the domain (isVnd); these are here so a malformed operator
      // payload is a 400 with a clear message rather than a domain error.
      supplierTotalVnd: z.number().int().min(0).max(2_147_483_647),
      feeVnd: z.number().int().min(0).max(2_147_483_647),
    }).strict(),
  ])

// ⚠️ WS6 — NOT MIGRATED: a guest gets `{"error":"not_signed_in"}` 401 here, where the wrapper's
// `auth: 'profile'` emits `{"error":"auth_required"}` 401 (src/lib/api/handler.ts:195) — a
// different body at the same status.
//
// ⚠️ AND A SECOND, INDEPENDENT ONE WORTH STATING SEPARATELY, because it survives even if that code
// were ever unified: the authorisation is not this route's. Every lifecycle function resolves its
// OWN actor (`quoteAssistance` calls getAdmin(), the traveller paths resolve the session) and
// answers more than 401 — 403 `forbidden`, 404 `request_not_found`, 409 `invalid_status_transition`
// — through `assistanceHttpStatus`. An `auth:` mode would resolve the caller a second time and buy
// no wire change at all; the check that guards the write is the domain's, as the header above says.
// The limiter (keyed `profile.id`) and the body parse both sit behind that identity call, so with
// auth pinned all four options are empty.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Reject anonymous callers and key the rate limit. The AUTHORISATION belongs to the domain
  // functions, which resolve their own actor — this is only "is anybody there?".
  //
  // One identity check suffices for both kinds of actor: getAdmin() reads the same Supabase
  // session, so an admin is always a signed-in user with a profile too. A `?? await getAdmin()`
  // fallback here would be dead code implying otherwise.
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })

  const limit = await rateLimit('trip-assist-action', profile.id, 60, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  let result: AssistanceResult
  switch (parsed.data.action) {
    case 'accept': result = await acceptQuote({ requestId: id }); break
    case 'decline': result = await declineQuote({ requestId: id }); break
    case 'cancel': result = await cancelAssistance({ requestId: id }); break
    case 'review': result = await startReview({ requestId: id }); break
    case 'quote':
      result = await quoteAssistance({
        requestId: id,
        supplierTotalVnd: parsed.data.supplierTotalVnd,
        feeVnd: parsed.data.feeVnd,
      })
      break
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: assistanceHttpStatus(result.error) })
  return NextResponse.json({ requestId: result.requestId })
}

/**
 * The live read behind a quote card. Its whole reason for existing is that the message row carries
 * no amount — see TripQuoteMeta — so the numbers must come from the case on every render.
 *
 * Authorisation is viewAssistance's, not this route's: traveller or admin, nobody else. A stranger
 * gets 403 rather than 404, so the endpoint never confirms which case ids are real.
 *
 * ⚠️ WS6 — NOT MIGRATED: this handler contains NO auth block to hoist. `viewAssistance` resolves the
 * caller itself and is the only thing that answers — 401 `not_signed_in`, 403 `forbidden`, or the
 * case — via `assistanceHttpStatus` (src/lib/trips/http.ts). Adding `auth: 'profile'` would resolve
 * the session a SECOND time and replace that 401's body with `auth_required`, which is both a wire
 * change and a duplicated identity resolution. No limiter and no JSON body: all four options empty.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await viewAssistance({ requestId: id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: assistanceHttpStatus(result.error) })
  return NextResponse.json(result.data)
}
