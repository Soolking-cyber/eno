import { renderBrandEmail, esc, EMAIL } from './layout'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/**
 * ⛔ THE DAY THE TEACHER DM LADDER TOOK EFFECT — pinned here, never read from /privacy's live date (gate review,
 * 2026-10-13): a later amendment re-dates PRIVACY_TEXT_PUBLISHED, and a late run would then print that day. If the
 * deploy carrying the ladder slips past it, re-date it WITH PRIVACY_TEXT_PUBLISHED — privacy-updated.ts says so, as it
 * does for TIKTOK_NAMED_FROM_S. The cron refuses to run 14 days after it, and addresses only teachers who agreed to an
 * older publish notice.
 */
export const TEACHER_DM_NOTICE_DAY = '2026-10-13'
const [Y, M, D] = TEACHER_DM_NOTICE_DAY.split('-').map(Number)
export const NOTICE_SINCE = { en: `${D} ${MONTHS[M - 1]} ${Y}`, vi: `${String(D).padStart(2, '0')}/${String(M).padStart(2, '0')}/${Y}` } as const

/**
 * THE ONE-OFF NOTICE TO LIVE TEACHERS (owner, 2026-10-13 — "Notify + privacy"): who can message them changed. Every
 * signed-in account may now start a chat (the teacher DM ladder, src/lib/teachers/dm-quota.ts), not only schools and
 * companies; their phone, email, CV and private video are still shared only on their own tap. Sent once per teacher by
 * /api/cron/teacher-dm-ladder-notice, with the in-app notice beside it. A SERVICE NOTICE about how their profile works —
 * the /privacy change it reports (2026-10-13) — so no unsubscribe link, and nothing promotional. It says how to hide the
 * profile: these teachers published under the old rule (gate review, 2026-10-13). Dated, never "from
 * today": the in-app notice is read days later (gate review, 2026-10-13). In the teacher's language, the email too.
 */
export const TEACHER_DM_NOTICE = {
  title: {
    en: 'A change to who can message teachers',
    vi: 'Thay đổi về người có thể nhắn tin cho giáo viên',
  },
  body: {
    en: `From ${NOTICE_SINCE.en}, any signed-in account can message teachers — not only schools and companies. Each account can start chats with a limited number of new teachers a day, a number that rises once it verifies its identity or its business, and can send at most two messages until you reply. Your phone, email, CV and private video are still shared only when you tap Share in a chat, and each chat shows whether the account writing to you is verified. You can hide your profile at any time from “Teacher profile” in your account. Our privacy policy has the details.`,
    vi: `Từ ngày ${NOTICE_SINCE.vi}, mọi tài khoản đã đăng nhập đều có thể nhắn tin cho giáo viên — không chỉ trường học và công ty. Mỗi tài khoản chỉ được bắt đầu trò chuyện với một số giáo viên mới nhất định mỗi ngày, con số này tăng lên khi tài khoản xác minh danh tính hoặc doanh nghiệp, và chỉ được gửi tối đa hai tin nhắn cho đến khi bạn trả lời. Số điện thoại, email, CV và video riêng tư của bạn vẫn chỉ được chia sẻ khi bạn bấm Chia sẻ trong cuộc trò chuyện, và mỗi cuộc trò chuyện cho biết tài khoản đang nhắn tin cho bạn đã xác minh hay chưa. Bạn có thể ẩn hồ sơ bất cứ lúc nào tại mục “Hồ sơ giáo viên” trong tài khoản. Chính sách quyền riêng tư có thông tin chi tiết.`,
  },
} as const

export function renderTeacherDmLadderNotice(opts: { origin: string; siteName: string; recipientName?: string | null; locale?: 'en' | 'vi' }): { subject: string; html: string; text: string } {
  const { origin, siteName, recipientName } = opts
  // In the teacher's own language (gate review, 2026-10-13): this one is a notice of a privacy change, not a reminder.
  const vi = opts.locale === 'vi'
  const subject = vi ? `Thay đổi về người có thể nhắn tin cho bạn trên ${siteName}` : `A change to who can message you on ${siteName}`
  const hello = recipientName ? (vi ? `Chào ${recipientName},` : `Hi ${recipientName},`) : (vi ? 'Chào bạn,' : 'Hi,')
  const lines = vi ? [
    `Từ ngày ${NOTICE_SINCE.vi}, mọi tài khoản đã đăng nhập trên ${siteName} đều có thể nhắn tin cho bạn về hồ sơ giáo viên — không chỉ trường học và công ty.`,
    'Để công bằng, mỗi tài khoản chỉ được bắt đầu trò chuyện với một số giáo viên mới nhất định mỗi ngày — con số này tăng lên khi tài khoản xác minh danh tính hoặc doanh nghiệp — và người nhắn tin cho bạn chỉ được gửi tối đa hai tin nhắn cho đến khi bạn trả lời.',
    'Số điện thoại, email, CV và video giới thiệu riêng tư của bạn vẫn chỉ được chia sẻ khi bạn bấm Chia sẻ trong cuộc trò chuyện, và mỗi cuộc trò chuyện giờ đây cho bạn biết tài khoản đang nhắn tin cho bạn đã xác minh danh tính hay là doanh nghiệp đã xác minh.',
    'Bạn có thể ẩn hồ sơ bất cứ lúc nào tại mục “Hồ sơ giáo viên” trong tài khoản.',
    'Chính sách quyền riêng tư có thông tin chi tiết.',
  ] : [
    `From ${NOTICE_SINCE.en}, any signed-in account on ${siteName} can message you about your teacher profile — not only schools and companies.`,
    'To keep this fair, each account can start chats with a limited number of new teachers a day — a number that rises once it verifies its identity or its business — and anyone who writes to you can send at most two messages until you reply.',
    'Your phone, email, CV and private intro video are still shared only when you tap Share in a chat, and each chat now shows you whether the account writing to you has verified its identity or is a verified business.',
    'You can hide your profile at any time from “Teacher profile” in your account.',
    'Our privacy policy has the details.',
  ]
  const E = EMAIL
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${E.INK};">${esc(s)}</p>`
  // ⚠️ bodyHtml is the card's CONTENT ROWS (layout.ts): bare paragraphs between its <tr>s are hoisted out of the table by
  // every HTML parser, above the white card (pre-review, 2026-10-13) — so one row, as teacher-messages.ts does.
  const html = renderBrandEmail({
    preheader: lines[0],
    bodyHtml: `<tr><td style="padding:4px 24px 8px;">${p(hello)}${lines.map(p).join('')}</td></tr>`,
    origin,
    cta: { label: vi ? 'Đọc chính sách quyền riêng tư' : 'Read the privacy policy', url: `${origin}/privacy` },
    audienceNote: vi ? `Bạn nhận được email này vì bạn có hồ sơ giáo viên trên ${siteName}.` : `You’re receiving this because you have a teacher profile on ${siteName}.`,
    sender: 'full',
  })
  const text = [hello, '', ...lines, '', `${origin}/privacy`].join('\n')
  return { subject, html, text }
}
