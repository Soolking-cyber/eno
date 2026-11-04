import 'server-only'
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'

/**
 * CONNECT FACEBOOK (owner, 2026-11-04): an account made another way adds Facebook as a second way in, from Settings ›
 * Privacy. Both ways keep working.
 *
 * ⛔ NOT GOTRUE'S MANUAL LINKING, AND IT MUST STAY OFF (plan review, codex + opus, 2026-11-04). In GoTrue v2.189 the
 * flow's `state` alone picks the account to link, nothing binds it to a browser, and the link commits before the PKCE
 * exchange (internal/api/external.go). So an attacker could start Connect on their own account and send a victim the
 * Facebook URL: one tap puts the victim's Facebook on the attacker's account, and the victim's next "Continue with
 * Facebook" lands there. This flow binds `state` to an httpOnly cookie holding the user id, and the callback requires
 * the signed-in user to be that user, with a live session and this flow's own code confirmed. The manual-linking flag and the nginx 403 on its route stay as they are.
 *
 * ⛔ THE DATABASE IS STILL THE BOUNDARY. Only auth.eno_connect_facebook (infra/vn-node/apply-facebook-connect.sh) may add
 * a Facebook identity to an account in use; GoTrue's automatic link-by-email stays refused by the trigger.
 *
 * ⛔ FACEBOOK'S TOKEN IS NEVER KEPT, AND NO RESPONSE BODY IS EVER LOGGED: an error body can echo the request, and this
 * module holds the app secret.
 */

const APP_ID = process.env.FACEBOOK_APP_ID?.trim() || null
const APP_SECRET = process.env.FACEBOOK_APP_SECRET?.trim() || null
const GRAPH = 'https://graph.facebook.com'
const DIALOG = 'https://www.facebook.com/dialog/oauth'
const FETCH_TIMEOUT_MS = 8_000

/** 10 minutes: long enough to answer Facebook's dialog, short enough that a leaked transaction is stale. */
export const FB_TX_TTL_SECONDS = 10 * 60
/**
 * ⛔ A CODE FOR THIS ONE ACT (CONNECTING OR DISCONNECTING), BOUND TO THIS ONE SESSION (commit gate, 2026-11-04, after three rounds on the first design). That
 * design asked the session's `amr` for a recent `otp`, and an ordinary email-code sign-in looks exactly like that: a session stolen
 * within ten minutes of one could add its Facebook with no mailbox at all (codex). So Connect mails its own code, saying what it is
 * for, and accepts only that. Nothing is stored: the code's HMAC rides in an httpOnly cookie, tied to the user and the session id,
 * and a right answer swaps it for a confirmation sealed the same way, which /start and the callback both require.
 */
export const FB_CODE_COOKIE = 'eno_fbc_code'
export const FB_OK_COOKIE = 'eno_fbc_ok'
export const FB_CODE_TTL_SECONDS = 10 * 60
/** Long enough to answer Facebook's dialog after the code. */
export const FB_OK_TTL_SECONDS = 15 * 60
export const FB_CODE_LENGTH = 6

const seal = (purpose: string, parts: string[], exp: number) =>
  createHmac('sha256', APP_SECRET ?? '').update(['eno-fb-connect', purpose, ...parts, String(exp)].join('\0')).digest('base64url')

