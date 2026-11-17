import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { safeFetch } from '@/lib/ssrf'
import { MESSAGING_SCOPES, OAUTH_ISSUER, SIGN_IN_SCOPES } from '@/lib/api/oauth'
import { createSupabaseServer } from '@/lib/supabase/server'

/**
 * ── "SIGN IN WITH ENO": OAuth 2.1 AUTHORIZATION CODE + PKCE FOR THE PARTNER MCP SERVER (owner 2026-11-13) ────────────
 *
 * Claude's connector directory, ChatGPT's plugin review and Muse only connect an authenticated MCP server through a
 * sign-in the person clicks through; a pasted API key is not offered there. This module is the grant half: who may ask
 * (client metadata documents), what a consent produces (a pending grant row + a 60-second code), and how a grant lives
 * on (refresh-token rotation). The routes are /oauth/authorize (the consent page), /api/oauth/authorize (its POST) and
 * the authorization_code / refresh_token branches of /api/v1/oauth/token.
 *
 * ⛔ THE GRANT IS AN ApiKey ROW, SO "REVOKE" IN DASHBOARD › DEVELOPERS ALREADY WORKS — and no schema change is needed:
 *  · created PENDING at consent: `revokedAt` = PENDING_AT (the epoch, a value no real revocation writes) and `lastUsedAt`
 *    null, so a code nobody redeems leaves a dead row, never a live credential — and a pending grant revoked from the
 *    dashboard (revokedAt = now) can no longer be redeemed (commit review, codex 2026-11-13);
 *  · REDEEMED by one atomic update (pending → live) keyed on that pending state — the single-use rule for the code is a
 *    durable row transition, not a cache entry an unclean restart could forget (plan review, codex 2026-11-13);
 *  · its `hashedKey` then holds the hash of the CURRENT refresh token, and each refresh is a compare-and-swap on it
 *    (rotation); a refresh token that no longer matches a live row is a replay: the whole grant is revoked.
 * ⛔ NOTHING LONG-LIVED IS SIGNED. The signing key is derived from a secret that gets rotated (SUPABASE_SECRET_KEY,
 * oauth.ts signingKey); a code lives 60 seconds and a refresh token is random bytes checked against the database, so a
 * rotation costs at most an in-flight sign-in.
 * ⛔ DOMAIN SEPARATION: a refresh token is hashed under its own label and never matches API_KEY_RE, and `oag_` grant
 * rows are refused by the client_credentials grant — a refresh token can never be laundered into a raw-key credential.
 * ⛔ CLIENTS ARE CLIENT ID METADATA DOCUMENTS ONLY (CIMD: the client_id is an https URL serving its own metadata) — what
 * Claude, ChatGPT and Muse all use. No dynamic registration, so no client table and no signed client ids to rotate.
 */

/** The MCP server this sign-in grants access to — the RFC 8707 resource and the access token's `aud`. */
export const MCP_RESOURCE = `${OAUTH_ISSUER}/api/mcp`
export const CODE_TTL_SECONDS = 60
export const CONSENT_TTL_SECONDS = 600
/** A grant row's key prefix: `oag_` + 10 hex of sha256(client_id) (the client binding) + 6 random. */
/** The MCP server's address as a client may spell it: exact, or with one trailing slash (review 2026-11-13). */
export const isMcpResource = (r: string) => r === MCP_RESOURCE || r === `${MCP_RESOURCE}/`
export const GRANT_PREFIX = 'oag_'
/** The pending marker in `revokedAt`: the epoch. A real revocation always writes "now", so the two never meet. */
export const PENDING_AT = new Date(0)
// Replay evidence is kept as long as a grant can live (GRANT_MAX_AGE_SECONDS), so no rotated-out token ever stops
// counting as one (review 2026-11-13).
const REFRESH_HISTORY_SECONDS = 180 * 24 * 3600
export const REFRESH_PREFIX = 'eno_rt_'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sha256hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** Hash of a secret under a purpose label, so the same bytes can never match another purpose's hash. */
export const labelledHash = (label: string, secret: string) => sha256hex(`${label}:${secret}`)
/** The grant row's client binding — also bound to THIS deployment (both editions share one database), so a grant one
 *  site issued can never be refreshed at the other (review 2026-11-13). */
export const clientBinding = (clientId: string) => sha256hex(`client:${OAUTH_ISSUER}:${clientId}`).slice(0, 10)
/** A sign-in grant ends this long after it was made, however often it is refreshed: then the person signs in again. */
export const GRANT_MAX_AGE_SECONDS = 180 * 24 * 3600
/**
 * The grant rows of AGENT REGISTRATION (src/lib/api/agent-auth.ts, the auth.md service_auth ceremony): `oag_` like every
 * sign-in grant (so the client_credentials grant refuses them by name and Disconnect lists them), with a binding hashed
 * from a URN no client ID metadata document can be (clientIdShapeOk wants an https URL). rotateRefresh refuses them by
 * this prefix, and the consent prune leaves them alone: their ceremony runs up to 30 minutes, not 10.
 */
