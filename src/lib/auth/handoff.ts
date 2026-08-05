import 'server-only'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'

// ── Google sign-in across a cookie-jar boundary ─────────────────────────────────────────────────
//
// See scripts/auth-handoff-ddl.mjs for the account-takeover this design exists to defeat and why
// the pairing code must be minted by the BROWSER, not the app. Flow, with the context of each step:
//
//   [app]      signInWithOAuth({skipBrowserRedirect}) → PKCE verifier stays HERE
//   [app]      POST /handoff/open        → nonce cookie in THIS jar + row(auth_url)
//   [browser]  /auth/escape?h=…          → no cookie ⇒ 302 to the stored provider URL
//   [browser]  Google → /auth/callback   → PARK the code + set a BROWSER cookie, 'awaiting_consent'
//   [browser]  "Did you just tap Continue with Google in the eno app on this phone?"
//   [browser]  Yes ⇒ mint pair P, show it. Stored only as HMAC.
//   [app]      polls /claim (STATE ONLY — structurally cannot return a code)
//   [app]      user types P → /redeem → code returned only on an HMAC match
//   [app]      exchangeCodeForSession(code) → session in the ORIGINAL jar
//
// ⚠️ /claim CANNOT RETURN A CODE. That is a structural property, not a check: the only path that
// returns `code` is redeem, and redeem requires the pair. If a future edit makes claim return a
// code "for convenience", the takeover is back.
//
// ⚠️⚠️ AND THE NONCE ALONE MUST NEVER BE ENOUGH TO MINT THE PAIR — THIS IS THE WHOLE FIX OF
// 2026-08-05, FOUND INDEPENDENTLY BY TWO EXTERNAL REVIEWERS. The previous version took the nonce
// from the REQUEST BODY at /consent and minted the pair for whoever asked. The nonce is not a
// secret: it rides in the escape URL and in /handoff/url?h=. So the original account takeover was
// still live — the attacker opened the handoff (their cookie, their PKCE verifier), sent the victim
// the escape link, let the victim authenticate, then called /consent with the nonce THEY chose,
// received the pairing code themselves, and redeemed it. The pair was never actually bound to the
// browser that authenticated.
//
// THE BINDING IS A SECOND COOKIE, SET IN THE BROWSER'S OWN JAR AT /auth/callback, in the same
// request that parks the code. Only the browser that completed Google receives it, and /consent
// requires it. Possession of the nonce is now worthless: the attacker's context never gets the
// browser cookie, so it can never mint the pair. Do not "simplify" /consent back to a body nonce.

export const HANDOFF_TTL_MS = 15 * 60_000
/** Starts at REVEAL, not at open — the visitor may have taken ten minutes inside Google. */
export const PAIR_TTL_MS = 5 * 60_000
export const HANDOFF_COOKIE = 'eno_handoff'
/**
 * The BROWSER-side cookie. ⚠️ A DIFFERENT NAME FROM HANDOFF_COOKIE ON PURPOSE. /auth/escape decides
 * "waiting room vs launch ramp" purely on the presence of HANDOFF_COOKIE; if this shared that name,
 * a visitor whose real browser is also the originating context (Android, where the escape can land
 * in the same jar) would be shown the waiting room instead of the confirm screen.
 */
export const HANDOFF_BROWSER_COOKIE = 'eno_handoff_br'

/**
 * ⚠️ THE BROWSER COOKIE IS NAMED PER HANDOFF, not shared. One cookie for all handoffs is
 * origin-wide, so a second /auth/callback in the same browser OVERWRITES the first — and an
 * attacker can force that by getting someone to open `/auth/callback?handoff=<their nonce>&code=x`,
 * stranding a real sign-in that was in flight in that browser. Naming the cookie after the handoff
 * removes the collision entirely rather than trying to detect it (external review, 2026-08-05).
 *
 * The suffix is a truncated hash, never the nonce itself: cookie NAMES are readable by any script
 * on the origin, and the nonce is the key to the row. 12 hex chars is ample to separate the handful
 * of handoffs one browser could ever hold at once.
 */
export function browserCookieName(nonce: string): string {
  return `${HANDOFF_BROWSER_COOKIE}_${nonceHash(nonce).slice(0, 12)}`
}
export const MAX_PAIR_ATTEMPTS = 5

export function newNonce(): string { return randomBytes(32).toString('base64url') }
export function nonceHash(nonce: string): string { return createHash('sha256').update(nonce).digest('hex') }
export function isNonce(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(v)
}

/** The browser-binding secret. Same shape as a nonce, so isNonce() validates it too. */
export function newBrowserSecret(): string { return randomBytes(32).toString('base64url') }
export function browserHash(secret: string): string {
  return createHash('sha256').update(`br:${secret}`).digest('hex')
}

