import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { rateLimit, kv } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { canonicalEmail } from '@/lib/email-alias'
import { normalizePhoneForRouting } from '@/lib/phone'
import { route } from '@/lib/api/handler'

// Password sign-in — eno.vn's own endpoint, deliberately NOT the client SDK's
// signInWithPassword.
//
// ⚠️ WHY THIS IS A SERVER ROUTE AND NOT A ONE-LINE CLIENT CALL. Both external reviewers
// landed on the same point at plan stage, and it is the whole reason this file exists:
// calling supabase.auth.signInWithPassword() from the browser hands the visitor GoTrue's
// raw error, and GoTrue distinguishes "no such user" from "wrong password". This app has
// spent real effort making account existence unknowable to an unauthenticated caller —
// api/auth/email-link returns a generic 200 for every outcome, and a wrong emailed code
// returns a byte-identical 403 whether or not the account exists. A client-side password
// call would have handed that back in a single line, and it would have been an ORACLE FOR
// EVERY EMAIL AND PHONE NUMBER ON THE PLATFORM, which is worse than the feature is worth.
// Routing it here means one generic failure for every cause, and our own rate limits.
//
// ⚠️ THE CAPTCHA TOKEN IS FORWARDED, NOT VERIFIED HERE — this is the one place this route
// deliberately differs from api/auth/email-link, which calls verifyTurnstile() itself.
// A Turnstile token is SINGLE-USE: verifying it against siteverify here would consume it,
// and the upstream call below would then be rejected by Supabase's own captcha check with
// no way to satisfy it. Measured 2026-08-10 against this project: an unauthenticated POST
// to /auth/v1/token?grant_type=password answers
//   400 {"error_code":"captcha_failed","msg":"captcha protection: request disallowed"}
// so the captcha IS enforced upstream on this grant and does not need a second owner. We
// keep our rate limits in front of it regardless, because they are keyed on things
// Supabase's are not (our own IP extraction, and a per-identifier lockout).
//
// SESSION HANDLING. createSupabaseServer() is the @supabase/ssr cookie client, so a
// successful sign-in writes the auth cookies from here and the browser singleton picks the
// same session up — the password never passes through the client SDK, and no tokens travel
// back in this response body for a script to scrape.

/** Same ceiling the email sender uses for a typed address. */
const MAX_IDENTIFIER = 254
/** Long enough for a passphrase, bounded so a megabyte body cannot reach bcrypt. */
const MAX_PASSWORD = 200

// ⚠️ THE LOCKOUT COUNTS FAILURES, NOT ATTEMPTS — and it is NOT escalatingCooldown().
// The first version of this route reached for escalatingCooldown() because that is what
// api/auth/email-link uses, and it was wrong here in a way that only shows up on the happy
// path: rl_cooldown_claim() CLAIMS a step on every call, so it does not distinguish a
// failed sign-in from a successful one. A user who simply signed in five times would have
// been told to wait half an hour. Sends are the right shape for that helper (every send
// costs money and every send is the thing being limited); sign-ins are not, because the
// successful ones must be free.
//
// So: a counter in kv, incremented ONLY on failure and DELETED on success, carrying its own
// unlock deadline so the 429 can name a real wait.
// ⚠️ A FIXED WINDOW, NOT AN ESCALATING LADDER — AND THE LADDER WAS DEAD CODE.
// Round 2 of review said the counter must not grow forever (one wrong password per expiry
// pins a known address at the top step permanently — a denial of service on any account
// whose address you can spell). Round 3 then showed that the reset I added to fix that made
// the ladder UNREACHABLE: a lock always lands at n=5, waiting it out resets n to 1, so
// 300/900/1800 could never occur and an attacker simply got five fresh guesses every minute.
// I verified it by simulating the sequence rather than reasoning about it — n never exceeded 5.
//
// Those two findings are not both satisfiable by an escalating per-identifier lock: either
// serving a lock clears the run (ladder dead) or it does not (permanent lockout by a third
// party). So the escalation is gone. Five failures inside a fifteen-minute window locks the
// PASSWORD PATH for the remainder of that window, and the window then expires on its own.
//
// What makes that enough: this lock is defence in depth, not the primary control. Ahead of it
// sit Supabase's own captcha on the grant, Supabase's own rate limits, the project's password
// policy, and the per-IP ceiling above. And behind it, the account is never actually locked —
// a code or a magic link still signs the real owner in, which is the property that makes a
// bounded, non-escalating window the right trade here rather than a timid one.
const FAILURES_BEFORE_LOCK = 5
/** Failures are counted, and a lock lasts, within one window of this length. */
const FAILURE_WINDOW_SEC = 900