export const AGENT_CLIENT_LABEL = 'urn:eno:agent-auth:service_auth'
/** Every agent grant row, on EITHER edition (both share one database): what the consent prune and rotateRefresh exclude
 *  (commit gate, opus: a per-issuer prefix let the other edition's prune delete this one's pending agent rows). */
export const AGENT_GRANT_FAMILY = `${GRANT_PREFIX}${sha256hex(`agent-family:${AGENT_CLIENT_LABEL}`).slice(0, 10)}`
/** This edition's agent grant rows: the family + a 4-hex issuer tag, so an assertion one site issued never works at the
 *  other's token endpoint. Then 8 random hex — 26 characters, the length of every `oag_` prefix. */
export const AGENT_GRANT_PREFIX = `${AGENT_GRANT_FAMILY}${sha256hex(`issuer:${OAUTH_ISSUER}`).slice(0, 4)}`

let cachedKey: Buffer | null = null
/** A key for consent tickets and codes only — HKDF from the same root as access tokens, under its own label. */
function grantKey(): Buffer | null {
  if (cachedKey) return cachedKey
  const ikm = process.env.SUPABASE_SECRET_KEY || process.env.CRON_SECRET
  if (!ikm) return null
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-oauth-v1'), Buffer.from('authorization-grant'), 32))
  return cachedKey
}

function seal(typ: 'consent' | 'code' | 'agent', claims: Record<string, unknown>): string | null {
  const key = grantKey()
  if (!key) return null
  const payload = b64url(JSON.stringify({ ...claims, typ }))
  return `${payload}.${crypto.createHmac('sha256', key).update(`${typ}.${payload}`).digest('base64url')}`
}

function open<T>(typ: 'consent' | 'code' | 'agent', token: string, now: number, opts: { allowExpired?: boolean } = {}): T | null {
  const key = grantKey()
  if (!key || typeof token !== 'string') return null
  const [payload, sig, extra] = token.split('.')
  if (!payload || !sig || extra !== undefined) return null
  const expected = crypto.createHmac('sha256', key).update(`${typ}.${payload}`).digest('base64url')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  if (claims.typ !== typ || typeof claims.exp !== 'number' || (!opts.allowExpired && claims.exp <= now)) return null
  return claims as T
}

// ── Clients: Client ID Metadata Documents ─────────────────────────────────────────────────────────────────────────────

export type ClientInfo = { clientId: string; name: string; host: string; redirectUris: string[] }

const isLoopback = (u: URL) => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
/** A redirect URI a client may register: https, or http on a loopback address (a desktop client); no fragment. */
export function redirectUriAllowed(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.hash || u.username || u.password) return false
  return u.protocol === 'https:' || isLoopback(u)
}

/**
 * Does the redirect URI sent match one the client registered? Exactly — except that a LOOPBACK address matches on any
 * port (RFC 8252 §7.3): a desktop client (Cursor, Claude Code…) listens on whatever port is free (review 2026-11-13).
 */
export function redirectMatches(registered: string[], sent: string): boolean {
  if (registered.includes(sent)) return true
  let s: URL
  try { s = new URL(sent) } catch { return false }
  if (!isLoopback(s) || s.hash) return false
  return registered.some((r) => {
    try {
      const u = new URL(r)
      return isLoopback(u) && u.hostname === s.hostname && u.pathname === s.pathname && u.search === s.search
    } catch { return false }
  })
}

/** The client_id must be an https URL with a path, no fragment, no credentials, no dot-segments (CIMD). */
export function clientIdShapeOk(raw: string): boolean {
  if (raw.length > 512) return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  return u.protocol === 'https:' && !u.hash && !u.username && !u.password && u.pathname !== '/' && !/\/\.\.?(\/|$)/.test(u.pathname) && u.href === raw
}

const METADATA_MAX_BYTES = 5 * 1024

/**
 * Fetch and check a client's metadata document. Through `safeFetch` (DNS pinned to the checked address, private ranges
 * refused, no redirects), at most 5 KB read while streaming, cached 10 minutes. Null when anything is off.
 */