// ── The pairing code ────────────────────────────────────────────────────────────────────────────
//
// ⚠️ THE ALPHABET EXCLUDES B/8, S/5, Z/2, G/6, I/1, O/0. This code is read off one screen and typed
// into another, by someone who is mid-sign-in and already mildly annoyed. Every confusable pair we
// leave in costs real sign-ins, and a failed pair burns one of five attempts.
//
// ⚠️ IT MUST CONTAIN NO DUPLICATES. It shipped as '…34779' — a typo that put '7' in twice, which is
// not cosmetic: measured, '7' came out at 7.81% against 4.30% for every other character, so one
// character in six was nearly twice as likely as the rest and the real space was 24^6, not 25^6.
//
// ⚠️ AND 24 IS THE CEILING, NOT 25 — DO NOT PAD IT BACK UP. The first attempt at fixing the
// duplicate replaced it with '6', which restored the count and reintroduced a confusable: '6' is
// the G/6 pair, and normalizePair() folds G→6, so a '6' on screen and a 'G' typed are the same
// character by the time they are compared. Twenty non-confusable letters plus {3,4,7,9} is
// everything this alphabet can contain. 24^6 ≈ 1.9e8, and five guesses bound it regardless.
const PAIR_ALPHABET = 'ACDEFHJKLMNPQRTUVWXY3479'
const PAIR_LEN = 6

/**
 * ⚠️ REJECTION SAMPLING, NOT A BARE `% alphabet.length`. A raw modulo over 256 gives the first
 * 256 % 24 = 16 characters an 11/256 chance against 10/256 for the rest. It is a small bias on a
 * code that is already bounded to five guesses — and it costs one comparison to not have it.
 */
export function newPair(): string {
  const a = PAIR_ALPHABET
  const limit = 256 - (256 % a.length) // 240 for the 24-char alphabet
  let out = ''
  while (out.length < PAIR_LEN) {
    for (const b of randomBytes(PAIR_LEN * 2)) {
      if (b >= limit) continue // biased tail — draw again rather than fold it in
      out += a[b % a.length]
      if (out.length === PAIR_LEN) break
    }
  }
  return out
}

/** Fold the confusables a human will inevitably type instead. Applied to BOTH sides. */
export function normalizePair(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2')
    .replace(/G/g, '6').replace(/I/g, '1').replace(/O/g, '0')
}

/**
 * ⚠️ KEYED, AND THE NONCE IS IN THE MESSAGE. Without `nonce_hash` inside, a pair observed on one
 * handoff could be replayed against another row. Keyed with the app secret so a database leak does
 * not let anyone precompute the 24^6 space offline.
 *
 * ⚠️ IT THROWS RATHER THAN FALLING BACK TO AN EMPTY KEY. The previous version ended in `|| ''`,
 * which silently turned the HMAC into a plain hash whenever the env was misconfigured — destroying
 * the one property the comment above claims, in exactly the deployment where nobody would notice.
 * A sign-in that fails loudly is recoverable; one that is quietly unkeyed is not.
 */
function pairHmac(nonceH: string, pair: string): string {
  const key = process.env.IDENTITY_HASH_PEPPER || process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error('handoff: IDENTITY_HASH_PEPPER (or SUPABASE_SECRET_KEY) is required to key the pairing code')
  return createHmac('sha256', key).update(`${nonceH}:${normalizePair(pair)}`).digest('hex')
}

/** Constant-time compare — a timing oracle on a 6-char code is a real shortcut. */
function hmacEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex')
  return x.length === y.length && timingSafeEqual(x, y)
}

export type HandoffState = 'pending' | 'awaiting_consent' | 'awaiting_pair' | 'claimed' | 'void' | 'gone'

export async function openHandoff(nonce: string, authUrl: string, now: Date = new Date()): Promise<void> {
  const expires = new Date(now.getTime() + HANDOFF_TTL_MS)
  await db.$executeRaw`
    INSERT INTO public.auth_handoff (nonce_hash, auth_url, state, created_at, expires_at)
    VALUES (${nonceHash(nonce)}, ${authUrl}, 'pending', now(), ${expires})
    ON CONFLICT (nonce_hash) DO UPDATE
      SET auth_url = EXCLUDED.auth_url, code = NULL, pair_hmac = NULL, pair_expires = NULL,
          browser_hash = NULL, attempts = 0, state = 'pending', created_at = now(),
          expires_at = EXCLUDED.expires_at
      -- ⚠️ ONLY A ROW THAT HAS NOT YET BEEN AUTHENTICATED MAY BE RESET. Without this predicate a
      -- nonce holder could rewind a handoff that already had a parked code or a live pair, which is
      -- both a denial-of-service and a way to re-drive the state machine. A genuine retry always
      -- picks a fresh nonce, so this never blocks the honest path.
      WHERE public.auth_handoff.state = 'pending'
  `
  await db.$executeRaw`DELETE FROM public.auth_handoff WHERE expires_at < now()`
}

