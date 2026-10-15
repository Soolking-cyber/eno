import { Resend } from 'resend'
import * as nodemailer from 'nodemailer'
import { SITE_NAME } from '@/lib/edition'

type Transporter = nodemailer.Transporter

// One Resend client per process. If RESEND_API_KEY is unset — local/dev, or in prod
// BEFORE the key is uploaded — sending is a NO-OP that logs, so the digest cron still
// runs end-to-end and just doesn't deliver. Same env-gated guard as push.ts / VAPID.
const KEY = process.env.RESEND_API_KEY
// Must be a domain verified in Resend (eno.vn). Override via MAIL_FROM env.
//
// ⚠️ ONE SENDER FOR BOTH EDITIONS, AND ON eno.forum THAT IS A KNOWN LEAK LEFT FOR THE OWNER. Unless
// the forum container sets MAIL_FROM, every eno.forum email — the finished e-Visa included — arrives
// FROM "eno.vn <no-reply@eno.vn>", the licensed marketplace, even though its body and footer now
// name eno.forum (emails/layout.ts). No Reply-To is set, so a reply goes to no-reply@eno.vn. The fix
// is NOT a per-edition default here: a forum address only sends once eno.forum is verified as a
// sending domain with the provider (and the API key in use is allowed to send from it). Verify that,
// then set MAIL_FROM on the services deployment — e.g. "eno.forum <no-reply@eno.forum>".
const FROM = process.env.MAIL_FROM || 'eno.vn <no-reply@eno.vn>'
/** The bare sending address out of FROM ("Name <addr>" or "addr") — the part the provider verified. */
const FROM_ADDRESS = (FROM.match(/<([^>]+)>/)?.[1] ?? FROM).trim()

/**
 * The From header for one message. A `fromName` replaces only the DISPLAY NAME — the address stays
 * this deployment's verified sender, so deliverability and SPF/DKIM are untouched. Used by the
 * finished-visa mail on eno.vn, which is the partner's and must not arrive as "eno.vn"
 * (src/lib/visa/result-brand.ts).
 * ⚠️ Quotes, angle brackets, backslashes and line breaks are stripped, not escaped: the name comes from
 * a Seller row, and a header value is the wrong place to discover what a provider does with `\r\n`.
 */
