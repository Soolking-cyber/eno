import 'server-only'
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createSign, randomBytes, type KeyObject } from 'node:crypto'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { logError, logWarn } from '@/lib/log'
import { appleFlagSet, appleIosEnabled } from '@/lib/apple-signin'
import { IS_MARKETPLACE } from '@/lib/edition'

// ── SIGN IN WITH APPLE: THE SERVER HALF ──────────────────────────────────────────────────────────
//
// Plan: ~/eno-ios-prep/siwa/plan.md §7.8. GoTrue owns the session on every path; what it does NOT do is keep
// Apple's refresh token where account deletion can reach it — and App Store Guideline 5.1.1(v) with TN3194
// requires an app offering Sign in with Apple to REVOKE the user's tokens when the account is deleted. So:
//   · the web/Android flow (GoTrue's Apple OAuth, the Services ID): /auth/callback keeps the
//     `provider_refresh_token` GoTrue hands back — only when GoTrue's own flow state says the code was Apple's;
//   · the native iOS flow (the bundle ID): /api/auth/apple/native exchanges Apple's authorization code itself;
//   · eraseAccount queues each kept token in the transaction that erases the account, then validates and revokes
//     it before the GoTrue user goes, and /api/cron/apple-revocations retries what could not be revoked, daily, for
//     at most 14 days (the table section below says who owns a row when).
//
// Env — written by infra/vn-node/apply-apple-signin.sh into BOTH /opt/eno/secrets/eno-vn.env and eno-forum.env:
//   APPLE_SIWA_TEAM_ID      the 10-character Team ID
//   APPLE_SIWA_KEY_ID       the 10-character Key ID of the DEDICATED Sign in with Apple key (D5)
//   APPLE_SIWA_PRIVATE_KEY  that key's .p8, base64 (a raw PEM is accepted too)
//   APPLE_SIWA_SERVICES_ID  the web client (vn.eno.web) — the audience of GoTrue's web flow and its tokens
//   APPLE_SIWA_BUNDLE_ID    the app (vn.eno.app) — the native flow's audience and its tokens
//   APPLE_TOKEN_ENC_KEY     32 bytes, 64 hex or base64 — the AES-256-GCM key for the stored refresh tokens
// ⛔ THE APPLE_SIWA_* NAMES ARE DELIBERATE: the team-id variable WITHOUT the SIWA infix switches on the AASA
// route (applinks — P7, on hold), and nothing here may ever read it (apple-siwa.test.ts greps for it).
//
// ⚠️ MISSING ENV IS AN ANSWER, NEVER A THROW: every function returns 'unconfigured' (or the equivalent) so the
// dark deploy, a forum build without the values, and a box mid-install all behave — sign-in still works, a token
// simply is not kept, and erasure tells the person to remove eno in their Apple Account by hand.
// ⚠️ NO TOKEN, CODE OR SECRET EVER REACHES A LOG. Logs carry codes: the step, the client, Apple's error word.

export const APPLE_ISSUER = 'https://appleid.apple.com'
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token'
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke'
/** Every call to Apple: 5 s, so a slow Apple can delay a sign-in or a deletion by seconds, never hang it. */
export const APPLE_TIMEOUT_MS = 5000
/** A minted client secret lives 5 minutes — minted per call, it never needs to live longer. */
const CLIENT_SECRET_TTL_S = 300

const env = (name: string): string | null => process.env[name]?.trim() || null

/** The app's bundle ID — the native identity token's required `aud`. Null ⇒ native Apple is unconfigured. */
export function appleBundleId(): string | null {
  return env('APPLE_SIWA_BUNDLE_ID')
}

/**
 * ⛔ THE BUNDLE ID THE NATIVE ROUTES MAY USE ON THIS DEPLOYMENT — null, and both answer exactly as when unconfigured
 * (503 not_configured), unless the iOS app can show the button here (commit gate round 2, C2). The env above is written
 * into BOTH editions' files, so the bundle ID alone said yes on eno.forum and through the dark deploy to anyone who
 * called /api/auth/apple/nonce and /native directly. Now also: `ios` in this build's rollout flag (appleIosEnabled) AND
 * the marketplace edition — D2: eno.forum is not enabled. The daily retry still uses appleBundleId(): tokens kept
 * before a flag change must be revoked whatever the flag says now.
 */
export function nativeAppleBundleId(): string | null {
  return appleIosEnabled() && IS_MARKETPLACE ? appleBundleId() : null
}

/** The Services ID — the client GoTrue's web flow runs as, so the client its refresh tokens belong to. */
export function appleServicesId(): string | null {
  return env('APPLE_SIWA_SERVICES_ID')
}

// ── The native flow's nonce: /api/auth/apple/nonce mints it, /api/auth/apple/native spends it ────────

/**
 * The RAW nonce never leaves the server's cookie; the app sees only its SHA-256 hex, which goes into Apple's
 * request and comes back as the identity token's `nonce` claim. GoTrue is then handed the raw value and compares
 * `%x` of sha256(raw) with the claim — so a token minted for one sign-in cannot be replayed into another.
 * HttpOnly, SameSite=Strict, scoped to the two routes, ten minutes, single use (the native route clears it).
 */
export const APPLE_NONCE_COOKIE = 'eno_apple_nonce'
export const APPLE_NONCE_PATH = '/api/auth/apple'
export const APPLE_NONCE_TTL_S = 600

export function hashAppleNonce(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** 32 random bytes (base64url) and the hex digest the app passes to Apple. */
export function newAppleNonce(): { raw: string; hashed: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hashed: hashAppleNonce(raw) }
}

// ── The client secret (an ES256 JWT, the native-push.ts APNs pattern) ─────────────────────────────

let keyMemo: { raw: string; key: KeyObject | null } | null = null

function signingKey(): KeyObject | null {
  const raw = env('APPLE_SIWA_PRIVATE_KEY')
  if (!raw) return null
  if (keyMemo?.raw === raw) return keyMemo.key
  let key: KeyObject | null = null
  try {
    // base64 is what the box script writes; a raw PEM pasted into an env file often carries literal "\n"s.
    const pem = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8')
    key = createPrivateKey(pem)
  } catch {
    // A malformed key is "unconfigured" too — but say so once, or a typo would look like a missing value.
    logWarn('[auth] apple_key_invalid', {})
  }
  keyMemo = { raw, key }
  return key
}

/**
 * Apple's client secret for `sub` (the Services ID or the bundle ID): header {alg ES256, kid}, claims
 * {iss team, iat, exp ≤ iat+300, aud https://appleid.apple.com, sub}. 'unconfigured' when the team, key id or
 * key is missing or unreadable.
 */
