import 'server-only'
import { db } from '@/lib/db'

// ── Native Zalo ZNS (ZBS Template Message) OTP delivery ──────────────────────────
// Direct integration with Zalo's Business OpenAPI — no aggregator (eSMS removed by
// user decision 2026-07-05). Three raw HTTPS calls, zero new deps:
//   token:   POST oauth.zaloapp.com/v4/oa/access_token   (x-www-form-urlencoded,
//            header `secret_key`) — access token 25h; REFRESH TOKEN IS SINGLE-USE
//            (each refresh returns a NEW refresh token and kills the old one, 3-month
//            life). The rotating chain therefore lives in the LOGGED Postgres table
//            zalo_oauth_token (single row, id=1), NEVER env — and rotation runs under
//            SELECT ... FOR UPDATE so two instances can never both consume the same
//            single-use token (owner design, 2026-07-20; replaced the Upstash NX lock).
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
// the refresh token in ZALO_INIT_REFRESH_TOKEN. The FIRST send seeds the table from it
// and the chain self-maintains from then on (the env value is stale after first use
// by design — it is only read when the table has no chain). Manual recovery after a
// dead chain: new ZALO_INIT_REFRESH_TOKEN + `delete from zalo_oauth_token`.

const APP_ID = process.env.ZALO_APP_ID
const APP_SECRET = process.env.ZALO_APP_SECRET
const TEMPLATE_ID = process.env.ZALO_ZNS_TEMPLATE_ID
const INIT_REFRESH_TOKEN = process.env.ZALO_INIT_REFRESH_TOKEN
// 'development' delivers only to app/OA admins — pre-launch end-to-end testing.
const MODE = process.env.ZALO_ZNS_MODE

type TokenState = { accessToken: string; refreshToken: string; expiresAt: number }
type TokenRow = { access_token: string; refresh_token: string; expires_ms: number | bigint }

export function znsConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET && TEMPLATE_ID)
}

const rowToState = (r: TokenRow | undefined): TokenState | null =>
  r ? { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Number(r.expires_ms) } : null

// Exchange a refresh token for a fresh pair. PERSISTENCE IS THE CALLER'S JOB —
// this runs inside the FOR UPDATE transaction so the new chain and the row lock
// commit together. Returns null on failure (expired/consumed refresh token →
// chain is dead until an OA admin re-authorizes; we log loudly and the caller
// falls back).
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
      // `delete from zalo_oauth_token`) — shout about it.
      console.error('[zns] token refresh REJECTED — chain may need re-authorization:', json.error, json.error_name)
      return null
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      // expires_in is a STRING ("90000" = 25h). Refresh 1h early.
      expiresAt: Date.now() + (Number(json.expires_in || 90000) - 3600) * 1000,
    }
  } catch (e) {
    console.error('[zns] token refresh failed:', (e as Error).name)
    return null
  }
}

// Per-process single-flight for the refresh path: concurrent callers on one
// instance share ONE transaction/connection instead of each pinning a pooled
// connection while blocked on the lock during the ~once/24h refresh window
// (review 2026-07-20). Cross-instance serialization is the advisory lock below.
let refreshInFlight: Promise<string | null> | null = null

// Returns a usable access token, refreshing (or bootstrapping from env) when needed.
// Fast path reads without a lock. The refresh path serializes on
// pg_advisory_xact_lock — NOT just the row's FOR UPDATE, because FOR UPDATE on an
// EMPTY table locks nothing, and bootstrap/recovery (`delete from zalo_oauth_token`)
// is exactly when two racers would both spend the single-use INIT token (review
// 2026-07-20; same xact-lock pattern as dispute.ts). A loser blocks until the winner
// commits, re-reads the fresh chain, and returns it WITHOUT spending the single-use
// refresh token — one consumer, always. The HTTP exchange runs inside the
// transaction (bounded by its 4s AbortSignal) ON PURPOSE: dropping the lock before
// the new pair is persisted would reopen the double-consume race.
async function getAccessToken(force = false): Promise<string | null> {
  if (!znsConfigured()) return null

  const read = async (client: Pick<typeof db, '$queryRaw'>, lock: boolean) => {
    const rows = lock
      ? await client.$queryRaw<TokenRow[]>`
          select access_token, refresh_token, extract(epoch from expires_at) * 1000 as expires_ms
            from zalo_oauth_token where id = 1 for update`
      : await client.$queryRaw<TokenRow[]>`
          select access_token, refresh_token, extract(epoch from expires_at) * 1000 as expires_ms
            from zalo_oauth_token where id = 1`
    return rowToState(rows[0])
  }

  try {
    const state = await read(db, false)
    if (state && !force && state.expiresAt > Date.now()) return state.accessToken

    // Join an in-flight refresh rather than opening another transaction. Safe for
    // force=true too: the in-flight refresh yields a brand-new token either way.
    if (refreshInFlight) return await refreshInFlight
    refreshInFlight = db.$transaction(
      async (tx) => {
        // Row-independent one-winner gate — holds even when the table is empty.
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('zalo:oa-refresh'))`
        const latest = await read(tx, true)
        if (latest && !force && latest.expiresAt > Date.now()) return latest.accessToken

        const seed = latest?.refreshToken ?? INIT_REFRESH_TOKEN
        if (!seed) {
          console.error('[zns] no refresh token available (set ZALO_INIT_REFRESH_TOKEN to bootstrap)')
          return null
        }
        const next = await refreshTokens(seed)
        if (!next) return null
        await tx.$executeRaw`
          insert into zalo_oauth_token (id, access_token, refresh_token, expires_at, updated_at)
          values (1, ${next.accessToken}, ${next.refreshToken}, to_timestamp(${next.expiresAt} / 1000.0), now())
          on conflict (id) do update set
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            updated_at = now()`
        return next.accessToken
      },
      // Cover a queued waiter (winner's 4s HTTP + commit) with honest headroom.
      { maxWait: 8_000, timeout: 15_000 },
    )
    try {
      return await refreshInFlight
    } finally {
      refreshInFlight = null
    }
  } catch (e) {
    console.error('[zns] token state error:', (e as Error).message)
    return null
  }
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