export function fromHeader(fromName?: string | null): string {
  const clean = (fromName ?? '').replace(/["<>\\\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
  return clean ? `"${clean}" <${FROM_ADDRESS}>` : FROM
}
const resend = KEY ? new Resend(KEY) : null

// ──────────────────────────────────────────────────────────────────────────────────────────────
// FALLBACK TRANSPORT — our own mailcow SMTP (mx.eno.vn), used ONLY by sendMail when Resend is DOWN.
//
// Resend stays PRIMARY. Only the INTERACTIVE, low-volume sendMail path (sign-in, visa result, KYC,
// payout) fails over, so a Resend quota cap can't 502 sign-in. The BULK paths deliberately do NOT
// fail over: sendMailBatch (weekly digest) and sendMailOnce (the teacher-match / -message cron LOOPS)
// would push hundreds of messages through this un-warmed, no-PTR IP and the 2-connection pool —
// burning the sending reputation sign-in leans on and starving interactive sign-in behind the queue.
// They stay Resend-only (their crons already gate on mailEnabled() = Resend) and simply pause until
// quota recovers. Enabled only when host+user+pass are set AND the From is on THIS edition's domain.
const SMTP_HOST = process.env.MAIL_SMTP_HOST
const SMTP_PORT = Number(process.env.MAIL_SMTP_PORT || 465)
const SMTP_USER = process.env.MAIL_SMTP_USER
const SMTP_PASS = process.env.MAIL_SMTP_PASS
// The SMTP From. Its ADDRESS must be a mailbox the authenticated user owns (mailcow rejects a
// sender-login mismatch), so it defaults to MAIL_SMTP_USER with NO display name — a display naming a
// different domain than the address trips spam filters. A per-message fromName is still honoured.
const SMTP_FROM = process.env.MAIL_SMTP_FROM || SMTP_USER || ''
const SMTP_FROM_ADDRESS = (SMTP_FROM.match(/<([^>]+)>/)?.[1] ?? SMTP_FROM).trim()
// ⛔ LICENSING GUARD: BOTH the authenticated account (MAIL_SMTP_USER) AND the visible From must be on
// THIS edition's own domain. eno.vn is a licensed VN marketplace and must never be the sender — or the
// relaying account — of eno.forum's visa/itinerary mail. So MAIL_SMTP_* copied into the OTHER
// edition's env (the "ship to both sites" reflex) pointed at this box's eno.vn mailbox leaves SMTP OFF
// (Resend-only) rather than relaying forum mail through eno.vn. Per-edition failover needs a mailbox
// on that edition's own domain. (Checking both closes the user≠From gap: eno.vn creds + eno.forum From.)
// On-edition = the host/address is this edition's own domain (apex, a subdomain, or an @address on
// it). The WHOLE SMTP identity — relay host, auth account, AND From — must pass, so no part of
// eno.forum's mail (its MX in Received/HELO included) is ever eno.vn, and vice versa.
const onThisEdition = (v: string) => {
  const s = v.toLowerCase()
  return s === SITE_NAME || s.endsWith('@' + SITE_NAME) || s.endsWith('.' + SITE_NAME)
}
const smtpConfigured = !!(
  SMTP_HOST && SMTP_USER && SMTP_PASS &&
  onThisEdition(SMTP_HOST) && onThisEdition(SMTP_USER) && onThisEdition(SMTP_FROM_ADDRESS)
)
// Loud once at module load when the fallback is CONFIGURED but the licensing guard rejected it — so a
// misconfigured env (e.g. eno.vn creds copied into the forum) is visible instead of silently leaving
// sign-in on Resend only until the first quota outage.
if (SMTP_HOST && !smtpConfigured) {
  console.warn(`[mail] MAIL_SMTP_* set but the SMTP fallback is DISABLED — host, user and From must all be on ${SITE_NAME}. Using Resend only.`)
}

let smtpTransport: Transporter | null = null
function smtpTransporter(): Transporter | null {
  if (!smtpConfigured) return null
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // implicit TLS on 465; STARTTLS upgrade on 587
      requireTLS: true, // on 587, refuse to send if STARTTLS can't be negotiated (no plaintext creds)
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      maxConnections: 2,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 15_000,
    })
    // A pooled transport is a long-lived EventEmitter; an unhandled 'error' event would take down the
    // Node process (which runs both edition containers). Swallow + log — nodemailer recycles the
    // failed pool connection itself on the next send, so the cached transporter stays usable.
    smtpTransport.on('error', (e: unknown) => console.error('[mail] smtp pool error', (e as { message?: string })?.message ?? e))
  }
  return smtpTransport
}

/** From header for the SMTP path — fromName as the display, address forced to the authenticated
 *  mailbox (SMTP_FROM). Mirrors fromHeader's sanitising. */
function smtpFromHeader(fromName?: string | null): string {
  const clean = (fromName ?? '').replace(/["<>\\\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
  return clean ? `"${clean}" <${SMTP_FROM_ADDRESS}>` : SMTP_FROM
}

/**
 * Wait at most `ms` for a promise, then reject. The Resend SDK sets no fetch timeout, and
 * nodemailer's socketTimeout is a per-step IDLE timeout — without an overall cap a black-holed box or
 * a slow trickle could hang a sign-in. The underlying request is NOT aborted (it may still complete),
 * which for this fire-and-forget path is at worst a rare duplicate, never a lost sign-in.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}
const RESEND_TIMEOUT_MS = 8_000
const SMTP_TIMEOUT_MS = 20_000

/** One SMTP fallback send. Returns true on accept, false on any failure (logged). Never throws — a
 *  thrown transporter build is caught too, so sendMail's catch can't double-invoke it. Attachments:
 *  Resend passes base64 TEXT, nodemailer wants raw bytes. */
async function smtpSend(msg: MailMessage): Promise<boolean> {
  const who = maskEmail(msg.to)
  try {
    const t = smtpTransporter()
    if (!t) return false
    await withTimeout(
      t.sendMail({
        from: smtpFromHeader(msg.fromName),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'base64'),
          contentType: a.contentType,
        })),
      }),
      SMTP_TIMEOUT_MS,
    )
    return true
  } catch (e) {
    const err = e as { code?: string; command?: string; responseCode?: number }
    console.error('[mail] smtp fallback failed', who, err.command ?? err.code ?? err.responseCode ?? e)
    return false
  }
}