export function mintClientSecret(sub: string, now: number = Date.now()): string | 'unconfigured' {
  const teamId = env('APPLE_SIWA_TEAM_ID')
  const keyId = env('APPLE_SIWA_KEY_ID')
  const key = signingKey()
  if (!teamId || !keyId || !key || !sub) return 'unconfigured'
  const iat = Math.floor(now / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const claims = b64url(JSON.stringify({ iss: teamId, iat, exp: iat + CLIENT_SECRET_TTL_S, aud: APPLE_ISSUER, sub }))
  const sig = createSign('SHA256').update(`${header}.${claims}`).sign({ key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${claims}.${b64url(sig)}`
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** The payload of a JWT, UNVERIFIED — for pre-checks and for reading `sub` off a token Apple just handed us. */
export function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ── Apple's token and revoke endpoints ────────────────────────────────────────────────────────────

/**
 * What a call to Apple can come back as, short of success (TN3107):
 *   invalid_grant  — the code or token is bad, used, expired or already revoked
 *   invalid_client — OUR secret is bad or expired (a configuration fault, never the user's)
 *   unconfigured   — the env above is missing
 *   network        — no answer (timeout, DNS, reset)
 *   server         — Apple answered 5xx or 429
 *   rejected       — any other refusal (invalid_request, unauthorized_client …)
 */
export type AppleCallError = 'invalid_grant' | 'invalid_client' | 'unconfigured' | 'network' | 'server' | 'rejected'

type AppleAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; error: AppleCallError }

/** `timeoutMs`: APPLE_TIMEOUT_MS, or less — what is left of a caller's deadline (the erasure's, settleQueuedTokens). */
async function callApple(url: string, form: Record<string, string>, timeoutMs: number = APPLE_TIMEOUT_MS): Promise<AppleAnswer> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.ok) return { ok: true, body: body ?? {} }
  if (res.status >= 500 || res.status === 429) return { ok: false, error: 'server' }
  const word = typeof body?.error === 'string' ? body.error : ''
  if (word === 'invalid_grant') return { ok: false, error: 'invalid_grant' }
  if (word === 'invalid_client') return { ok: false, error: 'invalid_client' }
  return { ok: false, error: 'rejected' }
}

/**
 * Trade a native authorization code for tokens (client_id + secret `sub` = the bundle ID). ⚠️ NO redirect_uri:
 * the native flow had none, and sending one fails the grant. `sub` is read off Apple's own id_token, so the
 * caller can refuse to keep a token that belongs to a different Apple ID than the one that signed in.
 */
export async function exchangeCode(
  clientId: string,
  code: string,
): Promise<{ ok: true; refreshToken: string | null; sub: string | null } | { ok: false; error: AppleCallError }> {
  const secret = mintClientSecret(clientId)
  if (secret === 'unconfigured') return { ok: false, error: 'unconfigured' }
  const r = await callApple(APPLE_TOKEN_URL, { client_id: clientId, client_secret: secret, code, grant_type: 'authorization_code' })
  if (!r.ok) return r
  const refreshToken = typeof r.body.refresh_token === 'string' && r.body.refresh_token ? r.body.refresh_token : null
  const sub = decodeJwtPayload(r.body.id_token)?.sub
  return { ok: true, refreshToken, sub: typeof sub === 'string' ? sub : null }
}

/**
 * Is this refresh token still good? (grant_type=refresh_token.) TN3194 allows it once a day per token, which is
 * why it runs only at deletion and in the daily retry — never at sign-in. Revoke answers 200 even for a token
 * that is already dead, so this is the only way to tell "revoked" from "nothing to revoke".
 */
export async function validateRefresh(clientId: string, refreshToken: string, timeoutMs?: number): Promise<{ ok: true } | { ok: false; error: AppleCallError }> {
  const secret = mintClientSecret(clientId)
  if (secret === 'unconfigured') return { ok: false, error: 'unconfigured' }
  const r = await callApple(APPLE_TOKEN_URL, { client_id: clientId, client_secret: secret, grant_type: 'refresh_token', refresh_token: refreshToken }, timeoutMs)
  return r.ok ? { ok: true } : r
}

/** Revoke the token — and with it this user's authorization of eno — at Apple. */
export async function revoke(clientId: string, refreshToken: string, timeoutMs?: number): Promise<{ ok: true } | { ok: false; error: AppleCallError }> {
  const secret = mintClientSecret(clientId)
  if (secret === 'unconfigured') return { ok: false, error: 'unconfigured' }
  const r = await callApple(APPLE_REVOKE_URL, { client_id: clientId, client_secret: secret, token: refreshToken, token_type_hint: 'refresh_token' }, timeoutMs)
  return r.ok ? { ok: true } : r
}

export type ProbeResult = 'ok' | 'invalid_client' | 'unconfigured' | 'unreachable' | 'unexpected'

/**
 * Is this client's configuration (team, key id, key, client id) accepted by Apple RIGHT NOW? A code Apple never
 * issued must answer `invalid_grant` — the client authenticated and only the grant failed — while
 * `invalid_client` means the secret is refused (TN3107). The app mints its own short-lived secrets, so this
 * proves the .p8 and the ids; GoTrue's long-lived secret has its own daily probe on the box (A3).
 */
export async function probeClient(clientId: string | null): Promise<ProbeResult> {
  if (!clientId) return 'unconfigured'
  const secret = mintClientSecret(clientId)
  if (secret === 'unconfigured') return 'unconfigured'
  const r = await callApple(APPLE_TOKEN_URL, { client_id: clientId, client_secret: secret, code: 'probe', grant_type: 'authorization_code' })
  if (r.ok) return 'unexpected'
  if (r.error === 'invalid_grant') return 'ok'
  if (r.error === 'invalid_client') return 'invalid_client'
  if (r.error === 'network' || r.error === 'server') return 'unreachable'
  return 'unexpected'
}

// ── The stored token: AES-256-GCM (the visa/crypto.ts pattern), bound to its row ──────────────────

const SEAL_VERSION = 'v1'

function tokenKey(): Buffer | null {
  const raw = env('APPLE_TOKEN_ENC_KEY')
  if (!raw) return null
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  return key.length === 32 ? key : null
}

/**
 * ⚠️ THE ROW IS THE ASSOCIATED DATA: a ciphertext copied onto another user's row, or another client's, fails to
 * open — so a database-only attacker cannot move a token between accounts, and a mixed-up row cannot revoke the
 * wrong person's authorization.
 */
const aad = (userId: string, clientId: string) => Buffer.from(`eno:apple-siwa-token:${SEAL_VERSION}:${userId}:${clientId}`)

/** `v1.<iv>.<tag>.<ciphertext>` (base64url), or null when APPLE_TOKEN_ENC_KEY is missing or malformed. */
export function sealAppleToken(token: string, userId: string, clientId: string): string | null {
  const key = tokenKey()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(userId, clientId))
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [SEAL_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

/**
 * The token, or null — a missing key, a different row, or any tampering.
 * ⛔ THE TAG IS EXACTLY 16 BYTES AND THE IV EXACTLY 12. Without `authTagLength`, Node's GCM decipher accepts a tag
 * cut to 12, 8 or even 4 bytes (only a deprecation warning, DEP0182) — and a 4-byte tag is a 2^32 forgery, which
 * would hollow out the row-binding promise above. sealAppleToken only ever writes 16 and 12.
 */
export function openAppleToken(sealed: string, userId: string, clientId: string): string | null {
  const key = tokenKey()
  if (!key) return null
  const [v, iv, tag, ct, ...rest] = String(sealed).split('.')
  if (v !== SEAL_VERSION || !iv || !tag || !ct || rest.length) return null
  const ivBytes = Buffer.from(iv, 'base64url')
  const tagBytes = Buffer.from(tag, 'base64url')
  if (ivBytes.length !== 12 || tagBytes.length !== 16) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, ivBytes, { authTagLength: 16 })
    decipher.setAAD(aad(userId, clientId))
    decipher.setAuthTag(tagBytes)
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ── public.apple_siwa_token (scripts/apple-siwa-ddl.mjs — raw SQL, outside Prisma) ────────────────
//
// ⛔ A ROW'S TWO STATES, AND WHO OWNS IT IN EACH (commit-gate review C1–C3, 2026-10-08):
//   active (queued_at NULL) — an account holds the token. Written ONLY by storeAppleToken, at sign-in.
//   queued (queued_at set)  — the account is gone or going: the daily retry owns the row until it is revoked, found
//                             dead, dropped for a live account, or given up 14 days after the erasure.
// NO ACTIVE ROW MAY OUTLIVE ITS ACCOUNT — it would keep a live credential for good (the retry selects queued rows
// only), and read as "a live account holds this Apple ID". Three writers turn active into queued:
//   · the erasure's OWN transaction (queueTokensForErasure), so no crash after its commit can strand a row (C1);
//   · the erasure again, after GoTrue's DELETE (queueUnsettledTokens): a sign-in that stored while it ran (C2);
//   · the daily retry (queueOrphanedTokens): any active row whose account no longer exists, however it got there (C2) —
//     e.g. a native keep that outlasted the sign-in's 2.5 s wait and stored after the erasure (round 11): an orphan
//     for at most a day. "Outlive" therefore means outlive the next daily run, never "for good".
// And ONE LOCK PER APPLE ID (appleSubLockKey), taken by every store and every revoke, makes "does a live account
// hold this Apple ID?" and the revoke that depends on the answer one step no store can land inside (C3). This table
// answers only for the accounts whose token was kept — keeping one is best effort — so the retry asks GoTrue's own
// auth.identities as well (appleIdHeldElsewhere).

export type AppleTokenRow = {
  userId: string
  clientId: string
  appleSub: string
  tokenEnc: string
  /** null = active (the account exists); set = queued for revocation after an erasure. */
  queuedAt: Date | null
  attempts: number
  lastError: string | null
}

type DbRow = { user_id: string; client_id: string; apple_sub: string; token_enc: string; queued_at: Date | null; attempts: number; last_error: string | null }
const toRow = (r: DbRow): AppleTokenRow => ({
  userId: r.user_id, clientId: r.client_id, appleSub: r.apple_sub, tokenEnc: r.token_enc,
  queuedAt: r.queued_at, attempts: Number(r.attempts) || 0, lastError: r.last_error,
})

/** Which row — what the erasure's transaction hands to the revocation that runs after its commit. */
export type QueuedKey = { userId: string; clientId: string; appleSub: string }
type KeyRow = { user_id: string; client_id: string; apple_sub: string }
const toKey = (r: KeyRow): QueuedKey => ({ userId: r.user_id, clientId: r.client_id, appleSub: r.apple_sub })

/** All this module needs of a transaction: raw SQL. */
type RawSql = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>

/** Postgres' SQLSTATE behind a Prisma 7 raw-query error (P2010 carries the driver's), or the typed code. */
function sqlState(e: unknown): unknown {
  if (!e || typeof e !== 'object') return undefined
  const x = e as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } }
  return x.meta?.driverAdapterError?.cause?.originalCode ?? x.meta?.code ?? x.code
}

/**
 * The table not existing yet (the DDL runs before the deploy, but a scratch database or a missed step lacks it).
 * Prisma 7 raw queries surface Postgres 42P01 as P2010 with the driver error inside; P2021 is the typed form.
 */
export function isMissingTable(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const x = e as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } }; message?: unknown }
  if (x.code === 'P2021' || x.code === '42P01') return true
  if (x.meta?.code === '42P01' || x.meta?.driverAdapterError?.cause?.originalCode === '42P01') return true
  return typeof x.message === 'string' && x.message.includes('42P01')
}

// ── One lock per Apple ID (C3) ────────────────────────────────────────────────────────────────────

/**
 * ⛔ THE RETRY'S QUESTION AND ITS REVOKE ARE ONE STEP. A deleted account's queued token and a NEW account's token for
 * the same Apple ID belong to ONE grouped authorization (the Services ID is grouped under the primary App ID), so
 * revoking the old one takes the new one with it. The retry therefore revokes only when no live account holds the
 * Apple ID — and it used to ask, then call Apple, with nothing in between: a re-sign-up that stored its token after
 * the question was revoked behind the answer. Now the question, the revoke and the row's settling run inside one
 * transaction holding this lock, and storeAppleToken takes the same lock — so a store lands either BEFORE the
 * question (and is seen by it) or AFTER the revoke has finished, never between.
 * ⛔ AND THE QUESTION GOES TO GoTrue TOO (verifier, 2026-10-09). Keeping a token is best effort — Apple's token
 * endpoint down for the native code exchange (the same outage that left the old token queued), a web callback whose
 * flow state could not be read, a store that gave up on this lock — so a re-sign-up can hold the Apple ID with NO row
 * here, and the retry would revoke its authorization along with the old token. Its auth.identities row is always
 * there, written by GoTrue before the sign-in can store anything (appleIdHeldElsewhere).
 *
 * ⚠️ THE RESIDUAL WINDOW, WHICH NO DATABASE LOCK CAN CLOSE: GoTrue does not take this lock, and Apple issues a
 * sign-in's authorization a few seconds before GoTrue writes its identity (the web callback's code exchange, the
 * app's round trip to /api/auth/apple/native). A re-sign-up whose authorization Apple issues within those seconds
 * before the question, or between the question and this settle's revoke (well under a second normally,
 * 4 × APPLE_TIMEOUT_MS at the very worst), is revoked with the old token: its identity was not there to be seen, and
 * the revoke reached Apple after its authorization existed. Bounded: the GoTrue session is untouched, eno leaves the
 * person's Apple ID list, the token that account kept (if any) is dead — its own deletion then answers `manual` — and
 * the next Apple sign-in consents again and replaces it.
 *
 * Transaction-scoped (pg_advisory_xact_lock): released by commit or rollback, and safe under Supavisor's
 * transaction pooling, where a session-level lock would stay behind on a connection another client gets next.
 */
export const appleSubLockKey = (appleSub: string): string => `apple-siwa:${appleSub}`

/**
 * How long the daily retry's settle waits for the lock: longer than any one settle holds it — a group of two rows is
 * four Apple calls, APPLE_TIMEOUT_MS each at worst. A STORE does not use it (STORE_LOCK_WAIT: it is on the sign-in
 * path); a store itself holds the lock for one INSERT.
 */
const LOCK_WAIT = '25s'
/**
 * ⛔ A STORE IS ON THE SIGN-IN PATH, SO IT WAITS ONLY BRIEFLY (commit gate 2026-10-09, codex): the web callback and the
 * native route both await it, and LOCK_WAIT held a sign-in up to ~30 s whenever a settle of the same Apple ID was
 * running. Two seconds, then 'busy': the person signs in, the token is not kept, and a later deletion of that account
 * reads 'manual' (the "remove eno in your Apple Account" notice) — the rare loser of a rare race, never a stall.
 */
const STORE_LOCK_WAIT = '2s'
/** Interactive-transaction bounds for a store: the 2 s lock wait, then one INSERT. */
const STORE_TX = { maxWait: 2_000, timeout: 5_000 }
const SETTLE_TX = { maxWait: 10_000, timeout: 90_000 }

/**
 * ⛔ THE ERASURE'S REQUEST PATH WAITS FAR LESS (commit gate round 2, O3). A settle handed a deadline — the erasure's
 * Apple budget (account-erasure.ts) — waits at most this long for the Apple ID's lock (the daily retry or a store holding
 * it), asks Apple only while APPLE_MIN_CALL_MS of the deadline is left, and bounds each call by what is left. What it
 * cannot settle in time stays queued — the daily retry's — and the person reads `queued`. The daily retry passes no
 * deadline and keeps LOCK_WAIT and SETTLE_TX.
 */
export const APPLE_ERASURE_LOCK_WAIT_MS = 3_000
/** Less than this left of a deadline: no further call to Apple is started (nor, by the erasure, a further settle). */
export const APPLE_MIN_CALL_MS = 1_000
/** A deadline-bound settle's transaction outlives the deadline by this much — its last writes, after Apple's last answer. */
const SETTLE_TX_SLACK_MS = 5_000

async function lockAppleSub(tx: RawSql, appleSub: string, wait: string): Promise<void> {
  // lock_timeout bounds the advisory-lock wait too (measured on Postgres 14: 55P03 "canceling statement due to lock
  // timeout"), and every row-lock wait after it in this transaction.
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${wait}, true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${appleSubLockKey(appleSub)}))`
}

const isLockTimeout = (e: unknown): boolean => sqlState(e) === '55P03'

/**
 * Keep (or replace) the refresh token for (user, client). A re-sign-in replaces the token and re-activates a row that
 * was queued (an erasure whose auth-user delete did not happen). Best effort: the caller signs in regardless.
 * ⛔ UNDER THE APPLE ID'S LOCK, so never inside a revoke of the same Apple ID (appleSubLockKey).
 */
export async function storeAppleToken(i: { userId: string; clientId: string; appleSub: string; refreshToken: string }): Promise<'stored' | 'unconfigured' | 'failed'> {
  const sealed = sealAppleToken(i.refreshToken, i.userId, i.clientId)
  if (!sealed) {
    logWarn('[auth] apple_token_not_kept', { reason: 'unconfigured', client: i.clientId })
    return 'unconfigured'
  }
  try {
    await db.$transaction(async (tx) => {
      await lockAppleSub(tx, i.appleSub, STORE_LOCK_WAIT)
      await tx.$executeRaw`
        INSERT INTO public.apple_siwa_token (user_id, client_id, apple_sub, token_enc)
        VALUES (${i.userId}::uuid, ${i.clientId}, ${i.appleSub}, ${sealed})
        ON CONFLICT (user_id, client_id) DO UPDATE SET
          apple_sub = EXCLUDED.apple_sub, token_enc = EXCLUDED.token_enc, updated_at = now(),
          queued_at = NULL, next_attempt_at = NULL, attempts = 0, last_error = NULL`
    }, STORE_TX)
    return 'stored'
  } catch (e) {
    logWarn('[auth] apple_token_not_kept', { reason: isMissingTable(e) ? 'no_table' : isLockTimeout(e) ? 'busy' : 'db', client: i.clientId })
    return 'failed'
  }
}

// ── The erasure's hand-over (C1, C2) ──────────────────────────────────────────────────────────────

/**
 * ⛔ C1 — CALLED INSIDE THE ERASURE'S OWN TRANSACTION. Every ACTIVE row of the account is queued in the same commit
 * that deletes its profile, so from that commit on the daily retry owns it. Before, rows were queued or revoked only
 * AFTER the commit: a process killed in between left them active — invisible to the retry — for good.
 * A day out, like every retry: the erasure tries them itself right after the commit (settleQueuedTokens), and TN3194
 * allows one validation a day. Answers the rows it queued.
 *
 * ⛔ APPLE NEVER FAILS THE ERASURE. A missing table (to_regclass, so no statement fails on it) is "nothing to queue";
 * any other failure is rolled back to a SAVEPOINT — measured on Postgres 14 through the Prisma 7 pg adapter: the
 * erasure's own writes still commit — and the caller hands the rows over after the commit instead
 * (queueUnsettledTokens), as it did before this existed.
 */
export async function queueTokensForErasure(tx: RawSql, userId: string): Promise<{ keys: QueuedKey[]; missingTable: boolean; failed: boolean }> {
  await tx.$executeRaw`SAVEPOINT apple_siwa_erasure`
  try {
    if (!(await appleTokenTablePresent(tx))) {
      await tx.$executeRaw`RELEASE SAVEPOINT apple_siwa_erasure`
      logWarn('[auth] apple_token_table_missing', {})
      return { keys: [], missingTable: true, failed: false }
    }
    const rows = await tx.$queryRaw<KeyRow[]>`
      UPDATE public.apple_siwa_token
      SET queued_at = now(), next_attempt_at = now() + interval '1 day',
          last_error = COALESCE(last_error, 'erased'), updated_at = now()
      WHERE user_id = ${userId}::uuid AND queued_at IS NULL
      RETURNING user_id::text AS user_id, client_id, apple_sub`
    await tx.$executeRaw`RELEASE SAVEPOINT apple_siwa_erasure`
    return { keys: rows.map(toKey), missingTable: false, failed: false }
  } catch (e) {
    logError(e, { op: 'apple-siwa.queueTokensForErasure' })
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT apple_siwa_erasure`
    return { keys: [], missingTable: false, failed: true }
  }
}

/**
 * Queues every row of this user still ACTIVE and answers which. Run by the erasure (outside its transaction) in two
 * places: after the commit when the in-transaction hand-over failed, and — C2 — after GoTrue's DELETE succeeded, for
 * a sign-in that stored a token while the account was being deleted (no active row may outlive its account). It
 * touches no attempt count: nothing was tried for these rows.
 */
export async function queueUnsettledTokens(userId: string): Promise<QueuedKey[]> {
  const rows = await db.$queryRaw<KeyRow[]>`
    UPDATE public.apple_siwa_token
    SET queued_at = now(), next_attempt_at = now() + interval '1 day',
        last_error = COALESCE(last_error, 'unsettled'), updated_at = now()
    WHERE user_id = ${userId}::uuid AND queued_at IS NULL
    RETURNING user_id::text AS user_id, client_id, apple_sub`
  return rows.map(toKey)
}

// ── The daily retry's queue ───────────────────────────────────────────────────────────────────────

/**
 * The slack on "due" — see dueRevocations. Over the timer's RandomizedDelaySec (2 min) and a Persistent catch-up run's
 * usual lateness; under a day, so a token is still checked at most once a day (TN3194).
 */
export const APPLE_DUE_SLACK = '2 hours'

/**
 * The queued rows of the settle units that are due — oldest first.
 * ⚠️ DUE WITHIN THE SLACK, NOT TO THE SECOND. A retried row comes due exactly 24 h after the run that tried it, and
 * the timer fires at 09:15 UTC plus a random delay drawn afresh every day — so whenever today's run started a few
 * seconds earlier than yesterday's (about half the days), the row was not yet due and slipped a whole day: the
 * "daily" retry ran every other day, 7–9 times in its 14 days instead of 14.
 * ⛔ `limit` COUNTS UNITS — (account, Apple ID) — NEVER ROWS (commit gate round 2, C4). Both clients' rows of one unit
 * share ONE grouped authorization and must be settled together (settleQueuedTokens: checked, THEN revoked); a row LIMIT
 * falling between them settled one today and left the other, dead by then, to read `manual` tomorrow. So the due units
 * are chosen first, LIMIT applied to them, and EVERY queued row of each comes back — a sibling not yet due included.
 */
/**
 * Whether anyone on this deployment can have signed in with Apple: Apple on offer in this build, OR configured on this
 * server (APPLE_SIWA_* present — which stays true through a rollback of the flag; commit gate round 7, codex). Both
 * editions: they share one database, so an Apple account can be deleted from either.
 */
export function appleOnOffer(): boolean {
  return appleFlagSet() || !!appleServicesId() || !!appleBundleId()
}

/**
 * ⛔ THE 14-DAY PROMISE HOLDS THROUGH AN OUTAGE (commit gate round 9, codex): while Apple is unreachable no unit is
 * settled, so no row reaches the settle's own give-up. Rows queued longer than `maxAgeMs` are dropped here instead
 * (D9: retry at most 14 days, then drop and alert) and returned for the log. Never throws.
 */
export async function dropStaleQueued(maxAgeMs: number): Promise<Array<{ userId: string; clientId: string; attempts: number }>> {
  try {
    const rows = await db.$queryRaw<Array<{ user_id: string; client_id: string; attempts: number }>>`
      DELETE FROM public.apple_siwa_token
      WHERE queued_at IS NOT NULL AND queued_at < now() - make_interval(secs => ${maxAgeMs / 1000})
      RETURNING user_id::text AS user_id, client_id, attempts`
    return rows.map((r) => ({ userId: r.user_id, clientId: r.client_id, attempts: Number(r.attempts) || 0 }))
  } catch (e) {
    logWarn('[auth] apple_stale_drop_failed', { reason: isMissingTable(e) ? 'no_table' : 'db' })
    return []
  }
}

/**
 * How long the oldest queued row has waited, in ms; null when nothing is queued. ⛔ THROWS when the table cannot be
 * read (commit gate round 12, codex): "cannot tell" must not read as "nothing waiting" — the caller turns it red.
 */
export async function oldestQueuedMs(): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ age_ms: number | null }>>`
    SELECT (EXTRACT(EPOCH FROM (now() - min(queued_at))) * 1000)::float8 AS age_ms
    FROM public.apple_siwa_token WHERE queued_at IS NOT NULL`
  const age = rows[0]?.age_ms
  return typeof age === 'number' && Number.isFinite(age) ? age : null
}

export async function dueRevocations(limit = 100): Promise<AppleTokenRow[]> {
  const rows = await db.$queryRaw<DbRow[]>`
    WITH due AS (
      SELECT user_id, apple_sub, min(next_attempt_at) AS first_due
      FROM public.apple_siwa_token
      WHERE queued_at IS NOT NULL AND next_attempt_at <= now() + ${APPLE_DUE_SLACK}::interval
      GROUP BY user_id, apple_sub
      ORDER BY first_due, user_id, apple_sub
      LIMIT ${limit}
    )
    SELECT t.user_id::text AS user_id, t.client_id, t.apple_sub, t.token_enc, t.queued_at, t.attempts, t.last_error
    FROM public.apple_siwa_token t
    JOIN due d ON d.user_id = t.user_id AND d.apple_sub = t.apple_sub
    WHERE t.queued_at IS NOT NULL
    ORDER BY d.first_due, t.user_id, t.apple_sub, t.client_id`
  return rows.map(toRow)
}

/**
 * Does public.apple_siwa_token exist? (to_regclass — no statement fails on a missing table, so this is safe inside a
 * transaction too.) False until scripts/apple-siwa-ddl.mjs has run on this database.
 */
export async function appleTokenTablePresent(client: RawSql = db): Promise<boolean> {
  const [table] = await client.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public.apple_siwa_token') IS NOT NULL AS present`
  return table?.present === true
}

/**
 * Does the daily retry still hold queued rows of this account? Null — cannot tell (the read failed). A missing table
 * holds none. For a repeated deletion request, which can no longer know what the first one answered
 * (account-erasure.ts appleStatusAfterErasure).
 */
export async function hasQueuedTokens(userId: string): Promise<boolean | null> {
  try {
    if (!(await appleTokenTablePresent())) return false
    const [r] = await db.$queryRaw<Array<{ queued: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM public.apple_siwa_token WHERE user_id = ${userId}::uuid AND queued_at IS NOT NULL) AS queued`
    return r?.queued === true
  } catch (e) {
    logWarn('[auth] apple_queue_unreadable', { code: String(sqlState(e) ?? 'error') })
    return null
  }
}

/**
 * ⛔ C2 — ACTIVE ROWS WHOSE ACCOUNT IS GONE, QUEUED BY THE DAILY RETRY. However the erasure orders its steps, a
 * sign-in can store a token for the account while it is being deleted — the store comes at the END of a sign-in, so
 * it can land after the erasure's in-transaction queue, after its post-delete sweep, after GoTrue's DELETE itself.
 * Such a row has no account, no foreign key to cascade it and queued_at NULL: nothing would ever revoke it.
 *
 * Candidates: active rows with no Profile. public."Profile".id references auth.users ON DELETE CASCADE
 * (profile_auth_fk), so every account that is gone has lost its profile; the only other candidate is a live account
 * whose profile was never written, and the confirmation clears it.
 * Confirmation, per candidate, that the auth user is GONE — auth.users itself where this role can read it, else
 * GoTrue's admin API (authUserState). Anything unconfirmed is left queued_at NULL and counted: a wrong "gone"
 * would revoke a LIVE account's authorization, a missed one only waits for a later run.
 * Queued due NOW: these were never tried.
 * ⚠️ A ROTATING WINDOW (verifier, 2026-10-09). `limit` bounds the GoTrue calls of one run, and the window used to be
 * whatever 50 rows Postgres returned first — so 50 candidates that never confirm (live accounts whose profile was
 * never written, erasures that kept their auth user, every candidate while GoTrue cannot be asked) could fill it every
 * day and hold a real orphan behind them for good. Now the least recently touched accounts come first, and every
 * candidate this run could not confirm gone is touched (updated_at — on an ACTIVE row only the store writes it
 * otherwise), so each one is looked at within ⌈candidates / limit⌉ runs.
 */
export async function queueOrphanedTokens(limit = 50, deadline?: number): Promise<{ candidates: number; queued: number; unconfirmed: number }> {
  const candidates = await db.$queryRaw<Array<{ user_id: string }>>`
    SELECT t.user_id::text AS user_id
    FROM public.apple_siwa_token t
    WHERE t.queued_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public."Profile" p WHERE p.id = t.user_id)
    GROUP BY t.user_id
    ORDER BY min(t.updated_at), t.user_id
    LIMIT ${limit}`
  let queued = 0
  let unconfirmed = 0
  for (const { user_id: userId } of candidates) {
    // Bounded by the run's deadline (round 9, codex): with auth.users unreadable each look is a 5 s GoTrue call.
    if (deadline !== undefined && Date.now() > deadline) break
    const state = await authUserState(userId)
    if (state === 'gone') {
      queued += await db.$executeRaw`
        UPDATE public.apple_siwa_token
        SET queued_at = now(), next_attempt_at = now(), last_error = COALESCE(last_error, 'orphaned'), updated_at = now()
        WHERE user_id = ${userId}::uuid AND queued_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public."Profile" p WHERE p.id = ${userId}::uuid)`
      continue
    }
    if (state === 'unknown') unconfirmed++
    // Looked at, not confirmed gone: to the back of the window, so the next run looks at the ones behind it.
    await db.$executeRaw`
      UPDATE public.apple_siwa_token SET updated_at = now()
      WHERE user_id = ${userId}::uuid AND queued_at IS NULL`
  }
  return { candidates: candidates.length, queued, unconfirmed }
}

/**
 * Does this auth user still exist? From auth.users where this database role can read it, else from GoTrue's admin
 * API (gone = GoTrue's own user_not_found, never just any 404 — isGoTrueUserNotFound). Until this module the app never
 * read the auth schema at runtime — the repo's cross-schema reads were the profile_auth_fk constraint and scripts run
 * on DIRECT_URL (purge-pre-launch-data.mjs) — so an unreadable one is handled, not an error (probeAuthTables reports
 * it). ⚠️ "Readable" means a NON-EMPTY answer: row-level security hiding every row must read as "cannot tell", never
 * as "everyone is gone".
 */
export async function authUserState(userId: string): Promise<'present' | 'gone' | 'unknown'> {
  try {
    const [r] = await db.$queryRaw<Array<{ readable: boolean; present: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM auth.users) AS readable,
             EXISTS (SELECT 1 FROM auth.users WHERE id = ${userId}::uuid) AS present`
    if (r?.readable) return r.present ? 'present' : 'gone'
  } catch {
    // 42501 (no privilege) or 42P01 (no auth schema — a scratch database): GoTrue decides.
  }
  const user = await gotrueAdminUser(userId)
  return user === 'gone' || user === 'unknown' ? user : 'present'
}

// ── Revocation: validate, then revoke ─────────────────────────────────────────────────────────────

/** A queued token is retried once a day for at most this long after the erasure, then dropped and alerted (D9). */
export const APPLE_REVOKE_GIVE_UP_MS = 14 * 24 * 60 * 60 * 1000

/**
 *   revoked — validated and revoked: drop the row.
 *   manual  — Apple says the token is already dead (invalid_grant): nothing left to revoke from here, so the
 *             person is told to check their Apple Account themselves (TN3194). Drop the row.
 *   retry   — anything else (no answer, Apple 5xx, our secret refused, no key to open the token): keep it queued.
 */
export type RevokeOutcome =
  | { outcome: 'revoked' }
  | { outcome: 'manual'; error: 'invalid_grant' }
  | { outcome: 'retry'; error: AppleCallError | 'undecryptable' | 'deadline' }

/**
 * Step one: open the kept token and ask Apple whether it is still good (the refresh grant — once a day, TN3194).
 * `deadline`: the caller's deadline left no time to ask (settleQueuedTokens) — Apple was not asked.
 */
export type TokenCheck =
  | { state: 'valid'; token: string }
  | { state: 'dead' }
  | { state: 'retry'; error: AppleCallError | 'undecryptable' | 'deadline' }

export async function checkStoredToken(row: AppleTokenRow, timeoutMs?: number): Promise<TokenCheck> {
  const token = openAppleToken(row.tokenEnc, row.userId, row.clientId)
  if (!token) return { state: 'retry', error: 'undecryptable' }
  const valid = await validateRefresh(row.clientId, token, timeoutMs)
  if (valid.ok) return { state: 'valid', token }
  return valid.error === 'invalid_grant' ? { state: 'dead' } : { state: 'retry', error: valid.error }
}

/** Step two: revoke a token checkStoredToken found valid. */
export async function revokeCheckedToken(row: AppleTokenRow, token: string, timeoutMs?: number): Promise<RevokeOutcome> {
  const done = await revoke(row.clientId, token, timeoutMs)
  if (done.ok) return { outcome: 'revoked' }
  return done.error === 'invalid_grant' ? { outcome: 'manual', error: 'invalid_grant' } : { outcome: 'retry', error: done.error }
}

/**
 * What became of one queued row:
 *   revoked  — validated and revoked: the row is gone.
 *   manual   — already dead at Apple (invalid_grant): the row is gone; nothing left to revoke from here.
 *   retried  — Apple could not take it now (or our secret is refused): one more attempt a day later.
 *   gave_up  — still failing past giveUpAfterMs since the erasure: the row is gone and the caller alerts.
 *   dropped  — a LIVE account holds this Apple ID (its kept token, or GoTrue's identity row): never revoked (it would
 *              take that account's authorization); the row is gone, and that account's own deletion revokes the
 *              shared authorization — or, holding no token, answers `manual`.
 *   deferred — an active row whose account cannot be told live or gone holds this Apple ID — or the caller's deadline
 *              left no time to ask Apple (`opts.deadline`) — untouched a day more, no attempt counted.
 *   skipped  — no longer queued when the lock was granted: a sign-in re-activated it, or another run settled it.
 */
export type SettleOutcome =
  | { clientId: string; outcome: 'revoked' | 'manual' | 'dropped' | 'deferred' | 'skipped' }
  | { clientId: string; outcome: 'retried'; error: string }
  | { clientId: string; outcome: 'gave_up'; error: string; attempts: number }

/**
 * ⛔ DOES GoTrue SAY A LIVE ACCOUNT HOLDS THIS APPLE ID? (verifier, 2026-10-09 — the retry's second question, beside
 * the token table's: appleSubLockKey says why.) auth.identities is GoTrue's own record — provider_id is the identity's
 * `sub` (models.NewIdentity), which for Apple is Apple's user id on both the web flow and the native id_token grant (the
 * appleSub every store keeps), unique per provider — and GoTrue writes it before a sign-in can store any token.
 *   true  — an Apple identity with this sub belongs to ANOTHER account (a re-sign-up, whatever became of its token),
 *           or to this one again with a Profile: an erasure that kept its auth user, signed into once more. A visible
 *           row is proof even under row-level security.
 *   false — no such identity, read by a role that sees every row.
 *   null  — cannot tell: no auth.identities, no privilege, or row-level security hiding rows from this role (GoTrue
 *           enables it on every auth table, no policy — only BYPASSRLS, which production's postgres has, sees a row).
 * `lower(provider)`: GoTrue keeps the provider as the authorize request spelled it (external.go:42).
 * Runs in the caller's transaction behind a SAVEPOINT: a failing read must not abort the settle — measured on Postgres
 * 14: ROLLBACK TO SAVEPOINT keeps the Apple ID's advisory lock and its lock_timeout.
 */
export async function appleIdHeldElsewhere(tx: RawSql, appleSub: string, userId: string): Promise<boolean | null> {
  await tx.$executeRaw`SAVEPOINT apple_siwa_identity`
  try {
    const [r] = await tx.$queryRaw<Array<{ visible: boolean; held: boolean }>>`
      SELECT NOT row_security_active('auth.identities'::regclass) AS visible,
             EXISTS (SELECT 1 FROM auth.identities i
                     WHERE i.provider_id = ${appleSub} AND lower(i.provider) = 'apple'
                       AND (i.user_id <> ${userId}::uuid
                            OR EXISTS (SELECT 1 FROM public."Profile" p WHERE p.id = i.user_id))) AS held`
    await tx.$executeRaw`RELEASE SAVEPOINT apple_siwa_identity`
    if (r?.held === true) return true
    return r?.visible === true ? false : null
  } catch {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT apple_siwa_identity`
    return null
  }
}

/**
 * Settle the QUEUED tokens of one account for one Apple ID — the unit the erasure runs right after its commit and the
 * daily retry runs every day — in ONE transaction holding the Apple ID's lock (C3) from the first read to the last
 * write, Apple's calls included:
 *   1. The rows are re-read under the lock, and only those still queued are touched ('skipped' otherwise).
 *   2. liveCheck (the retry): does a LIVE account hold this Apple ID? Asked twice, and either yes means nothing is
 *      revoked: 'dropped'.
 *      · This table: an ACTIVE row of an account with a Profile (profile_auth_fk guarantees only a live auth user has
 *        one) — the half the lock serialises against every store.
 *      · ⛔ GoTrue (appleIdHeldElsewhere — verifier, 2026-10-09): an Apple identity with this sub on ANOTHER account,
 *        or on this one again with a Profile. Keeping a token is best effort, so a re-sign-up whose store failed holds
 *        the Apple ID with no row here; until this, the retry then validated the old token and revoked the new
 *        account's grouped authorization with it. GoTrue's table unreadable (no privilege, row-level security, no auth
 *        schema): the token table alone answers, as before, `[auth] apple_identity_unverified` is logged, and the daily
 *        retry's probe is red on the same cause (probeAuthTables).
 *      An active row with NO profile and no identity behind it — an orphan the sweep has not confirmed yet — cannot be
 *      told apart, so it is neither revoked nor dropped: 'deferred'. (An orphan cannot make the retry drop another
 *      erasure's token unrevoked any more.)
 *      The erasure passes false: until GoTrue's DELETE the erased account itself holds the Apple identity — GoTrue
 *      keeps one account per Apple ID (identities_provider_id_provider_unique), and eno never unlinks one — so no
 *      other account can, and an active row of its own is a sign-in racing the deletion, revoked with the rest.
 *   3. Check EVERY row, THEN revoke the valid ones. Both clients share one grouped authorization: revoking the first
 *      kills the second, which would then check dead — "manual" for a person eno was in fact removed for. Rows of a
 *      client the probe found refused (invalid_client) are not sent to Apple at all.
 *   4. Revoked or already dead → the row goes. Anything else → retried a day later, or past giveUpAfterMs → gone.
 * Every write is compare-and-set on the token read in step 1. Throws only when the database fails; the rows are then
 * exactly as before — queued, owned by the retry.
 * ⛔ `deadline` (epoch ms — the erasure's request path, commit gate round 2, O3): the lock is waited for at most
 * APPLE_ERASURE_LOCK_WAIT_MS, and no longer than the deadline leaves once the transaction has begun — after any wait for
 * a pooled connection; 100 ms at the least (a timeout throws — the rows stay queued). The transaction is bounded by the
 * deadline, each call to Apple by what is left of it, and with under APPLE_MIN_CALL_MS left a row is not sent at all:
 * 'deferred' (never checked) or 'retried' with `deadline` (checked, not revoked) — queued for the daily retry either way.
 */
export async function settleQueuedTokens(
  target: { userId: string; appleSub: string; clientIds: readonly string[] },
  opts: { liveCheck: boolean; refusedClients?: ReadonlySet<string>; giveUpAfterMs?: number; now?: number; deadline?: number },
): Promise<SettleOutcome[]> {
  const left = () => (opts.deadline === undefined ? Infinity : opts.deadline - Date.now())
  /** Apple's bound for the next call: APPLE_TIMEOUT_MS, or what the deadline leaves — null when too little is left. */
  const callMs = (): number | null => {
    const l = left()
    return l >= APPLE_MIN_CALL_MS ? Math.min(APPLE_TIMEOUT_MS, Math.floor(l)) : null
  }
  const bounded = opts.deadline !== undefined
  // Never under 100 ms: a lock_timeout of 0 means NO timeout to Postgres.
  const within = (cap: number) => Math.max(100, Math.min(cap, Math.floor(left())))
  const txBounds = bounded ? { maxWait: within(SETTLE_TX.maxWait), timeout: Math.max(0, Math.floor(left())) + SETTLE_TX_SLACK_MS } : SETTLE_TX
  return db.$transaction(async (tx) => {
    // ⛔ THE LOCK WAIT IS WHAT THE DEADLINE LEAVES ONCE THE TRANSACTION HAS BEGUN (verifier, commit gate round 2). The
    // wait for a pooled connection (≤ maxWait) comes first: computed before it, the full 3 s followed a busy pool and a
    // held lock ended the settle up to 3 s past its deadline (measured: 55P03 at 5429 ms against 3000 ms).
    await lockAppleSub(tx, target.appleSub, bounded ? `${within(APPLE_ERASURE_LOCK_WAIT_MS)}ms` : LOCK_WAIT)
    const wanted = new Set(target.clientIds)
    const rows = (await tx.$queryRaw<DbRow[]>`
      SELECT user_id::text AS user_id, client_id, apple_sub, token_enc, queued_at, attempts, last_error
      FROM public.apple_siwa_token
      WHERE user_id = ${target.userId}::uuid AND apple_sub = ${target.appleSub} AND queued_at IS NOT NULL`)
      .map(toRow)
      .filter((r) => wanted.has(r.clientId))
    const out: SettleOutcome[] = [...wanted].filter((c) => !rows.some((r) => r.clientId === c)).map((clientId) => ({ clientId, outcome: 'skipped' as const }))
    if (!rows.length) return out

    const now = opts.now ?? Date.now()
    const expired = (r: AppleTokenRow) => opts.giveUpAfterMs !== undefined && !!r.queuedAt && now - r.queuedAt.getTime() >= opts.giveUpAfterMs
    const drop = (r: AppleTokenRow) => tx.$executeRaw`
      DELETE FROM public.apple_siwa_token
      WHERE user_id = ${r.userId}::uuid AND client_id = ${r.clientId} AND token_enc = ${r.tokenEnc} AND queued_at IS NOT NULL`
    /** Not settled now: a day later — or, past the give-up, gone. `attempted`: Apple was (or would have been) asked. */
    const later = async (r: AppleTokenRow, error: string, attempted: boolean): Promise<SettleOutcome> => {
      if (expired(r)) {
        await drop(r)
        return { clientId: r.clientId, outcome: 'gave_up', error, attempts: r.attempts + (attempted ? 1 : 0) }
      }
      await tx.$executeRaw`
        UPDATE public.apple_siwa_token
        SET next_attempt_at = now() + interval '1 day', attempts = attempts + ${attempted ? 1 : 0},
            last_error = ${error.slice(0, 40)}, updated_at = now()
        WHERE user_id = ${r.userId}::uuid AND client_id = ${r.clientId} AND token_enc = ${r.tokenEnc} AND queued_at IS NOT NULL`
      return attempted ? { clientId: r.clientId, outcome: 'retried', error } : { clientId: r.clientId, outcome: 'deferred' }
    }

    if (opts.liveCheck) {
      const [held] = await tx.$queryRaw<Array<{ live: boolean; active: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM public.apple_siwa_token t JOIN public."Profile" p ON p.id = t.user_id
                       WHERE t.apple_sub = ${target.appleSub} AND t.queued_at IS NULL) AS live,
               EXISTS (SELECT 1 FROM public.apple_siwa_token t
                       WHERE t.apple_sub = ${target.appleSub} AND t.queued_at IS NULL) AS active`
      const elsewhere = held?.live ? true : await appleIdHeldElsewhere(tx, target.appleSub, target.userId)
      if (elsewhere === true) {
        for (const r of rows) {
          await drop(r)
          out.push({ clientId: r.clientId, outcome: 'dropped' })
        }
        return out
      }
      if (elsewhere === null) logWarn('[auth] apple_identity_unverified', {})
      if (held?.active) {
        for (const r of rows) out.push(await later(r, 'deferred_active', false))
        return out
      }
    }

    const checked: Array<{ row: AppleTokenRow; check: TokenCheck }> = []
    for (const row of rows) {
      let check: TokenCheck
      if (opts.refusedClients?.has(row.clientId)) check = { state: 'retry', error: 'invalid_client' }
      else {
        const ms = callMs()
        check = ms === null
          ? { state: 'retry', error: 'deadline' }
          : await checkStoredToken(row, ms).catch((): TokenCheck => ({ state: 'retry', error: 'network' }))
      }
      checked.push({ row, check })
    }
    for (const { row, check } of checked) {
      let r: RevokeOutcome
      if (check.state === 'valid') {
        const ms = callMs()
        r = ms === null
          ? { outcome: 'retry', error: 'deadline' }
          : await revokeCheckedToken(row, check.token, ms).catch((): RevokeOutcome => ({ outcome: 'retry', error: 'network' }))
      } else r = check.state === 'dead' ? { outcome: 'manual', error: 'invalid_grant' } : { outcome: 'retry', error: check.error }
      if (r.outcome === 'retry') {
        // Apple was asked (or, for a refused client, would have been) — unless the deadline left no time to check at all.
        out.push(await later(row, r.error, !(check.state === 'retry' && check.error === 'deadline')))
        continue
      }
      await drop(row)
      out.push({ clientId: row.clientId, outcome: r.outcome })
    }
    return out
  }, txBounds)
}

