/**
 * eno Classroom — THE WORDS EVERY CONSENT IS GIVEN TO (plan "Privacy, consent, children"). Authored once here, rendered
 * beside the action that carries the agreement, and hashed by the server into the consent record (appendAudit), so each
 * record names the exact text a person agreed to (PDP Law 91/2025 Art 9; Decree 356/2025 Art 6) — the teacher-bio pattern
 * (src/lib/teachers/bio-notice.ts), with the same helpers it uses (noticeBody, NoticeText — src/lib/teachers/import-notice.ts).
 *
 * ⛔ ONE NOTICE PER PURPOSE, NEVER BUNDLED (plan review, codex): the learner's voice practice and the teacher's view of
 * the reports are separate purposes with separate records; the guardian's attestation and a child's assent are their own.
 * ⛔ BUMP A VERSION WHEN ITS MEANING CHANGES — what is sent, to whom, where, how long it is kept. The client echoes the
 * version it showed; the route refuses any other (409 notice_changed). Rewording without a change of meaning keeps the
 * version; the hash still moves, so every record names its text.
 * ⚠️ Plain literals, no {placeholders}, each English part ≤ 200 characters (gen-ui-strings harvests authored pairs only up
 * to that length — src/lib/teachers/bio-notice.ts says why).
 */
import { noticeBody, type NoticeText } from '@/lib/teachers/import-notice'

export type { NoticeText }

// ── Teacher: Write with AI (the avatar's persona) ──────────────────────────────────────────────────────────────────
export const PERSONA_AI_NOTICE_VERSION = '2026-10-25'
export const PERSONA_AI_ACTION: NoticeText = { en: 'Write with AI', vi: 'Viết bằng AI' }
export const PERSONA_AI_NOTICE: readonly NoticeText[] = [
  {
    en: 'Write with AI sends your teacher profile’s headline, About text, subjects, age groups, nationality and experience, and the chips you picked, to Google’s Gemini AI on Google Cloud, outside Vietnam.',
    vi: 'Viết bằng AI gửi tiêu đề, phần giới thiệu, môn dạy, lứa tuổi học viên, quốc tịch, kinh nghiệm trong hồ sơ giáo viên và các lựa chọn của bạn đến AI Gemini của Google trên Google Cloud, ngoài Việt Nam.',
  },
  {
    en: 'Google doesn’t use it to train its AI. It may hold it briefly to answer, and for up to 90 days if its automated checks flag a request as misuse.',
    vi: 'Google không dùng dữ liệu này để huấn luyện AI. Google có thể giữ dữ liệu trong thời gian ngắn để trả kết quả, và tối đa 90 ngày nếu hệ thống tự động của Google đánh dấu yêu cầu là lạm dụng.',
  },
  { en: 'We keep a record that you asked, not the text. Read the result before you save it.', vi: 'Chúng tôi chỉ lưu bản ghi rằng bạn đã yêu cầu, không lưu nội dung. Hãy đọc kết quả trước khi lưu.' },
]
export const personaAiNoticeBody = (): string => noticeBody([PERSONA_AI_ACTION, ...PERSONA_AI_NOTICE])

// ── Teacher: Use my photo (the avatar's face) ──────────────────────────────────────────────────────────────────────
export const PHOTO_NOTICE_VERSION = '2026-10-25'
export const PHOTO_ACTION: NoticeText = { en: 'Use my photo', vi: 'Dùng ảnh của tôi' }
export const PHOTO_NOTICE: readonly NoticeText[] = [
  {
    en: 'Your profile photo goes to SpatialWalk Pte. Ltd. (Spatius, Singapore), which makes a 3D talking likeness of your face from it.',
    vi: 'Ảnh hồ sơ của bạn được gửi đến SpatialWalk Pte. Ltd. (Spatius, Singapore) để tạo một hình ảnh 3D biết nói giống khuôn mặt bạn.',
  },
  {
    en: 'Your students see it labelled as an AI avatar, never as you. It speaks only in your class.',
    vi: 'Học viên luôn thấy đây là avatar AI, không phải chính bạn. Avatar chỉ nói chuyện trong lớp của bạn.',
  },
  {
    en: 'Spatius keeps the photo and the likeness until you remove them. Remove them here any time and we ask Spatius to delete both.',
    vi: 'Spatius lưu ảnh và hình ảnh 3D cho đến khi bạn gỡ bỏ. Bạn có thể gỡ bất cứ lúc nào tại đây, và chúng tôi sẽ yêu cầu Spatius xoá cả hai.',
  },
  { en: 'Spatius says it does not train its systems on customer content.', vi: 'Spatius cho biết họ không dùng nội dung của khách hàng để huấn luyện hệ thống.' },
]
export const photoNoticeBody = (): string => noticeBody([PHOTO_ACTION, ...PHOTO_NOTICE])

