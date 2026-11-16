import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'
import {
  AGENT_GRANT_PREFIX, DEFAULT_SIGN_IN_SCOPES, eligibleShop, GRANT_MAX_AGE_SECONDS, labelledHash, PENDING_AT,
} from '@/lib/api/oauth-grant'

/**
 * ── AGENT REGISTRATION: THE auth.md `service_auth` CLAIM CEREMONY (owner 2026-11-16 "plan well and build") ────────────
 *
 * An AI agent that knows only its person's EMAIL gets a credential for that person's eno SHOP, by the ceremony of
 * https://github.com/workos/auth.md (agent-services/README.md) — shaped like RFC 8628 device authorization:
 *   1. POST /api/agent/identity { type: "service_auth", login_hint } → claim_token + a 6-digit user_code + the BARE
 *      verification_uri https://<site>/oauth/agent (registerServiceAuth);
 *   2. the person opens that page themselves, signed in, types the code, sees which shop and access are asked, presses Allow
 *      (lookupByCode → agent ticket → completeClaim) — a PENDING grant row, like Sign in with eno's consent;
 *   3. the agent polls /api/v1/oauth/token with grant_type urn:workos:agent-auth:grant-type:claim (pollClaim): pending →
 *      authorization_pending; once allowed, ONE atomic pending→live transition answers an access token + an
 *      identity_assertion; later grant_type jwt-bearer + that assertion mints fresh access tokens (exchangeAssertion).
 *
 * ⛔ WHAT IS NOT OFFERED (and so not advertised): `anonymous` (an ownerless principal — nothing a shopless agent may do
 * here) and `identity_assertion` (no ID-JAG provider is trusted), so no `events_endpoint` either. Plan review (opus,
 * 2026-11-16) shaped the rest:
 *  · THE verification_uri CARRIES NOTHING. A link with the request in it is a one-click phishing link (RFC 8628 §5.4 on
 *    verification_uri_complete): an attacker posing as "the agent" receives the link and the code and sends both to the
 *    victim. Here the person opens /oauth/agent and types the code; it is looked up only among the attempts made for the
 *    SIGNED-IN person's own confirmed email — so a guessed code can only ever connect an agent to the guesser's own shop.
 *  · A connection that went live is announced in the bell, with Dashboard › Developers (Disconnect) one tap away.
 *  · THE identity_assertion IS AN OPAQUE RANDOM SECRET (`eno_ia_<grant id>_<random>`), its labelled hash on the grant
 *    row — nothing long-lived is signed (oauth-grant.ts: the signing key derives from a secret that gets rotated). It does
 *    not rotate: the auth.md agent re-presents the SAME assertion until it expires, and a rotating one would read every
 *    such retry as a replay. It lives as long as the grant: GRANT_MAX_AGE_SECONDS, Disconnect, or losing the shop.
 *  · The grant IS an ApiKey row with the `oag_` prefix and its own binding (AGENT_GRANT_PREFIX), so Disconnect, the
 *    180-day cap and the per-call check in resolveApiKey (the access token's `aud` is the MCP server) all apply unchanged.
 *    Refused by name by the client_credentials grant (every `oag_` row) and by rotateRefresh (this binding).
 *  · Ceremony state is kv (UNLOGGED Postgres) for at most REGISTRATION_TTL_SECONDS: losing it fails safe (the agent gets
 *    expired_token and starts again). The single-use rule is the durable row transition, as for an authorization code.
 *  · Every kv key is scoped to this ISSUER (both editions share kv and the secret).
 *  · No email is ever sent by eno; the login_hint is kept only as a labelled hash, for at most the registration's life.
 */

export const REGISTRATION_TTL_SECONDS = 30 * 60
export const ATTEMPT_TTL_SECONDS = 10 * 60
export const POLL_INTERVAL_SECONDS = 5
export const MAX_ATTEMPTS = 3
export const AGENT_TICKET_TTL_SECONDS = 10 * 60
/** Registration budget per caller IP per hour — sized for hosted agents, which leave from small shared IP pools (commit
 *  gate, opus: at 30 one provider's users shared 30 an hour). A registration is three small kv rows for 30 minutes. */
