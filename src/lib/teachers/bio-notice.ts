/**
 * THE WORDS BESIDE "IMPROVE WITH AI" (owner, 2026-10-21) — authored once here, rendered under the About text (about-step.tsx),
 * and hashed by the server into the consent record, so the record says which words the teacher acted on (PDP Law
 * 91/2025 Art 9; Decree 356/2025 Art 6) — the CV reader's pattern (import-notice.ts), whose helpers this reuses.
 *
 * ⛔ BUMP THE VERSION WHEN THE MEANING CHANGES — what is sent (bio-context.ts teacherBioRequest), to whom, where, what is
 * kept. The client echoes the version it showed; the route refuses any other (409 notice_changed). Rewording without a
 * change of meaning keeps the version; the hash still moves, so every record names its exact text.
 * ⚠️ Plain literals, no {placeholders} (machine translation mangles them; the pairs are harvested for the other UI
 * languages by scripts/gen-ui-strings.mjs). The button's words are part of the notice: the tap is the consent.
 */
import { noticeBody, type NoticeText } from '@/lib/teachers/import-notice'

// 2026-10-22 (before any deploy): the notice names "would move to", what the contact screen removes, and that a name
// written in the About text goes with it — gate review, opus.
export const TEACHER_BIO_NOTICE_VERSION = '2026-10-22'

/**
 * Under the button — the facts that decide the consent, one sentence a part. ⛔ Every kind of answer teacherBioRequest
 * sends is named here. ⚠️ Each English part stays ≤ 200 characters (gate review, opus 2026-10-22): gen-ui-strings
 * harvests authored pairs only up to that length, so one long notice reached the nine machine-translated languages
 * late, as English first — the CV reader's notice is split the same way (import-notice.ts).
 */
export const BIO_NOTICE: readonly NoticeText[] = [
  {
    en: 'Improve with AI sends your About text and these answers to Google’s Gemini AI on Google Cloud, outside Vietnam:',
    vi: 'Cải thiện bằng AI gửi phần giới thiệu và các câu trả lời sau đến AI Gemini của Google trên Google Cloud, ngoài Việt Nam:',
  },
  {
    // Every kind teacherBioRequest sends — "would move to" too (gate review, opus 2026-10-22: it was missing).
    en: 'subjects, age groups, experience, teaching jobs, degree, certificates, nationality, English level, other languages, the work you want, headline, and where you live, can teach or would move to.',
    vi: 'môn dạy, lứa tuổi học viên, kinh nghiệm, công việc giảng dạy, bằng cấp, chứng chỉ, quốc tịch, trình độ tiếng Anh, ngôn ngữ khác, loại công việc bạn tìm, tiêu đề, và nơi bạn sống, có thể dạy hoặc sẵn sàng chuyển đến.',
  },
  {
    // ⚠️ Exact, not reassuring (gate review, opus 2026-10-22): the About text goes in the teacher's own words — what the
    // screen removes is what it FINDS (bio-context.ts contactIn), and a name written in the text goes too (no name
    // stripping: it corrupts Vietnamese); the FIELDS never do.
    en: 'Your About text goes in your own words — minus sentences where we find a phone number, email, link or messenger ID — so a name you wrote in it goes too.',
    vi: 'Phần giới thiệu được gửi nguyên văn — trừ những câu chúng tôi phát hiện có số điện thoại, email, liên kết hoặc ID ứng dụng nhắn tin — nên tên bạn tự viết trong đó cũng được gửi.',
  },
  {
    en: 'Your profile’s name and phone number fields, photo, video and CV are never sent.',
    vi: 'Mục họ tên và số điện thoại trong hồ sơ, ảnh, video và CV của bạn không bao giờ được gửi.',
  },
  {
    // The CV reader's words for the same Vertex path (import-notice.ts; /privacy) — gate review, opus 2026-10-22: "keeps it
    // only if flagged" left out the brief hold to answer.
    en: 'Google doesn’t use it to train its AI. It may hold it briefly to answer, and for up to 90 days if its automated checks flag a request as misuse.',
    vi: 'Google không dùng dữ liệu này để huấn luyện AI. Google có thể giữ dữ liệu trong thời gian ngắn để trả kết quả, và tối đa 90 ngày nếu hệ thống tự động của Google đánh dấu yêu cầu là lạm dụng.',
  },
  { en: 'We keep a record that you asked, not the text.', vi: 'Chúng tôi chỉ lưu bản ghi rằng bạn đã yêu cầu, không lưu nội dung.' },
  { en: 'Check the result before you publish.', vi: 'Hãy kiểm tra kết quả trước khi đăng hồ sơ.' },
]

/** The act itself carries the agreement (Law 91 Art 9: clear and specific). */
export const BIO_ACTION_LABEL: NoticeText = { en: 'Improve with AI', vi: 'Cải thiện bằng AI' }

/** The exact text of the notice, both languages, in display order — what the consent record's hash covers. */
export const BIO_NOTICE_PARTS: readonly NoticeText[] = [BIO_ACTION_LABEL, ...BIO_NOTICE]
export const bioNoticeBody = (): string => noticeBody(BIO_NOTICE_PARTS)