/** A Resend failure that is about Resend being UNAVAILABLE (quota/rate/5xx/network/bad key) rather
 *  than the message being invalid — the only failures sendMail fails over to SMTP. */
const AVAILABILITY_NAMES = new Set([
  'rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded',
  'internal_server_error', 'application_error',
  'invalid_api_key', 'missing_api_key', 'restricted_api_key', 'invalid_access',
])
function resendUnavailable(name: string, statusCode: number | null | undefined): boolean {
  if (statusCode == null) return true // network / no response
  if (statusCode === 429 || statusCode >= 500) return true
  return AVAILABILITY_NAMES.has(name)
}

/** True once RESEND_API_KEY is set — cron can short-circuit instead of looping recipients. */
export function mailEnabled(): boolean {
  return !!resend
}

/**
 * One file attached to an outgoing email.
 *
 * ⚠️ `content` is BASE64 TEXT, not raw bytes and not a Buffer. Resend's node SDK passes
 * this field straight into `JSON.stringify` (dist/index.mjs `parseAttachments`), so a
 * Buffer would serialise as `{"type":"Buffer","data":[…]}` and arrive as a corrupt file.
 * Encode at the call site: `buf.toString('base64')`.
 *
 * ⚠️ `filename` is the ONE part of an attachment the recipient's mail client, their
 * provider's virus scanner and every forwarding hop can all read in the clear. It must
 * never carry identity data — no passport number, no name, no date of birth. Name result
 * files after the case reference (`EV-1042-evisa.pdf`) and nothing else.
 *
 * Resend's ceiling is 40 MB for the whole message, base64 included (~30 MB of file).
 */
export type MailAttachment = {
  filename: string
  /** Base64-encoded file contents — see the note above. */
  content: string
  /** e.g. 'application/pdf'. Derived from the filename when omitted. */
  contentType?: string
}

export type MailMessage = {
  to: string
  subject: string
  html: string
  text?: string
  /** Extra SMTP headers, e.g. List-Unsubscribe / List-Unsubscribe-Post. */
  headers?: Record<string, string>
  /** Files to attach. Omit for ordinary transactional mail. */
  attachments?: MailAttachment[]
  /** Display name for From (address unchanged) — see fromHeader. sendMail only; batches use FROM. */
  fromName?: string
}

/**
 * Recipients in logs are reduced to `a…e@gmail.com`: enough to tell two failures apart
 * while debugging a bounce, not enough to be a copy of the address book. Cloud Logging
 * retains these lines far longer than we retain the data that produced them, and one of
 * the senders here carries a visa result — an address that must not outlive its case.
 */
function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '***'
  const local = address.slice(0, at)
  const domain = address.slice(at)
  const head = local.length > 1 ? `${local[0]}…${local[local.length - 1]}` : '*'
  return head + domain
}

/**
 * One Resend batch request, up to 100 messages — the broadcast path (the weekly digest).
 *
 * ⛔ WHY A BATCH AND NOT sendMail() IN A LOOP. Resend allows 10 requests per second per team. The
 * digest fired 20 sendMail() calls at once, and on 2026-09-24 exactly 10 were accepted and 11 were
 * refused with 429 (the 21st went out in the same second). A batch is ONE request for up to 100
 * recipients, so a list this size never touches the limit, and the sign-in mail sharing the key
 * keeps its headroom.
 *
 * ⚠️ `idempotencyKey` MAKES A RETRY SAFE. Resend keeps it for 24 h: re-posting the same key and the
 * same payload returns the first answer instead of sending again, so a request that timed out
 * after Resend had accepted it can be retried without emailing anyone twice.
 *
 * ⚠️ PERMISSIVE VALIDATION: one malformed address fails only its own row (`ok[i] === false`), not
 * the other 99. A whole-request failure returns every row false, plus `retryable` when trying again
 * can help (429, 5xx, a network error) and `retryAfterMs` when Resend said how long to wait.
 *
 * Never throws. Attachments are not supported by Resend's batch API and are not accepted here.
 */
