'use client'

// What every step of the teacher form shares: the props a step gets, the error words, and the two looks a radio takes
// here (a chip in a wrapping row, a card with a dot). The step components are the six screens of the situation-first
// flow (teacher onboarding redesign, 2026-10-08); the form (teacher-form.tsx) owns the state, the saves and the rail.

import { chipVariants } from '@/components/ui/chip'
import { cn } from '@/lib/utils'
import { TEACHER_OPTIONS, type TeacherErrors, type TeacherInput } from '@/lib/teachers/profile'
import type { DroppedField } from '@/components/teachers/teacher-form-rules'

export type TeacherFormMode = 'join' | 'edit'

export type StepProps = {
  t: TeacherInput
  /** One field, as typed — clears that field's error. */
  set: <K extends keyof TeacherInput>(k: K, v: TeacherInput[K]) => void
  /** Several fields at once, as typed — clears each one's error. No warning: a direct edit of what it changes. */
  patch: (p: Partial<TeacherInput>) => void
  /**
   * A change that re-derives other answers (the situation, the work wanted, a subject that hides a question): the whole
   * next input. On an EDIT it first asks before anything already saved would be dropped (teacher-form's warning).
   */
  update: (next: TeacherInput, touched: readonly (keyof TeacherInput)[], direct?: readonly DroppedField[]) => void
  errors: TeacherErrors
  /** An error code → its words, for that field. */
  errText: (field: string, code: string | undefined) => string
  mode: TeacherFormMode
}

/** A radio drawn as a chip (a row that wraps): the neutral chip, its checked state the pressed chip's. */
export const RADIO_CHIP = cn(
  chipVariants({ size: 'md', tone: 'neutral' }),
  'relative tap-44 data-checked:bg-accent data-checked:text-accent-foreground data-checked:ring-1 data-checked:ring-brand/30',
  // ⛔ An unchecked radio must not hover into the checked look (ui/chip's TOGGLE_HOVER rule, for data-checked).
  'not-data-checked:hover:bg-muted not-data-checked:hover:text-foreground',
)
/** A radio drawn as a card with its dot — for an answer that needs a second line. */
export const RADIO_CARD = 'flex w-full items-start justify-start gap-2.5 whitespace-normal rounded-xl border border-border p-3 text-left data-checked:border-brand'

