import 'server-only'
import crypto from 'crypto'
import { clientIp } from '@/lib/client-ip'
import { serverConsentAt } from '@/lib/consent-value'
import { isAppleRelayEmail } from '@/lib/apple-signin'
import { normalizePhone } from '@/lib/phone'
import { TIKTOK_NAMED_FROM_S, consentCoversTikTok } from '@/lib/tiktok-consent'

// ── TikTok Events API (server-side) ──────────────────────────────────────────
// Sends a conversion straight from our server to TikTok, the way src/lib/meta-capi.ts does for Meta — NO browser pixel
// (the CSP allows no TikTok host, on either edition) and no Tag Manager container. Call it from `after()` so it runs
// once the response has flushed.
//
// The request is TikTok's Events API 2.0, read from TikTok's own server-side tag template
// (github.com/tiktok/gtm-template-eapi, 2026-10-12): POST /open_api/v1.3/event/track/ with an `Access-Token` header and
// { event_source: 'web', event_source_id: <pixel>, data: [{ event, event_time, event_id, user, page, properties }] }.
// `user.email` / `user.phone` / `user.external_id` are SHA-256 hex; `ip` and `user_agent` go as they are.
// ⚠️ NO CLICK ID YET: TikTok's `ttclid` (the ad link's own id) is not carried from the browser in this release, so a
// sign-up is matched to an ad on the hashed identifiers, the IP address and the browser alone.
// ⚠️ TikTok answers HTTP 200 with a JSON `code` — 0 is the only success — so a 200 alone proves nothing.
//
// Config (server env; until BOTH are present every call is a silent no-op):
//   TIKTOK_PIXEL_ID          the dataset's pixel code (Events Manager → the dataset)
//   TIKTOK_EVENTS_TOKEN      the Events API access token (the dataset's Settings → Events API)
//   TIKTOK_TEST_EVENT_CODE   optional — routes events to the dataset's "Test events" tab while testing

const PIXEL_ID = process.env.TIKTOK_PIXEL_ID
const TOKEN = process.env.TIKTOK_EVENTS_TOKEN
const TEST_CODE = process.env.TIKTOK_TEST_EVENT_CODE
const ENDPOINT = 'https://business-api.tiktok.com/open_api/v1.3/event/track/'

export function tiktokEventsConfigured(): boolean {
  return Boolean(PIXEL_ID && TOKEN)
}

export { TIKTOK_NAMED_FROM_S }

/** The request-only half of "may this visitor be reported to TikTok?": Advertising on (never inside the apps), in an
 *  answer no older than the first full day the card named TikTok. ⛔ Necessary, NOT sufficient — the caller must also
 *  hold the consent record to the card's words (src/lib/tiktok-consent-record.ts) before it sends anything. */
export function tiktokConsent(headers: Headers, nowMs: number = Date.now()): boolean {
  return consentCoversTikTok(serverConsentAt(headers, nowMs))
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export type TikTokUser = {
  email?: string | null
  /** ⛔ D14, as for Meta: an address Apple shared or relayed never reaches an ad platform. The email is hashed ONLY
   *  when this is exactly `false`; `true` or no answer sends none. A relay address is dropped whatever this says. */
  appleLinked?: boolean
  phone?: string | null
  externalId?: string | null // our account id — hashed
  clientIp?: string | null
  userAgent?: string | null
  /** tiktokConsent() of the request (Advertising on, no older than the floor) — sendTikTokEvent FAILS CLOSED on it. */
  consent?: boolean
}

/** What a caller adds. ⛔ An email only WITH the answer to "is this account Apple-linked?" — the type refuses one without it. */
export type TikTokIdentifiers = { phone?: string | null; externalId?: string | null } & (
  | { email?: undefined; appleLinked?: boolean }
  | { email: string | null | undefined; appleLinked: boolean }
)

export function tiktokUserFromHeaders(headers: Headers, extra: TikTokIdentifiers = {}): TikTokUser {
  const resolved = clientIp(headers)
  return {
    clientIp: resolved === 'anon' ? undefined : resolved,
    userAgent: headers.get('user-agent') || undefined,
    consent: tiktokConsent(headers),
    ...extra,
  }
}

function userPayload(u: TikTokUser): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const email = (u.email || '').trim().toLowerCase()
  if (email && u.appleLinked === false && !isAppleRelayEmail(email)) out.email = sha256(email)
  // E.164 with its plus sign, as TikTok matches it — the app's own canonical form (a local 09… number becomes +849…).
  const phone = normalizePhone(u.phone || '')
  if (phone) out.phone = sha256(phone)
  const ext = (u.externalId || '').trim()
  if (ext) out.external_id = sha256(ext)
  if (u.clientIp) out.ip = u.clientIp
  if (u.userAgent) out.user_agent = u.userAgent
  return out
}

export type TikTokEventOpts = {
  /**
   * ⛔ REQUIRED, AND ONLY EVER `true` FROM consentRecordNamesTikTok(headers) (src/lib/tiktok-consent-record.ts): the
   * consent RECORD of this visitor's answer shows it was given to a card that named TikTok. The sender refuses without
   * it, so a call site added later cannot reach TikTok on the date floor alone.
   */
  recordNamesTikTok: boolean
  eventId?: string // dedup key; defaulted to a uuid
  pageUrl?: string
  user?: TikTokUser
  properties?: Record<string, unknown>
}

// Best-effort: never throws, never blocks. No-op until configured, and FAILS CLOSED on consent, twice — `user` must
// come from tiktokUserFromHeaders (Advertising on, no older than the floor) AND the caller must have held the consent
// record to the card's words. A visitor who never answered, declined, answered a card that did not name TikTok, or is
// inside the app sends nothing.
export async function sendTikTokEvent(event: string, opts: TikTokEventOpts): Promise<void> {
  if (!tiktokEventsConfigured()) return
  if (opts?.recordNamesTikTok !== true || opts.user?.consent !== true) return
  try {
    const body = {
      event_source: 'web',
      event_source_id: PIXEL_ID,
      ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}),
      data: [
        {
          event,
          event_time: Math.floor(Date.now() / 1000),
          event_id: opts.eventId || crypto.randomUUID(),
          user: userPayload(opts.user),
          ...(opts.pageUrl ? { page: { url: opts.pageUrl } } : {}),
          ...(opts.properties ? { properties: opts.properties } : {}),
        },
      ],
    }
    // ⚠️ A test code left in the production env sends EVERY event to the Test events tab and TikTok still answers OK —
    // so it is said out loud, each time, where the operator will see it.
    if (TEST_CODE && process.env.NODE_ENV === 'production') console.error('[tiktok-events]', event, 'sent as a TEST event: TIKTOK_TEST_EVENT_CODE is set')
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'access-token': TOKEN as string },
      body: JSON.stringify(body),
      // A slow TikTok endpoint must never hold the function open.
      signal: AbortSignal.timeout(4000),
    })
    const text = await res.text().catch(() => '')
    let code: unknown
    try { code = (JSON.parse(text) as { code?: unknown }).code } catch { code = undefined }
    if (!res.ok || code !== 0) console.error('[tiktok-events]', event, res.status, text.slice(0, 300))
  } catch (e) {
    // Network / timeout — best-effort, never surfaced to the user, but LOGGED in production too: a box that cannot
    // reach TikTok would otherwise record nothing, anywhere (commit gate, 2026-10-12). The message only — no request.
    console.error('[tiktok-events]', event, 'send failed:', e instanceof Error ? e.message : 'unknown error')
  }
}
