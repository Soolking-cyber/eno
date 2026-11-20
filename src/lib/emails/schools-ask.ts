import { renderBrandEmail, esc, EMAIL, senderIdentityText } from './layout'

/**
 * "Which schools have you taught at?" — the schools ask (owner, 2026-11-20, wording approved as written; Vietnamese mirrors
 * it). One email per teacher, ever (src/lib/teachers/schools-ask.ts). It names its sender and can be stopped (Decree
 * 91/2020): the footer and the text part carry the operator's legal identity, and the digest list's unsubscribe link —
 * the consent it is sent under (Profile.weeklyDigestOptIn).
 * `schools` is the directory's live count; the "no review yet" sentence is said only while it is true.
 */
export type SchoolsAskLang = 'en' | 'vi'

export function schoolsAskCopy(o: { lang: SchoolsAskLang; firstName: string | null; schools: number; reviewed: boolean; origin: string }) {
  const rate = `${o.origin}/schools`
  const hiring = `${o.origin}/schools#schools-hiring-h`
  if (o.lang === 'vi') {
    return {
      subject: 'Bạn từng dạy ở trường nào?',
      hi: o.firstName ? `Chào ${o.firstName}` : 'Chào bạn',
      lead: `eno.vn xếp hạng ${o.schools} trường và trung tâm ngoại ngữ ở TP.HCM theo những gì giáo viên nói.`,
      first: o.reviewed ? null : 'Chưa trường nào có đánh giá, nên đánh giá của bạn sẽ nằm trong những đánh giá đầu tiên.',
      rateLabel: 'Chấm điểm trường bạn từng dạy',
      hiringLine: 'Bạn cũng có thể xem trường nào đang tuyển và ứng tuyển trên eno.',
      hiringLabel: 'Xem trường đang tuyển',
      chatHiring: 'Xem trường nào đang tuyển',
      rate,
      hiring,
      unsubscribe: 'Ngừng nhận email này',
      because: 'Bạn nhận email này vì bạn có hồ sơ giáo viên trên eno.vn và đang nhận email từ eno.',
    }
  }
  return {
    subject: 'Which schools have you taught at?',
    hi: o.firstName ? `Hi ${o.firstName}` : 'Hi',
    lead: `eno.vn ranks ${o.schools} schools and language centres in Ho Chi Minh City by what teachers say.`,
    first: o.reviewed ? null : 'None has a review yet, so yours would be among the first.',
    rateLabel: "Rate a school you've worked at",
    hiringLine: 'You can also see which schools are hiring now, and apply on eno.',
    hiringLabel: "See who's hiring",
    chatHiring: "See who's hiring now",
    rate,
    hiring,
    unsubscribe: 'Stop these emails',
    because: "You're receiving this because you have a teacher profile on eno.vn and get emails from eno.",
  }
}

/** The chat message: the same two lines and links, shorter (owner, 2026-11-20). */
export function schoolsAskChatText(c: ReturnType<typeof schoolsAskCopy>): string {
  return [`${c.hi} — ${c.lead}${c.first ? ` ${c.first}` : ''}`, `${c.rateLabel}: ${c.rate}`, `${c.chatHiring}: ${c.hiring}`].join('\n')
}

export function renderSchoolsAsk(c: ReturnType<typeof schoolsAskCopy>, o: { origin: string; unsubscribeUrl: string }): { subject: string; html: string; text: string } {
  const p = (s: string, style = `margin:8px 0 0;font-size:14px;color:${EMAIL.INK};line-height:1.55;`) => `<p style="${style}">${s}</p>`
  const link = (label: string, url: string) => `<p style="margin:10px 0 0;font-size:14px;"><a href="${esc(url)}" style="color:${EMAIL.BLUE};font-weight:600;">${esc(label)} →</a></p>`
  const bodyHtml = `
      <tr><td style="padding:4px 24px 16px;">
        ${p(`${esc(c.hi)} — ${esc(c.lead)}${c.first ? ` ${esc(c.first)}` : ''}`, `margin:12px 0 0;font-size:15px;color:${EMAIL.INK};line-height:1.55;`)}
        ${link(c.rateLabel, c.rate)}
        ${p(esc(c.hiringLine), `margin:14px 0 0;font-size:14px;color:${EMAIL.MUTED};line-height:1.55;`)}
        ${link(c.hiringLabel, c.hiring)}
      </td></tr>`
  const html = renderBrandEmail({ preheader: c.lead, bodyHtml, origin: o.origin, audienceNote: c.because, unsubscribeUrl: o.unsubscribeUrl, sender: 'full' })
  const text = [
    `${c.hi} — ${c.lead}${c.first ? ` ${c.first}` : ''}`, '',
    `${c.rateLabel}: ${c.rate}`, '',
    c.hiringLine,
    `${c.hiringLabel}: ${c.hiring}`, '',
    `${c.unsubscribe}: ${o.unsubscribeUrl}`, '',
    c.because,
    `Sent by ${senderIdentityText()}`,
  ].join('\n')
  return { subject: c.subject, html, text }
}
