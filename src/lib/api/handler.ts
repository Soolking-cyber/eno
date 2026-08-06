import 'server-only'
import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { getAdmin, getCurrentProfile, getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import type { ApiErrorCode } from '@/lib/api/errors'

/**
 * THE PREAMBLE EVERY FIRST-PARTY ROUTE RETYPES.
 *
 * ⚠️ WHAT IT REPLACES, LITERALLY. 167 first-party handlers open with some subset of the same five
 * blocks — resolve the caller, rate-limit, parse the body, validate it, shape the error — written
 * out by hand each time. The consequences are measurable rather than aesthetic:
 *   · 669 ad-hoc `NextResponse.json({ error })` returns across 197 distinct codes, including
 *     `forbidden` (21) alongside `Forbidden` (16) — nothing ever forced a choice.
 *   · 96 handlers read a request body and only 30 validate it with zod; the rest hand-coerce with
 *     `String(body.x || '').trim()`, which silently accepts an object, an array or a number.
 *   · a policy change — a Retry-After header, a request-id, a body cap — is 167 edits, so it never
 *     happens.
 *
 * ⚠️ THE ERROR SHAPE IS UNCHANGED, ON PURPOSE. This emits exactly `{ error: '<code>' }` with the
 * same status codes the hand-written blocks use today, because clients branch on those strings and
 * `/api/v1`'s richer `{ error: { code, message } }` envelope is a different contract. Adopting the
 * wrapper is therefore byte-identical on the wire, one route at a time, with no client
 * coordination — which is the only reason a 167-route migration is safe to start.
 *
 * ⚠️ IT IS NOT FOR `/api/v1`. That surface already has `resolveApiKey` + `apiOk`/`apiError` and a
 * deliberately different envelope. Do not point this at it.
 *
 *   export const POST = route(
 *     { auth: 'profile', rateLimit: { bucket: 'conversation-create', limit: 30, window: '1 h' },
 *       body: z.object({ listingId: z.string().min(1) }) },
 *     async ({ profile, body }) => ({ id: await createConversation(profile.id, body.listingId) }),
 *   )
 */

type Profile = NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>

/** Thrown by a handler to return a specific code+status without constructing a Response. */
export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status = 400) {
    super(code)
    this.name = 'ApiError'
  }
}

export function apiFail(code: ApiErrorCode, status = 400): NextResponse {
  return NextResponse.json({ error: code }, { status })
}

/**
 * ⚠️ `userId` EXISTS SO THE WRAPPER CANNOT MAKE A HOT PATH SLOWER.
 * `getCurrentProfile()` verifies the JWT with the auth server, reads the Profile row and lazily
 * provisions it; `getCurrentProfileId()` verifies the JWT LOCALLY from cached JWKS with no network
 * and no DB. `src/lib/admin.ts` says so in as many words and warns against adding work to it,
 * because it is what the messaging read/write paths call. If a route only needs "who is this",
 * upgrading it to `profile` to fit the wrapper would be the wrapper making the codebase worse.
 *
 * The trade-off is real and belongs at the call site: `userId` means server-side revocation takes
 * effect at token expiry (~1h) rather than instantly, which is fine for participant checks and NOT
 * fine for admin powers.
 */
type AuthMode = 'public' | 'userId' | 'profile' | 'admin'

type Ctx<A extends AuthMode, B> = {
  req: Request
  params: Record<string, string>
  /** The signed-in profile. Typed as present for `auth: 'profile'`, `null` for `'public'`/`'userId'`. */
  profile: A extends 'profile' ? Profile : A extends 'admin' ? Profile | null : null
  /** The caller's id. Present for every authed mode; the ONLY thing `auth: 'userId'` resolves. */
  userId: A extends 'public' ? null : string
  /** The admin's email for `auth: 'admin'`. */
  admin: A extends 'admin' ? string : null
  /** Parsed and validated body, when a schema was given. */
  body: B
}

