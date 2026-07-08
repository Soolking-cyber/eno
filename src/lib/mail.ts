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

export type MailMessage = {
  to: string
  subject: string
  html: string
  text?: string
  /** Extra SMTP headers, e.g. List-Unsubscribe / List-Unsubscribe-Post. */
  headers?: Record<string, string>
}

/** Send one email. Returns true on success; never throws (logs + returns false). */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  if (!resend) {
    console.warn('[mail] RESEND_API_KEY not set — email disabled (skipped', msg.to + ')')
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
    })
    if (error) {
      console.error('[mail] send failed', msg.to, error)
      return false
    }
    return true
  } catch (e) {
    console.error('[mail] send threw', msg.to, e)
    return false
  }
}