/** Read by /auth/escape in the BROWSER, which has no cookie. Only a still-pending row may redirect. */
export async function handoffAuthUrl(nonce: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ auth_url: string }[]>`
    SELECT auth_url FROM public.auth_handoff
     WHERE nonce_hash = ${nonceHash(nonce)} AND state = 'pending' AND expires_at > now()
  `
  return rows[0]?.auth_url ?? null
}

/**
 * Park the code AND bind the browser. Only from `pending`, so a second callback cannot overwrite a
 * code the visitor is already pairing, and a spent handoff cannot be resurrected.
 *
 * `browserSecret` is minted by the callback route and returned to the browser as an httpOnly
 * cookie; only its hash is stored. That pair of facts is what makes /consent unforgeable.
 */
export async function parkCode(nonce: string, code: string, browserSecret: string, now: Date = new Date()): Promise<boolean> {
  const extended = new Date(now.getTime() + HANDOFF_TTL_MS)
  const n = await db.$executeRaw`
    UPDATE public.auth_handoff
       SET code = ${code}, state = 'awaiting_consent', expires_at = ${extended},
           browser_hash = ${browserHash(browserSecret)}
     WHERE nonce_hash = ${nonceHash(nonce)} AND state = 'pending' AND expires_at > now()
  `
  return n > 0
}

/**
 * The visitor confirmed, IN THE BROWSER THAT AUTHENTICATED, that they started this. Mint the pair.
 *
 * ⚠️ THE PAIR IS RETURNED ONCE, TO THE BROWSER THAT AUTHENTICATED, AND STORED ONLY AS AN HMAC. It
 * must never appear in a URL, a redirect, a log line, or any response reachable from another jar —
 * that is the entire security property.
 *
 * ⚠️ `browserSecret` IS MANDATORY AND IS MATCHED IN SQL AGAINST THE STORED HASH. This is the check
 * that closes the takeover; see the header. It is deliberately part of the WHERE clause rather than
 * a separate read-then-compare, so there is no window between the two.
 *
 * ⚠️ IT ALSO ACCEPTS 'awaiting_pair' WHEN THE PAIR HAS EXPIRED, which is what makes re-reveal work.
 * Previously handoffState() merely REPORTED 'awaiting_consent' after expiry while the row still said
 * 'awaiting_pair', so the app told the visitor "get a fresh code in your browser" and the browser
 * could not produce one — a dead end with no way out but starting over.
 */
export async function consentAndMintPair(nonce: string, browserSecret: string, now: Date = new Date()): Promise<string | null> {
  const pair = newPair()
  const h = nonceHash(nonce)
  const n = await db.$executeRaw`
    UPDATE public.auth_handoff
       SET state = 'awaiting_pair', pair_hmac = ${pairHmac(h, pair)},
           pair_expires = ${new Date(now.getTime() + PAIR_TTL_MS)}, attempts = 0
     WHERE nonce_hash = ${h}
       AND browser_hash IS NOT NULL AND browser_hash = ${browserHash(browserSecret)}
       AND expires_at > now()
       AND (state = 'awaiting_consent'
            OR (state = 'awaiting_pair' AND (pair_expires IS NULL OR pair_expires < now())))
  `
  return n > 0 ? pair : null
}

/** The visitor said "no, that wasn't me". Kill it rather than leaving a live code parked. */
export async function voidHandoff(nonce: string, browserSecret: string): Promise<void> {
  // ⚠️ ALSO BROWSER-BOUND. An unbound void is a denial-of-service anyone holding the nonce can fire
  // at someone else's sign-in; the nonce is not a secret.
  await db.$executeRaw`
    UPDATE public.auth_handoff SET state = 'void', code = NULL, pair_hmac = NULL
     WHERE nonce_hash = ${nonceHash(nonce)}
       AND browser_hash IS NOT NULL AND browser_hash = ${browserHash(browserSecret)}
  `
}

/** State only. ⚠️ Deliberately incapable of returning a code — see the header note. */
export async function handoffState(nonce: string, now: Date = new Date()): Promise<HandoffState> {
  const rows = await db.$queryRaw<{ state: string; pair_expires: Date | null }[]>`
    SELECT state, pair_expires FROM public.auth_handoff
     WHERE nonce_hash = ${nonceHash(nonce)} AND expires_at > now()
  `
  const r = rows[0]
  if (!r) return 'gone'
  // A dead pair is not a dead handoff: the browser can re-reveal (consentAndMintPair accepts an
  // expired 'awaiting_pair'), so say so precisely rather than reporting the whole thing gone.
  if (r.state === 'awaiting_pair' && r.pair_expires && r.pair_expires.getTime() < now.getTime()) {
    return 'awaiting_consent'
  }
  return r.state as HandoffState
}

