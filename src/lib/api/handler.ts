import 'server-only'
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
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
 *
 * ⚠️ `cron` RESOLVES NO CALLER AT ALL, WHICH IS WHY IT IS A MODE AND NOT A HELPER. A scheduled
 * invocation has no session and no Profile: it proves itself with `Authorization: Bearer
 * $CRON_SECRET`. It was added (WS6, 2026-08-06) because the identical eleven-line guard —
 * a local `bearerOk()` plus the `if (!secret || !bearerOk(...))` block — was COPIED SIX TIMES:
 *   src/app/api/cron/{daily-reminders,price-stats,saved-search-alerts,video-gc,weekly-digest}/route.ts
 *   src/app/api/cron/visa-retention/route.svc.ts        (services edition)
 * All six were verified byte-identical before this mode existed. Six hand-copied
 * implementations of a timing-safe secret comparison is the exact shape this file's header
 * describes: a change to any one of them — a `Retry-After`, an allowed second secret during a
 * rotation, a log line — is six edits, so it never happens, and a drift in one of the six is a
 * silent authentication hole that nothing in the build would report.
 *
 * ⚠️ THREE PROPERTIES OF THE ORIGINAL ARE LOAD-BEARING AND ARE REPRODUCED EXACTLY. Read
 * `cronAuthorized()` below before changing any of them:
 *   · The comparison is `timingSafeEqual`, NOT `===`. A `===` on a secret returns early at the
 *     first differing byte, which leaks the secret one byte at a time to a caller who can time
 *     the response. Replacing it would be a security REGRESSION dressed as a simplification.
 *   · It FAILS CLOSED when `CRON_SECRET` is unset. An unset secret must never mean "let everyone
 *     in" on an endpoint that emails the whole user base or deletes storage objects.
 *   · The answer is `{"error":"forbidden"}` with status **401** — lowercase `forbidden`, and 401
 *     rather than the 403 the word implies. That pairing is odd and it is what is already on the
 *     wire, so it is preserved rather than tidied. (`auth: 'admin'` above emits capital-F
 *     `Forbidden` at 403; the two are genuinely different responses, which is the argument for
 *     the shared `ApiErrorCode` union, not an excuse to unify them here.)
 *
 * ⚠️ ALL SIX ARE NOW ON THIS MODE, INCLUDING `visa-retention/route.svc.ts`. That one was written
 * up here as "deliberately not migrated, a safe follow-up" because it sits in the services edition
 * (`.svc.ts`, excluded from the marketplace build by `pageExtensions`) and fell outside the cluster
 * that added this mode — and it was then picked up by the next wave the same session. The reason
 * to record that rather than just delete the sentence: the file was invisible to the migration's
 * own survey, which globbed `route.ts` and therefore missed 38 `.svc.ts` files and 45 method
 * exports. A guard copied into a directory your inventory does not glob is the exact way the
 * seventh copy gets written. There is no copy left; keep it that way.
 *
 * ⚠️ `warm-translations` LOOKS LIKE A SIXTH COPY AND IS NOT. It answers 503 `not_configured` when
 * the secret is unset (not 401), 401 `unauthorized` (not `forbidden`), and it compares the FULL
 * `authorization` header against `Bearer <secret>` rather than the token. Putting it on this mode
 * would change three response bodies and one status code, so it keeps its own guard.
 */
type AuthMode = 'public' | 'userId' | 'profile' | 'admin' | 'cron'

/**
 * The shared cron guard, byte-for-byte the `bearerOk()` the five routes each declared locally.
 * Note the `&&`: `timingSafeEqual` THROWS on unequal-length buffers, so the length check is not an
 * optimisation, it is what keeps the call legal. Comparing lengths first leaks only the secret's
 * LENGTH, which is what every existing copy already did and is not the property being protected.
 */
function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

