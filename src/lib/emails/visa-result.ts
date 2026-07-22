import { renderBrandEmail, esc, EMAIL } from './layout'

// ── THE LAST THING THE CUSTOMER HEARS FROM US ─────────────────────────────────────────
//
// Owner: "auto send beautifully crafted email from no reply with pdf result and thanking
// for using service". This is the close of the whole e-Visa job — they paid, they waited,
// they were anxious about a government document. So: warm, short, and the next step is
// obvious. Two sentences of thanks, where the file is, what to do with it before they fly.
//
// ⚠️ THE BODY CARRIES TWO FIELDS AND NO MORE — the applicant's GIVEN NAME and the CASE
// REFERENCE. Not the passport number, not the date of birth, not the address, not the
// nationality, not even the email address it is being sent to (which sign-in-code.ts does
// echo, because there a typo costs an account; here the address is already proven and
// echoing it only feeds a forwarded copy). Email is not a confidential channel: it crosses
// hops at the mercy of the receiving provider, it is scanned, and it sits in an inbox — and
// in that inbox's backups — forever. The identity data lives in the ATTACHED PDF, where it
// has to be, and nowhere in the prose around it. `visa-result.test.ts` renders a full
// decrypted-payload shape and fails if any field of it reaches the output.
//
// ⚠️ NOTHING IDENTIFYING IN THE SUBJECT OR THE PREHEADER. Those two strings are what a
// lock screen shows on a phone lying face-up on a café table, and what every mail scanner
// and notification bridge logs. They carry the case reference — which means nothing without
// eno's database — and never the applicant's name. A test locks that.
//
// The renderer emits copy only. Attaching the PDF is the caller's job (`sendMail` takes
// `attachments`); this module deliberately never touches the file or the storage bucket, so
// nothing here can accidentally read a payload it has no business reading.

const { INK, MUTED, BORDER, BLUE } = EMAIL

type Lang = 'en' | 'vi'

export type VisaResultEmail = { subject: string; html: string; text: string }

const COPY = {
  en: {
    subject: (ref: string) => `Your Vietnam e-Visa is ready — ${ref}`,
    preheader: 'The PDF is attached to this email, and it is saved in your eno.vn chat too.',
    heading: 'Your e-Visa is ready',
    greeting: (name: string | null) => (name ? `Hi ${name},` : 'Hi there,'),
    thanks:
      'Thank you for trusting eno.vn with your Vietnam e-Visa. It has been approved, and your visa is attached to this email as a PDF.',
    inChat:
      'The same file is saved in your eno.vn chat, so you can download it again any time — no need to keep this email.',
    refLabel: 'Case reference',
    tip: 'Before you fly: print a copy and keep it with your passport. You will be asked for it at check-in and again at the border.',
    ctaLabel: 'Open your chat →',
    signoff: 'Safe travels, and thank you for using eno.vn.',
    noReply:
      'This mailbox is not monitored. If anything on the visa looks wrong, reply in your eno.vn chat or write to support@eno.vn with your case reference and we will pick it up.',
  },
  vi: {
    subject: (ref: string) => `Thị thực điện tử Việt Nam của bạn đã sẵn sàng — ${ref}`,
    preheader: 'Tệp PDF được đính kèm trong email này, và cũng được lưu trong cuộc trò chuyện eno.vn của bạn.',
    heading: 'Thị thực điện tử của bạn đã sẵn sàng',
    greeting: (name: string | null) => (name ? `Chào ${name},` : 'Xin chào,'),
    thanks:
      'Cảm ơn bạn đã tin tưởng eno.vn cho hồ sơ thị thực điện tử Việt Nam. Hồ sơ đã được duyệt, và thị thực của bạn được đính kèm trong email này dưới dạng PDF.',
    inChat:
      'Tệp này cũng được lưu trong cuộc trò chuyện eno.vn của bạn, nên bạn có thể tải lại bất cứ lúc nào — không cần giữ email này.',
    refLabel: 'Mã hồ sơ',
    tip: 'Trước chuyến bay: hãy in một bản và mang theo cùng hộ chiếu. Bạn sẽ được yêu cầu xuất trình khi làm thủ tục bay và tại cửa khẩu.',
    ctaLabel: 'Mở cuộc trò chuyện →',
    signoff: 'Chúc bạn thượng lộ bình an, và cảm ơn bạn đã sử dụng dịch vụ của eno.vn.',
    noReply:
      'Hộp thư này không nhận phản hồi. Nếu có điều gì chưa đúng trên thị thực, hãy nhắn trong cuộc trò chuyện eno.vn hoặc gửi email tới support@eno.vn kèm mã hồ sơ, chúng tôi sẽ xử lý ngay.',
  },
} as const

