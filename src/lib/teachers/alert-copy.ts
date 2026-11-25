/**
 * The teacher alerts' fixed words (notify.ts: a message about the profile; job-dms/desk.ts: new jobs). CLIENT-SAFE: the
 * push picks the teacher's half (push.ts), the bell row stores "VI · EN" and shows the reader's half (chat-phrases.ts).
 */
export const TEACHER_MESSAGE_TITLE = { vi: 'Bạn có tin nhắn mới về hồ sơ giáo viên', en: 'New message about your teacher profile' }
export const TEACHER_MESSAGE_BODY = { vi: 'Mở để trả lời — có thể là lời mời dạy thay.', en: 'Open to reply — it may be a cover-lesson request.' }
export const TEACHER_JOBS_TITLE = { vi: 'Việc làm phù hợp với bạn', en: 'Jobs that match your profile' }
export const TEACHER_JOBS_BODY = { vi: 'Alex · eno.vn đã gửi cho bạn việc làm mới.', en: 'Alex from eno.vn sent you new jobs.' }
/** The stored bell form. */
export const composite = (p: { vi: string; en: string }) => `${p.vi} · ${p.en}`