export const IDENTITY_RATE_PER_IP = 120
/** Codes a signed-in person may try on /oauth/agent per 10 minutes. Only attempts for their own email can match. */
export const CODE_TRIES_PER_PROFILE = 10
export const CLAIM_GRANT = 'urn:workos:agent-auth:grant-type:claim'
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
export const IDENTITY_PATH = '/api/agent/identity'
export const CLAIM_PATH = '/api/agent/identity/claim'
export const VERIFICATION_PATH = '/oauth/agent'

const ISSUER_TAG = crypto.createHash('sha256').update(OAUTH_ISSUER).digest('hex').slice(0, 8)
const k = (name: string) => `agent:${ISSUER_TAG}:${name}`
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** A login_hint as eno compares it: trimmed, lower-cased, a plausible address of at most 254 characters. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}
export const emailHash = (email: string) => labelledHash('agent-email', email)
const codeHash = (code: string) => labelledHash('agent-code', code)

type Registration = { iss: string; emailHash: string; claimHash: string; createdAt: number; exp: number }
type Attempt = { n: number; codeHash: string; exp: number }
type CodeIndex = { regId: string; n: number }

export type CeremonyBlock = { user_code: string; verification_uri: string; expires_in: number; interval: number }

/**
 * The next attempt number, ATOMIC (kv incrby; commit gate, opus: a read-then-write counter let two concurrent reissues
 * share a number and leave two codes live). The attempt record keeps only the newest number, so one code works at a time.
 */
const nextAttemptNumber = (regId: string, reg: Registration, now: number) => kv.incrby(k(`n:${regId}`), 1, Math.max(1, reg.exp - now))

/** A fresh attempt: a 6-digit code unique among this email's open attempts, indexed by (email, code) for the page. */
async function newAttempt(regId: string, reg: Registration, n: number, now: number): Promise<CeremonyBlock | null> {
  for (let i = 0; i < 5; i++) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const won = await kv.set(k(`code:${reg.emailHash}:${codeHash(code)}`), { regId, n } satisfies CodeIndex, { nx: true, ex: ATTEMPT_TTL_SECONDS })
    if (won !== 'OK') continue // another open attempt for the same email holds this code: draw again
    await kv.set(k(`att:${regId}`), { n, codeHash: codeHash(code), exp: now + ATTEMPT_TTL_SECONDS } satisfies Attempt, { ex: Math.max(1, reg.exp - now) })
    return { user_code: code, verification_uri: `${OAUTH_ISSUER}${VERIFICATION_PATH}`, expires_in: ATTEMPT_TTL_SECONDS, interval: POLL_INTERVAL_SECONDS }
  }
  return null
}

export type Registered = {
  registration_id: string; registration_type: 'service_auth'; claim_url: string; claim_token: string
  claim_token_expires: string; post_claim_scopes: string[]; claim: CeremonyBlock
}

/** Step 1: a service_auth registration. The same answer whether or not an account exists (no enumeration). */
export async function registerServiceAuth(email: string, now: number): Promise<Registered | null> {
  const regId = crypto.randomBytes(10).toString('hex')
  const claimToken = `clm_${regId}_${random()}`
  const reg: Registration = { iss: OAUTH_ISSUER, emailHash: emailHash(email), claimHash: labelledHash('agent-claim', claimToken), createdAt: now, exp: now + REGISTRATION_TTL_SECONDS }
  // ⛔ No longer than the registration: /privacy promises the email hash is gone within the hour (the TTL, then the
  // kv_store sweep).
  if ((await kv.set(k(`reg:${regId}`), reg, { nx: true, ex: REGISTRATION_TTL_SECONDS })) !== 'OK') return null
  const claim = await newAttempt(regId, reg, await nextAttemptNumber(regId, reg, now), now)
  if (!claim) return null
  return {
    registration_id: `reg_${regId}`, registration_type: 'service_auth', claim_url: CLAIM_PATH, claim_token: claimToken,
    claim_token_expires: new Date(reg.exp * 1000).toISOString(), post_claim_scopes: [...DEFAULT_SIGN_IN_SCOPES], claim,
  }
}

