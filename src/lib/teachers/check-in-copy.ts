/**
 * THE TEACHERS' WEEKLY CHECK-IN — its words and its constants (owner, 2026-10-27: "remove it for teachers make it custom
 * weekly like are you still look for job or are you still available for cover etc no sold there"). Import-free, so the
 * page, the bell and the server (src/lib/teachers/check-in.ts) read the same table.
 *
 * WHY IT EXISTS: the goods review ("Still available? Tick anything that sold") listed teachers' profiles too, and four
 * teachers ticked their own — meaning "yes, available" — which marked it sold and took it out of search. A teacher is
 * now asked once a week, in their own terms, and the only answers are "yes", "change my details" and an explicit,
 * confirmed "hide my profile". Nothing here can mark a profile sold.
 *
 * ⚠️ The question follows what the profile OFFERS (profile.ts FORM_JOB_TYPES + cover): a job (full-time or part-time),
 * private students, cover lessons — and names cover whenever cover is on, because "yes" also confirms the cover periods
 * (coverConfirmedAt). Each pair is a literal `{ en, vi }` so scripts/gen-ui-strings.mjs harvests it for the other languages.
 */
export const CHECK_IN_TYPE = 'teacher_checkin'
export const CHECK_IN_URL = '/teachers/check-in'
/** Asked at most once per this many days, and not before a profile is this old or within this long of a "yes". */
export const CHECK_IN_EVERY_DAYS = 7

export type CheckInOffer = { jobTypes: readonly string[]; coverOpen: boolean }

const Q = {
  jobCover: { en: 'Still looking for a teaching job — and free for cover lessons?', vi: 'Bạn vẫn đang tìm việc dạy — và vẫn rảnh để dạy thay?' },
  job: { en: 'Still looking for a teaching job?', vi: 'Bạn vẫn đang tìm việc dạy?' },
  privateCover: { en: 'Still taking private students — and free for cover lessons?', vi: 'Bạn vẫn nhận học viên dạy kèm — và vẫn rảnh để dạy thay?' },
  private: { en: 'Still taking private students?', vi: 'Bạn vẫn nhận học viên dạy kèm?' },
  cover: { en: 'Still free for cover lessons?', vi: 'Bạn vẫn rảnh để dạy thay?' },
  any: { en: 'Still available to teach?', vi: 'Bạn vẫn sẵn sàng đi dạy?' },
} as const

/** The week's question for what this profile offers. */
export function checkInQuestion(t: CheckInOffer): { en: string; vi: string } {
  const job = t.jobTypes.includes('fulltime') || t.jobTypes.includes('parttime')
  const tutoring = t.jobTypes.includes('private')
  if (job) return t.coverOpen ? Q.jobCover : Q.job
  if (tutoring) return t.coverOpen ? Q.privateCover : Q.private
  return t.coverOpen ? Q.cover : Q.any
}

/**
 * The bell row, stored server-side where tr() cannot run: a bilingual composite "vi · en" (invite.ts's idiom). The bell
 * titles this type itself in the reader's language (notification-bell.tsx); the body is eno's own words, so
 * notification-text.ts lets it be machine-translated.
 */
export const CHECK_IN_TITLE = 'Hồ sơ giáo viên: kiểm tra hằng tuần · Your teacher profile: weekly check-in'
export function checkInBody(t: CheckInOffer): string {
  const q = checkInQuestion(t)
  return `${q.vi} Nhấn để trả lời — hồ sơ của bạn vẫn hiển thị. · ${q.en} Tap to answer — your profile stays up.`
}