export async function loadClient(clientId: string): Promise<ClientInfo | null> {
  if (!clientIdShapeOk(clientId)) return null
  const cacheKey = `oauth:cimd:${sha256hex(clientId)}`
  const hit = await kv.get<ClientInfo | { bad: true }>(cacheKey).catch((e) => { logError(e, { op: 'oauth-grant.cimdCacheGet' }); return null })
  if (hit && 'bad' in hit) return null // a document that failed a minute ago is not fetched again on demand
  if (hit && hit.clientId === clientId) return hit
  const info = await fetchClient(clientId)
  if (!info) await kv.set(cacheKey, { bad: true }, { ex: 60 }).catch((e) => logError(e, { op: 'oauth-grant.cimdCacheSet' }))
  else await kv.set(cacheKey, info, { ex: 600 }).catch((e) => logError(e, { op: 'oauth-grant.cimdCacheSet' }))
  return info
}

async function fetchClient(clientId: string): Promise<ClientInfo | null> {
  let doc: Record<string, unknown>
  try {
    const res = await safeFetch(clientId, { timeoutMs: 5000, followRedirects: false, headers: { accept: 'application/json' } })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > METADATA_MAX_BYTES) { await reader.cancel().catch((e) => logError(e, { op: 'oauth-grant.cancelBody' })); return null }
      chunks.push(value)
    }
    doc = JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'))
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object' || doc.client_id !== clientId) return null
  // Only a client that can sign in as a PUBLIC client: eno checks no secret or signed assertion, only PKCE and this
  // binding. ChatGPT's document prefers private_key_jwt but lists "none" in token_endpoint_auth_methods_supported, and
  // our server metadata offers it only "none" (2026-11-14: ChatGPT was refused as invalid_client before this).
  const auth = doc.token_endpoint_auth_method
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported : []
  if (auth !== undefined && auth !== 'none' && !methods.includes('none')) return null
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((x): x is string => typeof x === 'string' && redirectUriAllowed(x)) : []
  if (!redirectUris.length) return null
  const host = new URL(clientId).host
  const rawName = typeof doc.client_name === 'string' ? doc.client_name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim() : ''
  return { clientId, name: (rawName || host).slice(0, 60), host, redirectUris }
}

// ── The authorization request ─────────────────────────────────────────────────────────────────────────────────────────

export type AuthRequest = {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scopes: string[]
  resource: string
}

export type AuthRequestCheck =
  | { ok: true; req: AuthRequest; client: ClientInfo }
  /** Every error is SHOWN on our page, never redirected: with Client ID Metadata Documents anyone can "register" a return
   *  address by hosting a file, so redirecting an error before anyone signs in would make eno an open redirect for
   *  phishing links (RFC 9700 §4.11.2; review 2026-11-13). Only a signed-in person's Allow or Cancel goes back. */
  | { ok: false; error: string; description: string }

const ALL_SCOPES = new Set<string>(SIGN_IN_SCOPES)
/** What a sign-in grants when the client names no scope: what the MCP tools need, never media:write. */
export const DEFAULT_SIGN_IN_SCOPES = ['listings:read', 'listings:write', 'analytics:read']

/** Validate an authorization request. Until the redirect URI is proven, errors are shown on our page, never redirected. */
export async function checkAuthRequest(q: URLSearchParams): Promise<AuthRequestCheck> {
  const clientId = q.get('client_id') || ''
  const redirectUri = q.get('redirect_uri') || ''
  const client = await loadClient(clientId)
  if (!client) return { ok: false, error: 'invalid_client', description: 'The app asking to connect could not be identified.' }
  if (!redirectMatches(client.redirectUris, redirectUri)) {
    return { ok: false, error: 'invalid_request', description: 'The app sent a return address it has not registered.' }
  }
  const state = q.get('state') || ''
  const fail = (error: string, description: string): AuthRequestCheck => ({ ok: false, error, description })
  if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.')
  const challenge = q.get('code_challenge') || ''
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.')
  }
  if (!isMcpResource(q.get('resource') || MCP_RESOURCE)) return fail('invalid_target', `The only resource here is ${MCP_RESOURCE}.`)
  const resource = MCP_RESOURCE // stored canonical: a trailing-slash spelling is the same server
  const asked = (q.get('scope') || '').split(/\s+/).filter(Boolean)
  if (asked.some((s) => !ALL_SCOPES.has(s))) return fail('invalid_scope', `Scopes are: ${SIGN_IN_SCOPES.join(' ')}.`)
  const scopes = asked.length ? [...new Set(asked)] : DEFAULT_SIGN_IN_SCOPES
  // ChatGPT sends a ~760-character state (2026-11-14: refused at the old 512 cap). It only rides the sealed consent
  // ticket and the return redirect, so a generous cap costs nothing; the cap only stops absurd links.
  if (state.length > 2048) return fail('invalid_request', 'state is too long.')
  return { ok: true, req: { clientId, redirectUri, state, codeChallenge: challenge, scopes, resource }, client }
}

