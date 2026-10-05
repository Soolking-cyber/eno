/**
 * SCHOOLS — the teacher-voted ranking of Saigon schools, centres and agencies (2026-10-04).
 * Plan + the review that reshaped it: ~/.claude/plans/eno-schools-2026-10-04.md.
 *
 * Client-safe: no server imports. Every enum here is ALSO a CHECK constraint in scripts/schools-ddl.mjs —
 * change both or the database will refuse the row the API just accepted.
 */

export const SCHOOL_KINDS = ['language_centre', 'international_school', 'bilingual_school', 'agency', 'university'] as const
export type SchoolKind = (typeof SCHOOL_KINDS)[number]
export const isSchoolKind = (v: unknown): v is SchoolKind => typeof v === 'string' && (SCHOOL_KINDS as readonly string[]).includes(v)

/** Singular label for a badge, plural for a filter chip. Authored Vietnamese (rendered with tr). */
export const KIND_LABEL: Record<SchoolKind, { en: string; vi: string; pluralEn: string; pluralVi: string }> = {
  language_centre: { en: 'Language centre', vi: 'Trung tâm Anh ngữ', pluralEn: 'Language centres', pluralVi: 'Trung tâm Anh ngữ' },
  international_school: { en: 'International school', vi: 'Trường quốc tế', pluralEn: 'International schools', pluralVi: 'Trường quốc tế' },
  bilingual_school: { en: 'Bilingual school', vi: 'Trường song ngữ', pluralEn: 'Bilingual schools', pluralVi: 'Trường song ngữ' },
  agency: { en: 'Teacher agency', vi: 'Công ty cung ứng giáo viên', pluralEn: 'Teacher agencies', pluralVi: 'Công ty cung ứng giáo viên' },
  university: { en: 'University', vi: 'Đại học', pluralEn: 'Universities', pluralVi: 'Đại học' },
}

export const TENURES = ['lt1', '1to2', '2plus'] as const
export type Tenure = (typeof TENURES)[number]
export const TENURE_LABEL: Record<Tenure, { en: string; vi: string }> = {
  lt1: { en: 'under 1 year', vi: 'dưới 1 năm' },
  '1to2': { en: '1–2 years', vi: '1–2 năm' },
  '2plus': { en: '2+ years', vi: 'trên 2 năm' },
}

export const ROLES = ['teacher', 'head_teacher', 'assistant', 'other'] as const
export type SchoolRole = (typeof ROLES)[number]
export const ROLE_LABEL: Record<SchoolRole, { en: string; vi: string }> = {
  teacher: { en: 'Teacher', vi: 'Giáo viên' },
  head_teacher: { en: 'Head teacher / coordinator', vi: 'Tổ trưởng / điều phối' },
  assistant: { en: 'Teaching assistant', vi: 'Trợ giảng' },
  other: { en: 'Other staff', vi: 'Vị trí khác' },
}

export const EMPLOYMENTS = ['full_time', 'part_time', 'contract'] as const
export type Employment = (typeof EMPLOYMENTS)[number]
export const EMPLOYMENT_LABEL: Record<Employment, { en: string; vi: string }> = {
  full_time: { en: 'Full-time', vi: 'Toàn thời gian' },
  part_time: { en: 'Part-time', vi: 'Bán thời gian' },
  contract: { en: 'Freelance', vi: 'Tự do' },
}