export type BatchResult = {
  ok: boolean[]
  retryable: boolean
  retryAfterMs: number | null
  error: string | null
}

const RETRYABLE_ERRORS = new Set(['rate_limit_exceeded', 'internal_server_error', 'application_error', 'concurrent_idempotent_requests'])

export async function sendMailBatch(
  msgs: Omit<MailMessage, 'attachments'>[],
  opts: { idempotencyKey: string },
): Promise<BatchResult> {
  const none = (error: string, retryable: boolean, retryAfterMs: number | null = null): BatchResult =>
    ({ ok: msgs.map(() => false), retryable, retryAfterMs, error })
  if (!resend) {
    console.warn('[mail] RESEND_API_KEY not set — batch of', msgs.length, 'skipped')
    return none('disabled', false)
  }
  if (msgs.length === 0) return { ok: [], retryable: false, retryAfterMs: null, error: null }
  if (msgs.length > 100) return none('batch_too_large', false)
  try {
    const res = await resend.batch.send(
      msgs.map((m) => ({ from: FROM, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers })),
      { idempotencyKey: opts.idempotencyKey, batchValidation: 'permissive' },
    )
    if (res.error) {
      const status = res.error.statusCode
      const retryable = status == null || status === 429 || status >= 500 || RETRYABLE_ERRORS.has(res.error.name)
      const after = Number(res.headers?.['retry-after'])
      console.error('[mail] batch failed', msgs.length, res.error.name, status)
      return none(res.error.name, retryable, Number.isFinite(after) && after > 0 ? after * 1000 : null)
    }
    const failed = new Set((res.data?.errors ?? []).map((e) => e.index))
    for (const e of res.data?.errors ?? []) console.error('[mail] batch row refused', maskEmail(msgs[e.index]?.to ?? ''), e.message)
    return { ok: msgs.map((_, i) => !failed.has(i)), retryable: false, retryAfterMs: null, error: failed.size ? 'rows_refused' : null }
  } catch (e) {
    console.error('[mail] batch threw', msgs.length, e)
    return none('network', true)
  }
}

/**
 * ⛔ ONE EMAIL THAT MUST NEVER ARRIVE TWICE — the teacher job-match emails (cron/teacher-match-emails). The caller claims
 * its rows BEFORE sending and passes an idempotency key derived from what it claimed; this says what became of the send,
 * classified by Resend's error NAME, never by status band (a 409 is a 4xx and proves nothing was refused):
 *   · 'sent'    — Resend accepted it. Keep the claim.
 *   · 'refused' — ONLY on a first attempt, and only for names that PROVE nothing was sent (the request was rejected
 *                 before it was processed): rate limits and quotas, validation, a bad key or sender. The caller may
 *                 release its claim for a later run. `stopRun` when every later send would fail the same way (quota,
 *                 access, key, sender, idempotency key) — the run should end there.
 *   · 'unknown' — everything else: a 409 (concurrent_idempotent_requests, invalid_idempotent_request), a 5xx /
 *                 application_error, a network failure (the SDK's statusCode null: "Unable to fetch data"), a throw, and
 *                 ANY non-success when `afterUnknown` says an earlier attempt with this key may already have been
 *                 processed. Resend may have sent it: KEEP the claim, so the email is lost at worst, never doubled.
 * A retry with the SAME key and payload is safe for 24 h: Resend answers it with the first request's result.
 * Masked logging, as in sendMail. sendMail itself is unchanged for every other caller.
 */
export type OnceOutcome = 'sent' | 'refused' | 'unknown'
export type OnceResult = {
  outcome: OnceOutcome
  /** every later send in this run would fail the same way: stop the run */
  stopRun: boolean
  /** Resend's error name ('rate_limit_exceeded', …), 'network' for a throw, null when sent */
  name: string | null
  /** Resend's retry-after (a 429), in ms, when it sent one */
  retryAfterMs: number | null
}