type Ctx<A extends AuthMode, B> = {
  req: Request
  params: Record<string, string>
  /**
   * The signed-in profile. Present ONLY for `auth: 'profile'`.
   *
   * ⚠️ `null` FOR `'admin'`, AND THAT IS A FIX, NOT A LIMITATION. The admin branch used to
   * `await getCurrentProfile()` as well, on the theory that an admin route might want its own row.
   * Measured across all 11 admin routes: not one destructures `profile` or `userId` — they read
   * `admin` (the email) or nothing. So the call was pure cost, and it cost three real things:
   *   · `/api/admin/ai-health` and `/api/admin/brands/ai` touched NO database by design — a
   *     diagnostics endpoint you curl DURING an outage. `getCurrentProfile()` is unwrapped
   *     (`src/lib/admin.ts:81`), so with Postgres down they went from 200 + diagnostics to
   *     `{"error":"internal_error"}` 500. The migration silently removed the one property that
   *     made them worth having.
   *   · It fires the presence heartbeat (`db.profile.updateMany` via `after()`), so a read-only
   *     admin GET became a deferred DB WRITE.
   *   · On an admin's first-ever call it runs `ensureProfile()`, which includes the IRREVERSIBLE
   *     guest-Seller auto-claim (`src/lib/profile.ts:71-95`). An admin GET is not a place to
   *     trigger that.
   * An admin route that genuinely needs the row can call `getCurrentProfile()` itself, which is
   * exactly what it would have written before the wrapper existed.
   */
  profile: A extends 'profile' ? Profile : null
  /**
   * The caller's id, for `'userId'` and `'profile'`. `null` for `'public'` and `'admin'` — see
   * above — and `null` for `'cron'`, which authenticates a SECRET rather than a person and has no
   * id to hand over. A cron handler that needs one must resolve it itself, deliberately.
   */
  userId: A extends 'userId' | 'profile' ? string : null
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
   *
   * ⚠️ WITH `auth: 'admin'` OR `auth: 'cron'` THIS KEYS BY **IP**, NOT BY PERSON. Both modes leave
   * `userId` null (an admin is identified by email, a cron caller by a shared secret), and the key
   * below is `userId ?? clientIp(req)`. So a limit meant as "20 per admin per hour" becomes "20 per
   * SOURCE ADDRESS per hour" and the whole moderation desk sitting behind one office NAT — or every
   * scheduled invocation arriving from one scheduler — shares a single bucket. No route combines
   * them today (measured 2026-08-06: zero). If you are the first, key it by hand inside the handler
   * on `admin` (the email) instead, and do not reach for this option because it is nearer.
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
        // ⚠️ NO getCurrentProfile() HERE. See the `profile` field above: it resolved a row no admin
        // handler reads, and in doing so put an unwrapped DB call in front of two endpoints that
        // deliberately had none. getAdmin() alone is what the hand-written admin preamble did.
      } else if (opts.auth === 'profile') {
        profile = await getCurrentProfile()
        if (!profile) return apiFail('auth_required', 401)
        userId = profile.id
      } else if (opts.auth === 'cron') {
        // ⚠️ 401 WITH LOWERCASE `forbidden` — the wrong-looking pairing the five cron routes are
        // already on. Do not "fix" it to 403 or capital-F here: that is a wire change to five
        // scheduled jobs whose only client is a scheduler that branches on the status.
        // profile/admin/userId all stay null: a secret is not a caller.
        if (!cronAuthorized(req)) return apiFail('forbidden', 401)
      }

      // 2. Rate limit, keyed by caller where there is one.
      // ⚠️ SKIPPED IN LOCAL DEV ONLY (NODE_ENV === 'development' is true solely under `next dev`).
      // Interactive dev testing — walking a flow repeatedly — otherwise trips the same throttles real
      // users see, and a `strict` bucket's denied-attempt penalty then extends the window on every
      // impatient click. Deployed builds run as 'production' and vitest as 'test', so BOTH keep full
      // rate limiting (handler rate-limit tests still fire).
      if (opts.rateLimit && process.env.NODE_ENV !== 'development') {
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
        if (!rl.success) {
          // ⚠️ Carry the retry time so a client can show a COUNTDOWN instead of a vague "try later".
          // `resetSec` is when the window slot advances (see ratelimit.ts) — the honest lower bound on
          // when to retry. Additive: the body still has `error: 'rate_limited'`; `Retry-After` is the
          // standard header. apiFail() can't attach headers, so this one 429 is built inline.
          return NextResponse.json(
            { error: 'rate_limited', retryAfterSeconds: rl.resetSec },
            { status: 429, headers: { 'Retry-After': String(rl.resetSec) } },
          )
        }
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
