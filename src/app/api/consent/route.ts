import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { getCurrentProfileId } from '@/lib/admin'
import { appendAudit } from '@/lib/compliance/audit'
import { CONSENT_V2_KEY, CONSENT_VERSION, NATIVE_UA_RE, cookieFromHeader, isConsentExpired, isConsentId, isProductionEnoHost, parseConsentV2 } from '@/lib/consent-value'
import { EDITION } from '@/lib/edition'
import { LANGS } from '@/lib/i18n/langs'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── The record of consent ────────────────────────────────────────────────────────────────────────
//
// Every choice made in the cookie card is sent here (sendBeacon from src/lib/consent.ts setConsent)
// and written as ONE row of the append-only, hash-chained `compliance_audit` log — the evidence
// Decree 356/2025 Art 6(2) makes the controller keep, and what /privacy tells visitors is kept.
// No schema change: the log already exists, is tamper-evident, and cannot be UPDATEd or DELETEd
// (scripts/compliance-ddl.mjs), which is exactly the property a consent record needs.
//
// WHAT A ROW HOLDS: the random consent id (subjectId — the same id the visitor's own consent cookie
// carries, so every later change links to the first), the three purposes, the consent and copy
// versions, where and how it was chosen, the edition (from THIS build, never the client), the locale,
// whether it came from the native app (User-Agent marker), when the choice was made (the cookie's
// timestamp; `occurredAt` is the server's), and the profile id when someone is signed in.
// ⚠️ NO IP ADDRESS, deliberately (`actorIp: null`): the record has to prove what was agreed to and
// when, not locate the person, and an IP in a 3-year log is personal data we would then have to justify.
//
// ⚠️ ALWAYS 204, NO BODY. It is a beacon: nothing reads the response, and an error status would only
// print noise in a visitor's console on a consent click. Every rejection path is silent.
//
// ⛔ THE RECORD IS BOUND TO THE CONSENT COOKIE THE SAME REQUEST CARRIES. setConsent() writes the
// `eno-consent-v2` cookie synchronously and THEN sends the beacon, so a genuine record always arrives
// with a cookie holding the same consent id and the same three purposes. A body that disagrees with
// its own cookie — or arrives with none, or an expired one — is not a record of anything this browser
// stores, and nothing is written. The purposes and timestamp recorded are the COOKIE's: that is the
// answer the server itself acts on (meta-capi, account-type), so the evidence and the behaviour match.
// ⚠️ This is consistency, not authentication: a scripted client can forge both halves. What bounds a
// forger is the next paragraph.
//
// ⛔ ONLY THE LIVE SITES WRITE. A local `npm run preview:vn` is a production build whose DATABASE_URL is
// the SSH tunnel to the PRODUCTION database, so the operator's own "click Allow all, see the 204" check
// used to append undeletable rows to the production log, labelled with the local build's edition.
// Nothing is written (and nothing touches the database — the rate limiter lives there too) unless
// NODE_ENV is 'production' AND the request's Host is a real eno host (consent-value.ts
// `isProductionEnoHost`). Everywhere else the endpoint is a silent 204.
//
// ⛔ THREE LIMITS, ALL FAIL CLOSED, BECAUSE THE TABLE CANNOT BE CLEANED. A junk row in an append-only
// evidence log is permanent, so an anonymous endpoint that writes there must not be floodable:
//   · 120/h per IP + consent id — one browser changing its mind, however often a real person would.
//     Keyed on the pair, not the IP alone, because Vietnamese mobile carriers put many subscribers
//     behind one CGNAT address: an IP-only 30/h silently dropped real visitors' records (the Decree
//     356 Art 6(2) evidence) on a busy day while their choice still took effect.
//   · 1,000/h per IP alone — a coarse ceiling, far above any carrier pool at this site's traffic,
//     that stops ONE machine minting a fresh consent id per request from spending the global
//     ceiling by itself (which would drop everyone else's records for the rest of the hour).
//   · 20,000/h overall — the flood cap for many machines.
// IPs come from cf-connecting-ip (every /api request must come through the edge). The limits share
// the database the log lives in, so "limiter down" already means "log down" — failing closed costs
// nothing extra. ⚠️ The global ceiling is a flood cap, not a traffic estimate: a botnet can still
// spend it, so if junk ever appears the answer is a lower ceiling or a dedicated (deletable) table.
//
// ⚠️ THE LOG'S ONE GLOBAL LOCK IS SHARED WITH KYC REVIEW, ACCOUNT ERASURE AND ADMIN AUDIT WRITES.
// appendAudit serialises every append on one advisory lock, and visitor beacons are by far the
// highest-volume writer — deploy day re-asks every v1 'all' holder at once. So a consent append
// waits at most CONSENT_LOCK_TIMEOUT for that lock (and CONSENT_TX_MAX_WAIT_MS for a pool connection),
// then gives up and logs `consent.record` — a lost record, never a queue of held pool connections in
// front of a KYC decision. A dedicated consent table (a schema change) removes the shared lock
// entirely and is the planned follow-up, not an "if junk appears" item.
// ⚠️ A STOREFRONT HOST (`<shop>.eno.vn`) CANNOT POST HERE: src/proxy.ts refuses cross-origin writes,
// by design. Storefronts are not live; when they are, their choices are stored but not yet recorded.

