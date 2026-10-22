// @vitest-environment jsdom
/**
 * PHOTO & PUBLISH › VISIBILITY — "HIDE MY PROFILE FROM SEARCH ENGINES" (owner decision 14, 2026-10-20), edit only. The
 * switch is drawn from the form's state (the save is teacher-form.tsx's — teacher-form.edit.test.tsx):
 *   · a labelled switch whose DESCRIPTION is the one honest helper line: what it asks of search engines (the profile PAGE
 *     out of their results), that it can take them a while (no promise about Google's timing), and that the profile stays
 *     on eno — its card on eno's other pages too (the teacher lists), which stay indexable;
 *   · checked = hidden, as the server last said it; disabled (never guessed) until it is known;
 *   · a tap asks the form to save; a tap while that save is on its way is dropped; a refusal or a failure has its line;
 *   · the join form (no profile yet) has no such switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { EMPTY_TEACHER } from '@/lib/teachers/profile'
import { FinishStep, type FinishEdit, type FinishIdentityMark, type FinishMedia } from './finish-step'
import { NO_MARK } from '@/components/teachers/identity-mark-switch'

afterEach(() => cleanup())

const MARK: FinishIdentityMark = { ...NO_MARK, canSave: true, local: false, busy: false, message: '', onToggle: vi.fn() }
const MEDIA = {
  busy: '', onPhoto: vi.fn(), onVideo: vi.fn(), privateVideo: false, savedPublicUrl: null, ownVideoUrl: null, ownVideoBusy: false,
  videoRemoving: false, confirmVideoRemove: false, setConfirmVideoRemove: vi.fn(), onWatchOwnVideo: vi.fn(), onCloseOwnVideo: vi.fn(),
  onOwnVideoError: vi.fn(), onRemovePrivateVideo: vi.fn(), cvName: null, cvFile: null, onCvPick: vi.fn(), onCvDiscard: vi.fn(), onCvRemove: null,
} as unknown as FinishMedia

const EN_NAME = 'Hide my profile from search engines'
const VI_NAME = 'Ẩn hồ sơ khỏi công cụ tìm kiếm'
const EN_HELP = 'Asks Google and other search engines to leave your profile page out of their results — it can take them a while. Your profile stays on eno for everyone, and its card still shows on eno’s other pages, such as the teacher lists.'
const VI_HELP = 'Yêu cầu Google và các công cụ tìm kiếm khác không hiển thị trang hồ sơ của bạn trong kết quả tìm kiếm — việc này có thể mất một thời gian. Hồ sơ vẫn hiển thị trên eno với mọi người, và thẻ hồ sơ vẫn xuất hiện ở các trang khác của eno, như danh sách giáo viên.'

function mount(over: Partial<FinishEdit> = {}, opts: { lang?: 'en' | 'vi'; mode?: 'edit' | 'join' } = {}) {
  const lang = opts.lang ?? 'en'
  if (lang === 'vi') try { sessionStorage.removeItem('lang-reload:en') } catch { /* no storage */ }
  const edit: FinishEdit = {
    live: true, listingLive: true, onToggleLive: vi.fn(), onDelete: vi.fn(),
    searchHidden: false, searchBusy: false, searchMessage: '', onToggleSearchHidden: vi.fn(), ...over,
  }
  render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <FinishStep
        t={{ ...EMPTY_TEACHER }} set={vi.fn()} errors={{}} errText={() => ''} mode={opts.mode ?? 'edit'} signedIn publishGate={null}
        prefillAvatar={null} prefillPhone={null} media={MEDIA} edit={opts.mode === 'join' ? null : edit} optInsNoticeChanged={false}
        identityMark={MARK}
        optIns={{ matchEmail: false, staffCall: false, onChange: vi.fn() }}
      />
    </LanguageProvider>,
  )
  return edit
}
const description = (sw: HTMLElement) =>
  (sw.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')

describe('"Hide my profile from search engines" — the switch', () => {
  it('a labelled switch, off by default, whose description is the helper line — in English and in Vietnamese', () => {
    mount()
    const sw = screen.getByRole('switch', { name: EN_NAME })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(description(sw)).toBe(EN_HELP)
    cleanup()
    mount({ searchHidden: true }, { lang: 'vi' })
    const vi = screen.getByRole('switch', { name: VI_NAME })
    expect(vi.getAttribute('aria-checked')).toBe('true')
    expect(description(vi)).toBe(VI_HELP)
  })
  it('⛔ honest: no promise about when Google drops a page, no claim that eno hides it', () => {
    expect(EN_HELP).not.toMatch(/immediately|at once|right away|within \d|minutes|hours|days|removes? your profile from eno/i)
    expect(VI_HELP).not.toMatch(/ngay lập tức|ngay|phút|giờ|ngày/)
    expect(EN_HELP).toMatch(/can take them a while/)
    expect(EN_HELP).toMatch(/stays on eno/)
    // The profile PAGE is what leaves search; its card stays on eno's other pages — the teacher lists, a shop with stock —
    // which stay indexable (review rounds 1 and 2).
    expect(EN_HELP).toMatch(/your profile page out of their results/)
    expect(EN_HELP).toMatch(/its card still shows on eno’s other pages, such as the teacher lists/)
    expect(VI_HELP).toMatch(/trang hồ sơ/)
    expect(VI_HELP).toMatch(/thẻ hồ sơ vẫn xuất hiện ở các trang khác của eno, như danh sách giáo viên/)
  })
  it('a tap asks the form to save the other way; a tap while a save is on its way is dropped', () => {
    const edit = mount()
    fireEvent.click(screen.getByRole('switch', { name: EN_NAME }))
    expect(edit.onToggleSearchHidden).toHaveBeenCalledWith(true)
    cleanup()
    const busy = mount({ searchHidden: true, searchBusy: true })
    expect(screen.getByText('Saving…')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: EN_NAME }))
    expect(busy.onToggleSearchHidden).not.toHaveBeenCalled()
  })
  it('not known yet (the profile did not load): disabled, and never toggled', () => {
    const edit = mount({ searchHidden: null })
    const sw = screen.getByRole('switch', { name: EN_NAME })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-disabled') === 'true' || sw.hasAttribute('disabled') || sw.hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(sw)
    expect(edit.onToggleSearchHidden).not.toHaveBeenCalled()
  })
  it('a refusal or a failure says so beside it', () => {
    mount({ searchMessage: 'rate_limited' })
    expect(screen.getByText('Too many requests — please try again in a few minutes.')).toBeTruthy()
    cleanup()
    mount({ searchMessage: 'failed' })
    expect(screen.getByRole('alert').textContent).toBe('Could not save the switch. Please try again.')
  })
  it('the join form has no such switch — it is a setting of a published profile', () => {
    mount({}, { mode: 'join' })
    expect(screen.queryByRole('switch', { name: EN_NAME })).toBeNull()
  })
})