/** The registration a claim_token names, if the token is genuine (constant-time) and the registration this issuer's. */
async function registrationByClaimToken(claimToken: unknown): Promise<{ regId: string; reg: Registration } | null> {
  const m = typeof claimToken === 'string' ? /^clm_([a-f0-9]{20})_[A-Za-z0-9_-]{43}$/.exec(claimToken) : null
  if (!m) return null
  const reg = await kv.get<Registration>(k(`reg:${m[1]}`))
  if (!reg || reg.iss !== OAUTH_ISSUER || !safeEqual(reg.claimHash, labelledHash('agent-claim', claimToken as string))) return null
  return { regId: m[1], reg }
}

export type Reissued =
  | { ok: true; body: { registration_id: string; claim_attempt_id: string; status: 'initiated'; expires_at: string; claim_attempt: CeremonyBlock } }
  | { ok: false; status: number; error: string; message: string }

/** POST /api/agent/identity/claim: a fresh code for a still-open registration (the old code stops working). */
export async function reissueAttempt(claimToken: unknown, email: unknown, now: number): Promise<Reissued> {
  const found = await registrationByClaimToken(claimToken)
  if (!found || found.reg.exp <= now) return { ok: false, status: 400, error: 'claim_expired', message: 'This registration is unknown or has expired. Register again.' }
  const { regId, reg } = found
  const e = normaliseEmail(email)
  if (!e || !safeEqual(emailHash(e), reg.emailHash)) return { ok: false, status: 400, error: 'invalid_request', message: 'email must be the login_hint this registration was made with.' }
  if (await kv.get(k(`answer:${regId}`))) return { ok: false, status: 400, error: 'claimed_or_in_flight', message: 'This registration was already answered.' }
  const old = await kv.get<Attempt>(k(`att:${regId}`))
  const n = await nextAttemptNumber(regId, reg, now)
  if (n > MAX_ATTEMPTS) return { ok: false, status: 400, error: 'too_many_attempts', message: `At most ${MAX_ATTEMPTS} codes per registration. Register again.` }
  const claim = await newAttempt(regId, reg, n, now)
  if (!claim) return { ok: false, status: 503, error: 'temporarily_unavailable', message: 'Try again in a moment.' }
  // The previous code's index entry goes too (lookup already refuses it: its number is no longer the attempt's).
  if (old) await kv.del(k(`code:${reg.emailHash}:${old.codeHash}`)).catch((err) => logError(err, { op: 'agent-auth.dropOldCode' }))
  return {
    ok: true,
    body: { registration_id: `reg_${regId}`, claim_attempt_id: `cla_${regId}_${n}`, status: 'initiated', expires_at: new Date((now + ATTEMPT_TTL_SECONDS) * 1000).toISOString(), claim_attempt: claim },
  }
}

export type OpenAttempt = { regId: string; n: number; requestedAt: number }

/**
 * The page's lookup: the open, unanswered attempt this code names AMONG THE SIGNED-IN PERSON'S OWN EMAIL's attempts.
 * Null for a wrong, stale or answered code — the page says only "that code does not work".
 */
export async function lookupByCode(personEmailHash: string, code: unknown, now: number): Promise<OpenAttempt | null> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null
  const idx = await kv.get<CodeIndex>(k(`code:${personEmailHash}:${codeHash(code)}`))
  if (!idx) return null
  return openAttempt(idx.regId, idx.n, personEmailHash, now)
}

/** Is attempt `n` of this registration still the current, unexpired, unanswered one, for this email? */
export async function openAttempt(regId: string, n: number, personEmailHash: string, now: number): Promise<OpenAttempt | null> {
  const [reg, att, answer] = await Promise.all([kv.get<Registration>(k(`reg:${regId}`)), kv.get<Attempt>(k(`att:${regId}`)), kv.get(k(`answer:${regId}`))])
  if (!reg || !att || answer) return null
  if (reg.iss !== OAUTH_ISSUER || reg.exp <= now || att.n !== n || att.exp <= now || !safeEqual(reg.emailHash, personEmailHash)) return null
  return { regId, n, requestedAt: reg.createdAt }
}

/**
 * The bell line a person gets when they ALLOWED an agent (written at Allow, before the agent collects — so "allowed to
 * connect", never "connected"): Disconnect is one tap away. A `system` row, translated in the bell like every other.
 */
export const CONNECTED_NOTICE = {
  title: 'An AI agent was allowed to connect to your shop',
  body: 'If this was not you, disconnect it now in Dashboard › Developers.',
  url: '/dashboard/dev',
}

