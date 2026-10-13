// The one-off in-app notice to teachers about the DM ladder (owner, 2026-10-13 — "Notify + privacy", then "no email only
// notif"): sent once per teacher by /api/cron/teacher-dm-ladder-notice, as a 'system' notification in their language.
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
 * Who can message a teacher changed: every signed-in account may now start a chat (the teacher DM ladder,
 * src/lib/teachers/dm-quota.ts), not only schools and companies; their phone, email, CV and private video are still
 * shared only on their own tap. A SERVICE NOTICE about how their profile works — the /privacy change it reports — so
 * nothing promotional. It says how to hide the profile: these teachers published under the old rule (gate review,
 * 2026-10-13). Dated, never "from today": a notice is read days later.
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
