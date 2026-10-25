'use client'

// What every step of the teacher form shares: the props a step gets, the error words, and the two looks a radio takes
// here (a chip in a wrapping row, a card with a dot). The step components are the six screens of the situation-first
// flow (teacher onboarding redesign, 2026-10-08); the form (teacher-form.tsx) owns the state, the saves and the rail.

import { chipVariants } from '@/components/ui/chip'
import { cn } from '@/lib/utils'
import { TEACHER_OPTIONS, type TeacherErrors, type TeacherInput } from '@/lib/teachers/profile'
import type { DroppedField } from '@/components/teachers/teacher-form-rules'
import { teacherRefusedWords } from '@/lib/teachers/text-screen'

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
  /**
   * An error code → its words, for that field. `texts` — the field's own text(s) as typed (a job row: role, employer,
   * city): a refused text then shows the teacher's OWN words that were refused (text-screen.ts teacherRefusedWords).
   */
  errText: (field: string, code: string | undefined, texts?: readonly (string | null | undefined)[]) => string
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
      case 'real_name': return tr('Please enter your real name — schools see it on your profile.', 'Vui lòng nhập tên thật của bạn — các trường sẽ thấy tên này trên hồ sơ.')
      case 'too_short': return tr('Please write a little more (at least 10 characters).', 'Vui lòng viết thêm (ít nhất 10 ký tự).')
      case 'invalid': return tr('Please check this value.', 'Vui lòng kiểm tra lại.')
      case 'incomplete': return tr('Fill in the role and the school or company, or remove this job.', 'Điền vị trí và trường hoặc công ty, hoặc xoá công việc này.')
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
      // The publish screens' refusals, on the FIELD they refused (publish.ts PublishBlockedError names it, never the word) —
      // these lines only when the words cannot be pointed at (`pointed` above, from the field's own text, comes first).
      case 'contact_in_text':
      case 'contact_in_name': return tr('Please remove phone numbers, emails and links here — the person you are chatting with gets your contact only when you share it in that chat.', 'Vui lòng xoá số điện thoại, email và liên kết ở đây — người đang trò chuyện với bạn chỉ nhận được liên hệ khi bạn chia sẻ trong tin nhắn với họ.')
      case 'banned_words': return tr('This contains a word we do not allow. Please rephrase it.', 'Nội dung này có từ không được phép. Vui lòng viết lại.')
      case 'reach_required': return tr('Add a place near you on the “Where you teach” step first — that is where schools find you for cover.', 'Hãy thêm một nơi gần bạn ở bước “Nơi bạn dạy” trước — đó là nơi các trường tìm bạn để dạy thay.')
      default: return code ? tr('Please check this value.', 'Vui lòng kiểm tra lại.') : ''
    }
  }
  // ⛔ THE TEACHER'S OWN REFUSED WORDS, quoted (2026-10-21: a teacher refused three times without being told which word
  // published his complaint as his bio). Found in the browser from the text it already holds — the server still sends only
  // the field; and eno.vn's own copy names no rule and no word: the quote is the teacher's text, shown back to them alone.
  const pointed = (field: string, code: string, words: readonly string[]): string => {
    const quoted = words.map((w) => `“${w}”`).join(', ')
    // A NAME cannot be reworded: the human route, as for the photo check.
    if (code === 'banned_words' && field === 'fullName') return `${tr('We can’t publish this:', 'Không thể đăng nội dung này:')} ${quoted}. ${tr('If this is your name as written on your ID, tell us from the Help page.', 'Nếu đây là tên của bạn như trên giấy tờ tùy thân, hãy báo cho chúng tôi từ trang Trợ giúp.')}`
    if (code === 'banned_words') return `${tr('We can’t publish this:', 'Không thể đăng nội dung này:')} ${quoted}. ${tr('Please rephrase or remove it.', 'Vui lòng viết lại hoặc xoá phần này.')}`
    return `${tr('Please remove this:', 'Vui lòng xoá phần này:')} ${quoted} — ${tr('the person you are chatting with gets your contact only when you share it in that chat.', 'người đang trò chuyện với bạn chỉ nhận được liên hệ khi bạn chia sẻ trong tin nhắn với họ.')}`
  }
  return (field: string, code: string | undefined, texts?: readonly (string | null | undefined)[]): string => {
    if (!code) return ''
    if (texts && (code === 'banned_words' || code === 'contact_in_text' || code === 'contact_in_name')) {
      const words = teacherRefusedWords(code, texts)
      if (words.length) return pointed(field, code, words)
    }
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
        // Required for a new profile since 2026-10-16 (owner: "make short intor video mandatory from now on").
        case 'videoUrl': return tr('Please add a short intro video (up to 5 minutes) — say hello and show how you teach.', 'Vui lòng thêm một video giới thiệu ngắn (tối đa 5 phút) — chào hỏi và cho thấy cách bạn dạy.')
        // Required on every save since 2026-10-22 (owner: "phone number is mandatory") — and said to stay private.
        case 'phone': return tr('Please add your phone number — it stays private: the person you are chatting with gets it only when you share it.', 'Vui lòng thêm số điện thoại — số này được giữ riêng tư: người đang trò chuyện với bạn chỉ nhận được khi bạn chia sẻ.')
        case 'coverSlots': return tr('Please tap at least one period you are usually free.', 'Vui lòng bấm chọn ít nhất một buổi bạn thường rảnh.')
        case 'coverRateVnd': return tr('Please set your hourly rate.', 'Vui lòng đặt mức phí theo giờ.')
        // Required for a new profile 2026-10-22..25 (owner: "they should include cv"); no server sends it since — kept for one.
        case 'cv': return tr('Please add your CV — a PDF up to 10 MB. It stays private: schools get it only when you share it in a chat.', 'Vui lòng thêm CV — tệp PDF tối đa 10 MB. CV được giữ riêng tư: các trường chỉ nhận được khi bạn chia sẻ trong tin nhắn.')
      }
    }
    // The CV's own refusals (2026-10-21): a pick the upload would never take, an upload that did not arrive, and one the
    // server no longer held when Publish named it (the form has already tried it again once). The CV is optional since
    // 2026-10-25, so an upload that cannot go through now says the way out too: remove it, add it later (review).
    if (field === 'cv') {
      switch (code) {
        case 'type': return tr('Your CV must be a PDF.', 'CV phải là tệp PDF.')
        case 'size': return tr('Your CV must be 10 MB or smaller.', 'CV phải có dung lượng tối đa 10 MB.')
        case 'upload_failed': return tr('Your CV didn’t upload. Please try again — or remove it and add it later.', 'Chưa tải được CV lên. Vui lòng thử lại — hoặc gỡ tệp và thêm CV sau.')
        case 'rate': return tr('Too many CV uploads from this account — please try again in an hour, or remove it and add it later.', 'Tài khoản này đã tải CV lên quá nhiều lần — vui lòng thử lại sau một giờ, hoặc gỡ tệp và thêm CV sau.')
        case 'busy': return tr('CV uploads are busy on this network right now — please try again later or from another connection, or remove it and add it later.', 'Hiện có quá nhiều lượt tải CV từ mạng này — vui lòng thử lại sau hoặc dùng kết nối khác, hoặc gỡ tệp và thêm CV sau.')
        case 'expired': return tr('Your CV upload expired. Please tap Publish again.', 'CV tải lên đã hết hạn. Vui lòng bấm Đăng lần nữa.')
      }
    }
    // A certificate row with NO TYPE — only a draft from the previous form holds one (it added a row before its type
    // was picked; the chips here add typed rows): the generic `incomplete` is the teaching-job words ("Fill in the role
    // and the school"), which told the teacher nothing they could do (gate review, 2026-10-08).
    // The profile photo check (owner, 2026-10-16) — what was found, what is fine, and the human route.
    if (field === 'photoUrl' && code === 'no_face') return tr('We can’t see your face in this photo. Choose one where your face shows — a photo of you teaching your class is fine. Think we got it wrong? Tell us from the Help page.', 'Chúng tôi không thấy khuôn mặt của bạn trong ảnh này. Hãy chọn ảnh thấy rõ khuôn mặt — ảnh bạn đang dạy lớp cũng được. Bạn cho rằng chúng tôi nhầm? Hãy báo cho chúng tôi từ trang Trợ giúp.')
    if (field === 'photoUrl' && code === 'not_photo') return tr('This looks like a drawing, a character or a graphic. Choose a real photo of yourself. Think we got it wrong? Tell us from the Help page.', 'Ảnh này trông giống hình vẽ, nhân vật hoặc hình đồ họa. Hãy chọn một ảnh thật của bạn. Bạn cho rằng chúng tôi nhầm? Hãy báo cho chúng tôi từ trang Trợ giúp.')
    if (code === 'incomplete' && field.startsWith('certificates.')) return tr('It has no type — remove it, then tap the right certificate above.', 'Chưa có loại chứng chỉ — hãy xoá mục này rồi bấm chọn chứng chỉ đúng ở trên.')
    return generic(code)
  }
}

/** A certificate's name ("CELTA"), for its row and its error — ⛔ a row's error names it (plan: "CELTA: …"). */
export const certName = (type: string, tr: (en: string, vi: string) => string) => {
  const o = TEACHER_OPTIONS.cert.find((c) => c.value === type)
  return o ? tr(o.label, o.labelVi) : tr('Certificate', 'Chứng chỉ')
}
