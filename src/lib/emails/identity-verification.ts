import { renderBrandEmail, esc, EMAIL } from './layout'

const { INK, MUTED, BORDER, BLUE } = EMAIL

type Lang = 'en' | 'vi'

/**
 * The machine reasons a case can be refused AT REVIEW — `reviewKycCase` re-runs `decideTierB` when
 * an admin approves, and a passport that slipped inside the six-month floor between submission and
 * review comes back rejected with one of these rather than the reviewer's own words. `manual` is
 * the reviewer's decision and carries their note instead.
 */
export type IdentityRejectReason = 'manual' | 'expired' | 'document_expires_soon' | 'document_expiry_unreadable' | string

export type IdentityOutcomeEmail = { subject: string; html: string; text: string }

const COPY = {
  en: {
    approvedSubject: (site: string) => `Your identity is verified on ${site}`,
    rejectedSubject: 'Your identity verification was not accepted',
    approvedPre: 'Your identity is confirmed.',
    rejectedPre: 'A reviewer looked at your documents and could not accept them.',
    approvedHeading: 'You are verified',
    rejectedHeading: 'We could not accept your documents',
    approvedBody:
      'A person on our team reviewed your document and selfie and confirmed them. You will not be asked to do this again unless your document expires or is replaced.',
    rejectedBody: 'A person on our team reviewed your document and selfie and could not accept them',
    reasons: {
      expired: 'The document had expired by the time it was reviewed.',
      document_expires_soon: 'A passport must be valid for at least six more months, and yours was inside that window when it was reviewed.',
      document_expiry_unreadable: 'We could not read the expiry date on the document.',
    } as Record<string, string>,
    rejectedNext: {
      B: 'You can try again with a different document, or the same one photographed more clearly — sharp, flat, no glare on the two code lines at the bottom of the page.',
      A: 'You can try again with a clearer photograph of your CCCD — the side with your photo, sharp, all four corners inside the frame.',
    } as Record<'A' | 'B', string>,
    // ⚠️ AN EXPIRY REFUSAL IS NOT A PHOTOGRAPHY PROBLEM. Telling someone whose passport is inside
    // the six-month window to "photograph it more clearly" contradicts the sentence above it.
    renewNext: {
      B: 'You will need a passport that is valid for at least six more months — renew it, or use a different document — and then verify again.',
      A: 'Your CCCD had expired — renew your CCCD and then verify again.',
    } as Record<'A' | 'B', string>,
    // ⚠️ A REVIEWER'S NOTE IS FOLLOWED BY NOTHING THAT COULD CONTRADICT IT. "Name differs from the
    // account" must not be chased by "photograph it more clearly".
    afterNote: 'Once you have addressed this, you can verify again from your dashboard.',
    cta: 'Open verification',
    signoff: (site: string) => `Thanks for selling on ${site}.`,
  },
  vi: {
    approvedSubject: (site: string) => `Danh tính của bạn đã được xác minh trên ${site}`,
    rejectedSubject: 'Hồ sơ xác minh danh tính chưa được chấp nhận',
    approvedPre: 'Danh tính của bạn đã được xác nhận.',
    rejectedPre: 'Nhân viên đã xem giấy tờ của bạn nhưng chưa thể chấp nhận.',
    approvedHeading: 'Bạn đã được xác minh',
    rejectedHeading: 'Chúng tôi chưa thể chấp nhận giấy tờ của bạn',
    approvedBody:
      'Nhân viên của chúng tôi đã xem giấy tờ và ảnh chân dung của bạn và xác nhận hợp lệ. Bạn sẽ không phải làm lại trừ khi giấy tờ hết hạn hoặc được thay mới.',
    rejectedBody: 'Nhân viên của chúng tôi đã xem giấy tờ và ảnh chân dung của bạn nhưng chưa thể chấp nhận',
    reasons: {
      expired: 'Giấy tờ đã hết hạn tại thời điểm xét duyệt.',
      document_expires_soon: 'Hộ chiếu phải còn hiệu lực ít nhất sáu tháng nữa, và hộ chiếu của bạn đã nằm trong khoảng đó khi được xét duyệt.',
      document_expiry_unreadable: 'Chúng tôi không đọc được ngày hết hạn trên giấy tờ.',
    } as Record<string, string>,
    rejectedNext: {
      B: 'Bạn có thể thử lại với giấy tờ khác, hoặc chụp lại giấy tờ này rõ hơn — nét, phẳng, không loá sáng ở hai dòng mã cuối trang.',
      A: 'Bạn có thể thử lại với ảnh CCCD rõ hơn — mặt có ảnh của bạn, nét, cả bốn góc thẻ nằm trong khung.',
    } as Record<'A' | 'B', string>,
    renewNext: {
      B: 'Bạn cần hộ chiếu còn hiệu lực ít nhất sáu tháng nữa — hãy gia hạn, hoặc dùng giấy tờ khác — rồi xác minh lại.',
      A: 'Thẻ CCCD của bạn đã hết hạn — hãy gia hạn CCCD rồi xác minh lại.',
    } as Record<'A' | 'B', string>,
    afterNote: 'Sau khi xử lý xong, bạn có thể xác minh lại từ bảng điều khiển.',
    cta: 'Mở phần xác minh',
    signoff: (site: string) => `Cảm ơn bạn đã bán hàng trên ${site}.`,
  },
} as const

