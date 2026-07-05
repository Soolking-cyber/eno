import 'server-only'
import { Redis } from '@upstash/redis'

// ── Native Zalo ZNS (ZBS Template Message) OTP delivery ──────────────────────────
// Direct integration with Zalo's Business OpenAPI — no aggregator (eSMS removed by
// user decision 2026-07-05). Three raw HTTPS calls, zero new deps:
//   token:   POST oauth.zaloapp.com/v4/oa/access_token   (x-www-form-urlencoded,
//            header `secret_key`) — access token 25h; REFRESH TOKEN IS SINGLE-USE
//            (each refresh returns a NEW refresh token and kills the old one, 3-month
//            life). The rotating chain therefore lives in Upstash Redis, NEVER env.
//   send:    POST business.openapi.zalo.me/message/template (header `access_token`)
//            body { phone: '84…', template_id, template_data: { otp }, tracking_id }
// OTP ("Mẫu Xác thực") notes: param name is literally `otp`; the only template type
// allowed for users with no prior OA interaction; EXEMPT from the 6:00–22:00 send
// window; 300 VND + VAT per delivered message, prepaid ZBS wallet.
//
// Ops error map (developers.zalo.me/docs/zbs-template-message/bang-ma-loi):
//   -118 target phone has no Zalo  → caller falls back to SMS
//   -140/-141 user refuses OA msgs → caller falls back to SMS
//   -124 access token invalid      → forced refresh + one retry (handled here)
//   -115/-137 wallet empty/charge failure → alert-worthy, logged loudly
//   -144/-147 OA/template daily quota     → logged; caller falls back
//   -135 OA not business-verified          → config-stage error, logged
//
// Bootstrap: an OA admin mints the first token pair via Zalo's API Explorer and puts
// the refresh token in ZALO_INIT_REFRESH_TOKEN. The FIRST send seeds Redis from it
// and the chain self-maintains from then on (the env value is stale after first use
// by design — it is only read when Redis has no chain).

const APP_ID = process.env.ZALO_APP_ID
const APP_SECRET = process.env.ZALO_APP_SECRET
const TEMPLATE_ID = process.env.ZALO_ZNS_TEMPLATE_ID
const INIT_REFRESH_TOKEN = process.env.ZALO_INIT_REFRESH_TOKEN
// 'development' delivers only to app/OA admins — pre-launch end-to-end testing.
const MODE = process.env.ZALO_ZNS_MODE

const TOKENS_KEY = 'zalo:oa-tokens' // durable JSON { accessToken, refreshToken, expiresAt }
const LOCK_KEY = 'zalo:oa-refresh-lock' // SET NX guard — single-use refresh must never race

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
const redis = url && token ? new Redis({ url, token }) : null

type TokenState = { accessToken: string; refreshToken: string; expiresAt: number }

export function znsConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET && TEMPLATE_ID && redis)
}

// Exchange a refresh token for a fresh pair and persist the NEW chain atomically.
// Returns null on failure (expired/consumed refresh token → chain is dead until an
// OA admin re-authorizes; we log loudly and let the caller fall back).
async function refreshTokens(refreshToken: string): Promise<TokenState | null> {
  try {
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: APP_SECRET!,
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        app_id: APP_ID!,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(4000),
    })
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
      expires_in?: string
      error?: number
      error_name?: string
    }
    if (!json.access_token || !json.refresh_token) {
      // Most likely: the refresh token was already consumed or the 3-month life
      // lapsed. Recovery is MANUAL (API Explorer → new ZALO_INIT_REFRESH_TOKEN +
      // `redis-cli DEL zalo:oa-tokens` equivalent) — shout about it.
      console.error('[zns] token refresh REJECTED — chain may need re-authorization:', json.error, json.error_name)
      return null
    }
    const state: TokenState = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      // expires_in is a STRING ("90000" = 25h). Refresh 1h early.
      expiresAt: Date.now() + (Number(json.expires_in || 90000) - 3600) * 1000,
    }
    await redis!.set(TOKENS_KEY, state)
    return state
  } catch (e) {
    console.error('[zns] token refresh failed:', (e as Error).name)
    return null
  }
}

