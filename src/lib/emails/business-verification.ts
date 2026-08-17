import { renderBrandEmail, esc, EMAIL } from './layout'

// ── THE ANSWER TO A DOCUMENT SUBMISSION ────────────────────────────────────────────────
//
// Owner, 2026-08-17: "when business registration documents sent and rejected or approved
// seller doesnt get noticification fix it".
//
// A seller uploads a business licence and a bank document, ticks a PDPL consent, and waits.
// Before this, the outcome was written to the database and NOWHERE ELSE: the panel showed it
// the next time they happened to open Settings, and nothing told them to. A rejection is the
// worse half — it asks them to DO something ("a specialist asked for a change: tax code") and
// they cannot act on a message they never receive.
//
// ⚠️ EMAIL, NOT ONLY THE BELL, AND THAT IS THE POINT OF THIS FILE. A verification review takes
// as long as it takes; the seller is not sitting on the site waiting. An in-app notification
// reaches someone who comes back — this reaches someone who does not.
//
// ⚠️ NOTHING IDENTIFYING IN THE SUBJECT OR THE PREHEADER, the same rule visa-result.ts states
// and for the same reason: those two strings are what a lock screen shows and what every mail
// scanner logs. "Your business verification" says what happened without naming the business,
// the tax code, or the documents.
//
// ⚠️ THE REJECTION NOTE IS THE OPERATOR'S OWN WORDS AND IS ESCAPED, NEVER TRUSTED. It is typed
// into an admin textarea and lands in HTML; `esc` is what stops a note containing a tag from
// becoming markup in the seller's inbox.

const { INK, MUTED, BORDER, BLUE } = EMAIL

type Lang = 'en' | 'vi'

export type VerificationOutcomeEmail = { subject: string; html: string; text: string }

const COPY = {
  en: {
    approvedSubject: (site: string) => `Your business is verified on ${site}`,
    rejectedSubject: 'Your business verification needs one change',
    approvedPre: 'The verified badge is live on your storefront.',
    rejectedPre: 'A specialist reviewed your documents and asked for one change.',
    approvedHeading: 'You are verified',
    rejectedHeading: 'One change is needed',
    approvedBody:
      'A specialist reviewed your documents and confirmed them. The verified badge is now showing on your storefront and on every listing you post.',
    rejectedBody: 'A specialist reviewed your documents and asked for a change before they can be confirmed:',
    rejectedNext:
      'Open your settings, make the change and submit again. Your documents are still there — you only need to fix what is listed above.',
    cta: 'Open verification settings',
    signoff: (site: string) => `Thanks for selling on ${site}.`,
  },
  vi: {
    approvedSubject: (site: string) => `Doanh nghiệp của bạn đã được xác minh trên ${site}`,
    rejectedSubject: 'Xác minh doanh nghiệp cần chỉnh sửa một điểm',
    approvedPre: 'Huy hiệu đã xác minh đang hiển thị trên gian hàng của bạn.',
    rejectedPre: 'Chuyên viên đã xem xét giấy tờ và yêu cầu chỉnh sửa một điểm.',
    approvedHeading: 'Bạn đã được xác minh',
    rejectedHeading: 'Cần chỉnh sửa một điểm',
    approvedBody:
      'Chuyên viên đã xem xét và xác nhận giấy tờ của bạn. Huy hiệu đã xác minh hiện hiển thị trên gian hàng và trên mọi tin bạn đăng.',
    rejectedBody: 'Chuyên viên đã xem xét giấy tờ và yêu cầu chỉnh sửa trước khi có thể xác nhận:',
    rejectedNext:
      'Mở phần cài đặt, chỉnh sửa và gửi lại. Giấy tờ của bạn vẫn được lưu — bạn chỉ cần sửa nội dung nêu trên.',
    cta: 'Mở cài đặt xác minh',
    signoff: (site: string) => `Cảm ơn bạn đã bán hàng trên ${site}.`,
  },
} as const

/**
 * Render the approval / rejection email.
 *
 * `note` is only read for the rejected case and is the operator's free text; it is escaped
 * here rather than at the call site so no caller can forget.
 */
export function renderVerificationOutcomeEmail(opts: {
  outcome: 'approved' | 'rejected'
  note: string | null
  lang: Lang
  origin: string
  /**
   * ⚠️ THE SITE NAME IS PASSED IN, NEVER TYPED INTO THE COPY. One codebase is deployed twice, so a
   * literal "eno.vn" in a subject line reaches eno.forum sellers and tells them the wrong site
   * verified them — the same class of bug as the handle host, fixed the same day. Reviewer-caught.
   */
  siteName: string
}): VerificationOutcomeEmail {
  const c = COPY[opts.lang]
  const approved = opts.outcome === 'approved'
  const url = `${opts.origin}/dashboard/settings`

  const noteHtml =
    !approved && opts.note
      ? `<p style="margin:0 0 16px;padding:12px 14px;border:1px solid ${BORDER};border-radius:10px;color:${INK};font-size:15px;line-height:1.55">${esc(opts.note)}</p>`
      : ''

  const bodyHtml = `
    <h1 style="margin:0 0 12px;color:${INK};font-size:22px;line-height:1.3">${esc(approved ? c.approvedHeading : c.rejectedHeading)}</h1>
    <p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6">${esc(approved ? c.approvedBody : c.rejectedBody)}</p>
    ${noteHtml}
    ${approved ? '' : `<p style="margin:0 0 20px;color:${INK};font-size:15px;line-height:1.6">${esc(c.rejectedNext)}</p>`}
    <p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:11px 18px;border-radius:10px">${esc(c.cta)}</a></p>
    <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6">${esc(c.signoff(opts.siteName))}</p>
  `

  const text = [
    approved ? c.approvedHeading : c.rejectedHeading,
    '',
    approved ? c.approvedBody : c.rejectedBody,
    ...(!approved && opts.note ? ['', opts.note] : []),
    ...(approved ? [] : ['', c.rejectedNext]),
    '',
    url,
    '',
    c.signoff(opts.siteName),
  ].join('\n')

  return {
    subject: approved ? c.approvedSubject(opts.siteName) : c.rejectedSubject,
    html: renderBrandEmail({ preheader: approved ? c.approvedPre : c.rejectedPre, bodyHtml, origin: opts.origin }),
    text,
  }
}