/** Names that prove the request was refused before it was processed — nothing was sent. */
const NOTHING_SENT = new Set([
  'rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded',
  'validation_error', 'missing_required_field', 'invalid_parameter', 'invalid_from_address', 'invalid_attachment',
  'invalid_idempotency_key', 'invalid_access', 'invalid_api_key', 'restricted_api_key', 'missing_api_key',
])
/** …and of those, the ones every later send of the run would hit too (the quota, the key, the sender, the key format). */
const STOP_RUN = new Set([
  'daily_quota_exceeded', 'monthly_quota_exceeded', 'invalid_access', 'invalid_api_key', 'restricted_api_key', 'missing_api_key',
  'invalid_idempotency_key', 'invalid_from_address',
])

export async function sendMailOnce(
  msg: Omit<MailMessage, 'attachments'>,
  opts: { idempotencyKey: string; afterUnknown?: boolean },
): Promise<OnceResult> {
  const who = maskEmail(msg.to)
  if (!resend) {
    console.warn('[mail] RESEND_API_KEY not set — email disabled (skipped', who + ')')
    return { outcome: 'refused', stopRun: true, name: 'disabled', retryAfterMs: null }
  }
  try {
    const res = await resend.emails.send(
      { from: fromHeader(msg.fromName), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers },
      { idempotencyKey: opts.idempotencyKey },
    )
    if (!res.error) {
      if (res.data?.id) return { outcome: 'sent', stopRun: false, name: null, retryAfterMs: null }
      // No error and no id is not a shape Resend documents: it may have been accepted.
      console.error('[mail] once: no id and no error', who)
      return { outcome: 'unknown', stopRun: false, name: 'no_id', retryAfterMs: null }
    }
    const { name, statusCode } = res.error
    const after = Number(res.headers?.['retry-after'])
    const retryAfterMs = Number.isFinite(after) && after > 0 ? after * 1000 : null
    if (!opts.afterUnknown && statusCode != null && NOTHING_SENT.has(name)) {
      console.error('[mail] once refused', who, name, statusCode)
      return { outcome: 'refused', stopRun: STOP_RUN.has(name), name, retryAfterMs }
    }
    console.error('[mail] once unclear', who, name, statusCode)
    return { outcome: 'unknown', stopRun: false, name, retryAfterMs }
  } catch (e) {
    console.error('[mail] once threw', who, e)
    return { outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null }
  }
}

/**
 * Send one email. Returns true on success; never throws (logs + returns false).
 *
 * Fire-and-forget, low-volume, no caller retry — when Resend is UNAVAILABLE it falls over to SMTP so
 * sign-in / visa / KYC / payout keep flowing. ⚠️ withTimeout does not abort the Resend request, so a
 * Resend 5xx/timeout that in fact delivered, followed by the SMTP send, can duplicate — acceptable
 * here (a second magic link carries the same token; a dead sign-in does not). The BULK paths
 * (sendMailBatch, sendMailOnce) do NOT fall over — see the fallback-transport note above.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const who = maskEmail(msg.to)
  if (!resend) {
    if (smtpConfigured) return smtpSend(msg)
    console.warn('[mail] RESEND_API_KEY not set — email disabled (skipped', who + ')')
    return false
  }
  try {
    const { error } = await withTimeout(
      resend.emails.send({
        from: fromHeader(msg.fromName),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
        attachments: msg.attachments,
      }),
      RESEND_TIMEOUT_MS,
    )
    if (error) {
      // Resend unavailable (quota/rate/5xx/bad key) → fall over to SMTP. A message Resend rejects as
      // INVALID stays Resend-only — SMTP can't fix a bad message.
      if (smtpConfigured && resendUnavailable(error.name, error.statusCode)) {
        console.warn('[mail] resend unavailable — falling over to smtp', who, error.name)
        return smtpSend(msg)
      }
      console.error('[mail] send failed', who, error)
      return false
    }
    return true
  } catch (e) {
    // Timeout or network throw — prefer a possible duplicate over a lost sign-in.
    if (smtpConfigured) {
      console.warn('[mail] resend threw — falling over to smtp', who)
      return smtpSend(msg)
    }
    console.error('[mail] send threw', who, e)
    return false
  }
}