const Body = z.object({
  cid: z.string().refine(isConsentId),
  p: z.boolean(),
  a: z.boolean(),
  d: z.boolean(),
  v: z.literal(CONSENT_VERSION),
  copy: z.string().regex(/^[\w.-]{1,32}$/),
  surface: z.enum(['banner', 'settings']),
  action: z.enum(['allow_all', 'decline_all', 'save']),
  locale: z.string().max(8),
  ts: z.number().int().positive().max(99_999_999_999),
})

const VALID_LOCALES = new Set<string>(LANGS)
/** How long a consent append may wait for the log's advisory lock before it gives up (see header). */
const CONSENT_LOCK_TIMEOUT = '1000ms'
/** How long it may wait for a pool connection to open its transaction. */
const CONSENT_TX_MAX_WAIT_MS = 1_000
const noContent = () => new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } })
const MAX_BODY_BYTES = 2_048
/** How far ahead of the server clock a choice's timestamp may be before its record is flagged `clockAhead`. */
const MAX_CLOCK_SKEW_S = 300

export async function POST(req: Request) {
  // ⛔ FIRST, BEFORE ANYTHING READS THE BODY OR TOUCHES THE DATABASE — see the header.
  if (process.env.NODE_ENV !== 'production' || !isProductionEnoHost(req.headers.get('host'))) return noContent()

  // ⚠️ PARSED FROM TEXT, NOT req.json(): sendBeacon with a Blob sets application/json, but the
  // fallback paths and some browsers do not, and a content-type quibble must not lose a record.
  // A consent record is ~300 bytes. Refuse anything far larger BEFORE reading it, and again after (a
  // chunked body has no Content-Length), so an anonymous endpoint cannot be made to buffer megabytes.
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return noContent()
  let raw: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return noContent()
    raw = JSON.parse(text)
  } catch { return noContent() }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) return noContent()
  const b = parsed.data

  const stored = parseConsentV2(cookieFromHeader(req.headers.get('cookie'), CONSENT_V2_KEY))
  if (
    !stored ||
    isConsentExpired(stored, Math.floor(Date.now() / 1000)) ||
    stored.cid !== b.cid ||
    stored.p !== b.p || stored.a !== b.a || stored.d !== b.d
  ) return noContent()
  // ⚠️ A choice stamped in the future is RECORDED, flagged — never dropped. The browser already acts on it
  // (a phone whose clock runs fast still has working consent), so refusing would leave consent in force
  // with no evidence of it (codex, 2026-10-01). `occurredAt` is the server's clock; clientTs is kept as
  // sent, and `clockAhead` marks the row so nobody reads clientTs as the moment of the choice.
  const clockAhead = stored.ts > Math.floor(Date.now() / 1000) + MAX_CLOCK_SKEW_S

  // An "Allow all" with a purpose off, or a "Decline all" with one on, is not something the card can
  // send (cookie-consent.tsx: allow = ALL_ON, decline = ALL_OFF; the schema requires all three
  // booleans) — it is a forged record, and an append-only log must not take it (codex, 2026-10-01).
  const all = b.p && b.a && b.d, none = !b.p && !b.a && !b.d
  if ((b.action === 'allow_all' && !all) || (b.action === 'decline_all' && !none)) return noContent()

  // ⛔ ONE AFTER ANOTHER, NEVER Promise.all. Every rateLimit() call counts its hit, refused or not, so a
  // parallel check let one IP past its own 1,000/h cap keep feeding the GLOBAL counter until it ran out —
  // and then every real visitor's record was dropped for the hour (codex + opus, 2026-10-01). Checked in
  // order, a request refused by its pair or IP limit never reaches the global counter.
  const ip = clientIp(req)
  try {
    if (!(await rateLimit('consent-record', `${ip}|${b.cid}`, 120, '1 h', { strict: true })).success) return noContent()
    if (!(await rateLimit('consent-record-ip', ip, 1_000, '1 h', { strict: true })).success) return noContent()
    if (!(await rateLimit('consent-record-global', 'all', 20_000, '1 h', { strict: true })).success) return noContent()
  } catch (e) {
    // The endpoint's contract is a bodyless 204 on every path; a limiter outage must not turn into a 500.
    logError(e, { op: 'consent.ratelimit' })
    return noContent()
  }

  const profileId = await getCurrentProfileId().catch(() => null)
  const native = NATIVE_UA_RE.test(req.headers.get('user-agent') || '')

  try {
    await db.$transaction(async (tx) => {
      // Bounded wait on the log's shared advisory lock (see the header). `true` = this transaction only.
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${CONSENT_LOCK_TIMEOUT}, true)`
      await appendAudit(tx, {
        actorType: 'user',
        actorId: profileId,
        actorIp: null,
        action: 'consent.recorded',
        subjectType: 'consent',
        subjectId: b.cid,
        detail: {
          // ⚠️ Inside the native apps analytics and advertising are forced off whatever is stored, so
          // the EFFECTIVE purposes are recorded — the record must not claim a grant that never ran.
          p: stored.p,
          a: stored.a && !native,
          d: stored.d && !native,
          version: b.v,
          copyVersion: b.copy,
          surface: b.surface,
          action: b.action,
          edition: EDITION,
          locale: VALID_LOCALES.has(b.locale) ? b.locale : 'other',
          native,
          clientTs: stored.ts,
          ...(clockAhead ? { clockAhead: true } : {}),
        },
      })
    }, { maxWait: CONSENT_TX_MAX_WAIT_MS })
  } catch (e) {
    logError(e, { op: 'consent.record' })
  }
  return noContent()
}
