// @vitest-environment jsdom
// Photo & publish, after "Fill it in from my CV" (2026-10-15): the phone in the file and the file itself are OFFERED —
// a tap each — and never used unasked.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { EMPTY_TEACHER, type TeacherInput } from '@/lib/teachers/profile'
import { FinishStep, type FinishMedia } from './finish-step'

afterEach(() => cleanup())

function mount(o: { t?: Partial<TeacherInput>; imported?: { phone: string | null; file: File | null } | null; prefillPhone?: string | null; cvName?: string | null; cvFile?: File | null } = {}) {
  const set = vi.fn()
  const onCvPick = vi.fn()
  const media = {
    busy: '', onPhoto: vi.fn(), onVideo: vi.fn(), privateVideo: false, savedPublicUrl: null, ownVideoUrl: null, ownVideoBusy: false,
    videoRemoving: false, confirmVideoRemove: false, setConfirmVideoRemove: vi.fn(), onWatchOwnVideo: vi.fn(), onCloseOwnVideo: vi.fn(),
    onOwnVideoError: vi.fn(), onRemovePrivateVideo: vi.fn(), cvName: o.cvName ?? null, cvFile: o.cvFile ?? null, onCvPick, onCvDiscard: vi.fn(), onCvRemove: null,
  } as unknown as FinishMedia
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <FinishStep
        t={{ ...EMPTY_TEACHER, ...o.t }} set={set} errors={{}} errText={() => ''} mode="join" signedIn publishGate={null}
        prefillAvatar={null} prefillPhone={o.prefillPhone ?? null} imported={o.imported ?? null} media={media} edit={null} optInsNoticeChanged={false}
      />
    </LanguageProvider>,
  )
  return { set, onCvPick }
}
const cv = new File([new Uint8Array(10)], 'Jane-Smith-CV.pdf', { type: 'application/pdf' })

describe('FinishStep — what the CV reading offers', () => {
  it('the number from the CV: one tap fills the phone; nothing is filled before it', () => {
    const { set } = mount({ imported: { phone: '+447700900123', file: null } })
    expect(set).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Use the number from my CV: \+447700900123/ }))
    expect(set).toHaveBeenCalledWith('phone', '+447700900123')
  })
  it('not offered when a phone is typed, or when it is the account’s own number (already offered)', () => {
    mount({ t: { phone: '+84901234567' }, imported: { phone: '+447700900123', file: null } })
    expect(screen.queryByRole('button', { name: /number from my CV/ })).toBeNull()
    cleanup()
    mount({ prefillPhone: '+447700900123', imported: { phone: '+447700900123', file: null } })
    expect(screen.queryByRole('button', { name: /number from my CV/ })).toBeNull()
  })
  it('the file the form was filled from, offered as the private CV — a pick like any other', () => {
    const { onCvPick } = mount({ imported: { phone: null, file: cv } })
    fireEvent.click(screen.getByRole('button', { name: /Attach the CV you used earlier/ }))
    expect(onCvPick).toHaveBeenCalledWith(cv)
  })
  it('not offered once a CV is picked or saved', () => {
    mount({ imported: { phone: null, file: cv }, cvFile: new File(['x'], 'other.pdf') })
    expect(screen.queryByRole('button', { name: /Attach the CV you used earlier/ })).toBeNull()
  })
})
