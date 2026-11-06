import 'server-only'
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { logWarn } from '@/lib/log'
import { FACEBOOK_DIALOG } from '@/lib/facebook-signin'

/**
 * CONNECT FACEBOOK (owner, 2026-11-04): an account made another way adds Facebook as a second way in, from Settings ›
 * Privacy. Both ways keep working.
 *
 * ⛔ NOT GOTRUE'S MANUAL LINKING, AND IT MUST STAY OFF (plan review, codex + opus, 2026-11-04). In GoTrue v2.189 the
 * flow's `state` alone picks the account to link, nothing binds it to a browser, and the link commits before the PKCE
 * exchange (internal/api/external.go). So an attacker could start Connect on their own account and send a victim the
 * Facebook URL: one tap puts the victim's Facebook on the attacker's account, and the victim's next "Continue with
 * Facebook" lands there. This flow binds `state` to an httpOnly cookie holding the user id, and the callback requires
 * the signed-in user to be that user, with a live session. The manual-linking flag and the nginx 403 on its route stay as they are.
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
const DIALOG = FACEBOOK_DIALOG
const FETCH_TIMEOUT_MS = 8_000

/** 10 minutes: long enough to answer Facebook's dialog, short enough that a leaked transaction is stale. */
export const FB_TX_TTL_SECONDS = 10 * 60
/**
 * Connect itself asks no code (owner, 2026-11-04: "they are already in their account remove code and connect directly"). The notice mail is
 * what tells an owner if someone else used a signed-in device to add a Facebook. ⛔ DISCONNECT STILL TAKES ONE (commit gate, opus): it ends every
 * other session, which in a stolen session's hands signs the owner out and keeps itself. Nothing is stored: the code's HMAC rides in an httpOnly
 * cookie, tied to the user and the session id, and a right answer swaps it for a confirmation sealed the same way.
 */
export const FB_CODE_COOKIE = 'eno_fbc_code'
export const FB_OK_COOKIE = 'eno_fbc_ok'
export const FB_CODE_TTL_SECONDS = 10 * 60
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
/**
 * `n.` MARKS A CONNECT STARTED IN THE iOS APP (owner, 2026-11-06). Facebook returns to the app's in-app browser sheet, whose cookie jar is not the app's, so
 * the callback finds no state cookie there and hands code and state back to the app (FB_CONNECT_APP_RETURN), where the cookie is. The mark only picks that
 * hand-back; it proves nothing, and the callback that finishes still requires the cookie and the same signed-in user.
 */
export const NATIVE_CONNECT_PREFIX = 'n.'
export const newConnectState = (native = false) => `${native ? NATIVE_CONNECT_PREFIX : ''}${randomBytes(32).toString('base64url')}`
/** What newConnectState makes. Anything else came from a hand-made URL, and must never reach a cookie name. */
export const isConnectState = (s: string | null): s is string => !!s && /^(?:n\.)?[\w-]{43}$/.test(s)
export const isNativeConnectState = (s: string) => s.startsWith(NATIVE_CONNECT_PREFIX)
/** One cookie per transaction, keyed by the state: two tabs never overwrite each other (google-oauth.ts). */
export const fbTxCookieName = (state: string) => `eno_fbc_${(isNativeConnectState(state) ? state.slice(NATIVE_CONNECT_PREFIX.length) : state).slice(0, 12)}`
/** Where the callback hands an app's Connect back: the Capacitor app's own scheme (ios/App/App/Info.plist), read by native-auth.ts fbConnectPathFromDeepLink. */
export const FB_CONNECT_APP_RETURN = 'enovn://fb-connect'