/** "What's good" chips. Counted per school; never free text, so they cannot carry an accusation. */
export const GOOD_TAGS = ['pays_on_time', 'supportive_management', 'materials_provided', 'fair_hours', 'paid_prep', 'work_permit_help', 'good_students', 'training'] as const
export const BAD_TAGS = ['late_pay', 'unpaid_prep', 'last_minute_changes', 'contract_issues', 'high_workload', 'poor_management', 'pay_deductions', 'no_work_permit_help'] as const
export type GoodTag = (typeof GOOD_TAGS)[number]
export type BadTag = (typeof BAD_TAGS)[number]
export const TAG_LABEL: Record<GoodTag | BadTag, { en: string; vi: string }> = {
  pays_on_time: { en: 'Pays on time', vi: 'Trả lương đúng hạn' },
  supportive_management: { en: 'Supportive management', vi: 'Quản lý hỗ trợ tốt' },
  materials_provided: { en: 'Materials provided', vi: 'Có sẵn giáo trình, tài liệu' },
  fair_hours: { en: 'Fair hours', vi: 'Giờ làm hợp lý' },
  paid_prep: { en: 'Paid prep time', vi: 'Có trả tiền giờ soạn bài' },
  work_permit_help: { en: 'Helps with the work permit', vi: 'Hỗ trợ giấy phép lao động' },
  good_students: { en: 'Motivated students', vi: 'Học viên chăm chỉ' },
  training: { en: 'Good training', vi: 'Đào tạo tốt' },
  late_pay: { en: 'Late pay', vi: 'Trả lương trễ' },
  unpaid_prep: { en: 'Unpaid prep time', vi: 'Không trả tiền giờ soạn bài' },
  last_minute_changes: { en: 'Last-minute schedule changes', vi: 'Đổi lịch sát giờ' },
  contract_issues: { en: 'Contract issues', vi: 'Vấn đề hợp đồng' },
  high_workload: { en: 'High workload', vi: 'Khối lượng công việc lớn' },
  poor_management: { en: 'Poor management', vi: 'Quản lý kém' },
  pay_deductions: { en: 'Unexpected pay deductions', vi: 'Bị trừ lương bất ngờ' },
  no_work_permit_help: { en: 'No help with the work permit', vi: 'Không hỗ trợ giấy phép lao động' },
}
export const isGoodTag = (v: unknown): v is GoodTag => typeof v === 'string' && (GOOD_TAGS as readonly string[]).includes(v)
export const isBadTag = (v: unknown): v is BadTag => typeof v === 'string' && (BAD_TAGS as readonly string[]).includes(v)

/**
 * WHO COUNTS (plan review 2026-10-04 — all three reviewers REFUTED "anyone signed in"). A vote, a
 * helpful-vote and a review's pay report COUNT only from an account that is: an individual (not a
 * business account), in good standing, not trust-restricted, at least ELIGIBLE_ACCOUNT_AGE_DAYS old,
 * and not the school's own linked shop. Votes are stored at once and counted at READ time, so an
 * account simply starts counting when it ages in — nothing to backfill.
 * ⚠️ REQUIRE_PHONE is the stronger gate (Vietnam's Decree 147/2024 asks social-network posters to be
 * authenticated by phone) but phone OTP is OFF on eno.vn today (sign-in-form.tsx PHONE_OTP_ENABLED):
 * turning this on now would lock every user out. Flip it with the OTP launch.
 */
export const ELIGIBLE_ACCOUNT_AGE_DAYS = 7
export const REQUIRE_PHONE = false

/**
 * ⛔ ONE VERIFIED PERSON, ONE VOTE (owner, 2026-10-05: "make sure we dont get spam … upvotes or downvotes";
 * plan review, codex + Opus). A school vote and a helpful-vote count only from an account with a LIVE
 * verified identity (passport or VNeID — src/lib/kyc/identity.ts verifiedProfileIds), on top of WHO COUNTS
 * above; KYC already refuses a second verified identity, so it is one per person. Unverified people can
 * still vote: the vote is stored and starts counting the day they verify. A proof of EMPLOYMENT never stands
 * in for it — a school controls its own mail domain and could mint "employees" — it makes a REVIEW count.
 */
export const VOTES_NEED_IDENTITY = true
/** Where a teacher verifies their identity (the KYC capture page, on both editions). */
export const VERIFY_IDENTITY_PATH = '/dashboard/account/verify'

/** Pay shows only with this many distinct eligible, published reports per pay period (k-anonymity). */
export const PAY_MIN_REPORTS = 5
/** Reports older than this stop counting toward pay. */
export const PAY_MAX_AGE_YEARS = 3

export const SCHOOLS_PATH = '/schools'
export const SCHOOLS_SUBDOMAIN = 'schools'

/**
 * Ho Chi Minh City areas, the labels the directory and the review's optional branch use: the familiar
 * pre-2025 districts expats still search by.
 */
