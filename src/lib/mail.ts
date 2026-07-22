import { Resend } from 'resend'

// One Resend client per process. If RESEND_API_KEY is unset — local/dev, or in prod
// BEFORE the key is uploaded — sending is a NO-OP that logs, so the digest cron still
// runs end-to-end and just doesn't deliver. Same env-gated guard as push.ts / VAPID.
const KEY = process.env.RESEND_API_KEY
// Must be a domain verified in Resend (eno.vn). Override via MAIL_FROM env.
const FROM = process.env.MAIL_FROM || 'eno.vn <no-reply@eno.vn>'
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

/** Send one email. Returns true on success; never throws (logs + returns false). */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const who = maskEmail(msg.to)
  if (!resend) {
    console.warn('[mail] RESEND_API_KEY not set — email disabled (skipped', who + ')')
    return false
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM,
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
