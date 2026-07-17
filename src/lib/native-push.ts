import 'server-only'
import crypto from 'node:crypto'
import http2 from 'node:http2'
import { db } from './db'
import type { PushPayload } from './push'

/**
 * NATIVE push (Capacitor apps): FCM for Android, APNs for iOS — the counterpart to
 * sendPushToProfile (web push). DORMANT until the env below is set: with nothing configured every
 * call is a safe no-op, so this ships now and activates the moment the owner drops in the config.
 * Best-effort per token; dead tokens (Unregistered / BadDeviceToken) are pruned so the table
 * self-cleans. See NATIVE_PUSH_SETUP.md for the exact activation steps.
 *
 * ── Android / FCM (HTTP v1) ── a Firebase service-account JSON (Project settings → Service accounts):
 *   FCM_PROJECT_ID   the Firebase project id
 *   FCM_CREDENTIALS  the service-account JSON, raw OR base64 (same shape as GEMINI_CREDENTIALS)
 * ── iOS / APNs (token auth) ── an APNs Auth Key (.p8) from the PAID Apple developer account:
 *   APNS_KEY_ID      the 10-char Key ID
 *   APNS_TEAM_ID     the 10-char Apple Team ID
 *   APNS_KEY         the .p8 private-key PEM contents (raw or base64)
 *   APNS_BUNDLE_ID   the app bundle id used as the apns-topic (e.g. vn.eno.app)
 *   APNS_PRODUCTION  'true' → api.push.apple.com; else the sandbox host
 */

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const decodeMaybeB64 = (s: string) => (s.trim().startsWith('{') || s.includes('BEGIN') ? s : Buffer.from(s.trim(), 'base64').toString('utf8'))

// ─────────────────────────── Android / FCM ───────────────────────────
type Sa = { client_email: string; private_key: string }
function fcmSa(): { projectId: string; sa: Sa } | null {
  const projectId = process.env.FCM_PROJECT_ID?.trim()
  const raw = process.env.FCM_CREDENTIALS?.trim()
  if (!projectId || !raw) return null
  try { return { projectId, sa: JSON.parse(decodeMaybeB64(raw)) as Sa } } catch { return null }
}

let fcmToken: { value: string; exp: number } | null = null
async function fcmAccessToken(sa: Sa): Promise<string | null> {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const sig = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key))
  const assertion = `${header}.${claim}.${sig}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  })
  if (!res.ok) return null
  const j = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!j.access_token) return null
  fcmToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
  return j.access_token
}

/** Returns 'ok' | 'dead' | 'fail'. */
async function sendFcm(projectId: string, accessToken: string, token: string, p: PushPayload): Promise<'ok' | 'dead' | 'fail'> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: p.title, body: p.body ?? '' },
        data: p.url ? { url: p.url } : undefined,
        android: { notification: { tag: p.tag } },
      },
    }),
  })
  if (res.ok) return 'ok'
  const err = (await res.json().catch(() => null)) as { error?: { status?: string } } | null
  const status = err?.error?.status
  return status === 'NOT_FOUND' || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' ? 'dead' : 'fail'
}

// ─────────────────────────── iOS / APNs ───────────────────────────
function apnsConfig() {
  const keyId = process.env.APNS_KEY_ID?.trim()
  const teamId = process.env.APNS_TEAM_ID?.trim()
  const key = process.env.APNS_KEY?.trim()
  const bundleId = process.env.APNS_BUNDLE_ID?.trim()
  if (!keyId || !teamId || !key || !bundleId) return null
  return { keyId, teamId, key: decodeMaybeB64(key), bundleId, host: process.env.APNS_PRODUCTION === 'true' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com' }
}

let apnsJwtCache: { value: string; iat: number } | null = null
function apnsJwt(cfg: NonNullable<ReturnType<typeof apnsConfig>>): string {
  const now = Math.floor(Date.now() / 1000)
  if (apnsJwtCache && now - apnsJwtCache.iat < 2400) return apnsJwtCache.value // APNs allows reuse < 1h; refresh at 40m
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }))
  const claim = b64url(JSON.stringify({ iss: cfg.teamId, iat: now }))
  const sig = b64url(crypto.createSign('SHA256').update(`${header}.${claim}`).sign({ key: cfg.key, dsaEncoding: 'ieee-p1363' }))
  const jwt = `${header}.${claim}.${sig}`
  apnsJwtCache = { value: jwt, iat: now }
  return jwt
}

/** Returns 'ok' | 'dead' | 'fail'. */
function sendApns(cfg: NonNullable<ReturnType<typeof apnsConfig>>, jwt: string, token: string, p: PushPayload): Promise<'ok' | 'dead' | 'fail'> {
  return new Promise((resolve) => {
    const client = http2.connect(cfg.host)
    client.on('error', () => { try { client.close() } catch { /* noop */ }; resolve('fail') })
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`, 'apns-topic': cfg.bundleId, 'apns-push-type': 'alert', 'content-type': 'application/json',
    })
    let status = 0, data = ''
    req.on('response', (h) => { status = Number(h[':status']) || 0 })
    req.setEncoding('utf8'); req.on('data', (d) => { data += d })
    req.on('end', () => {
      try { client.close() } catch { /* noop */ }
      if (status === 200) return resolve('ok')
      const reason = (() => { try { return (JSON.parse(data) as { reason?: string }).reason } catch { return '' } })()
      resolve(status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken' ? 'dead' : 'fail')
    })
    req.on('error', () => { try { client.close() } catch { /* noop */ }; resolve('fail') })
    req.end(JSON.stringify({ aps: { alert: { title: p.title, body: p.body ?? '' }, sound: 'default' }, url: p.url }))
  })
}

/**
 * Send a native push to every device a profile registered. No-ops entirely when neither FCM nor
 * APNs is configured. Prunes dead tokens. Returns the count of successful deliveries.
 */
export async function sendNativePushToProfile(profileId: string, payload: PushPayload): Promise<number> {
  const fcm = fcmSa()
  const apns = apnsConfig()
  if (!fcm && !apns) return 0

  const tokens = await db.nativePushToken.findMany({ where: { profileId } })
  if (tokens.length === 0) return 0

  const dead: string[] = []
  let sent = 0
  const accessToken = fcm ? await fcmAccessToken(fcm.sa) : null
  const jwt = apns ? apnsJwt(apns) : null

  await Promise.all(tokens.map(async (t) => {
    try {
      let r: 'ok' | 'dead' | 'fail' = 'fail'
      if (t.platform === 'android' && fcm && accessToken) r = await sendFcm(fcm.projectId, accessToken, t.token, payload)
      else if (t.platform === 'ios' && apns && jwt) r = await sendApns(apns, jwt, t.token, payload)
      if (r === 'ok') sent++
      else if (r === 'dead') dead.push(t.token)
    } catch { /* swallow per-token */ }
  }))

  if (dead.length) await db.nativePushToken.deleteMany({ where: { profileId, token: { in: dead } } })
  return sent
}