/** The words for an error code — field by field where a generic line would not say what to do. */
export function makeErrText(tr: (en: string, vi: string) => string) {
  const nextYear = new Date().getUTCFullYear() + 1
  const generic = (code: string | undefined): string => {
    switch (code) {
      case 'required': return tr('This is required.', 'Mục này là bắt buộc.')
      case 'too_short': return tr('Please write a little more (at least 10 characters).', 'Vui lòng viết thêm (ít nhất 10 ký tự).')
      case 'invalid': return tr('Please check this value.', 'Vui lòng kiểm tra lại.')
      case 'incomplete': return tr('Fill in the role and the school, or remove this job.', 'Điền vị trí và nơi làm việc, hoặc xoá công việc này.')
      case 'dates': return tr('The end date is before the start date.', 'Ngày kết thúc trước ngày bắt đầu.')
      case 'not_owned': return tr('That upload has expired — please upload your video again.', 'Video tải lên đã hết hạn — vui lòng tải lại video.')
      case 'rate_range': return tr('Please enter a rate between 50,000 đ and 2,000,000 đ an hour.', 'Vui lòng nhập mức phí từ 50.000 đ đến 2.000.000 đ một giờ.')
      case 'salary_range': return tr('Please enter a monthly salary between 1 and 150 million đ.', 'Vui lòng nhập mức lương tháng từ 1 đến 150 triệu đ.')
      case 'year_range': return `${tr('Please enter a year from 1950 to', 'Vui lòng nhập năm từ 1950 đến')} ${nextYear}.`
      case 'hours_range': return tr('Please enter between 1 and 2,000 hours.', 'Vui lòng nhập từ 1 đến 2.000 giờ.')
      case 'duplicate': return tr('This certificate is already listed.', 'Chứng chỉ này đã có trong danh sách.')
      case 'confirm': return tr('Please confirm these are the places you can teach — or change them.', 'Vui lòng xác nhận đây là những nơi bạn có thể dạy — hoặc thay đổi.')
      case 'other_city_required': return tr('Pick at least one other city — or change your answer to “Would you move for a job?”.', 'Chọn ít nhất một thành phố khác — hoặc đổi câu trả lời cho “Bạn có chuyển đi vì công việc không?”.')
      case 'goal_required': return tr('Switch on cover lessons — or go back to step 1 and pick the work you want.', 'Hãy bật nhận dạy thay — hoặc quay lại bước 1 và chọn công việc bạn muốn.')
      // The publish screens' refusals, on the FIELD they refused (publish.ts PublishBlockedError names it, never the word).
      case 'contact_in_text':
      case 'contact_in_name': return tr('Please remove phone numbers, emails and links here — schools get your contact only when you share it in chat.', 'Vui lòng xoá số điện thoại, email và liên kết ở đây — trường chỉ nhận liên hệ khi bạn chia sẻ trong tin nhắn.')
      case 'banned_words': return tr('This contains a word we do not allow. Please rephrase it.', 'Nội dung này có từ không được phép. Vui lòng viết lại.')
      case 'reach_required': return tr('Add a place near you on the “Where you teach” step first — that is where schools find you for cover.', 'Hãy thêm một nơi gần bạn ở bước “Nơi bạn dạy” trước — đó là nơi các trường tìm bạn để dạy thay.')
      default: return code ? tr('Please check this value.', 'Vui lòng kiểm tra lại.') : ''
    }
  }
  return (field: string, code: string | undefined): string => {
    if (!code) return ''
    if (code === 'required') {
      switch (field) {
        case 'livesIn': return tr('Please tell us where you are now.', 'Vui lòng cho biết hiện bạn đang ở đâu.')
        case 'currentCity': return tr('Please pick your city.', 'Vui lòng chọn thành phố của bạn.')
        case 'currentProvince': return tr('Please pick your province.', 'Vui lòng chọn tỉnh của bạn.')
        case 'jobTypes': return tr('Please pick the work you are looking for.', 'Vui lòng chọn công việc bạn đang tìm.')
        case 'relocate': return tr('Please choose an answer.', 'Vui lòng chọn một câu trả lời.')
        case 'teachAreas': return tr('Please pick at least one place you can teach.', 'Vui lòng chọn ít nhất một nơi bạn có thể dạy.')
        case 'subjects': return tr('Please pick at least one subject.', 'Vui lòng chọn ít nhất một môn.')
        case 'teachLanguages': return tr('Please add the language you teach.', 'Vui lòng thêm ngôn ngữ bạn dạy.')
        case 'ageGroups': return tr('Please pick who you teach.', 'Vui lòng chọn đối tượng bạn dạy.')
        case 'experienceBand': return tr('Please pick how long you have been teaching.', 'Vui lòng chọn số năm bạn đã dạy.')
        case 'englishLevel': return tr('Please pick your English level.', 'Vui lòng chọn trình độ tiếng Anh của bạn.')
        case 'photoUrl': return tr('Please add a profile photo.', 'Vui lòng thêm ảnh hồ sơ.')
        case 'phone': return tr('Please add your phone number — our staff need it to call you.', 'Vui lòng thêm số điện thoại — nhân viên cần số này để gọi cho bạn.')
        case 'coverSlots': return tr('Please tap at least one period you are usually free.', 'Vui lòng chạm vào ít nhất một buổi bạn thường rảnh.')
        case 'coverRateVnd': return tr('Please set your hourly rate.', 'Vui lòng đặt mức phí theo giờ.')
      }
    }
    // A certificate row with NO TYPE — only a draft from the previous form holds one (it added a row before its type
    // was picked; the chips here add typed rows): the generic `incomplete` is the teaching-job words ("Fill in the role
    // and the school"), which told the teacher nothing they could do (gate review, 2026-10-08).
    if (code === 'incomplete' && field.startsWith('certificates.')) return tr('It has no type — remove it, then tap the right certificate above.', 'Chưa có loại chứng chỉ — hãy xoá mục này rồi chạm vào chứng chỉ đúng ở trên.')
    return generic(code)
  }
}

/** A certificate's name ("CELTA"), for its row and its error — ⛔ a row's error names it (plan: "CELTA: …"). */
export const certName = (type: string, tr: (en: string, vi: string) => string) => {
  const o = TEACHER_OPTIONS.cert.find((c) => c.value === type)
  return o ? tr(o.label, o.labelVi) : tr('Certificate', 'Chứng chỉ')
}