/**
 * ONE ANSWER PER REGISTRATION (commit gate, opus: Allow and Cancel from two tabs raced when they were two keys): the first
 * `answer:<reg>` written (kv nx) is the answer — { allow, keyId } or { deny } — and the poll reads only it.
 */
type Answer = { allow: true; keyId: string } | { allow: false }

/**
 * Allow: a PENDING grant row for the person's shop (live only when the agent's poll succeeds), then the answer (kv nx),
 * then the bell notice. False when the registration was answered meanwhile (the row is dropped again).
 */
export async function completeClaim(a: OpenAttempt, profileId: string, sellerId: string, now: number): Promise<boolean> {
  // Pending agent rows nobody's agent collected are dropped once their registration can no longer be polled.
  await db.apiKey.deleteMany({
    where: { prefix: { startsWith: AGENT_GRANT_PREFIX }, revokedAt: PENDING_AT, lastUsedAt: null, createdAt: { lt: new Date((now - REGISTRATION_TTL_SECONDS - 600) * 1000) } },
  }).catch((e) => logError(e, { op: 'agent-auth.prunePending' }))
  const row = await db.apiKey.create({
    data: {
      sellerId, profileId,
      name: 'AI agent (connection pending)',
      prefix: `${AGENT_GRANT_PREFIX}${crypto.randomBytes(4).toString('hex')}`,
      hashedKey: labelledHash('eno-pending', crypto.randomBytes(32).toString('hex')),
      scopes: DEFAULT_SIGN_IN_SCOPES.join(' '),
      revokedAt: PENDING_AT,
    },
    select: { id: true },
  })
  if ((await kv.set(k(`answer:${a.regId}`), { allow: true, keyId: row.id } satisfies Answer, { nx: true, ex: REGISTRATION_TTL_SECONDS })) !== 'OK') {
    await db.apiKey.delete({ where: { id: row.id } }).catch((e) => logError(e, { op: 'agent-auth.dropLostRow' }))
    return false
  }
  await db.notification.create({ data: { recipientId: profileId, type: 'system', ...CONNECTED_NOTICE, actorName: SITE_NAME } })
    .catch((e) => logError(e, { op: 'agent-auth.notice' }))
  return true
}

/** How this registration was answered, if it was — so a double-tapped Allow shows "Connected", not a failure (gate). */
export async function answerOf(regId: string): Promise<'allowed' | 'denied' | null> {
  const a = await kv.get<Answer>(k(`answer:${regId}`))
  return a ? (a.allow ? 'allowed' : 'denied') : null
}

/** Cancel: the agent's next poll gets access_denied — unless an Allow answered first. */
export async function denyClaim(a: OpenAttempt): Promise<boolean> {
  return (await kv.set(k(`answer:${a.regId}`), { allow: false } satisfies Answer, { nx: true, ex: REGISTRATION_TTL_SECONDS })) === 'OK'
}

export type AgentTokens = { keyId: string; sellerId: string; profileId: string; scopes: string[] }
export type PollResult =
  | { ok: true; grant: AgentTokens; identityAssertion: string; assertionExpires: number }
  | { ok: false; error: 'expired_token' | 'access_denied' | 'slow_down' | 'authorization_pending' | 'invalid_grant'; description: string }

const newAssertion = (keyId: string) => `eno_ia_${keyId}_${random()}`