// ── Learner, purpose 1: voice practice ─────────────────────────────────────────────────────────────────────────────
export const PRACTICE_NOTICE_VERSION = '2026-10-25'
export const PRACTICE_NOTICE: readonly NoticeText[] = [
  {
    en: 'Each time the learner speaks, the recording goes to Microsoft Azure (Singapore) to be written down and scored for pronunciation. We never store the recording.',
    vi: 'Mỗi lần học viên nói, bản ghi âm được gửi đến Microsoft Azure (Singapore) để chuyển thành chữ và chấm phát âm. Chúng tôi không bao giờ lưu bản ghi âm.',
  },
  {
    // Every recipient (round 10, opus): the avatar's replies are voiced by Azure too, and a reply may repeat the learner.
    en: 'The avatar’s replies are turned into speech by Azure as well.',
    vi: 'Câu trả lời của avatar cũng được Azure chuyển thành giọng nói.',
  },
  {
    en: 'What was said goes to Google’s Gemini AI on Google Cloud, outside Vietnam, to write the avatar’s replies and the report after each session.',
    vi: 'Nội dung đã nói được gửi đến AI Gemini của Google trên Google Cloud, ngoài Việt Nam, để viết câu trả lời của avatar và bản nhận xét sau mỗi buổi.',
  },
  {
    // Every field the tutor and the report send, named (core review, opus: "what was said" alone under-disclosed) — and
    // no promise the text cannot keep (round 3, codex + opus): we add no name, but a learner may SAY theirs.
    en: 'With it go the learner’s level and age group, the teacher’s notes for this practice and the mistakes being worked on.',
    vi: 'Kèm theo là trình độ và nhóm tuổi của học viên, ghi chú của giáo viên cho buổi luyện và các lỗi đang luyện.',
  },
  {
    en: 'We don’t add the learner’s name, but what they say, and what the teacher writes in a note, goes as it is.',
    vi: 'Chúng tôi không gửi kèm tên học viên, nhưng những gì học viên nói và những gì giáo viên ghi chú được gửi nguyên văn.',
  },
  {
    // The persona notice's words for the same Vertex path (core review, opus: the learner's notice left out the hold).
    en: 'Google doesn’t use it to train its AI. It may hold it briefly to answer, and for up to 90 days if its automated checks flag a request as misuse.',
    vi: 'Google không dùng dữ liệu này để huấn luyện AI. Google có thể giữ dữ liệu trong thời gian ngắn để trả kết quả, và tối đa 90 ngày nếu hệ thống tự động của Google đánh dấu yêu cầu là lạm dụng.',
  },
  {
    // Every recipient, in the purpose that produces it (round 3, opus): the tutor flags it DURING practice.
    en: 'If the learner mentions harm or danger, that part of the session is flagged to the teacher and to eno’s safety team.',
    vi: 'Nếu học viên nhắc đến việc bị tổn hại hoặc gặp nguy hiểm, phần đó của buổi luyện được báo cho giáo viên và bộ phận an toàn của eno.',
  },
  {
    en: 'Only the avatar’s voice — never the learner’s — goes to SpatialWalk (Spatius) to move the avatar’s face.',
    vi: 'Chỉ giọng nói của avatar — không bao giờ là giọng học viên — được gửi đến SpatialWalk (Spatius) để tạo cử động khuôn mặt avatar.',
  },
  {
    en: 'Transcripts and reports are kept while the learner is in the class and deleted 90 days after leaving. You can stop at any time.',
    vi: 'Bản ghi chữ và nhận xét được lưu khi học viên còn trong lớp và bị xoá 90 ngày sau khi rời lớp. Bạn có thể dừng bất cứ lúc nào.',
  },
]
export const practiceNoticeBody = (): string => noticeBody(PRACTICE_NOTICE)

// ── Learner, purpose 2: the teacher sees the reports ───────────────────────────────────────────────────────────────
export const TEACHER_VIEW_NOTICE_VERSION = '2026-10-25'
export const TEACHER_VIEW_NOTICE: readonly NoticeText[] = [
  {
    en: 'The teacher sees each session’s transcript and report, adds private notes, and uses them to plan the next session.',
    vi: 'Giáo viên xem bản ghi chữ và nhận xét của mỗi buổi, có thể ghi chú riêng và dùng chúng để lên kế hoạch cho buổi tiếp theo.',
  },
  {
    // What the teacher sees, said where the teacher's view is agreed to (round 10, opus) — the practice notice says it too.
    en: 'That includes any part of a session flagged for the learner’s safety.',
    vi: 'Bao gồm cả những phần của buổi luyện được đánh dấu vì sự an toàn của học viên.',
  },
]
export const teacherViewNoticeBody = (): string => noticeBody(TEACHER_VIEW_NOTICE)

// ── An adult practising as themselves (round 8, opus: "Me (18+)" was a label, not a record) ──────────────────────────
export const ADULT_NOTICE_VERSION = '2026-10-25'
export const ADULT_ATTESTATION: NoticeText = {
  en: 'I am 18 or older, and I am the one who will practise.',
  vi: 'Tôi từ 18 tuổi trở lên và chính tôi là người sẽ luyện tập.',
}
export const adultNoticeBody = (): string => noticeBody([ADULT_ATTESTATION])

// ── Parent or guardian ─────────────────────────────────────────────────────────────────────────────────────────────
export const GUARDIAN_NOTICE_VERSION = '2026-10-25'
export const GUARDIAN_ATTESTATION: NoticeText = {
  en: 'I am this child’s parent or legal guardian, and I give these agreements for them.',
  vi: 'Tôi là cha, mẹ hoặc người giám hộ hợp pháp của trẻ và tôi đồng ý thay cho trẻ.',
}
export const guardianNoticeBody = (): string => noticeBody([GUARDIAN_ATTESTATION])

// ── The child's own yes (age 7+) — child-friendly words ────────────────────────────────────────────────────────────
export const ASSENT_VERSION = '2026-10-25'
export const ASSENT_TEXT: readonly NoticeText[] = [
  {
    en: 'Hi! Your teacher’s AI will listen when you speak English and help you practise.',
    vi: 'Chào em! AI của thầy cô sẽ lắng nghe khi em nói tiếng Anh và giúp em luyện tập.',
  },
  { en: 'Your teacher will see how you did, so they can help you more.', vi: 'Thầy cô sẽ xem em đã làm thế nào để giúp em nhiều hơn.' },
  { en: 'Is that OK with you?', vi: 'Em có đồng ý không?' },
]
export const ASSENT_YES: NoticeText = { en: 'Yes, that’s OK', vi: 'Dạ, em đồng ý' }
export const assentBody = (): string => noticeBody([...ASSENT_TEXT, ASSENT_YES])
