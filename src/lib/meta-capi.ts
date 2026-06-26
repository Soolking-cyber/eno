import 'server-only'
import crypto from 'crypto'

// ── Meta Conversions API (server-side) ───────────────────────────────────────
// Sends conversion events straight from our server to Meta — NO browser pixel and
// ZERO client / first-load cost (the heavy pixel was removed; see analytics-tags.tsx).
// Always call these from `after()` in a route so they run AFTER the response flushes
// and never add a millisecond of latency to the user's request.
//
// Division of labour (so the two channels never double-count):
//   • Conversions  → here, server-side CAPI (CompleteRegistration / Contact / Lead).
//   • Browsing     → the browser pixel, IF ever re-enabled (PageView/ViewContent/Search).
// They fire different events, so no event_id dedup is needed.
//
// Config (server env — added manually in Vercel; see the values handed over):
//   META_PIXEL_ID         Pixel / dataset id (falls back to NEXT_PUBLIC_META_PIXEL_ID)
//   META_CAPI_TOKEN       Conversions API access token (Events Manager → Settings)
//   META_TEST_EVENT_CODE  optional — routes events to the "Test events" tab while testing
// Until BOTH id + token are present every call is a silent no-op (safe to ship now).

const PIXEL_ID = process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID
const TOKEN = process.env.META_CAPI_TOKEN
const TEST_CODE = process.env.META_TEST_EVENT_CODE
const GRAPH = 'https://graph.facebook.com/v21.0'

export function metaCapiConfigured(): boolean {
  return Boolean(PIXEL_ID && TOKEN)
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
// Meta normalizes most identifiers to trimmed-lowercase before SHA-256.
const hashLower = (v?: string | null) => {
  const s = (v || '').trim().toLowerCase()
  return s ? sha256(s) : undefined
}
// Phone: digits only (keep the country code), then SHA-256.
const hashPhone = (v?: string | null) => {
  const d = (v || '').replace(/\D/g, '')
  return d ? sha256(d) : undefined
}

export type MetaUserData = {
  email?: string | null
  phone?: string | null
  externalId?: string | null // our stable id (profile/user/seller) — hashed
  clientIp?: string | null
  userAgent?: string | null
  fbp?: string | null // _fbp cookie — sent raw (not hashed)
  fbc?: string | null // _fbc cookie — sent raw (not hashed)
}

function userDataPayload(u: MetaUserData): Record<string, unknown> {
  const ud: Record<string, unknown> = {}
  const em = hashLower(u.email); if (em) ud.em = [em]
  const ph = hashPhone(u.phone); if (ph) ud.ph = [ph]
  const ext = hashLower(u.externalId); if (ext) ud.external_id = [ext]
  if (u.clientIp) ud.client_ip_address = u.clientIp
  if (u.userAgent) ud.client_user_agent = u.userAgent
  if (u.fbp) ud.fbp = u.fbp
  if (u.fbc) ud.fbc = u.fbc
  return ud
}

// Pull IP / UA / _fbp / _fbc from the incoming request for best Event Match Quality,
// merged with any first-party identifiers we hold (phone/email/our id).
export function metaUserDataFromHeaders(
  headers: Headers,
  extra: { email?: string | null; phone?: string | null; externalId?: string | null } = {},
): MetaUserData {
  const ip = (headers.get('x-forwarded-for') || '').split(',')[0].trim() || undefined
  const ua = headers.get('user-agent') || undefined
  const cookie = headers.get('cookie') || ''
  const read = (name: string) => {
    const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
    return m ? decodeURIComponent(m[1]) : undefined
  }
  return { clientIp: ip, userAgent: ua, fbp: read('_fbp'), fbc: read('_fbc'), ...extra }
}

export type MetaEventOpts = {
  eventId?: string // dedup key; defaulted to a uuid (also guards accidental double-sends)
  eventSourceUrl?: string
  userData?: MetaUserData
  customData?: Record<string, unknown>
}

// Best-effort: never throws, never blocks. Call inside `after()`. No-op until configured.
export async function sendMetaCapiEvent(eventName: string, opts: MetaEventOpts = {}): Promise<void> {
  if (!metaCapiConfigured()) return
  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_id: opts.eventId || crypto.randomUUID(),
        ...(opts.eventSourceUrl ? { event_source_url: opts.eventSourceUrl } : {}),
        user_data: userDataPayload(opts.userData || {}),
        ...(opts.customData ? { custom_data: opts.customData } : {}),
      },
    ],
    ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}),
  }
  try {
    const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A slow Meta endpoint must never hold the serverless function open.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) console.error('[meta-capi]', eventName, res.status, (await res.text().catch(() => '')).slice(0, 300))
  } catch (e) {
    // Network/timeout — measurement is best-effort, never surfaced to the user.
    if (process.env.NODE_ENV !== 'production') console.error('[meta-capi] send failed', e)
  }
}
