// @vitest-environment jsdom
/**
 * Photo & publish — the phone and the job-match switches since the owner's 2026-10-22 decision ("also phone number is
 * mandatory and all toggles should be on by default"):
 *   · the phone is never "(optional)": one label, aria-required, and a hint that says when staff call it;
 *   · "Our staff may call me" no longer says it needs the phone (the phone is required whatever it says);
 *   · the switches show what the FORM says is in effect (optIns — a new profile's default ON is decided in
 *     teacher-form.tsx) and a tap goes to its onChange, never to `set` (the default rides beside `t`, never in it);
 *   · the AI note reads "While either option above is on, …" — the rest byte for byte (AI_NOTICE_VERSION unchanged).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { EMPTY_TEACHER, type TeacherInput } from '@/lib/teachers/profile'
import { FinishStep, type FinishIdentityMark, type FinishMedia, type FinishOptIns } from './finish-step'
import { NO_MARK } from '@/components/teachers/identity-mark-switch'

afterEach(() => cleanup())

const MARK: FinishIdentityMark = { ...NO_MARK, canSave: true, local: true, busy: false, message: '', onToggle: vi.fn() }
const MEDIA = {
  busy: '', onPhoto: vi.fn(), onVideo: vi.fn(), privateVideo: false, savedPublicUrl: null, ownVideoUrl: null, ownVideoBusy: false,
  videoRemoving: false, confirmVideoRemove: false, setConfirmVideoRemove: vi.fn(), onWatchOwnVideo: vi.fn(), onCloseOwnVideo: vi.fn(),
  onOwnVideoError: vi.fn(), onRemovePrivateVideo: vi.fn(), cvName: null, cvFile: null, onCvPick: vi.fn(), onCvDiscard: vi.fn(), onCvRemove: null,
} as unknown as FinishMedia
/** A job seeker — the switches are asked of job seekers only. */
const SEEKER: Partial<TeacherInput> = { jobTypes: ['fulltime'] }

function mount(o: { t?: Partial<TeacherInput>; optIns?: Partial<FinishOptIns>; lang?: 'en' | 'vi'; mode?: 'join' | 'edit'; noticeChanged?: boolean } = {}) {
  const lang = o.lang ?? 'en'
  if (lang === 'vi') try { sessionStorage.removeItem('lang-reload:en') } catch { /* no storage */ }
  const set = vi.fn()
  const optIns: FinishOptIns = { matchEmail: true, staffCall: true, onChange: vi.fn(), ...o.optIns }
  render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <FinishStep
        t={{ ...EMPTY_TEACHER, ...SEEKER, ...o.t }} set={set} errors={{}} errText={() => ''} mode={o.mode ?? 'join'} signedIn publishGate={null}
        prefillAvatar={null} prefillPhone={null} media={MEDIA} edit={null} optInsNoticeChanged={o.noticeChanged ?? false}
        identityMark={MARK} optIns={optIns}
      />
    </LanguageProvider>,
  )
  return { set, optIns }
}
const description = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')