type Options<A extends AuthMode, S extends z.ZodTypeAny | undefined> = {
  auth?: A
  /**
   * Sliding window keyed by profile id (or client IP for `auth: 'public'`). `strict: true` fails
   * CLOSED — use it on paid or PII-adjacent routes, matching the existing convention in
   * `src/lib/ratelimit.ts`.
   */
  rateLimit?: { bucket: string; limit: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}`; strict?: boolean }
  /** A zod schema. Its absence is what makes the 66 unvalidated handlers visible in a grep. */
  body?: S
  /**
   * Code returned when the body fails validation. Defaults to `bad_request`, but a route that
   * already returns `invalid_body` keeps returning it — the wrapper must not change the wire.
   */
  invalidBodyCode?: ApiErrorCode
}

export function route<A extends AuthMode = 'public', S extends z.ZodTypeAny | undefined = undefined>(
  opts: Options<A, S>,
  handler: (ctx: Ctx<A, S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>,
) {
  return async (req: Request, next?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      const params = (await next?.params) ?? {}

      // 1. Caller. `getCurrentProfile()` is what 102 of the 167 handlers already call.
      let profile: Profile | null = null
      let admin: string | null = null
      let userId: string | null = null
      if (opts.auth === 'userId') {
        userId = await getCurrentProfileId()
        if (!userId) return apiFail('auth_required', 401)
      } else if (opts.auth === 'admin') {
        admin = await getAdmin()
        if (!admin) return apiFail('Forbidden', 403) // capital F: 16 admin routes emit exactly this
        profile = await getCurrentProfile()
        userId = profile?.id ?? null
      } else if (opts.auth === 'profile') {
        profile = await getCurrentProfile()
        if (!profile) return apiFail('auth_required', 401)
        userId = profile.id
      }

      // 2. Rate limit, keyed by caller where there is one.
      if (opts.rateLimit) {
        const { bucket, limit, window, strict } = opts.rateLimit
        /**
         * ⚠️ `clientIp()`, NOT A HAND-ROLLED cf-connecting-ip READ. The first draft fell back to a
         * literal `'anon'` when that header was absent, which pools EVERY unauthenticated caller
         * into one bucket — so off-Cloudflare traffic (local dev, e2e, any other ingress) would
         * share a single limit and throttle each other globally. `src/lib/client-ip.ts` already
         * resolves cf-connecting-ip → x-real-ip → the first XFF hop, and every other rate-limited
         * route in this codebase uses it.
         */
        const key = userId ?? clientIp(req)
        const rl = await rateLimit(bucket, key, limit, window, strict ? { strict: true } : undefined)
        if (!rl.success) return apiFail('rate_limited', 429)
      }

      // 3. Body. Parsed once, validated once, and a malformed body is a 400 rather than a throw.
      let body: unknown = undefined
      if (opts.body) {
        let raw: unknown
        try { raw = await req.json() } catch { return apiFail(opts.invalidBodyCode ?? 'bad_request', 400) }
        const parsed = opts.body.safeParse(raw)
        if (!parsed.success) return apiFail(opts.invalidBodyCode ?? 'bad_request', 400)
        body = parsed.data
      }

      const data = await handler({ req, params, profile, admin, userId, body } as Ctx<A, never>)
      if (data instanceof Response) return data // an escape hatch for redirects and streams
      return NextResponse.json(data ?? {})
    } catch (e) {
      if (e instanceof ApiError) return apiFail(e.code, e.status)
      /**
       * ⚠️ REPORTED, THEN A GENERIC 500 — never the exception text. An unhandled throw here is a bug,
       * and its message can carry a Prisma query, a connection string or a seller's phone number.
       * `src/instrumentation.ts` also sees this via onRequestError; logging with an `op` is what
       * makes it greppable by route rather than only findable by stack.
       */
      logError(e, { op: 'route.unhandled', path: new URL(req.url).pathname, method: req.method })
      return apiFail('internal_error', 500)
    }
  }
}