export type RedeemResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'wrong' | 'exhausted' | 'expired' | 'gone' }

/**
 * Exchange the pair for the parked authorization code.
 *
 * ⚠️ THE ATTEMPT IS COUNTED BY THE SAME STATEMENT THAT READS THE ROW, AND THAT IS THE POINT. The
 * previous version SELECTed `attempts`, compared it to the limit in JS, and only then UPDATEd — so
 * N concurrent requests all read `attempts = 4`, all passed the check, and all got a guess. The
 * five-guess bound was advisory. `attempts < ${MAX}` now lives in the WHERE clause of the
 * incrementing UPDATE, so Postgres row-locking serialises the guesses and the sixth finds no row.
 *
 * The HMAC comparison stays in JS afterwards, deliberately: SQL `=` on the hash would be a
 * non-constant-time compare, and doing it here keeps timingSafeEqual.
 *
 * ⚠️ IDEMPOTENT ON SUCCESS. The code is NOT nulled: if the response is dropped on a flaky mobile
 * network, or `exchangeCodeForSession` fails once, the app must be able to ask again with the same
 * pair. Single-use is enforced by Supabase — the authorization code itself is spent on first
 * exchange — so nulling it here only creates a way to lose a sign-in. `attempts` is reset on a
 * match so those honest retries cannot exhaust the counter.
 */
export async function redeemPair(nonce: string, submitted: string, now: Date = new Date()): Promise<RedeemResult> {
  const h = nonceHash(nonce)
  const rows = await db.$queryRaw<{ code: string | null; pair_hmac: string | null; pair_expires: Date | null }[]>`
    UPDATE public.auth_handoff
       SET attempts = attempts + 1
     WHERE nonce_hash = ${h}
       AND state = 'awaiting_pair'
       AND expires_at > now()
       AND attempts < ${MAX_PAIR_ATTEMPTS}
       -- ⚠️ EXPIRY IS PART OF THE GUARD, so a dead pair does not burn an attempt. Without this the
       -- increment happens first and the expiry check follows in JS, which means a visitor who
       -- came back late and tapped Sign in a few times could exhaust the counter against a code
       -- that could never have worked.
       AND (pair_expires IS NULL OR pair_expires > now())
    RETURNING code, pair_hmac
  `
  const r = rows[0]
  if (!r) {
    // No row matched. Four reasons, and the visitor needs to be told which: never existed, voided,
    // pair expired, or guesses used up. One read, no increment.
    const live = await db.$queryRaw<{ attempts: number; state: string; pair_expires: Date | null }[]>`
      SELECT attempts, state, pair_expires FROM public.auth_handoff
       WHERE nonce_hash = ${h} AND expires_at > now()
    `
    const l = live[0]
    if (!l || l.state === 'void') return { ok: false, reason: 'gone' }
    if (l.attempts >= MAX_PAIR_ATTEMPTS) return { ok: false, reason: 'exhausted' }
    if (l.state === 'awaiting_pair' && l.pair_expires && l.pair_expires.getTime() < now.getTime()) {
      return { ok: false, reason: 'expired' }
    }
    return { ok: false, reason: 'gone' }
  }
  if (!r.pair_hmac || !r.code) return { ok: false, reason: 'gone' }

  if (!hmacEquals(r.pair_hmac, pairHmac(h, submitted))) {
    // On exhaustion, void the PAIR (not the code) so the browser can re-reveal a fresh one instead
    // of the visitor losing the whole sign-in.
    const after = await db.$queryRaw<{ attempts: number }[]>`
      UPDATE public.auth_handoff
         SET state = CASE WHEN attempts >= ${MAX_PAIR_ATTEMPTS} THEN 'awaiting_consent' ELSE state END,
             pair_hmac = CASE WHEN attempts >= ${MAX_PAIR_ATTEMPTS} THEN NULL ELSE pair_hmac END
       WHERE nonce_hash = ${h}
      RETURNING attempts
    `
    return { ok: false, reason: (after[0]?.attempts ?? 0) >= MAX_PAIR_ATTEMPTS ? 'exhausted' : 'wrong' }
  }

  await db.$executeRaw`UPDATE public.auth_handoff SET attempts = 0 WHERE nonce_hash = ${h}`
  return { ok: true, code: r.code }
}