/**
 * A single failure shape for EVERY cause: no such account, no password set on the
 * account, wrong password, unconfirmed identity, phone provider disabled upstream.
 * ⚠️ Do not add a `reason` field, and do not vary the status. The whole point is that a
 * caller cannot tell these apart. `bad_credentials` is what the client renders as
 * "Wrong email or password" — the copy names both fields precisely so it implies nothing
 * about which one was recognised.
 */
const GENERIC_FAILURE = { error: 'bad_credentials' } as const

/**
 * Floor every failed attempt at the same wall-clock cost.
 *
 * ⚠️ A UNIFORM BODY IS NOT A UNIFORM ANSWER — codex raised this at plan stage and it is
 * the non-obvious half. GoTrue only reaches the bcrypt comparison when the account
 * actually exists, so "no such user" returns measurably FASTER than "wrong password", and
 * the difference is a timing oracle that says exactly what the status code refuses to. A
 * fixed floor costs a real user nothing (they are already waiting on a network round trip)
 * and removes the signal. The floor must sit ABOVE the slow path, not the fast one.
 *
 * ⚠️ THE BASELINE IS TAKEN IMMEDIATELY BEFORE THE UPSTREAM CALL, NOT AT THE TOP OF THE
 * HANDLER — and that distinction is the whole control. The first version started the clock
 * on entry, which a reviewer correctly identified as self-defeating: an attacker who
 * slow-drips the request body for a second (trivial, and the body is read before any of
 * this) exhausts the floor budget before the sign-in even starts, `failAfterFloor` then
 * pads by zero, and the raw fast-vs-slow difference is handed straight back. Measuring only
 * the span this function is actually trying to mask means body timing, rate-limit lookups
 * and lockout reads cannot eat it.
 */
const FAILURE_FLOOR_MS = 900

