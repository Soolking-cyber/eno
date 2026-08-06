import { z } from 'zod'
import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { rateLimit } from '@/lib/ratelimit'
import { visaCryptoReady } from '@/lib/visa/crypto'
import { startVisaDmFlow, visaDmFailureFor } from '@/lib/visa/dm-flow'

// ONE TAP → an e-Visa case being filled out inside a chat thread.
//
// The owner's ask: "user click chat then selects available product from admin shop and
// continues uploading images and filling up the form". This route is that tap: it names a
// PRODUCT from the visa desk's catalogue and gets back a case, the thread it lives in, and
// the step the applicant is on. Everything after it is /advance and /cards/[id]/act.
//
// ⚠️ ENTITLEMENT LIVES HERE. src/lib/visa/dm-thread.ts takes no actor and says so in its
// own header: the route must authenticate and prove ownership before any card is authored.
// The proof chain on this route is:
//   getCurrentProfile()                     — the session, JWT-verified
//     → startVisaDmFlow(userId = profile.id)
//       → the case is created for that id, or reused only from `user_id = that id`
//         → bindVisaThread re-proves visa_applications.user_id == the buyer before it
//           writes Conversation.visaApplicationId (the binding every later card is
//           validated against).
// There is no branch on which a caller can reach a case, a thread or a card that is not
// their own.
//
// ⚠️ THE CLIENT NAMES A PRODUCT, NEVER A PRICE. The body is `{ listingId? }` and the schema
// is .strict(), so a client that starts sending an amount gets a loud 400 instead of having
// it quietly ignored. The đồng price is re-read from Listing.price and the dollars are a
// server-issued quote — see src/lib/visa/dm-flow.ts.
//
// listingId is OPTIONAL (Phase 2): the GENERIC "Apply" starts a product-less case — the
// thread's step-0 picker card is where the product gets chosen, via
// /api/visa/applications/[id]/select-product. A present listingId keeps the pre-chosen
// PDP/storefront path exactly as it was.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  // Listing ids are cuids, so this is a bounded opaque string — its authority comes from
  // matching a for-sale listing on the visa storefront, never from its shape.
  listingId: z.string().trim().min(1).max(64).optional(),
}).strict()

// ⚠️ WS6 MIGRATION — `auth: 'profile'` AND NOTHING ELSE.
// `auth: 'profile'` IS getCurrentProfile() + `{error:'auth_required'}` 401, which is exactly the
// preamble it replaces — and it must be `profile`, not `userId`: a fresh case is seeded with
// `profile.email` and the Profile row must exist to be the buyer side of the conversation.
//
// THE WIRE, ENUMERATED. Guest → 401 `auth_required`; no encryption key → 503
// `visa_encryption_not_configured`; throttled → 429 `rate_limited`; unparseable or non-`.strict()`
// body → 400 `invalid_request`; a refusal from startVisaDmFlow → its own `{error}` at its own
// status; success → 200 `{applicationId,conversationId,step}`; a throw inside the flow →
// visaDmFailureFor()'s `{error}` at its status.
//
// ⚠️ NEITHER THE LIMITER NOR THE SCHEMA CAN BE HOISTED, and the reason is ORDER, not shape. The
// route's order is auth → 503 env gate → limiter → body. route()'s fixed order is auth → limiter
// → body → handler, so moving either one past the `visaCryptoReady()` gate re-answers a dormant
// host: today every call there is 503, and with a hoisted limiter the 31st call in an hour is
// `{"error":"rate_limited"}` 429, with a hoisted schema a malformed body is `invalid_request` 400.
// Both are different bytes on a configuration this file explicitly handles.
//
// ⚠️ ACCEPTED EXCEPTION: the env gate, the limiter and the body parse sit outside the try, so any
// unhandled throw in them moves from Next's default 500 HTML to `{"error":"internal_error"}` 500.
// Stated as a shape — every DELIBERATE branch above is unchanged.
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  // Starting a case encrypts a payload — refuse honestly on a host without the key rather
  // than 500 halfway through.
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })

  // Two budgets, deliberately. This one bounds how often the chat surface may be re-entered
  // (it is idempotent, so a client retry loop is the realistic abuse), …
  const limit = await rateLimit('visa-dm-start', profile.id, 30, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  try {
    const started = await startVisaDmFlow({
      userId: profile.id,
      email: profile.email || '',
      listingId: parsed.data.listingId,
      // … and this one is the SAME 'visa-create' quota POST /api/visa/applications charges,
      // so the dashboard and the chat share one budget for minting government forms and the
      // chat entry point cannot be used to route around it. Consulted only on the branch
      // that really creates a case.
      allowCreate: async () => (await rateLimit('visa-create', profile.id, 5, '24 h', { strict: true })).success,
    })
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status })
    return NextResponse.json({
      applicationId: started.applicationId,
      conversationId: started.conversationId,
      step: started.step,
    })
  } catch (error) {
    // Passport-data route: the class of failure, never the driver's message.
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
})