// ── GoTrue ────────────────────────────────────────────────────────────────────────────────────────

type AdminUser = { identities?: Array<{ provider?: string }> | null; app_metadata?: { provider?: unknown; providers?: unknown } }

/**
 * ⛔ GoTrue's OWN "NO SUCH USER" — a 404 whose body says `user_not_found` (v2.189.0 admin.go loadUser; `error_code` in
 * the default response shape, `code` in the 2024-01-01 one) — NEVER JUST ANY 404 (verifier, 2026-10-09). A gateway's
 * "no Route matched", a wrong base URL or a malformed id (`validation_failed`) answer 404 as well, and reading one of
 * those as "gone" is the one dangerous direction: the orphan sweep would queue — and the same run revoke — a live
 * account's token, and the erasure would sweep an account whose auth user it did not delete.
 */
export async function isGoTrueUserNotFound(res: Response): Promise<boolean> {
  if (res.status !== 404) return false
  try {
    const body = (await res.json()) as { error_code?: unknown; code?: unknown } | null
    return body?.error_code === 'user_not_found' || body?.code === 'user_not_found'
  } catch {
    return false
  }
}

/**
 * GoTrue's admin view of one user (5 s): the user, 'gone' (GoTrue's own user_not_found — isGoTrueUserNotFound), or
 * 'unknown' (not asked, no answer, any other refusal or 404, not JSON).
 */