// Returns a usable access token, refreshing (or bootstrapping from env) when needed.
// Refresh is serialized behind an NX lock: with a SINGLE-USE refresh token, two
// concurrent refreshes would consume the same token and brick the chain.
async function getAccessToken(force = false): Promise<string | null> {
  if (!znsConfigured()) return null
  let state = (await redis!.get<TokenState>(TOKENS_KEY).catch(() => null)) ?? null

  const fresh = state && !force && state.expiresAt > Date.now()
  if (fresh) return state!.accessToken

  const seed = state?.refreshToken ?? INIT_REFRESH_TOKEN
  if (!seed) {
    console.error('[zns] no refresh token available (set ZALO_INIT_REFRESH_TOKEN to bootstrap)')
    return null
  }

  const locked = await redis!.set(LOCK_KEY, '1', { nx: true, px: 10_000 }).catch(() => null)
  if (locked) {
    try {
      // Re-read under the lock — another instance may have refreshed while we queued.
      const latest = (await redis!.get<TokenState>(TOKENS_KEY).catch(() => null)) ?? null
      if (latest && !force && latest.expiresAt > Date.now()) return latest.accessToken
      const next = await refreshTokens(latest?.refreshToken ?? seed)
      return next?.accessToken ?? null
    } finally {
      await redis!.del(LOCK_KEY).catch(() => {})
    }
  }

  // Someone else is refreshing — wait briefly and read their result.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500))
    state = (await redis!.get<TokenState>(TOKENS_KEY).catch(() => null)) ?? null
    if (state && state.expiresAt > Date.now()) return state.accessToken
  }
  return null
}

export type ZnsResult = { ok: boolean; code: number | null; noZalo: boolean }

/**
 * Send the OTP template to a VN phone number (84-prefixed digits). `noZalo: true`
 * means the number has no (or a refusing) Zalo account — the caller should fall
 * back to SMS. Never logs the OTP.
 */
export async function sendZnsOtp(phone: string, otp: string, trackingId: string): Promise<ZnsResult> {
  const fail = (code: number | null = null, noZalo = false): ZnsResult => ({ ok: false, code, noZalo })
  if (!znsConfigured()) return fail()

  const attempt = async (accessToken: string) => {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: accessToken },
      body: JSON.stringify({
        phone,
        template_id: TEMPLATE_ID,
        template_data: { otp },
        // ≤48 chars, no special chars — idempotency/correlation on Zalo's side.
        tracking_id: trackingId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48),
        ...(MODE === 'development' ? { mode: 'development' } : {}),
      }),
      signal: AbortSignal.timeout(4000),
    })
    return (await res.json().catch(() => ({}))) as { error?: number; message?: string }
  }

  try {
    let accessToken = await getAccessToken()
    if (!accessToken) return fail()
    let json = await attempt(accessToken)

    // -124: token invalid/expired despite our bookkeeping → force-refresh, retry once.
    if (json.error === -124) {
      accessToken = await getAccessToken(true)
      if (!accessToken) return fail(-124)
      json = await attempt(accessToken)
    }

    if (json.error === 0) return { ok: true, code: 0, noZalo: false }

    const code = json.error ?? null
    // No Zalo on this number / user refuses OA messages → SMS-fallback territory.
    if (code === -118 || code === -140 || code === -141) return fail(code, true)
    // Billing/config problems are operator-actionable — log loudly (no OTP in logs).
    if (code === -115 || code === -137) console.error('[zns] ZBS WALLET problem — top up:', code, json.message)
    else if (code === -135 || code === -136 || code === -138) console.error('[zns] account/config not ready:', code, json.message)
    else console.error('[zns] send rejected:', code, json.message)
    return fail(code)
  } catch (e) {
    console.error('[zns] send failed:', (e as Error).name)
    return fail()
  }
}