/**
 * Whitespace collapsed, invisible characters dropped, length capped. Applied to both
 * interpolated values.
 *
 * The name comes from an OCR'd passport and the reference from a database column, so
 * neither is attacker-controlled in any ordinary sense — but a stray newline would break
 * the text/plain half (where there is no `esc` to save us) and a 400-character "given name"
 * would wreck the layout. Cheap, total, and it means the only characters this module emits
 * into the body are ones a human could have read off the document.
 */
function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null
  // A code-point walk rather than a regex: a control-character class is an eslint
  // violation AND unreadable, and this way the one list of "invisible" ranges is stated
  // in plain numbers — C0, DEL/C1, the zero-width joiners a copy-pasted name drags along,
  // and the BOM. Each collapses to a space, and the space then collapses away.
  let flat = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    const invisible =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200d) || code === 0xfeff
    flat += invisible ? ' ' : ch
  }
  flat = flat.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? flat.slice(0, max).trim() : flat
}

/**
 * The thank-you email that carries the finished visa.
 *
 * `reference` is the human case number (`EV-1042`, see src/lib/visa/reference.ts). It is
 * the only handle the customer and the desk share, so it appears in the subject, the body
 * and the plain-text part — a customer searching their inbox a year later finds the case
 * by that string alone.
 */
export function renderVisaResultEmail(input: {
  givenName: string | null
  reference: string
  origin: string
  locale: Lang
}): VisaResultEmail {
  const lang: Lang = input.locale === 'vi' ? 'vi' : 'en'
  const c = COPY[lang]
  const name = clean(input.givenName, 40)
  // A blank reference would render "Case reference ·" with a hole in it; an em dash is at
  // least visibly wrong to the desk, where an empty line reads as normal.
  const reference = clean(input.reference, 32) ?? '—'
  const origin = input.origin.replace(/\/+$/, '')

  const bodyHtml = `
      <tr><td style="padding:8px 24px 0;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(c.heading)}</h1>
        <p style="margin:0;font-size:15px;color:${INK};line-height:1.6;">${esc(c.greeting(name))}</p>
        <p style="margin:10px 0 0;font-size:15px;color:${INK};line-height:1.6;">${esc(c.thanks)}</p>
        <p style="margin:10px 0 0;font-size:15px;color:${INK};line-height:1.6;">${esc(c.inChat)}</p>
      </td></tr>
      <tr><td style="padding:18px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.CANVAS};border:1px solid ${BORDER};border-radius:14px;">
          <tr><td style="padding:14px 18px;">
            <div style="font-size:12px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;">${esc(c.refLabel)}</div>
            <div style="margin-top:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:0.06em;color:${BLUE};">${esc(reference)}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 24px 0;">
        <p style="margin:0;font-size:14px;color:${INK};line-height:1.6;">${esc(c.tip)}</p>
        <p style="margin:14px 0 0;font-size:15px;font-weight:600;color:${INK};line-height:1.6;">${esc(c.signoff)}</p>
      </td></tr>
      <tr><td style="padding:14px 24px 0;">
        <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">${esc(c.noReply)}</p>
      </td></tr>`

  const html = renderBrandEmail({
    preheader: c.preheader,
    bodyHtml,
    origin,
    cta: { label: c.ctaLabel, url: `${origin}/messages` },
  })

  const text = [
    c.heading,
    '',
    c.greeting(name),
    '',
    c.thanks,
    c.inChat,
    '',
    `${c.refLabel}: ${reference}`,
    '',
    c.tip,
    '',
    c.signoff,
    '',
    `${origin}/messages`,
    '',
    c.noReply,
  ].join('\n')

  return { subject: c.subject(reference), html, text }
}