async function gotrueAdminUser(userId: string): Promise<AdminUser | 'gone' | 'unknown'> {
  // Static access, not env(): Next inlines NEXT_PUBLIC_* only where the name is written out.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null
  const key = env('SUPABASE_SECRET_KEY')
  if (!url || !key) return 'unknown'
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (res.status === 404) return (await isGoTrueUserNotFound(res)) ? 'gone' : 'unknown'
    if (!res.ok) return 'unknown'
    const user = (await res.json()) as unknown
    return user && typeof user === 'object' ? (user as AdminUser) : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Does this account have an Apple identity? Read straight from GoTrue's admin API (5 s), because a missing token row
 * does not mean "not an Apple user": the keep is best effort, and TN3194 says to send someone whose token we do not
 * hold to manual revocation.
 *   apple   — its identities, app_metadata.providers or app_metadata.provider name Apple (any case: GoTrue keeps the
 *             provider as the authorize request spelled it).
 *   none    — ⛔ A PROOF, NOT A DEFAULT (commit gate round 2, C1): GoTrue answered with this user AND at least one of its
 *             two lists of providers (identities, app_metadata.providers), and nothing anywhere names Apple.
 *   unknown — anything else: GoTrue not asked or not answering, an answer with neither list, or a user GoTrue no longer
 *             knows (user_not_found — its identities are gone with it, so nothing can be proven about them).
 */
export async function appleIdentityState(userId: string): Promise<'apple' | 'none' | 'unknown'> {
  const user = await gotrueAdminUser(userId)
  if (user === 'gone' || user === 'unknown') return 'unknown'
  const isApple = (p: unknown) => typeof p === 'string' && p.trim().toLowerCase() === 'apple'
  const meta = user.app_metadata ?? {}
  const identities = Array.isArray(user.identities) ? user.identities.map((i) => i?.provider) : null
  const providers = Array.isArray(meta.providers) ? (meta.providers as unknown[]) : null
  if ([...(identities ?? []), ...(providers ?? []), meta.provider].some(isApple)) return 'apple'
  return identities || providers ? 'none' : 'unknown'
}

/**
 * ⛔ C4 — WHICH PROVIDER MINTED THIS CODE, FROM GOTRUE ITSELF. `/auth/callback?p=apple` is a query parameter: anyone
 * can append it to any callback, and on an account where Google and Apple are linked (GoTrue links same-email
 * identities) a GOOGLE sign-in carrying p=apple found the Apple identity and kept Google's provider_refresh_token as
 * an Apple token — later sent to Apple at deletion.
 * GoTrue keeps the truth in auth.flow_state — read in the v2.189.0 source (the planning step's copy, git tree
 * 4fa66ba7): /authorize stores provider_type = the `provider` query value as sent (external.go:42,99 — the lookup
 * lowercases it, :590, the row does not: hence toLowerCase here) and, for PKCE, auth_code = a fresh UUID
 * (models/flow_state.go:124); the callback writes the provider's tokens and the user onto that row (external.go:233-234)
 * and redirects with ?code=<its auth_code> (:271); the PKCE grant finds the row by that code
 * (token.go:234, flow_state.go:149 `auth_code = ?`), refuses one without a user (:236), hands back ITS provider tokens
 * (:274) and deletes it (:276). So this is read BEFORE exchangeCodeForSession, by the code being exchanged.
 * apple-siwa.probe.test.ts proves this query on a stand-in table; a future GoTrue that keyed the row differently fails
 * the safe way — nothing kept, every Apple web sign-in logging `apple_token_not_kept {reason: provider_unverified}`.
 * Null — keep nothing — on ANY doubt: no row, more than one, an unreadable auth schema, any error.
 * ⚠️ THE ROLE MUST SEE THE ROWS, NOT ONLY HOLD THE GRANT: GoTrue enables row-level security on auth.flow_state with no
 * policy, so a role without BYPASSRLS reads zero rows here — indistinguishable from "no row". A failed read logs
 * `[auth] apple_flow_state_unreadable`; the hidden-rows case only probeAuthTables can see, and the daily retry turns red
 * on it.
 */
export async function pkceCodeProvider(code: string): Promise<{ provider: string; userId: string | null } | null> {
  if (!code || code.length > 512) return null
  try {
    const rows = await db.$queryRaw<Array<{ provider_type: unknown; user_id: string | null }>>`
      SELECT provider_type, user_id::text AS user_id FROM auth.flow_state WHERE auth_code = ${code} LIMIT 2`
    if (rows.length !== 1 || typeof rows[0].provider_type !== 'string' || !rows[0].provider_type) return null
    return { provider: rows[0].provider_type.toLowerCase(), userId: rows[0].user_id ?? null }
  } catch (e) {
    logWarn('[auth] apple_flow_state_unreadable', { code: String(sqlState(e) ?? 'error') })
    return null
  }
}

export type AuthTableRead = 'readable' | 'unreadable'
/** probeAuthTables' answer: one word per GoTrue table, and the SQLSTATE when the probe itself could not run. */
export type AuthTablesProbe = { flowState: AuthTableRead; identities: AuthTableRead; users: AuthTableRead; error?: string }

/**
 * ⛔ CAN THIS DATABASE ROLE READ THE GoTrue TABLES THE APPLE FLOW LEANS ON? (verifier, 2026-10-09.) Each reader answers
 * "cannot read" with "cannot tell" and carries on safely — pkceCodeProvider (auth.flow_state: no web token kept),
 * appleIdHeldElsewhere (auth.identities: the retry's live check falls back to the token table), authUserState
 * (auth.users: GoTrue's admin API decides) — so nothing would ever SAY the role lost its read. This does.
 * Readable = the table exists, this role may SELECT it, AND row-level security does not apply to this role.
 * ⚠️ THE GRANT ALONE PROVES NOTHING: GoTrue (v2.189.0, migration 20240612123726_enable_rls_update_grants) enables RLS
 * on every auth table with no policy and grants SELECT to postgres — so has_table_privilege says true for a role that
 * sees zero rows; only BYPASSRLS (production's postgres: scripts/rls-guard.sql) or ownership sees one. Measured on
 * Postgres 14: a NOBYPASSRLS role with the grant gets privilege true, row_security_active true, 0 rows.
 * Any error — no USAGE on schema auth (to_regclass raises 42501), no auth schema — reads as unreadable, all three.
 * The daily retry makes it its health (/api/cron/apple-revocations).
 */
export async function probeAuthTables(client: RawSql = db): Promise<AuthTablesProbe> {
  const out: AuthTablesProbe = { flowState: 'unreadable', identities: 'unreadable', users: 'unreadable' }
  const key: Record<string, keyof Omit<AuthTablesProbe, 'error'>> = { flow_state: 'flowState', identities: 'identities', users: 'users' }
  try {
    const rows = await client.$queryRaw<Array<{ name: string; readable: boolean | null }>>`
      SELECT t.name, has_table_privilege(c.rel, 'SELECT') AND NOT row_security_active(c.rel) AS readable
      FROM (VALUES ('flow_state'), ('identities'), ('users')) AS t(name)
      CROSS JOIN LATERAL (SELECT to_regclass('auth.' || t.name) AS rel) c`
    for (const r of rows) if (key[r.name] && r.readable === true) out[key[r.name]] = 'readable'
  } catch (e) {
    out.error = String(sqlState(e) ?? 'error')
  }
  return out
}