async function failAfterFloor(startedAt: number) {
  const elapsed = Date.now() - startedAt
  if (elapsed < FAILURE_FLOOR_MS) {
    await new Promise((r) => setTimeout(r, FAILURE_FLOOR_MS - elapsed))
  }
  return NextResponse.json(GENERIC_FAILURE, { status: 401 })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * One phone number → one string, using the app's OWN normaliser rather than a second copy.
 *
 * ⚠️ THIS FILE USED TO HAND-ROLL IT, AND THAT WAS THE BUG. The local version did
 * `startsWith('0') ? '+84'+rest : '+'+digits`, which a reviewer showed mangles foreign
 * numbers — and because the result also KEYS THE LOCKOUT, an Australian mistyping
 * `0455 123 456` five times would have locked a real Vietnamese account out of password
 * sign-in. Exactly the cross-account denial of service the `@`-branch fix above exists to
 * stop, reached through a different door. Two normalisers is the actual defect; there is now
 * one, shared with the OTP path, so the string this produces is the same string the account
 * was created under.
 *
 * normalizePhoneForRouting returns bare digits; GoTrue wants E.164, hence the '+'.
 */
function canonicalPhone(input: string): string {
  const d = normalizePhoneForRouting(input)
  return d ? `+${d}` : ''
}

export const POST = route({ auth: 'public' }, async ({ req }) => {
  let body: { identifier?: string; password?: string; captchaToken?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  // ⚠️ `null` IS VALID JSON. req.json() parses the body `null` successfully, and the very next
  // property read then throws — a 500 where a 400 was intended. Caught by a reviewer; the
  // `catch` above only covers UNPARSEABLE bodies, which is a different thing.
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const typed = String(body.identifier || '').trim()
  const password = String(body.password || '')
  if (!typed || typed.length > MAX_IDENTIFIER || !password || password.length > MAX_PASSWORD) {
    // The caller's own input is malformed — safe to name, and it never reached an account.
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const ip = clientIp(req)

  // 1) Per-IP ceiling FIRST — the limit an attacker cannot shed by varying the identifier,
  //    and checking it before the per-account lockout means a spray across many accounts
  //    does not get a fresh lockout budget for each one. Same ordering, and the same
  //    reasoning, as api/auth/email-link. strict: a limiter outage DENIES, because the
  //    thing being protected here is every password on the platform.
  const ipLimit = await rateLimit('auth-password-ip', ip, 20, '15 m', { strict: true })
  if (!ipLimit.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // Normalise to the SAME string the account is keyed on before it is used for the lockout
  // or the upstream call. An email alias (support@eno.vn → support@eno.forum) must consume
  // the real account's lockout budget rather than getting its own.
  // ⚠️ AN "@" MAKES IT AN EMAIL, FULL STOP — IT MUST NEVER FALL THROUGH TO THE PHONE BRANCH.
  // A reviewer found a cross-account denial of service here: `84901234567@gmail` fails
  // EMAIL_RE (no dot in the domain), dropped to the phone branch, had its digits extracted to
  // `+84901234567`, and so burned the LOCKOUT BUDGET OF A PHONE ACCOUNT THE ATTACKER DOES NOT
  // OWN. Anyone could lock any number out of password sign-in by typing it into the email box
  // with a junk domain. Deciding the branch on "@" — rather than on whether the whole string
  // is a valid address — means a malformed email can only ever be rejected as a malformed
  // email, and can never be re-read as somebody else's identifier.
  const looksLikeEmail = typed.includes('@')
  if (looksLikeEmail && !EMAIL_RE.test(typed)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const isEmail = looksLikeEmail
  const identifier = isEmail ? canonicalEmail(typed.toLowerCase()) : canonicalPhone(typed)
  // ⚠️ REJECT AN IDENTIFIER THAT NORMALISED TO NOTHING. A reviewer pointed out that the form
  // gates the password button on `email.includes('@')` while EMAIL_RE here also wants a dotted
  // domain, so `a@b` reaches this line, falls to the phone branch, strips to '' — and then
  // every such caller would share the single lockout key `pwfail:` and send an empty phone
  // upstream. Two disagreeing validators is the actual defect; this makes the stricter one
  // fail loudly instead of silently pooling unrelated callers into one bucket.
  if (!identifier) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  // 2) Per-identifier failure lockout. Protects ONE account from a stuffing run that
  //    rotates IPs, which the per-IP ceiling cannot see. Four failures are free (a real
  //    person mistyping), then it climbs.
  //
  //    ⚠️ THE LOCKOUT IS NOT AN ORACLE, because it is keyed on the identifier the CALLER
  //    typed and applies whether or not that account exists. Locking only real accounts
  //    would have made the 429 itself the answer to "does this address exist?".
  //
  //    ⚠️ FAILS CLOSED. kv throws on a backend outage rather than returning a default, and
  //    a password endpoint with its lockout silently disabled is exactly the state an
  //    attacker wants. The passwordless routes stay up either way, so denying here costs a
  //    user one alternative rather than their account.
  const lockKey = `pwfail:${identifier}`
  let record: { n: number; until: number; startedAt?: number } | null
  try {
    record = await kv.get<{ n: number; until: number; startedAt?: number }>(lockKey)
  } catch (e) {
    console.error('[auth/password] lockout backend unavailable — denying', e)
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  const now = Date.now()
  // The run is only current within one window; an older record is a fresh start, which is
  // what stops a slow drip from accumulating indefinitely.
  if (record && record.until <= now && record.until > 0) record = null
  if (record && now - (record.startedAt ?? 0) > FAILURE_WINDOW_SEC * 1000) record = null
  if (record && record.until > now) {
    const retryAfterSec = Math.ceil((record.until - now) / 1000)
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec },
      { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
    )
  }

  const sb = await createSupabaseServer()
  const credentials = isEmail
    ? { email: identifier, password, options: { captchaToken: body.captchaToken } }
    : { phone: identifier, password, options: { captchaToken: body.captchaToken } }

  // ⚠️ THE TIMING-FLOOR BASELINE. Here, not at the top of the handler — see FAILURE_FLOOR_MS.
  const startedAt = Date.now()
  const { data, error } = await sb.auth.signInWithPassword(credentials)

  if (error || !data.session) {
    // ⚠️ LOG THE CAUSE, RETURN NONE OF IT. Operators need to tell "wrong password" from
    // "phone logins are disabled on this project" — the second is a dashboard state that
    // would otherwise look exactly like every user suddenly forgetting their password.
    console.warn('[auth/password] sign-in failed —', isEmail ? 'email' : 'phone', error?.code || error?.message || 'no session returned')

    // ⚠️⚠️ A CAPTCHA REJECTION IS NOT A FAILED PASSWORD, AND COUNTING IT WAS A DENIAL OF
    // SERVICE ON EVERY ACCOUNT. Found by a reviewer on the finished diff, and it is the worst
    // bug this route has had. Supabase validates the Turnstile token BEFORE it looks at any
    // credential, so an attacker could curl this endpoint five times with a junk password and
    // an empty captchaToken — never solving a challenge, never guessing anything — and lock
    // the real owner out of password sign-in. The victim needs only to have an address the
    // attacker can spell, and every seller's is effectively public.
    //
    // The response is UNCHANGED (same 401, same body, same floor) — only our own counter
    // learns the difference, so this cannot become an oracle. It also fixes the honest case:
    // a visitor whose widget fails no longer burns one of their five attempts.
    // ⚠️ A CAPTCHA REJECTION IS TOLD TO THE USER, AND THAT IS SAFE. Every other cause collapses
    // into one 401, but this one gets its own 403 — because a captcha verdict is about the
    // REQUEST, not the account, so it reveals nothing about whether an identity exists. Keeping
    // it generic was actively harmful: a reviewer pointed out that a visitor whose token is
    // rejected upstream (low trust score, expiry, a blocked widget) would be told "Wrong email
    // or password" no matter how carefully they retyped a password that was correct all along.
    // It also must not count toward the lockout, for the DoS reason below.
    const captchaRejected = error?.code === 'captcha_failed' || /captcha/i.test(error?.message || '')
    if (captchaRejected) return NextResponse.json({ error: 'captcha_failed' }, { status: 403 })

    // Count within the current window; the window's own expiry is what ends a run, so
    // there is no reset rule here to get wrong (see FAILURE_WINDOW_SEC).
    // ⚠️ `windowStartedAt`, not `startedAt` — the latter is the TIMING-FLOOR baseline a few
    // lines up and the two mean completely different things. tsc caught the collision; the
    // distinct name is what stops a future edit from silently flooring against the window.
    const windowStartedAt = record?.startedAt ?? Date.now()
    const n = (record?.n ?? 0) + 1
    // Locked for the REMAINDER of the window the run began in — never longer than one window.
    const until = n >= FAILURES_BEFORE_LOCK ? windowStartedAt + FAILURE_WINDOW_SEC * 1000 : 0
    try {
      // One TTL, one window: the record cannot outlive the window it counts.
      await kv.set(lockKey, { n, until, startedAt: windowStartedAt }, { ex: FAILURE_WINDOW_SEC + 60 })
    } catch (e) {
      // ⚠️ FAIL CLOSED HERE TOO. A reviewer pointed out that only the kv READ failing closed
      // leaves a real hole: if reads succeed while writes fail, failures stop being counted
      // and the lockout silently stops existing while still looking healthy. Answering 429
      // when we cannot record the attempt means an outage costs users a slow path rather
      // than costing everyone their account. (The per-IP ceiling above is a backstop, but it
      // is 20 per 15 minutes — enough guesses to matter against one weak password.)
      console.error('[auth/password] could not record failure — denying', e)
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    return failAfterFloor(startedAt)
  }

  // Success CLEARS the failure run. Without this a user who mistypes four times and then
  // gets it right stays one slip away from a lockout for the rest of the window.
  try {
    await kv.del(lockKey)
  } catch (e) {
    console.error('[auth/password] could not clear failure record', e)
  }

  // createSupabaseServer already wrote the auth cookies. The client re-reads its session
  // rather than receiving tokens it would have to store itself.
  return NextResponse.json({ ok: true })
})
