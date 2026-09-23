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

/**
 * ⛔ NO SITE NAME OR ADDRESS IS TYPED INTO THIS COPY — both arrive as `site` / `support`.
 *
 * Every line below used to say "eno.vn" and "support@eno.vn". Its one caller is
 * src/lib/visa/result.ts, behind `.svc.` routes — compiled into the services edition, and ALSO into
 * the marketplace build that hosts the partner-run visa desk (MARKETPLACE_HOSTS_SERVICES,
 * infra/vn-node/eno-build.sh). So the words cannot be fixed to either site: the eno.forum mail that
 * handed a customer their finished visa thanked them "for trusting eno.vn" and told them to write to
 * eno.vn's inbox — the LICENSED marketplace named in writing as the provider of a service it does
 * not offer. Same pattern as business-verification.ts: the caller passes SITE_NAME and
 * COMPANY.email, so the words follow the build that sends them.
 */
const COPY = {
  en: {
    subject: (ref: string) => `Your Vietnam e-Visa is ready — ${ref}`,
    preheader: (site: string) => `The PDF is attached to this email, and it is saved in your ${site} chat too.`,
    heading: 'Your e-Visa is ready',
    greeting: (name: string | null) => (name ? `Hi ${name},` : 'Hi there,'),
    thanks: (site: string) =>
      `Thank you for trusting ${site} with your Vietnam e-Visa. It has been approved, and your visa is attached to this email as a PDF.`,
    inChat: (site: string) =>
      `The same file is saved in your ${site} chat, so you can download it again any time — no need to keep this email.`,
    refLabel: 'Case reference',
    tip: 'Before you fly: print a copy and keep it with your passport. You will be asked for it at check-in and again at the border.',
    ctaLabel: 'Open your chat →',
    signoff: (site: string) => `Safe travels, and thank you for using ${site}.`,
    // ⚠️ REPLIES ARE READ. This mail goes out as class `transactional`, so the eno-mailer Worker
    // sets Reply-To to this edition's support inbox (infra/cloudflare/eno-mailer.js) — the copy
    // must not tell the applicant their reply goes nowhere.
    contact: (site: string, support: string) =>
      `If anything on the visa looks wrong, just reply to this email — it reaches our support team — or write in your ${site} chat or to ${support}. Include your case reference and we will pick it up.`,
    // ── link-only delivery: the PDF was too large to attach (see renderVisaResultEmail) ──
    linkPreheader: (site: string) => `Your e-Visa PDF is waiting in your ${site} chat.`,
    linkThanks: (site: string) =>
      `Thank you for trusting ${site} with your Vietnam e-Visa. It has been approved, and your visa is ready to download as a PDF.`,
    linkInChat: (site: string) =>
      `The file is too large to attach to an email, so it is waiting for you in your ${site} chat. Open the chat to download it — it stays there, so you can download it again any time.`,
    linkCtaLabel: 'Open your chat to download it →',
  },
  vi: {
    subject: (ref: string) => `Thị thực điện tử Việt Nam của bạn đã sẵn sàng — ${ref}`,
    preheader: (site: string) => `Tệp PDF được đính kèm trong email này, và cũng được lưu trong cuộc trò chuyện ${site} của bạn.`,
    heading: 'Thị thực điện tử của bạn đã sẵn sàng',
    greeting: (name: string | null) => (name ? `Chào ${name},` : 'Xin chào,'),
    thanks: (site: string) =>
      `Cảm ơn bạn đã tin tưởng ${site} cho hồ sơ thị thực điện tử Việt Nam. Hồ sơ đã được duyệt, và thị thực của bạn được đính kèm trong email này dưới dạng PDF.`,
    inChat: (site: string) =>
      `Tệp này cũng được lưu trong cuộc trò chuyện ${site} của bạn, nên bạn có thể tải lại bất cứ lúc nào — không cần giữ email này.`,
    refLabel: 'Mã hồ sơ',
    tip: 'Trước chuyến bay: hãy in một bản và mang theo cùng hộ chiếu. Bạn sẽ được yêu cầu xuất trình khi làm thủ tục bay và tại cửa khẩu.',
    ctaLabel: 'Mở cuộc trò chuyện →',
    signoff: (site: string) => `Chúc bạn thượng lộ bình an, và cảm ơn bạn đã sử dụng dịch vụ của ${site}.`,
    contact: (site: string, support: string) =>
      `Nếu có điều gì chưa đúng trên thị thực, bạn chỉ cần trả lời email này — thư sẽ đến đội hỗ trợ của chúng tôi — hoặc nhắn trong cuộc trò chuyện ${site}, hoặc gửi email tới ${support}. Vui lòng kèm mã hồ sơ, chúng tôi sẽ xử lý ngay.`,
    linkPreheader: (site: string) => `Tệp PDF thị thực điện tử của bạn đang chờ trong cuộc trò chuyện ${site}.`,
    linkThanks: (site: string) =>
      `Cảm ơn bạn đã tin tưởng ${site} cho hồ sơ thị thực điện tử Việt Nam. Hồ sơ đã được duyệt, và thị thực của bạn đã sẵn sàng để tải về dưới dạng PDF.`,
    linkInChat: (site: string) =>
      `Tệp quá lớn để đính kèm vào email, nên thị thực đang chờ bạn trong cuộc trò chuyện ${site}. Hãy mở cuộc trò chuyện để tải về — tệp luôn được lưu ở đó, bạn có thể tải lại bất cứ lúc nào.`,
    linkCtaLabel: 'Mở cuộc trò chuyện để tải về →',
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
 *
 * ⚠️ TWO DELIVERIES, ONE EMAIL. `delivery: 'attached'` (the default) is the email the owner asked
 * for, with the PDF attached. `delivery: 'link'` exists because Cloudflare Email Sending caps a
 * whole message at 5 MiB while a result PDF may be up to 10 MiB: the copy then says the file is in
 * the chat and the call to action goes to `chatUrl` — the case's own thread when the caller can
 * resolve it. It must never claim an attachment that is not there.
 */
export function renderVisaResultEmail(input: {
  givenName: string | null
  reference: string
  origin: string
  locale: Lang
  /** This build's own name — pass SITE_NAME. Never typed into the copy (see COPY above). */
  siteName: string
  /** This build's support inbox — pass COMPANY.email, never a literal. */
  supportEmail: string
  /** 'attached' (default): the PDF rides along. 'link': it does not — see above. */
  delivery?: 'attached' | 'link'
  /** ABSOLUTE url of the applicant's chat holding the result. Defaults to `${origin}/messages`. */
  chatUrl?: string
}): VisaResultEmail {
  const lang: Lang = input.locale === 'vi' ? 'vi' : 'en'
  const c = COPY[lang]
  const site = input.siteName
  const support = input.supportEmail
  const linkOnly = input.delivery === 'link'
  const thanks = linkOnly ? c.linkThanks(site) : c.thanks(site)
  const inChat = linkOnly ? c.linkInChat(site) : c.inChat(site)
  const signoff = c.signoff(site)
  const contact = c.contact(site, support)
  const name = clean(input.givenName, 40)
  // A blank reference would render "Case reference ·" with a hole in it; an em dash is at
  // least visibly wrong to the desk, where an empty line reads as normal.
  const reference = clean(input.reference, 32) ?? '—'
  const origin = input.origin.replace(/\/+$/, '')
  // Only an absolute http(s) url on THIS origin is accepted; anything else falls back to the
  // inbox list, so a caller mistake can never put a foreign link in front of an applicant.
  const chatUrl = input.chatUrl && input.chatUrl.startsWith(`${origin}/`) ? input.chatUrl : `${origin}/messages`

  const bodyHtml = `
      <tr><td style="padding:8px 24px 0;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(c.heading)}</h1>
        <p style="margin:0;font-size:15px;color:${INK};line-height:1.6;">${esc(c.greeting(name))}</p>
        <p style="margin:10px 0 0;font-size:15px;color:${INK};line-height:1.6;">${esc(thanks)}</p>
        <p style="margin:10px 0 0;font-size:15px;color:${INK};line-height:1.6;">${esc(inChat)}</p>
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
        <p style="margin:14px 0 0;font-size:15px;font-weight:600;color:${INK};line-height:1.6;">${esc(signoff)}</p>
      </td></tr>
      <tr><td style="padding:14px 24px 0;">
        <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">${esc(contact)}</p>
      </td></tr>`

  const html = renderBrandEmail({
    preheader: linkOnly ? c.linkPreheader(site) : c.preheader(site),
    bodyHtml,
    origin,
    cta: { label: linkOnly ? c.linkCtaLabel : c.ctaLabel, url: chatUrl },
  })

  const text = [
    c.heading,
    '',
    c.greeting(name),
    '',
    thanks,
    inChat,
    '',
    `${c.refLabel}: ${reference}`,
    '',
    c.tip,
    '',
    signoff,
    '',
    chatUrl,
    '',
    contact,
  ].join('\n')

  return { subject: c.subject(reference), html, text }
}