describe('the phone — mandatory (owner, 2026-10-22)', () => {
  it('one label, never "(optional)" — with or without staff calls — and aria-required', () => {
    mount({ optIns: { staffCall: false } })
    const phone = screen.getByRole('textbox', { name: 'Phone number' })
    expect(phone.getAttribute('aria-required')).toBe('true')
    expect(screen.queryByText(/Phone number \(optional\)/)).toBeNull()
    cleanup()
    mount({ optIns: { staffCall: true } })
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toBeTruthy()
  })

  it('the hint says it stays private and when staff call it — in English and in Vietnamese', () => {
    mount()
    expect(screen.getByText('Never shown publicly. The person you are chatting with gets it only when you tap the Share button in that chat — and our staff call it only while “Our staff may call me” is on.')).toBeTruthy()
    cleanup()
    mount({ lang: 'vi' })
    expect(screen.getByRole('textbox', { name: 'Số điện thoại' })).toBeTruthy()
    expect(screen.queryByText(/không bắt buộc\)$/, { selector: 'label' })).toBeNull()
    expect(screen.getByText('Không bao giờ công khai. Người bạn đang trò chuyện chỉ nhận được khi bạn bấm nút Chia sẻ trong tin nhắn với họ — và nhân viên của chúng tôi chỉ gọi khi mục “Nhân viên của chúng tôi có thể gọi cho tôi” đang bật.')).toBeTruthy()
  })

  it('"Our staff may call me" no longer says it needs the phone (EN + VI)', () => {
    mount()
    expect(description(screen.getByRole('switch', { name: 'Our staff may call me' }))).toBe('About jobs that match your profile, and to introduce you to those schools.')
    cleanup()
    mount({ lang: 'vi' })
    expect(description(screen.getByRole('switch', { name: 'Nhân viên của chúng tôi có thể gọi cho tôi' }))).toBe('Về các việc làm phù hợp với hồ sơ của bạn, và để giới thiệu bạn với các trường đó.')
  })
})

describe('the job-match switches — what the form says is in effect', () => {
  it('shows the values it is given (ON / OFF) and a tap goes to onChange — never to set()', () => {
    const { set, optIns } = mount({ optIns: { matchEmail: true, staffCall: false } })
    const email = screen.getByRole('switch', { name: 'Email me jobs that match my profile' })
    const calls = screen.getByRole('switch', { name: 'Our staff may call me' })
    expect(email.getAttribute('aria-checked')).toBe('true')
    expect(calls.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(email)
    expect(optIns.onChange).toHaveBeenCalledWith('matchEmail', false)
    fireEvent.click(calls)
    expect(optIns.onChange).toHaveBeenCalledWith('staffCall', true)
    expect(set).not.toHaveBeenCalled()
  })

  it('the older-notice line reads the values in effect, not `t` (an edit whose opt-ins loaded off)', () => {
    mount({ mode: 'edit', noticeChanged: true, optIns: { matchEmail: false, staffCall: false } })
    expect(screen.getByText(/The job-matching notice below has changed/)).toBeTruthy()
    cleanup()
    mount({ mode: 'edit', noticeChanged: true, optIns: { matchEmail: true, staffCall: false } })
    expect(screen.queryByText(/The job-matching notice below has changed/)).toBeNull()
  })

  it('the AI note: "While either option above is on, …" — the rest of the words unchanged (EN + VI)', () => {
    mount()
    expect(screen.getByTestId('ai-note').textContent).toBe("While either option above is on, an AI model — Anthropic's Claude, which processes data outside Vietnam — compares your profile with teaching jobs. It receives your headline and about text (with your name taken out), your nationality and whether you are a native speaker, the city you live in and the cities you can teach in, subjects, age groups, job types, years of experience, degree, certificate types, expected salary and start date. It never receives your name, photo, video, phone, email or CV. See our Privacy Policy.")
    cleanup()
    mount({ lang: 'vi' })
    expect(screen.getByTestId('ai-note').textContent).toBe('Khi một trong hai tùy chọn trên đang bật, một mô hình AI — Claude của Anthropic, xử lý dữ liệu ngoài Việt Nam — sẽ so sánh hồ sơ của bạn với các việc làm giảng dạy. Mô hình nhận tiêu đề và phần giới thiệu của bạn (đã lược bỏ tên của bạn), quốc tịch và việc bạn có phải người bản ngữ hay không, thành phố bạn đang sống và các thành phố bạn có thể dạy, môn dạy, độ tuổi học viên, loại công việc, số năm kinh nghiệm, bằng cấp, loại chứng chỉ, mức lương mong muốn và ngày có thể bắt đầu. Mô hình không bao giờ nhận tên, ảnh, video, số điện thoại, email hay CV của bạn. Xem Chính sách bảo vệ dữ liệu cá nhân.')
  })
})
