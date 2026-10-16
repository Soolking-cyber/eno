// @vitest-environment jsdom
/**
 * PHOTO & PUBLISH — THE "IDENTITY VERIFIED" SWITCH (owner, 2026-10-15), drawn by IdentityMarkSection from the form's state
 * (the save itself is teacher-form.tsx's — teacher-form.edit.test.tsx):
 *   · the switch's DESCRIPTION is the notice — IdentityMarkNote, whose meaning is IDENTITY_MARK_NOTICE_VERSION: it names
 *     the three places the mark shows, the conditions, never the document, and "within a few minutes" (never "at once");
 *   · ONE state line per reason, from the server's reason; "Verify my identity" a link on the web and, in the iOS app
 *     with `ios-hide-kyc` on, plain text naming the website;
 *   · the trust line only while the identity check is LIVE;
 *   · a new profile (no profile yet) cannot save it — disabled, and the line says when it can;
 *   · ⛔ "xác minh" throughout — never "xác thực", never "Verified by eno".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import type { IdentityMarkReason } from '@/lib/teachers/identity-mark'

const ios = vi.hoisted(() => ({ on: false }))
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => ios.on }))

import { IdentityMarkNote, IdentityMarkSection, type FinishIdentityMark } from './finish-step'

const STAMPS = { at: null, withdrawnAt: null }
const mark = (reason: IdentityMarkReason | null | 'unknown', over: Partial<FinishIdentityMark> = {}): FinishIdentityMark => ({
  on: false, noticeChanged: false, base: STAMPS, canSave: true, busy: false, message: '', onToggle: vi.fn(),
  state: reason === 'unknown' ? null : reason === null ? { shown: true, reason: null } : { shown: false, reason },
  ...over,
})
const mount = (m: FinishIdentityMark, lang: 'en' | 'vi' = 'en') =>
  render(<LanguageProvider initialLang={lang} initialViDict={{}}><main><IdentityMarkSection mark={m} /></main></LanguageProvider>).container

const NOTICE_EN = 'Off unless you switch it on. While it’s on, “Identity verified” shows on your profile and on its card in lists — to anyone who can see them, schools, other members and search engines included — and to the people who message you about your profile, but only while your check is current and the name on your profile matches your ID. Never your document or anything on it. Switching it off removes it within a few minutes; search engines may show the old page until they visit again.'
const NOTICE_VI = 'Mặc định tắt. Khi bật, nhãn “Đã xác minh danh tính” hiển thị trên hồ sơ và trên thẻ hồ sơ trong các danh sách — với bất kỳ ai xem được, kể cả các trường, các thành viên khác và công cụ tìm kiếm — và với những người nhắn tin cho bạn về hồ sơ, nhưng chỉ khi việc xác minh còn hiệu lực và họ tên trên hồ sơ khớp với giấy tờ. Không bao giờ hiển thị giấy tờ hay bất kỳ thông tin nào trên đó. Khi bạn tắt, nhãn được gỡ trong vòng vài phút; công cụ tìm kiếm có thể vẫn hiển thị trang cũ cho đến lần truy cập tiếp theo.'

beforeEach(() => { ios.on = false })
afterEach(cleanup)

describe('IdentityMarkNote — the consent, word for word', () => {
  it.each([['en', NOTICE_EN], ['vi', NOTICE_VI]] as const)('%s', (lang, text) => {
    const c = render(<LanguageProvider initialLang={lang} initialViDict={{}}><IdentityMarkNote /></LanguageProvider>).container
    expect(c.querySelector('[data-testid="identity-mark-note"]')!.textContent).toBe(text)
  })
  it('names the three places, the conditions and the timing — never "at once", "xác thực" or "Verified by eno"', () => {
    expect(NOTICE_EN).toMatch(/on your profile/)
    expect(NOTICE_EN).toMatch(/on its card in lists/)
    expect(NOTICE_EN).toMatch(/to the people who message you about your profile/)
    expect(NOTICE_EN).toMatch(/only while your check is current and the name on your profile matches your ID/)
    expect(NOTICE_EN).toMatch(/Never your document/)
    expect(NOTICE_EN).toMatch(/within a few minutes/)
    expect(NOTICE_EN + NOTICE_VI).not.toMatch(/at once|ngay;|xác thực|Verified by eno/)
  })
})

describe('IdentityMarkSection — the switch', () => {
  it('a labelled switch whose DESCRIPTION is the notice — not part of its name', () => {
    mount(mark('off'))
    const sw = screen.getByRole('switch', { name: 'Show “Identity verified” on my profile' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    const desc = (sw.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(desc).toBe(NOTICE_EN)
  })
  it('shows the server\'s word: on is on', () => {
    mount(mark(null, { on: true }))
    expect(screen.getByRole('switch', { name: 'Show “Identity verified” on my profile' }).getAttribute('aria-checked')).toBe('true')
  })
  it('a toggle asks the form to save; a toggle while one is on its way is dropped', () => {
    const onToggle = vi.fn()
    mount(mark('off', { onToggle }))
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(true)
    cleanup()
    const busyToggle = vi.fn()
    mount(mark('off', { onToggle: busyToggle, busy: true }))
    expect(screen.getByText('Saving…')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch'))
    expect(busyToggle).not.toHaveBeenCalled()
  })
  it('a new profile (no profile yet): disabled, never toggled, and the line says when it can be', () => {
    const onToggle = vi.fn()
    mount(mark('unverified', { canSave: false, onToggle }))
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-disabled') === 'true' || sw.hasAttribute('disabled') || sw.hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(sw)
    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.getByText('You can switch this on after you publish your profile.')).toBeTruthy()
  })
})

describe('IdentityMarkSection — one line per reason', () => {
  const LINES: Record<string, RegExp> = {
    unverified: /^Verify your identity first — eno’s team checks an ID document and a selfie\. Verify my identity$/,
    pending: /^eno’s team is checking your ID\. It shows once approved\.$/,
    expired: /^Not showing: your verified ID has expired\. Verify your renewed document to show it again\. Verify my identity$/,
    no_name: /^Not showing: we have no name on record from your ID\. Verify your document again to show it\. Verify my identity$/,
    name_mismatch: /^Not showing: the name on your profile doesn’t match your verified ID\. Use your name as it is on your ID — you can leave out middle names\.$/,
    revoked: /^Not available for this account\. Contact support if you think this is a mistake\.$/,
  }
  const lineTexts = (c: HTMLElement) => [...c.querySelectorAll('section > p')].map((p) => p.textContent ?? '')

  it.each(Object.keys(LINES))('%s', (reason) => {
    const c = mount(mark(reason as IdentityMarkReason))
    const lines = lineTexts(c).filter((t) => Object.values(LINES).some((re) => re.test(t)))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(LINES[reason])
  })

  it('the link opens the verify page in a new tab, where it is offered', () => {
    for (const reason of ['unverified', 'expired', 'no_name'] as const) {
      mount(mark(reason))
      const link = screen.getByRole('link', { name: 'Verify my identity' })
      expect(link.getAttribute('href')).toBe('/dashboard/account/verify')
      expect(link.getAttribute('target')).toBe('_blank')
      cleanup()
    }
    for (const reason of ['pending', 'name_mismatch', 'revoked', 'off', null] as const) {
      mount(mark(reason))
      expect(screen.queryByRole('link', { name: 'Verify my identity' })).toBeNull()
      cleanup()
    }
  })

  it('⛔ in the iOS app (`ios-hide-kyc`): never a link — the website note, as plain text', () => {
    ios.on = true
    for (const reason of ['unverified', 'expired', 'no_name'] as const) {
      const c = mount(mark(reason))
      expect(screen.queryByRole('link')).toBeNull()
      expect(c.textContent).toMatch(/Identity verification is available on our website, in a web browser:/)
      cleanup()
    }
  })

  it('shown, off, or not known: no state line', () => {
    for (const reason of [null, 'off', 'unknown'] as const) {
      const c = mount(mark(reason))
      expect(lineTexts(c).filter((t) => Object.values(LINES).some((re) => re.test(t))), String(reason)).toEqual([])
      cleanup()
    }
  })

  it('switched on under older words: the warning line — unless the identity stands in the way first', () => {
    mount(mark('notice_changed', { noticeChanged: true }))
    expect(screen.getByText('What this switch does has changed since you turned it on. Switch it on again to keep showing it.')).toBeTruthy()
    cleanup()
    const c = mount(mark('expired', { noticeChanged: true }))
    expect(c.textContent).not.toContain('What this switch does has changed')
    expect(c.textContent).toContain('your verified ID has expired')
  })

  it('in Vietnamese: the curated lines — "xác minh", never "xác thực"', () => {
    const c = mount(mark('unverified'), 'vi')
    expect(c.textContent).toContain('Hãy xác minh danh tính trước — đội ngũ eno kiểm tra giấy tờ tùy thân và ảnh chân dung.')
    expect(screen.getByRole('link', { name: 'Xác minh danh tính' })).toBeTruthy()
    for (const reason of ['pending', 'expired', 'no_name', 'name_mismatch', 'revoked', 'notice_changed'] as const) {
      cleanup()
      const v = mount(mark(reason, { noticeChanged: reason === 'notice_changed' }), 'vi')
      expect(v.innerHTML, reason).not.toContain('xác thực')
    }
  })
})

describe('IdentityMarkSection — the trust line', () => {
  const TRUST = 'Your verified identity also adds 10 points to your trust score — one of the factors in the order of teacher lists — whether or not you show it.'
  it('only while the identity check is LIVE', () => {
    for (const reason of [null, 'off', 'notice_changed', 'no_name', 'name_mismatch'] as const) {
      expect(mount(mark(reason)).textContent, String(reason)).toContain(TRUST)
      cleanup()
    }
    for (const reason of ['unverified', 'pending', 'expired', 'revoked', 'unknown'] as const) {
      expect(mount(mark(reason)).textContent, reason).not.toContain(TRUST)
      cleanup()
    }
  })
})

describe('IdentityMarkSection — after a refusal', () => {
  it.each([
    ['reload', 'Some of the wording on this page has changed since you opened it. Reload the page to read it, then switch it on again.', 'status'],
    ['changed', 'This switch was changed in another window. It now shows what is saved — switch it on again if you want to.', 'status'],
    ['rate_limited', 'Too many requests — please try again in a few minutes.', 'status'],
    ['failed', 'Could not save the switch. Please try again.', 'alert'],
    ['unknown', 'Could not check the switch. Reload the page to see what is saved.', 'alert'],
  ] as const)('%s: a calm line', (message, text, role) => {
    mount(mark('off', { message }))
    const el = screen.getByText(text)
    expect(el.getAttribute('role')).toBe(role)
  })
})
