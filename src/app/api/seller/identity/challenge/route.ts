import { route } from '@/lib/api/handler'
import { challengeInstruction, issueChallenge } from '@/lib/identity/challenge'

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
  { auth: 'userId', rateLimit: { bucket: 'identity-challenge', limit: 20, window: '1 h', strict: true } },
  async ({ userId }) => {
    const issued = await issueChallenge(userId)
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