/**
 * THE APP'S RETURN CARRIES FACEBOOK'S CODE (commit gate, codex + opus, 2026-11-06). The link opens only on the phone whose sheet Facebook redirected, and a
 * code another app on that phone catches from the person's OWN Connect is useless without the PKCE verifier in the app's cookie (newPkceVerifier).
 * ⚠️ WHAT REMAINS: an attacker who starts a Connect (holding its verifier), gets someone to finish Facebook's dialog from that link, AND has an app on that
 * person's phone that claims `enovn://`, could still link that person's Facebook to the attacker's account. Closing it needs a return the app captures itself
 * (its web-auth session, which opens only GoTrue today: a new binary). ⛔ Holding the code on the server
 * instead was REFUTED: any browser without the cookie would park a code for whoever holds the state, so an attacker who sent someone their own dialog link
 * could collect that person's code and link their Facebook to the attacker's account.
 */

/**
 * ⛔ EVERY CONNECT CODE IS BOUND TO A PKCE VERIFIER (commit gate, codex, 2026-11-06). The iOS app's return carries the code through `enovn://`, which another
 * app on the phone could claim, and a caught code could otherwise be fed into its owner's own Connect. Measured 2026-11-06 with a real login on this app and
 * this redirect address: the code with a wrong verifier and no secret → 400 "Error validating code verifier"; with the right one → 200 and a token. So the
 * exchange sends the verifier and NOT the secret (with the secret, whether Facebook still checks the verifier is unmeasured), and the verifier lives only
 * in the transaction's httpOnly cookie. The web flow does the same.
 */
export const newPkceVerifier = () => randomBytes(48).toString('base64url')
export const isPkceVerifier = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{43,128}$/.test(v)
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export function buildConnectUrl(state: string, origin: string, challenge: string): string | null {
  if (!APP_ID) return null
  const u = new URL(DIALOG)
  u.searchParams.set('client_id', APP_ID)
  u.searchParams.set('redirect_uri', fbConnectRedirectUri(origin))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'email,public_profile')
  u.searchParams.set('state', state)
  // A person who declined email once is asked again: without one, Facebook can never sign in here (below).
  u.searchParams.set('auth_type', 'rerequest')
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

export type FacebookProfile = { id: string; email: string | null; name: string; picture: string | null; pictureIsDefault?: boolean; displayName?: string; pictures?: string[] }

/**
 * Every size of their picture Login can hand us. ⛔ THE IMPORT'S MATCH NEEDS MORE THAN ONE: a profile shows another account only small copies, and each size is its own file. Measured 2026-11-05 from a
 * separate account: 200 and 40 px equal Login's bytes exactly, a same-named stranger's equal none, and Login's 400 request (a 480 px file) is not on the page at all, so matching it alone found nobody.
 * ⛔ ONE CALL PER SIZE, ONLY FOR AN IMPORT, NEVER AS ALIASES IN THE PROFILE CALL: Graph answers 400 to `.as(p40)` ("p40 is not a valid name"), and that one word took Connect down with it (live 2026-11-05).
 */
export const FACEBOOK_PICTURE_SIZES = [40, 50, 80, 100, 160, 200, 320] as const
export type ProfileResult =
  | { ok: true; profile: FacebookProfile }
  | { ok: false; reason: 'not_configured' | 'exchange' | 'profile' }

type GraphPicture = { data?: { url?: unknown; is_silhouette?: unknown } }
type GraphMe = { id?: unknown; email?: unknown; name?: unknown; first_name?: unknown; last_name?: unknown; picture?: GraphPicture }