// ⚠️ ONE bucket for Thu Duc City. Districts 2 and 9 were merged into it in 2021, and schools and teachers use
// all three names for the same streets (An Phu, Thao Dien). Three options split one area: a teacher picking
// "District 2" missed every school filed under "Thu Duc City". Thu Dau Mot joined the city with Binh Duong (2025).
export const HCMC_AREAS = [
  'District 1', 'Thu Duc City (D2 & D9)', 'District 3', 'District 4', 'District 5', 'District 6', 'District 7',
  'District 8', 'District 10', 'District 11', 'District 12', 'Binh Thanh', 'Phu Nhuan', 'Tan Binh', 'Tan Phu',
  'Go Vap', 'Binh Tan', 'Binh Chanh', 'Nha Be', 'Hoc Mon', 'Cu Chi', 'Thu Dau Mot',
] as const
export type HcmcArea = (typeof HCMC_AREAS)[number]
export const isHcmcArea = (v: unknown): v is HcmcArea => typeof v === 'string' && (HCMC_AREAS as readonly string[]).includes(v)

export const REVIEW_TEXT_MAX = 2000
export const REVIEW_ADVICE_MAX = 1000
export const REVIEW_TEXT_MIN = 20

/** Why a teacher reports a review. A report never hides anything by itself — it reaches a moderator. */
export const REPORT_REASONS = ['false_or_misleading', 'personal_info', 'names_a_person', 'harassment', 'not_an_experience', 'spam', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const REPORT_REASON_LABEL: Record<ReportReason, { en: string; vi: string }> = {
  false_or_misleading: { en: 'False or misleading', vi: 'Sai sự thật hoặc gây hiểu lầm' },
  personal_info: { en: 'Shares personal information', vi: 'Tiết lộ thông tin cá nhân' },
  names_a_person: { en: 'Names or targets a person', vi: 'Nêu tên hoặc nhắm vào một cá nhân' },
  harassment: { en: 'Harassment or hate', vi: 'Quấy rối hoặc thù ghét' },
  not_an_experience: { en: 'Not a real work experience', vi: 'Không phải trải nghiệm làm việc thật' },
  spam: { en: 'Spam or advertising', vi: 'Spam hoặc quảng cáo' },
  other: { en: 'Something else', vi: 'Lý do khác' },
}

/** A proof of employment's LinkedIn link and code are erased this long after a moderator's decision (employment.ts). */
export const PURGE_AFTER_DAYS = 30
/** A proof nobody has decided is closed (and erased) after this long: nothing is kept indefinitely. */
export const PENDING_MAX_DAYS = 60
/** A review its writer can no longer publish (their proof withdrawn or rejected) is deleted this long after. */
export const ORPHAN_REVIEW_DAYS = 60
/** Proofs one account may have waiting at once (the proof route): a flood must not bury real ones in the queue. */
export const PROOFS_PENDING_MAX = 3
/** The vote log (SchoolVoteEvent) is kept this long — enough to decide any award year — then swept (employment.ts). */
export const VOTE_LOG_KEEP_DAYS = 730
/** The reason an undecided proof is closed with (employment.ts sweepProofRetention); the proof step translates it. */
export const EXPIRED_PROOF_REASON = 'Not checked in time — please submit it again.'

/** Suggest a school (src/lib/schools/suggest.ts): the note's length, and how many one account may have waiting. */
export const SUGGESTION_NOTE_MAX = 500
export const SUGGESTIONS_PENDING_MAX = 3

/**
 * Teachers' Choice awards (src/lib/schools/awards.ts). A school qualifies in a year with at least
 * AWARD_MIN_VOTERS counted voters and AWARD_MIN_REVIEWS counted reviews; the methodology states these numbers
 * and its test pins them. ⚠️ NO SUPERLATIVE in any name (Vietnamese advertising rules): the award is
 * "Teachers' Choice", the categories are the school kinds.
 */
export const AWARD_FIRST_YEAR = 2026
export const AWARD_MIN_VOTERS = 10
export const AWARD_MIN_REVIEWS = 3
/** Places per category: the Teachers' Choice and two finalists. */
export const AWARD_PLACES = 3
export const AWARDS_PATH = '/schools/awards'