function sealedMatches(cookie: string | null | undefined, purpose: string, parts: string[], nowSeconds: number): boolean {
  if (!APP_SECRET || !cookie) return false
  const [expRaw, mac, ...rest] = cookie.split('.')
  const exp = Number(expRaw)
  if (rest.length || !mac || !Number.isInteger(exp) || exp < nowSeconds) return false
  const want = Buffer.from(seal(purpose, parts, exp))
  const got = Buffer.from(mac)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** A string: leading zeros are real. */
export const newConnectCode = () => String(randomInt(0, 10 ** FB_CODE_LENGTH)).padStart(FB_CODE_LENGTH, '0')

export function sealConnectCode(code: string, userId: string, sessionId: string, nowSeconds: number): string {
  const exp = nowSeconds + FB_CODE_TTL_SECONDS
  return `${exp}.${seal('code', [code, userId, sessionId], exp)}`
}
export const connectCodeMatches = (cookie: string | null | undefined, code: string, userId: string, sessionId: string, nowSeconds: number) =>
  /^\d+$/.test(code) && sealedMatches(cookie, 'code', [code, userId, sessionId], nowSeconds)

export function sealConfirmation(userId: string, sessionId: string, nowSeconds: number): string {
  const exp = nowSeconds + FB_OK_TTL_SECONDS
  return `${exp}.${seal('ok', [userId, sessionId], exp)}`
}
export const confirmationValid = (cookie: string | null | undefined, userId: string, sessionId: string, nowSeconds: number) =>
  sealedMatches(cookie, 'ok', [userId, sessionId], nowSeconds)

/** One cookie by name. No RegExp: the value of a Cookie header is the visitor's to write. */
export function readCookie(request: Request, name: string): string | null {
  return request.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null
}

/** Unset ⇒ Connect is off and the row does not show. Never throws for a missing secret. */
export function facebookConnectConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET)
}

export const fbConnectRedirectUri = (origin: string) => `${origin}/auth/facebook/connect/callback`
export const newConnectState = () => randomBytes(32).toString('base64url')
/** What newConnectState makes. Anything else came from a hand-made URL, and must never reach a cookie name. */
export const isConnectState = (s: string | null): s is string => !!s && /^[\w-]{43}$/.test(s)
/** One cookie per transaction, keyed by the state: two tabs never overwrite each other (google-oauth.ts). */
export const fbTxCookieName = (state: string) => `eno_fbc_${state.slice(0, 12)}`

export function buildConnectUrl(state: string, origin: string): string | null {
  if (!APP_ID) return null
  const u = new URL(DIALOG)
  u.searchParams.set('client_id', APP_ID)
  u.searchParams.set('redirect_uri', fbConnectRedirectUri(origin))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'email,public_profile')
  u.searchParams.set('state', state)
  // A person who declined email once is asked again: without one, Facebook can never sign in here (below).
  u.searchParams.set('auth_type', 'rerequest')
  return u.toString()
}

export type FacebookProfile = { id: string; email: string; name: string; picture: string | null }
export type ProfileResult =
  | { ok: true; profile: FacebookProfile }
  | { ok: false; reason: 'not_configured' | 'exchange' | 'profile' | 'no_email' }

type GraphMe = { id?: unknown; email?: unknown; first_name?: unknown; last_name?: unknown; picture?: { data?: { url?: unknown } } }

