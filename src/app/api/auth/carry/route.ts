// A teacher's step-1 answers, left here by the join form inside an app's built-in browser the moment it hands the page
// to the phone's own browser ("Continue with Google" — sign-in-form.tsx continueGoogleInBrowser). The page that opens
// there takes them back once (./take). The whole contract: src/lib/auth/carry.ts.
// ⛔ No session by definition (the visitor signs in AFTER this). Writes are held to the canonical origin by proxy.ts, the
// rate limit is per IP (generous: carriers share IPs), and the value is a bounded `#d=` string stored once under a hash of its token for 30 minutes.
import { z } from 'zod'
import { CARRY_TOKEN_RE, CARRY_VALUE_RE, canonicalCarry, putCarry } from '@/lib/auth/carry'
import { ApiError, route } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'public',
    // Per IP — and Vietnamese mobile carriers put many phones behind one (CGNAT): one write per Google tap is the use.
    rateLimit: { bucket: 'auth-carry', limit: 60, window: '10 m' },
    body: z.object({ t: z.string().regex(CARRY_TOKEN_RE), carry: z.string().regex(CARRY_VALUE_RE) }),
  },
  async ({ body }) => {
    // Step 1 only, re-encoded here: anything else in it never reaches storage (src/lib/auth/carry.ts canonicalCarry).
    const carry = canonicalCarry(body.carry)
    if (!carry) throw new ApiError('bad_request', 400)
    return { ok: await putCarry(body.t, carry) }
  },
)
