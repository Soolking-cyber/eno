import { Resend } from 'resend'

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

/** Send one email. Returns true on success; never throws (logs + returns false). */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const who = maskEmail(msg.to)
  if (!resend) {
    console.warn('[mail] RESEND_API_KEY not set — email disabled (skipped', who + ')')
    return false
  }
  try {
    const { error } = await resend.emails.send({
      from: fromHeader(msg.fromName),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.headers,
      attachments: msg.attachments,
    })
    if (error) {
      console.error('[mail] send failed', who, error)
      return false
    }
    return true
  } catch (e) {
    console.error('[mail] send threw', who, e)
    return false
  }
}
