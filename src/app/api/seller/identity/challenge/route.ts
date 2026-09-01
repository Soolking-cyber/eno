import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { challengeInstruction, issueChallenge } from '@/lib/identity/challenge'
import { clientIp } from '@/lib/client-ip'
import { declarationHash } from '@/lib/compliance/declaration'

/**
 * ⛔ ISSUING A CHALLENGE NOW REQUIRES THE DECLARATION, AND THAT IS WHAT PUTS CONSENT BEFORE
 * COLLECTION. `/documents` refuses anyone without a live challenge, so this is the single door into
 * uploading an identity document — which makes "may upload" and "has affirmed" the same fact
 * instead of two facts that can drift.
 * Both plan reviewers refused recording the declaration at SUBMIT: `KycCapture` uploads each image
 * the moment it is taken, so a person who photographs their passport and then closes the tab would
 * leave documents in our private bucket with no recorded consent for having collected them.
 * ⚠️ THE VERSION COMES FROM THE CLIENT because it must be the text they ACTUALLY RENDERED. If a new
 * declaration shipped between page load and click, stamping `CURRENT_DECLARATION` here would
 * attribute to them a wording they never saw. An unrecognised id is refused, never coerced.
 */
const bodySchema = z.object({
  version: z.string().min(1).max(40),
  // ⚠️ `literal(true)`, not `boolean()`. A default or a falsy value must not be able to produce a
  // consent record; the only acceptable value is an explicit affirmative.
  accepted: z.literal(true),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mint the on-the-spot code a foreign seller writes on paper and holds in their selfie.
//
// ⛔ THE CODE IS RETURNED ONCE AND NEVER STORED IN PLAINTEXT. Only its hash reaches the store, so
// there is no "show me my code again" — the seller asks for a new one. That is deliberate: a code
// retrievable after the fact is a credential sitting in a database.
//
// ⚠️ TWO LIMITS, AND THEY GUARD DIFFERENT THINGS. The 60-second cooldown inside issueChallenge stops
// CODE-FARMING (requesting codes until one matches a photo already held, never submitting until it
// does — which a submission-only limit never sees). The hourly limiter here stops someone burning
// database writes. Neither substitutes for the other.
export const POST = route(
  {
    auth: 'userId',
    body: bodySchema as unknown as z.ZodTypeAny,
    invalidBodyCode: 'invalid_body',
    rateLimit: { bucket: 'identity-challenge', limit: 20, window: '1 h', strict: true },
  },
  async ({ req, userId, body }) => {
    const { version } = body as z.infer<typeof bodySchema>
    const hash = declarationHash(version)
    // ⚠️ AN UNKNOWN VERSION IS A 400, NOT A 500 — a stale tab after a deploy, which has a clear fix.
    if (!hash) throw new ApiError('invalid_body', 400)

    const issued = await issueChallenge(userId, {
      version,
      hash,
      declaredAt: new Date(),
      // ⚠️ `clientIp` reads cf-connecting-ip only — a client-supplied XFF in a legal record is worse
      // than no IP at all. See client-ip.ts.
      ip: clientIp(req) || null,
    })
    if (!issued.ok) {
      return Response.json(
        { error: 'cooldown', retryAfterSeconds: issued.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(issued.retryAfterSeconds), 'cache-control': 'no-store' } },
      )
    }
    return Response.json(
      { code: issued.code, expiresAt: issued.expiresAt.toISOString(), instruction: challengeInstruction(issued.code) },
      // ⛔ no-store, and it matters more here than on most routes: this body contains the one
      // secret that ties a photograph to a moment. A cached copy in a proxy defeats the mechanism.
      { headers: { 'cache-control': 'no-store' } },
    )
  },
)
