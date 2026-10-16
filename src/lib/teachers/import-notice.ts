/**
 * THE WORDS BESIDE "READ MY CV" (owner, 2026-10-15) — authored once here, rendered by the teacher form, and hashed by the
 * server into the consent record, so the record says which words the teacher acted on (PDP Law 91/2025 Art 9; Decree
 * 356/2025 Art 6). (Sign in with LinkedIn and its notice were removed on 2026-10-16, never having been switched on; its
 * text is in git history.)
 *
 * ⛔ BUMP THE VERSION WHEN THE MEANING CHANGES — who reads the file, where, what is kept, for how long. The client echoes
 * the version it showed; the import route refuses any other (409 notice_changed), as the publish notice does
 * (profile.ts PUBLISH_NOTICE_VERSION). Rewording without a change of meaning keeps the version; the hash still moves,
 * so every record names its exact text.
 * ⚠️ Plain literals, no {placeholders}: machine translation mangles named placeholders, and the pairs are harvested for
 * the other UI languages (scripts/gen-ui-strings.mjs). The operator's name is rendered beside them, never inside.
 */

export type NoticeText = { readonly en: string; readonly vi: string }

/**
 * '2026-10-16' was the reader as first deployed (the file never kept; the phone only offered). '2026-10-16b' (owner,
 * 2026-10-16: "the cv info like number and cv itself stays as default they dont have to click again") says what the
 * reading now does with them: the phone is filled into an empty field, and a PDF is attached as the private CV. A distinct
 * string, never the same day again: the server refuses any version but this one, and each consent row must name its text.
 */
export const TEACHER_IMPORT_NOTICE_VERSION = '2026-10-16b'

/** Beside the button — the facts that decide the consent. */
export const IMPORT_NOTICE_LEAD: NoticeText = {
  // ⛔ EVERY KIND OF ANSWER THE READING FILLS (import-map.ts IMPORT_FIELDS) is named here — the consent is to these.
  en: "Google's Gemini AI reads your CV on Google Cloud, outside Vietnam, and fills in the answers you have not given yet: what and who you teach, your teaching jobs and experience, degree, certificates, name, nationality, English level, other languages, headline and summary — and your phone number, kept private, if you have not given one. If your CV is a PDF of up to 10 MB, it is also attached to your profile as your private CV when you publish (unless you already have one): schools get it only when you share it in a chat, and you can remove it on the last step. Otherwise we don't keep the file. You check every answer — nothing is public until you publish.",
  vi: 'AI Gemini của Google đọc CV của bạn trên Google Cloud (ngoài Việt Nam) rồi điền những câu trả lời bạn chưa nhập: môn dạy và đối tượng học viên, công việc giảng dạy và kinh nghiệm, bằng cấp, chứng chỉ, họ tên, quốc tịch, trình độ tiếng Anh, ngôn ngữ khác, tiêu đề và phần giới thiệu — và số điện thoại của bạn (được giữ riêng tư) nếu bạn chưa nhập. Nếu CV là tệp PDF tối đa 10 MB, CV cũng được đính kèm vào hồ sơ dưới dạng CV riêng tư khi bạn đăng (trừ khi bạn đã có CV): các trường chỉ nhận được khi bạn chia sẻ trong tin nhắn, và bạn có thể xoá ở bước cuối. Ngoài ra chúng tôi không lưu tệp. Bạn kiểm tra từng câu trả lời — chưa có gì được công khai cho đến khi bạn đăng hồ sơ.',
}

/** The second layer ("How we read your CV"), always in the page (a mounted collapsible) — part of the same notice. */
export const IMPORT_NOTICE_DETAILS: readonly NoticeText[] = [
  {
    en: 'Choose only your own CV.',
    vi: 'Chỉ chọn CV của chính bạn.',
  },
  {
    // Never "we never save it": the AI is ASKED to leave it out and the texts are screened, but a sentence it copies
    // into your summary is only as safe as that ask — so the check is said, and is the teacher's (review, 2026-10-16).
    en: 'CVs often hold sensitive personal data — health, religion or beliefs, ethnicity, a criminal record, ID or passport numbers — and referees’ contact details. We don’t need any of it and ask the AI to leave it out, but it sees the whole file while reading it — so check what it filled in. Prefer Google not to see it? Remove it from the file first, or fill in the form yourself.',
    vi: 'CV thường có dữ liệu cá nhân nhạy cảm — sức khoẻ, tôn giáo hoặc tín ngưỡng, dân tộc, tiền án, số giấy tờ tùy thân hoặc hộ chiếu — và thông tin liên hệ của người giới thiệu. Chúng tôi không cần các thông tin này và yêu cầu AI bỏ qua chúng, nhưng AI sẽ xem toàn bộ tệp trong lúc đọc — vì vậy hãy kiểm tra những gì được điền. Không muốn Google xem? Hãy xoá chúng khỏi tệp trước, hoặc tự điền biểu mẫu.',
  },
  {
    en: 'Google doesn’t use your file to train its AI. It may hold it briefly to answer, and for up to 90 days if its automated checks flag a request as misuse.',
    vi: 'Google không dùng tệp của bạn để huấn luyện AI. Google có thể giữ tệp trong thời gian ngắn để trả kết quả, và tối đa 90 ngày nếu hệ thống tự động của Google đánh dấu yêu cầu là lạm dụng.',
  },
  {
    en: 'What we fill in is saved to your account as a private draft until you publish or start over (or after 90 days without changes). Your phone number and the attached CV are kept only on this page until you publish, and are never shown publicly: someone you are chatting with gets them only when you tap Share in that chat.',
    vi: 'Những gì chúng tôi điền được lưu vào tài khoản dưới dạng bản nháp riêng tư cho đến khi bạn đăng hồ sơ hoặc bắt đầu lại (hoặc sau 90 ngày không thay đổi). Số điện thoại và CV đính kèm chỉ được giữ trên trang này cho đến khi bạn đăng hồ sơ, và không bao giờ được công khai: người đang trò chuyện với bạn chỉ nhận được khi bạn bấm Chia sẻ trong tin nhắn với họ.',
  },
]

/** The act itself carries the agreement (Law 91 Art 9: clear and specific). */
export const IMPORT_AGREE_LABEL: NoticeText = { en: 'Agree & choose my CV', vi: 'Đồng ý và chọn CV' }

/** The exact text of a notice, both languages, in display order — what the consent record's hash covers. */
export const noticeBody = (parts: readonly NoticeText[]): string => parts.map((p) => `${p.en}\n${p.vi}`).join('\n')

export const IMPORT_NOTICE_PARTS: readonly NoticeText[] = [IMPORT_NOTICE_LEAD, ...IMPORT_NOTICE_DETAILS, IMPORT_AGREE_LABEL]