/** Code → token → who this is. The token dies with this function. Never throws. */
/** Whichever sizes Facebook will give. Best effort, one at a time in parallel: a size that fails is only a size the import can't compare. */
async function pictureSizes(token: string, proof: string): Promise<string[]> {
  const urls = await Promise.all(FACEBOOK_PICTURE_SIZES.map(async (w) => {
    try {
      const res = await fetch(`${GRAPH}/me/picture?width=${w}&height=${w}&redirect=false&appsecret_proof=${proof}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) return null
      const url = ((await res.json()) as GraphPicture).data?.url
      return typeof url === 'string' && url ? url : null
    } catch {
      return null
    }
  }))
  const found = urls.filter((u): u is string => u !== null)
  // The 400 alone is not on anyone's page, so this import will find nobody: say why.
  if (!found.length) logWarn('[facebook-connect] no picture size came back', { tried: FACEBOOK_PICTURE_SIZES.length })
  return found
}

export async function readFacebookProfile(code: string, origin: string, opts: { pictureSizes?: boolean; verifier: string }): Promise<ProfileResult> {
  if (!APP_ID || !APP_SECRET) return { ok: false, reason: 'not_configured' }
  if (!isPkceVerifier(opts.verifier)) return { ok: false, reason: 'exchange' }
  let token: string
  try {
    const res = await fetch(`${GRAPH}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // The verifier, never the secret (newPkceVerifier): the secret still signs every Graph call below (appsecret_proof).
      body: new URLSearchParams({ client_id: APP_ID, redirect_uri: fbConnectRedirectUri(origin), code, code_verifier: opts.verifier }),
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
    const url = `${GRAPH}/me?fields=id,email,name,first_name,last_name,picture.width(400).height(400)&appsecret_proof=${proof}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) {
      // Facebook's own code and status: its message can quote what was sent, and a silent failure here cost a whole deploy (2026-11-05).
      const code = ((await res.json().catch(() => null)) as { error?: { code?: unknown } } | null)?.error?.code
      logWarn('[facebook-connect] Graph refused the profile call', { status: res.status, code: typeof code === 'number' ? code : null })
      return { ok: false, reason: 'profile' }
    }
    const me = (await res.json()) as GraphMe
    if (typeof me.id !== 'string' || !me.id) return { ok: false, reason: 'profile' }
    // A Facebook that sends no email connects all the same: the eno account has its own. GoTrue's FACEBOOK_EMAIL_OPTIONAL lets it sign in later;
    // the guard still refuses a NEW account without one (apply-facebook-connect.sh), which would have no recovery and get no messages.
    const part = (v: unknown) => (typeof v === 'string' ? v : '')
    const picture = me.picture?.data?.url
    return {
      ok: true,
      profile: {
        id: me.id,
        email: typeof me.email === 'string' && me.email.trim() ? me.email.trim().toLowerCase() : null,
        name: `${part(me.first_name)} ${part(me.last_name)}`.trim(),
        picture: typeof picture === 'string' && picture ? picture : null,
        pictureIsDefault: me.picture?.data?.is_silhouette === true,
        // As Facebook shows it, for the import's search: first + last reads backwards for many Vietnamese names.
        displayName: typeof me.name === 'string' && me.name.trim() ? me.name.trim() : `${part(me.first_name)} ${part(me.last_name)}`.trim(),
        ...(opts.pictureSizes && typeof picture === 'string' && picture ? { pictures: [picture, ...(await pictureSizes(token, proof))] } : {}),
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
    ...(p.email ? { email: p.email, email_verified: true } : {}),
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
 * made: that account already had its own way in. ⛔ AN ACCOUNT MADE WITH FACEBOOK WAS CONFIRMED ON FACEBOOK'S WORD: if that mailbox is dead,
 * Disconnect would strand it. ⛔ NOT app_metadata.provider: GoTrue rewrites it at every sign-in (auth.eno_facebook_connected says why).
 */
/** The Facebook id this account has connected, if any: Import must be that one. */
export async function connectedFacebookId(userId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ provider_id: string }[]>`SELECT provider_id FROM auth.identities WHERE user_id = ${userId}::uuid AND lower(provider) = 'facebook' LIMIT 1`
  return rows[0]?.provider_id ?? null
}

export async function facebookConnectionState(userId: string): Promise<{ connected: boolean; canDisconnect: boolean; email: string | null }> {
  const rows = await db.$queryRaw<{ connected: boolean; made_by_connect: boolean; email: string | null }[]>`
    SELECT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND lower(i.provider) = 'facebook') AS connected,
           EXISTS (SELECT 1 FROM auth.eno_facebook_connected c WHERE c.user_id = u.id) AS made_by_connect,
           u.email AS email
    FROM auth.users u WHERE u.id = ${userId}::uuid`
  const connected = rows[0]?.connected === true
  return { connected, canDisconnect: connected && rows[0]?.made_by_connect === true, email: rows[0]?.email ?? null }
}