/** Code → token → who this is. The token dies with this function. Never throws. */
export async function readFacebookProfile(code: string, origin: string): Promise<ProfileResult> {
  if (!APP_ID || !APP_SECRET) return { ok: false, reason: 'not_configured' }
  let token: string
  try {
    const res = await fetch(`${GRAPH}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: fbConnectRedirectUri(origin), code }),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, reason: 'exchange' }
    const t = (await res.json()) as { access_token?: unknown }
    if (typeof t.access_token !== 'string' || !t.access_token) return { ok: false, reason: 'exchange' }
    token = t.access_token
  } catch {
    return { ok: false, reason: 'exchange' }
  }
  try {
    const proof = createHmac('sha256', APP_SECRET).update(token).digest('hex')
    const url = `${GRAPH}/me?fields=id,email,first_name,last_name,picture&appsecret_proof=${proof}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return { ok: false, reason: 'profile' }
    const me = (await res.json()) as GraphMe
    if (typeof me.id !== 'string' || !me.id) return { ok: false, reason: 'profile' }
    // ⛔ NO EMAIL, NO CONNECT. GoTrue's sign-in callback answers 500 for a Facebook account that sends none (external.go:
    // `len(userData.Emails) == 0 && !emailOptional`), so the connection could never be used to sign in.
    if (typeof me.email !== 'string' || !me.email.trim()) return { ok: false, reason: 'no_email' }
    const part = (v: unknown) => (typeof v === 'string' ? v : '')
    const picture = me.picture?.data?.url
    return {
      ok: true,
      profile: {
        id: me.id,
        email: me.email.trim().toLowerCase(),
        name: `${part(me.first_name)} ${part(me.last_name)}`.trim(),
        picture: typeof picture === 'string' && picture ? picture : null,
      },
    }
  } catch {
    return { ok: false, reason: 'profile' }
  }
}

/**
 * identity_data as GoTrue writes it for Facebook (provider/facebook.go + external.go), so a row made here reads the same
 * as one of its own, and GoTrue overwrites it at the first Facebook sign-in anyway. `iss` is the profile URL it uses.
 * The database strips `email` when it is not the account's (auth.eno_strip_facebook_identity_email).
 */
export function facebookIdentityData(p: FacebookProfile): Record<string, unknown> {
  return {
    iss: `${GRAPH}/me?fields=email,first_name,last_name,name,picture`,
    sub: p.id,
    provider_id: p.id,
    name: p.name,
    full_name: p.name,
    ...(p.picture ? { picture: p.picture, avatar_url: p.picture } : {}),
    email: p.email,
    email_verified: true,
    phone_verified: false,
  }
}

export type ConnectOutcome = 'ok' | 'already' | 'other_facebook' | 'held_elsewhere' | 'operator' | 'no_account' | 'no_email' | 'bad_input'
const CONNECT_OUTCOMES: ReadonlySet<string> = new Set<ConnectOutcome>(['ok', 'already', 'other_facebook', 'held_elsewhere', 'operator', 'no_account', 'no_email', 'bad_input'])

export async function connectFacebookIdentity(userId: string, profile: FacebookProfile): Promise<ConnectOutcome> {
  const identity = JSON.stringify(facebookIdentityData(profile))
  const rows = await db.$queryRaw<{ r: string }[]>`SELECT auth.eno_connect_facebook(${userId}::uuid, ${profile.id}, ${identity}::jsonb) AS r`
  const r = rows[0]?.r
  if (!r || !CONNECT_OUTCOMES.has(r)) throw new Error('eno_connect_facebook: unexpected answer')
  return r as ConnectOutcome
}

export type DisconnectOutcome = 'ok' | 'not_connected' | 'only_way_in'

/**
 * ⛔ THE SERVER ENDS THE OTHER SESSIONS, IN THE SAME TRANSACTION (commit gate, codex + opus, 2026-11-04): from the browser a closed
 * tab or a failed call would leave a thief's Facebook-opened session refreshing. `keepSession` is the caller's own, from its claims.
 */
export async function disconnectFacebookIdentity(userId: string, keepSession: string): Promise<DisconnectOutcome> {
  const rows = await db.$queryRaw<{ r: string }[]>`SELECT auth.eno_disconnect_facebook(${userId}::uuid, ${keepSession}::uuid) AS r`
  const r = rows[0]?.r
  if (r !== 'ok' && r !== 'not_connected' && r !== 'only_way_in') throw new Error('eno_disconnect_facebook: unexpected answer')
  return r
}

/**
 * What the Settings row needs. Disconnect needs a way back in that has really been proved, so it is offered only for a Facebook row Connect
 * made: that person typed a code from the mailbox. ⛔ AN ACCOUNT MADE WITH FACEBOOK WAS CONFIRMED ON FACEBOOK'S WORD: if that mailbox is dead,
 * Disconnect would strand it. ⛔ NOT app_metadata.provider: GoTrue rewrites it at every sign-in (auth.eno_facebook_connected says why).
 */
export async function facebookConnectionState(userId: string): Promise<{ connected: boolean; canDisconnect: boolean; email: string | null }> {
  const rows = await db.$queryRaw<{ connected: boolean; made_by_connect: boolean; email: string | null }[]>`
    SELECT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND lower(i.provider) = 'facebook') AS connected,
           EXISTS (SELECT 1 FROM auth.eno_facebook_connected c WHERE c.user_id = u.id) AS made_by_connect,
           u.email AS email
    FROM auth.users u WHERE u.id = ${userId}::uuid`
  const connected = rows[0]?.connected === true
  return { connected, canDisconnect: connected && rows[0]?.made_by_connect === true, email: rows[0]?.email ?? null }
}