/** The claim grant: the agent's poll. Answers ONCE with credentials; a second success-poll is a replay. */
export async function pollClaim(claimToken: unknown, now: number): Promise<PollResult> {
  const found = await registrationByClaimToken(claimToken)
  if (!found || found.reg.exp <= now) return { ok: false, error: 'expired_token', description: 'The claim ceremony window has closed.' }
  const { regId } = found
  // RFC 8628 §3.5: faster than `interval` is slow_down. A second of slack for network jitter.
  if ((await kv.set(k(`poll:${regId}`), 1, { nx: true, ex: POLL_INTERVAL_SECONDS - 1 })) !== 'OK') {
    return { ok: false, error: 'slow_down', description: `Poll at most every ${POLL_INTERVAL_SECONDS} seconds.` }
  }
  const answer = await kv.get<Answer>(k(`answer:${regId}`))
  if (!answer) return { ok: false, error: 'authorization_pending', description: 'The user has not yet completed the ceremony.' }
  if (!answer.allow) return { ok: false, error: 'access_denied', description: 'The person refused the connection.' }
  const claimed = answer
  const row = await db.apiKey.findUnique({ where: { id: claimed.keyId }, select: { sellerId: true, profileId: true, scopes: true, prefix: true, createdAt: true } })
  if (!row || !row.prefix.startsWith(AGENT_GRANT_PREFIX)) return { ok: false, error: 'invalid_grant', description: 'The connection no longer exists.' }
  // Eligibility again at collection: the person may have lost the shop or been suspended since Allow.
  const elig = await eligibleShop(row.profileId)
  if (!elig.ok || elig.shop.id !== row.sellerId) return { ok: false, error: 'invalid_grant', description: 'This shop can no longer be connected.' }
  const assertion = newAssertion(claimed.keyId)
  const live = await db.apiKey.updateMany({
    where: { id: claimed.keyId, revokedAt: PENDING_AT, lastUsedAt: null },
    data: { revokedAt: null, lastUsedAt: new Date(now * 1000), hashedKey: labelledHash('eno-ia', assertion), name: `AI agent (connected ${new Date(now * 1000).toISOString().slice(0, 10)})` },
  })
  if (live.count !== 1) {
    // Collected before (or disconnected): a replayed claim_token. Whatever it produced is ended (OAuth 2.1 §4.1.3).
    await db.apiKey.updateMany({ where: { id: claimed.keyId, revokedAt: null }, data: { revokedAt: new Date(now * 1000) } })
    return { ok: false, error: 'invalid_grant', description: 'This claim was already exchanged.' }
  }
  return {
    ok: true,
    grant: { keyId: claimed.keyId, sellerId: row.sellerId, profileId: row.profileId, scopes: row.scopes.split(/\s+/).filter(Boolean) },
    identityAssertion: assertion,
    assertionExpires: Math.floor(row.createdAt.getTime() / 1000 + GRANT_MAX_AGE_SECONDS),
  }
}

export type ExchangeResult = { ok: true; grant: AgentTokens } | { ok: false; error: 'invalid_grant' | 'invalid_scope'; description: string }

/** jwt-bearer: the identity_assertion this server issued, checked against its grant row on every exchange. */
export async function exchangeAssertion(assertion: unknown, scope: unknown, now: number): Promise<ExchangeResult> {
  const m = typeof assertion === 'string' ? /^eno_ia_([a-z0-9]{20,40})_[A-Za-z0-9_-]{43}$/.exec(assertion) : null
  if (!m) return { ok: false, error: 'invalid_grant', description: 'assertion must be an identity_assertion this server issued; assertions from agent providers (ID-JAG) are not accepted.' }
  const row = await db.apiKey.findUnique({ where: { id: m[1] }, select: { sellerId: true, profileId: true, scopes: true, prefix: true, hashedKey: true, revokedAt: true, createdAt: true } })
  if (!row || row.revokedAt || !row.prefix.startsWith(AGENT_GRANT_PREFIX) || !safeEqual(row.hashedKey, labelledHash('eno-ia', assertion as string))) {
    return { ok: false, error: 'invalid_grant', description: 'The identity_assertion is invalid or its connection was ended.' }
  }
  const expired = row.createdAt.getTime() / 1000 + GRANT_MAX_AGE_SECONDS < now
  const elig = await eligibleShop(row.profileId)
  if (expired || !elig.ok || elig.shop.id !== row.sellerId) {
    await db.apiKey.updateMany({ where: { id: m[1], revokedAt: null }, data: { revokedAt: new Date(now * 1000) } })
    return { ok: false, error: 'invalid_grant', description: expired ? 'This connection has expired; register again.' : 'This shop can no longer be connected; register again.' }
  }
  const granted = row.scopes.split(/\s+/).filter(Boolean)
  const asked = typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : []
  if (asked.some((s) => !granted.includes(s))) return { ok: false, error: 'invalid_scope', description: 'An exchange can only keep or narrow the scopes granted.' }
  void db.apiKey.update({ where: { id: m[1] }, data: { lastUsedAt: new Date(now * 1000) } }).catch((e) => logError(e, { op: 'agent-auth.touch' }))
  return { ok: true, grant: { keyId: m[1], sellerId: row.sellerId, profileId: row.profileId, scopes: asked.length ? asked : granted } }
}