/**
 * What a rejection means, in the seller's words: the reviewer's note when there is one, the machine
 * sentence for a reason that has one, and nothing (the caller renders only the heading) otherwise.
 * ⚠️ THE NOTE IS AN OPERATOR'S FREE TEXT and is rendered escaped, never as HTML.
 */
export function identityRejectionSentence(lang: Lang, reason: IdentityRejectReason | null, note: string | null): string | null {
  const n = (note ?? '').trim()
  if (n) return n
  if (reason && COPY[lang].reasons[reason]) return COPY[lang].reasons[reason]
  return null
}

export function renderIdentityOutcomeEmail(opts: {
  outcome: 'approved' | 'rejected'
  reason: IdentityRejectReason | null
  note: string | null
  /** 'A' = CCCD, 'B' = passport — the retry advice differs (a CCCD has no code lines). */
  tier: 'A' | 'B'
  lang: Lang
  origin: string
  siteName: string
}): IdentityOutcomeEmail {
  const c = COPY[opts.lang]
  const approved = opts.outcome === 'approved'
  const url = `${opts.origin}/dashboard/verification`
  const why = approved ? null : identityRejectionSentence(opts.lang, opts.reason, opts.note)
  // ⚠️ THE COLON EXISTS ONLY WHEN SOMETHING FOLLOWS IT. A refusal with neither note nor known
  // reason ends the sentence with a full stop, not a colon into nothing.
  const body = approved ? c.approvedBody : `${c.rejectedBody}${why ? ':' : '.'}`
  const expiryRefusal = opts.reason === 'expired' || opts.reason === 'document_expires_soon'
  const hasNote = !!(opts.note ?? '').trim()
  // A note wins outright: whatever the reviewer wrote is the instruction, and nothing follows it
  // that could contradict it. Without one, an expiry reason says renew; anything else, retake.
  const next = hasNote ? c.afterNote : expiryRefusal ? c.renewNext[opts.tier] : c.rejectedNext[opts.tier]
  const whyHtml = why
    ? `<p style="margin:0 0 16px;padding:12px 14px;border:1px solid ${BORDER};border-radius:10px;color:${INK};font-size:15px;line-height:1.55">${esc(why)}</p>`
    : ''
  const bodyHtml = `
    <h1 style="margin:0 0 12px;color:${INK};font-size:22px;line-height:1.3">${esc(approved ? c.approvedHeading : c.rejectedHeading)}</h1>
    <p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6">${esc(body)}</p>
    ${whyHtml}
    ${approved ? '' : `<p style="margin:0 0 20px;color:${INK};font-size:15px;line-height:1.6">${esc(next)}</p>`}
    <p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:11px 18px;border-radius:10px">${esc(c.cta)}</a></p>
    <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6">${esc(c.signoff(opts.siteName))}</p>
  `
  const text = [
    approved ? c.approvedHeading : c.rejectedHeading,
    '',
    body,
    ...(why ? ['', why] : []),
    ...(approved ? [] : ['', next]),
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