/**
 * The signed-in person, CONFIRMED BY THE AUTH SERVER (`getUser`), not read from the cookie's JWT the way
 * getCurrentProfileId does: a consent creates a long-lived grant, so a signed-out or banned session must not pass.
 */
export async function verifiedProfileId(): Promise<string | null> {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/**
 * The shop a person may connect an app to: their own (Seller.ownerId is unique), on a BUSINESS account — the same gate as
 * Dashboard › Developers, where a grant is revoked, so nobody can grant what they could not later remove — and not held
 * or suspended (review 2026-11-13). `reason` says which gate failed.
 */
export async function eligibleShop(profileId: string): Promise<{ ok: true; shop: { id: string; name: string } } | { ok: false; reason: 'no_shop' | 'not_business' | 'restricted' }> {
  const [profile, shop] = await Promise.all([
    db.profile.findUnique({ where: { id: profileId }, select: { accountType: true, enforcementState: true } }),
    db.seller.findUnique({ where: { ownerId: profileId }, select: { id: true, name: true } }),
  ])
  if (!profile || profile.enforcementState === 'held' || profile.enforcementState === 'suspended') return { ok: false, reason: 'restricted' }
  if (profile.accountType !== 'business') return { ok: false, reason: 'not_business' }
  if (!shop) return { ok: false, reason: 'no_shop' }
  return { ok: true, shop }
}

/** A person-only connection's gate (2026-11-17, owner "ok to agents for all"): the account exists and is not held or suspended. */
export async function eligiblePerson(profileId: string): Promise<boolean> {
  const p = await db.profile.findUnique({ where: { id: profileId }, select: { enforcementState: true } })
  return !!p && p.enforcementState !== 'held' && p.enforcementState !== 'suspended'
}

const MESSAGING = new Set<string>(MESSAGING_SCOPES)

/**
 * ── WHAT A SIGN-IN CONNECTS (owner, 2026-11-17: "ok to agents for all") ───────────────────────────────────────────────
 *  · ONLY chat scopes asked → the PERSON (any account, business or not): a grant with no shop (ApiKey.sellerId NULL). A
 *    business account's chat-only connection is person-only too, so switching the account type never cuts it.
 *  · Any shop scope asked, and the person has a connectable shop → that SHOP, with every scope asked.
 *  · Shop scopes asked but no connectable shop, and chat scopes asked too → the PERSON with the chat scopes only (the
 *    screen says so). No chat scope asked → refused, with today's reason (no shop / not business / restricted).
 * One function decides it for the consent page, the Allow and every later check (grantEligible), so they cannot disagree.
 */
export type ConnectTarget =
  | { ok: true; kind: 'shop'; shop: { id: string; name: string }; scopes: string[]; narrowed: false }
  | { ok: true; kind: 'person'; scopes: string[]; narrowed: boolean }
  | { ok: false; reason: 'no_shop' | 'not_business' | 'restricted' }
export async function connectTarget(profileId: string, asked: string[]): Promise<ConnectTarget> {
  const chat = asked.filter((s) => MESSAGING.has(s))
  if (chat.length === asked.length) {
    return (await eligiblePerson(profileId)) ? { ok: true, kind: 'person', scopes: chat, narrowed: false } : { ok: false, reason: 'restricted' }
  }
  const elig = await eligibleShop(profileId)
  if (elig.ok) return { ok: true, kind: 'shop', shop: elig.shop, scopes: asked, narrowed: false }
  if (chat.length && elig.reason !== 'restricted' && (await eligiblePerson(profileId))) return { ok: true, kind: 'person', scopes: chat, narrowed: true }
  return { ok: false, reason: elig.reason }
}

/** Is a grant still allowed to act — at redemption, at every refresh and on every call? A shop grant while its person
 *  still has THAT connectable shop; a person-only grant while the account may connect at all. */
export async function grantEligible(profileId: string, sellerId: string | null): Promise<boolean> {
  if (sellerId === null) return eligiblePerson(profileId)
  const elig = await eligibleShop(profileId)
  return elig.ok && elig.shop.id === sellerId
}

/** At most this many live grants per app, person and shop-or-person: a reconnect retires the oldest beyond it, so grants
 *  never pile up (nor count a shop out of its API keys), while two devices of one app can stay connected. */
export const LIVE_GRANTS_PER_APP = 3

/**
 * Does this app already hold, for this person and target, every scope it is asking for now? Then the consent screen is
 * the one-tap "Continue" form (page.tsx). ⛔ NEVER an automatic approval (plan review 2026-11-17): the big apps share one
 * client id across all their users and desktop apps return to any localhost port, so a zero-click code would let someone
 * else's connector be attached to this account by a link. One tap on eno's own page is the floor.
 */
export async function alreadyGranted(profileId: string, clientId: string, sellerId: string | null, scopes: string[]): Promise<boolean> {
  const rows = await db.apiKey.findMany({
    where: { profileId, sellerId, revokedAt: null, prefix: { startsWith: `${GRANT_PREFIX}${clientBinding(clientId)}` }, createdAt: { gt: new Date(Date.now() - GRANT_MAX_AGE_SECONDS * 1000) } },
    orderBy: { createdAt: 'desc' },
    select: { scopes: true },
    take: LIVE_GRANTS_PER_APP,
  })
  return rows.some((r) => { const has = new Set(r.scopes.split(/\s+/)); return scopes.every((s) => has.has(s)) })
}

// ── Consent ticket: binds what was SHOWN to who saw it ────────────────────────────────────────────────────────────────

type ConsentClaims = AuthRequest & { pid: string; sellers: string[]; exp: number; nonce: string }

/** Sealed into the consent form: the exact request, the signed-in person, the shops offered. Ten minutes. */
export function issueConsentTicket(req: AuthRequest, profileId: string, sellerIds: string[], now: number): string | null {
  return seal('consent', { ...req, pid: profileId, sellers: sellerIds, exp: now + CONSENT_TTL_SECONDS, nonce: crypto.randomUUID() })
}

export function openConsentTicket(ticket: string, now: number): ConsentClaims | null {
  const t = open<ConsentClaims>('consent', ticket, now)
  // A ticket sealed by the OTHER edition (both derive the key from the same secret) is not this site's consent (review).
  return t && t.resource === MCP_RESOURCE ? t : null
}

/**
 * A consent ticket says Allow ONCE: a reposted or double-submitted form makes no second grant (review). ⚠️ Accepted
 * limit: kv_store is unlogged, so an unclean database crash inside a ticket's 10 minutes forgets the answer. The ticket
 * is still bound to the same signed-in person, app and return address, so the worst case is that person's own second
 * grant to the same app — which they could make anyway by connecting again.
 */
export async function consumeConsent(t: Pick<ConsentClaims, 'nonce'>): Promise<boolean> {
  return (await kv.set(`oauth:consent:${t.nonce}`, '1', { nx: true, ex: CONSENT_TTL_SECONDS + 60 })) === 'OK'
}

/** Frees a consent screen whose Allow FAILED on our side (no grant made), so pressing Allow again works (review). */
export async function releaseConsent(t: Pick<ConsentClaims, 'nonce'>): Promise<void> {
  await kv.del(`oauth:consent:${t.nonce}`).catch((e) => logError(e, { op: 'oauth-grant.releaseConsent' }))
}

// ── Agent ticket: binds the agent registration a person looked up to that person (src/lib/api/agent-auth.ts) ──────────

export type AgentTicket = { iss: string; reg: string; n: number; pid: string; sid: string; exp: number; nonce: string }

/** Sealed into /oauth/agent's confirmation: the attempt the person's code found, the person, their shop. Its own type. */
export function issueAgentTicket(t: Omit<AgentTicket, 'iss' | 'exp' | 'nonce'>, now: number, ttl: number): string | null {
  return seal('agent', { ...t, iss: OAUTH_ISSUER, exp: now + ttl, nonce: crypto.randomUUID() })
}

export function openAgentTicket(ticket: string, now: number): AgentTicket | null {
  const t = open<AgentTicket>('agent', ticket, now)
  // Sealed by the other edition (both derive the key from one secret): not this site's.
  return t && t.iss === OAUTH_ISSUER && typeof t.reg === 'string' && typeof t.n === 'number' && typeof t.pid === 'string' && typeof t.sid === 'string' ? t : null
}

/** One answer per agent confirmation screen (a reposted form makes no second grant or flips no Cancel to Allow). */
export async function consumeAgentTicket(t: Pick<AgentTicket, 'nonce'>): Promise<boolean> {
  return (await kv.set(`oauth:agent-ticket:${t.nonce}`, '1', { nx: true, ex: 15 * 60 })) === 'OK'
}

/** Frees a confirmation whose Allow failed on our side, so pressing it again works. */
export async function releaseAgentTicket(t: Pick<AgentTicket, 'nonce'>): Promise<void> {
  await kv.del(`oauth:agent-ticket:${t.nonce}`).catch((e) => logError(e, { op: 'oauth-grant.releaseAgentTicket' }))
}

/** The signed-in person (confirmed by the auth server) and their CONFIRMED email, if any — the claim page matches on it. */
export async function verifiedPerson(): Promise<{ profileId: string; email: string | null } | null> {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
  const u = data.user
  if (!u) return null
  const confirmed = !!u.email && !!u.email_confirmed_at
  return { profileId: u.id, email: confirmed ? u.email!.trim().toLowerCase() : null }
}

// ── Code: approve → pending grant row + 60-second code ────────────────────────────────────────────────────────────────

type CodeClaims = { kid: string; cid: string; ruri: string; chal: string; scope: string; res: string; exp: number }

/** Approve: a PENDING grant row for the chosen shop (or, `sellerId` null, for the person alone), and a code bound to it
 *  and to the request. The ticket's scopes are what the screen listed — already narrowed for a person-only connection. */
export async function approve(t: ConsentClaims, sellerId: string | null, clientName: string, now: number): Promise<string | null> {
  // Pending rows whose code was never redeemed are dropped after ten minutes, so abandoned sign-ins do not pile up.
  // Everyone's, not only this person's: a sign-in someone abandons is cleared by the next sign-in anyone makes (review).
  // Never an agent registration's pending row: its ceremony may run 30 minutes (agent-auth.ts prunes its own).
  await db.apiKey.deleteMany({ where: { revokedAt: PENDING_AT, lastUsedAt: null, createdAt: { lt: new Date((now - CONSENT_TTL_SECONDS) * 1000) }, NOT: { prefix: { startsWith: AGENT_GRANT_FAMILY } } } })
    .catch((e) => logError(e, { op: 'oauth-grant.prunePending' }))
  const row = await db.apiKey.create({
    data: {
      sellerId,
      profileId: t.pid,
      name: `${clientName} (sign-in pending)`.slice(0, 120),
      prefix: `${GRANT_PREFIX}${clientBinding(t.clientId)}${crypto.randomBytes(6).toString('hex')}`,
      // A pending row holds no usable secret: a random hash under its own label.
      hashedKey: labelledHash('eno-pending', crypto.randomBytes(32).toString('hex')),
      scopes: t.scopes.join(' '),
      revokedAt: PENDING_AT,
    },
    select: { id: true },
  })
  return seal('code', { kid: row.id, cid: t.clientId, ruri: t.redirectUri, chal: t.codeChallenge, scope: t.scopes.join(' '), res: t.resource, exp: now + CODE_TTL_SECONDS } satisfies CodeClaims)
}

/** PKCE S256: base64url(sha256(verifier)) === challenge, verifier 43–128 unreserved characters. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  const a = Buffer.from(b64url(crypto.createHash('sha256').update(verifier).digest())), b = Buffer.from(challenge)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** `sellerId` is '' for a person-only grant (ApiKey.sellerId NULL): the token's `sid` claim must be a string, and ''
 *  never matches a shop id; such a grant holds only messaging scopes, which no shop tool or /api/v1 route accepts. */
export type GrantTokens = { keyId: string; sellerId: string; profileId: string; scopes: string[]; refreshToken: string }
export type GrantResult = { ok: true; grant: GrantTokens } | { ok: false; error: 'invalid_grant' | 'invalid_client' | 'invalid_target' | 'invalid_scope'; description: string }

/**
 * ⚠️ NO LOST-ANSWER RECOVERY, BY DECISION (review 2026-11-13). A code or refresh token is spent before its answer reaches
 * the client; if that answer is lost, the person signs in again. Every recovery scheme tried (re-rotation, a sealed copy of
 * the answer) opened a new race each review round — the mechanism smell — while losing an answer only costs a sign-in.
 */
const newRefreshToken = (keyId: string) => `${REFRESH_PREFIX}${keyId}_${crypto.randomBytes(32).toString('base64url')}`

/** authorization_code: every binding checked, then ONE atomic pending → live transition (the single-use rule). */
export async function redeemCode(p: { code: string; verifier: string; redirectUri: string; clientId: string; resource?: string }, now: number): Promise<GrantResult> {
  const c = open<CodeClaims>('code', p.code, now)
  if (!c) {
    // An EXPIRED code that was redeemed before is still a replay: its grant is revoked (genuine signature, live grant,
    // and the same PKCE verifier — so this is the holder of that code, not a guess) (review 2026-11-13).
    const old = open<CodeClaims>('code', p.code, now, { allowExpired: true })
    if (old && old.res === MCP_RESOURCE && old.cid === p.clientId && pkceOk(p.verifier, old.chal)) {
      await db.apiKey.updateMany({ where: { id: old.kid, revokedAt: null, lastUsedAt: { not: null } }, data: { revokedAt: new Date(now * 1000) } })
    }
    return { ok: false, error: 'invalid_grant', description: 'The code is invalid or expired.' }
  }
  if (c.cid !== p.clientId) return { ok: false, error: 'invalid_grant', description: 'The code was issued to another client.' }
  if (c.res !== MCP_RESOURCE) return { ok: false, error: 'invalid_grant', description: 'The code was issued by another site.' }
  if (c.ruri !== p.redirectUri) return { ok: false, error: 'invalid_grant', description: 'redirect_uri does not match the authorization request.' }
  if (p.resource && !isMcpResource(p.resource)) return { ok: false, error: 'invalid_target', description: 'resource does not match the authorization request.' }
  if (!pkceOk(p.verifier, c.chal)) return { ok: false, error: 'invalid_grant', description: 'code_verifier does not match the code_challenge.' }
  // Read BEFORE the transition, so no server failure after a successful transition strands the person (review).
  const row = await db.apiKey.findUnique({ where: { id: c.kid }, select: { sellerId: true, profileId: true, scopes: true, name: true, prefix: true } })
  if (!row || !row.prefix.startsWith(GRANT_PREFIX)) return { ok: false, error: 'invalid_grant', description: 'The grant no longer exists.' }
  // Eligibility again at redemption: the person may have been suspended, left the business tier or lost the shop in the
  // seconds since Allow (review 2026-11-13). Nothing is activated then.
  if (!(await grantEligible(row.profileId, row.sellerId))) return { ok: false, error: 'invalid_grant', description: row.sellerId ? 'This shop can no longer be connected.' : 'This account can no longer connect apps.' }
  const refreshToken = newRefreshToken(c.kid)
  const live = await db.apiKey.updateMany({
    where: { id: c.kid, lastUsedAt: null, revokedAt: PENDING_AT },
    data: { revokedAt: null, lastUsedAt: new Date(now * 1000), hashedKey: labelledHash('eno-rt', refreshToken) },
  })
  if (live.count !== 1) {
    // Redeemed before, or revoked: a replayed code. Kill whatever it produced (OAuth 2.1 §4.1.3).
    await db.apiKey.updateMany({ where: { id: c.kid, revokedAt: null }, data: { revokedAt: new Date(now * 1000) } })
    return { ok: false, error: 'invalid_grant', description: 'The code was already used.' }
  }
  await db.apiKey.update({ where: { id: c.kid }, data: { name: row.name.replace(' (sign-in pending)', ` (signed in ${new Date(now * 1000).toISOString().slice(0, 10)})`) } }).catch((e) => logError(e, { op: 'oauth-grant.renameGrant' }))
  await retireOldGrants(row.prefix, row.profileId, row.sellerId, now)
  return { ok: true, grant: { keyId: c.kid, sellerId: row.sellerId ?? '', profileId: row.profileId, scopes: row.scopes.split(/\s+/).filter(Boolean), refreshToken } }
}

/** Keeps the newest LIVE_GRANTS_PER_APP live grants of one app for one person and target; revokes the rest. Best-effort. */
async function retireOldGrants(prefix: string, profileId: string, sellerId: string | null, now: number): Promise<void> {
  try {
    const app = prefix.slice(0, GRANT_PREFIX.length + 10)
    if (prefix.startsWith(AGENT_GRANT_FAMILY)) return
    const live = await db.apiKey.findMany({
      where: { profileId, sellerId, revokedAt: null, prefix: { startsWith: app } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const old = live.slice(LIVE_GRANTS_PER_APP).map((r) => r.id)
    if (old.length) await db.apiKey.updateMany({ where: { id: { in: old }, revokedAt: null }, data: { revokedAt: new Date(now * 1000) } })
  } catch (e) { logError(e, { op: 'oauth-grant.retireOldGrants' }) }
}

/** refresh_token: client-bound, scope may only narrow, rotation by compare-and-swap; a replay revokes the grant. */
export async function rotateRefresh(p: { refreshToken: string; clientId: string; scope?: string; resource?: string }, now: number): Promise<GrantResult> {
  const m = /^eno_rt_([a-z0-9]{20,40})_[A-Za-z0-9_-]{43}$/.exec(p.refreshToken || '')
  if (!m) return { ok: false, error: 'invalid_grant', description: 'The refresh token is invalid.' }
  if (p.resource && !isMcpResource(p.resource)) return { ok: false, error: 'invalid_target', description: `The only resource here is ${MCP_RESOURCE}.` }
  const keyId = m[1]
  const row = await db.apiKey.findUnique({ where: { id: keyId }, select: { sellerId: true, profileId: true, scopes: true, prefix: true, hashedKey: true, revokedAt: true, createdAt: true } })
  if (!row || row.revokedAt || !row.prefix.startsWith(GRANT_PREFIX)) return { ok: false, error: 'invalid_grant', description: 'The grant was revoked.' }
  // An agent registration's grant is never refreshed here (its hash is an identity_assertion's, under another label, so
  // nothing could match anyway — refused by name too, before its binding could be compared with a client_id).
  if (row.prefix.startsWith(AGENT_GRANT_FAMILY)) return { ok: false, error: 'invalid_grant', description: 'The refresh token is invalid.' }
  // Client binding first, so a request from a stranger never revokes someone else's grant.
  if (row.prefix.slice(GRANT_PREFIX.length, GRANT_PREFIX.length + 10) !== clientBinding(p.clientId)) {
    return { ok: false, error: 'invalid_grant', description: 'The refresh token was issued to another client.' }
  }
  // Re-authorised on every refresh, not only at consent: the grant ends after GRANT_MAX_AGE_SECONDS, and when the person
  // no longer owns the shop, leaves the business tier or is held or suspended (review 2026-11-13).
  const expired = row.createdAt.getTime() / 1000 + GRANT_MAX_AGE_SECONDS < now
  if (expired || !(await grantEligible(row.profileId, row.sellerId))) {
    await db.apiKey.updateMany({ where: { id: keyId, revokedAt: null }, data: { revokedAt: new Date(now * 1000) } })
    return { ok: false, error: 'invalid_grant', description: expired ? 'This connection has expired; sign in again.' : row.sellerId ? 'This shop can no longer be connected; sign in again.' : 'This account can no longer connect apps; sign in again.' }
  }
  const granted = row.scopes.split(/\s+/).filter(Boolean)
  const asked = (p.scope || '').split(/\s+/).filter(Boolean)
  if (asked.some((s) => !granted.includes(s))) return { ok: false, error: 'invalid_scope', description: 'A refresh can only keep or narrow the scopes granted.' }
  const next = newRefreshToken(keyId)
  // ⛔ THE GRANT'S SCOPE NEVER CHANGES ON REFRESH (RFC 6749 §6): a narrower `scope` narrows only the access token this
  // answer carries. One rule, nothing to race (review 2026-11-13: a sticky narrowing could be undone by a concurrent
  // refresh). To give up a scope for good, the person disconnects and connects again with less.
  // ⛔ THE SWAP AND ITS REPLAY EVIDENCE COMMIT TOGETHER — one transaction: the rotated-out token's history entry is written
  // by kv_set (kv_store is a Postgres table) in the same transaction as the hash swap. A concurrent replay blocks on the
  // row until both are committed, so it always finds the evidence; if the history write fails, the swap rolls back and the
  // client still holds a valid token (review 2026-11-13).
  const prevKey = `oauth:rt-prev:${labelledHash('eno-rt', p.refreshToken)}`
  const swapped = await db.$transaction(async (tx) => {
    const r = await tx.apiKey.updateMany({
      where: { id: keyId, revokedAt: null, hashedKey: labelledHash('eno-rt', p.refreshToken) },
      data: { hashedKey: labelledHash('eno-rt', next), lastUsedAt: new Date(now * 1000) },
    })
    if (r.count === 1) await tx.$queryRaw`select kv_set(${prevKey}, ${JSON.stringify({ keyId, at: now })}::jsonb, ${REFRESH_HISTORY_SECONDS}::int, false) as won`
    return r
  })
  if (swapped.count !== 1) {
    // Revoke for ANY replay of a token this grant really issued and then rotated out (it is in the history): someone else
    // may hold its successor (OAuth 2.1 §4.3.1). No grace window — a racing duplicate from the real client costs a
    // sign-in, a thief who refreshed first never stays connected (review 2026-11-13). A token never issued (a guess built
    // from a row id and a public client id) is refused WITHOUT touching the grant. The history lives in kv_store (unlogged:
    // only an unclean database crash empties it, and then a replay is refused but not punished). A failed READ is not "no
    // history": it throws, the client gets 503 and retries, and the retry finds the evidence (review 2026-11-13).
    const prev = await kv.get<{ keyId: string; at: number }>(prevKey)
    const replay = !!prev && prev.keyId === keyId
    if (replay) await db.apiKey.updateMany({ where: { id: keyId, revokedAt: null }, data: { revokedAt: new Date(now * 1000) } })
    return { ok: false, error: 'invalid_grant', description: replay ? 'The refresh token was already used; sign in again.' : 'The refresh token is invalid.' }
  }
  return { ok: true, grant: { keyId, sellerId: row.sellerId ?? '', profileId: row.profileId, scopes: asked.length ? asked : granted, refreshToken: next } }
}
