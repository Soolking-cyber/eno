import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { issueChallenge } from '@/lib/identity/challenge'
import { clientIp } from '@/lib/client-ip'
import { CURRENT_DECLARATION, declarationHash } from '@/lib/compliance/declaration'

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
 * ⛔ AND A SUPERSEDED ONE IS REFUSED TOO (identity-v2, owner 2026-10-16): only CURRENT_DECLARATION is
 * issuable. identity-v2 added the teacher's consent to "Identity verified" (clause 5); a tab rendered
 * before it shipped — or any client that hard-codes 'identity-v1', like the shelved SwiftUI app — would
 * otherwise keep minting records under the old words for as long as it stays open, and the cohort the
 * owner showed WITHOUT that clause would never close. Neither stamped nor coerced: 409 `notice_changed`
 * with notice 'declaration'. A verify page rendered by THIS build or later says "reload" (it renders the
 * current text to be read and ticked again). ⚠️ A page rendered BEFORE this build — the one case this
 * refusal exists for — runs the old code, which has no 409 branch: it shows its generic "We could not start
 * verification. Please try again." on every try, and its next LOAD is the new page (commit gate, opus
 * round 1: answered, not changed — no deploy can teach a page already in a tab a new answer; accepting v1
 * instead would keep the cohort open, and the identities ever verified number two). Nothing is recorded
 * (no challenge, no declaration). An old version stays in
 * DECLARATIONS because its records still point at it; it is just never issued again.
 * ⚠️ Residual, by construction: a v1 challenge minted in the 10 minutes before the deploy
 * (CHALLENGE_TTL_SECONDS) can still be consumed after it, and a v1 case pending at the deploy is approved
 * as v1 — both join the v1 cohort (docs/compliance/pdpl-dossier-draft.md, purpose 8b).
 */
const bodySchema = z.object({
  version: z.string().min(1).max(40),
  // ⚠️ `literal(true)`, not `boolean()`. A default or a falsy value must not be able to produce a
  // consent record; the only acceptable value is an explicit affirmative.
  accepted: z.literal(true),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mint the challenge for ONE capture attempt — since 2026-09-04 three things and no longer a photo proof: the CONSENT
// RECEIPT (issued only on the affirmed declaration, which rides on it to the verification row), the UPLOAD GATE
// (/documents refuses without a live one) and the SINGLE-USE TOKEN the submission burns. ⛔ Nobody writes it on paper
// or holds it in a selfie any more (4ac85c0da; the reviewer compares the face with the document — 871b1a9ba), so the
// answer carries no instruction (A3, 2026-10-16): the page keeps the code only to submit it.
//
// ⛔ THE CODE IS RETURNED ONCE AND NEVER STORED IN PLAINTEXT. Only its hash reaches the store, so
// there is no "show me my code again" — the seller asks for a new one. That is deliberate: a code
// retrievable after the fact is a credential sitting in a database.
//
// ⚠️ TWO LIMITS, AND THEY GUARD DIFFERENT THINGS. The 60-second cooldown inside issueChallenge stops
// CODE-FARMING — minting tokens in a loop, which a submission-only limit never sees (it dates from the selfie code,
// when a farm could request codes until one matched a photo already held; it still bounds issuance). The hourly
// limiter here stops someone burning database writes. Neither substitutes for the other.
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
    // ⛔ A KNOWN BUT SUPERSEDED VERSION IS A 409 THE PAGE TURNS INTO "RELOAD" (see the header) — checked BEFORE
    // issueChallenge, so the refusal writes nothing and starts no cooldown.
    if (version !== CURRENT_DECLARATION) {
      return Response.json(
        { error: 'notice_changed', notice: 'declaration' },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      )
    }

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
      { code: issued.code, expiresAt: issued.expiresAt.toISOString() },
      // ⛔ no-store, and it matters more here than on most routes: this body carries a LIVE single-use token — the
      // key to this account's upload gate and submission. A cached copy in a proxy could be spent by someone else.
      { headers: { 'cache-control': 'no-store' } },
    )
  },
)
