// @vitest-environment jsdom
/**
 * PHOTO & PUBLISH — THE "IDENTITY VERIFIED" SWITCH (owner, 2026-10-15; AUTOMATIC since 2026-10-16), drawn by
 * IdentityMarkSection from the form's state (the save itself is teacher-form.tsx's — teacher-form.edit.test.tsx and, for a
 * new profile, teacher-form.publish.test.tsx):
 *   · the switch's DESCRIPTION is the notice — IdentityMarkNote, whose meaning is IDENTITY_MARK_NOTICE_VERSION: on by
 *     default, the three places the mark shows, the conditions, never the document, and "within a few minutes" (never
 *     "at once") once it is switched off to hide it;
 *   · ON by default — checked means NOT hidden; a new profile's switch is enabled and held on the page (its line says the
 *     choice is saved at Publish); disabled only when an edit's profile did not load;
 *   · ONE state line per reason, from the server's reason; a line that promises the mark will show only while it is ON;
 *     "Verify my identity" a link on the web and, in the iOS app with `ios-hide-kyc` on, plain text naming the website;
 *   · the trust line only while the identity check is LIVE;
 *   · no opt-in nudge any more: no "switch it on" line, no notice-changed warning, no "reload" line;
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
  on: true, base: STAMPS, canSave: true, local: false, busy: false, message: '', onToggle: vi.fn(),
  state: reason === 'unknown' ? null : reason === null ? { shown: true, reason: null } : { shown: false, reason },
  ...over,
})
const mount = (m: FinishIdentityMark, lang: 'en' | 'vi' = 'en') => {
  // jsdom's device language is English, so the provider "reloads" a Vietnamese page once and, the next time in this tab,
  // swaps it to English (language-context.tsx reconcile): each Vietnamese mount here starts that guard afresh, or every
  // one after the first would quietly be checked in English.
  if (lang === 'vi') try { sessionStorage.removeItem('lang-reload:en') } catch { /* no storage: never swapped */ }
  return render(<LanguageProvider initialLang={lang} initialViDict={{}}><main><IdentityMarkSection mark={m} /></main></LanguageProvider>).container
}

// The spec's words (auto-spec.md, 2026-10-16), word for word.
const NOTICE_EN = 'On by default once your identity is verified. While it’s on, “Identity verified” shows on your profile and on its card in lists — to anyone who can see them, schools, other members and search engines included — and to the people who message you about your profile, but only while your check is current and the name on your profile matches your ID. Never your document or anything on it. Switch it off to hide it — it is removed within a few minutes, though search engines may show the old page until they visit again.'
const NOTICE_VI = 'Tự động bật khi danh tính của bạn đã được xác minh. Khi bật, nhãn “Đã xác minh danh tính” hiển thị trên hồ sơ và trên thẻ hồ sơ trong các danh sách — với bất kỳ ai xem được, kể cả các trường, các thành viên khác và công cụ tìm kiếm — và với những người nhắn tin cho bạn về hồ sơ, nhưng chỉ khi việc xác minh còn hiệu lực và họ tên trên hồ sơ khớp với giấy tờ. Không bao giờ hiển thị giấy tờ hay bất kỳ thông tin nào trên đó. Tắt để ẩn nhãn — nhãn được gỡ trong vòng vài phút, dù công cụ tìm kiếm có thể vẫn hiển thị trang cũ cho đến lần truy cập tiếp theo.'
const MARK_NAME = 'Show “Identity verified” on my profile'
const LOCAL_LINE = 'Your choice is saved when you publish.'

beforeEach(() => { ios.on = false })
afterEach(cleanup)

describe('IdentityMarkNote — what the teacher is told, word for word', () => {
  it.each([['en', NOTICE_EN], ['vi', NOTICE_VI]] as const)('%s', (lang, text) => {
    const c = render(<LanguageProvider initialLang={lang} initialViDict={{}}><IdentityMarkNote /></LanguageProvider>).container
    expect(c.querySelector('[data-testid="identity-mark-note"]')!.textContent).toBe(text)
  })
  it('on by default; names the three places, the conditions, how to hide it and the timing — never opt-in words, "at once", "xác thực" or "Verified by eno"', () => {
    expect(NOTICE_EN).toMatch(/^On by default once your identity is verified\./)
    expect(NOTICE_EN).toMatch(/on your profile/)
    expect(NOTICE_EN).toMatch(/on its card in lists/)
    expect(NOTICE_EN).toMatch(/to the people who message you about your profile/)
    expect(NOTICE_EN).toMatch(/only while your check is current and the name on your profile matches your ID/)
    expect(NOTICE_EN).toMatch(/Never your document/)
    expect(NOTICE_EN).toMatch(/Switch it off to hide it/)
    expect(NOTICE_EN).toMatch(/within a few minutes/)
    expect(NOTICE_EN).not.toMatch(/Off unless|switch it on/i)
    expect(NOTICE_VI).not.toMatch(/Mặc định tắt/)
    expect(NOTICE_EN + NOTICE_VI).not.toMatch(/at once|ngay;|xác thực|Verified by eno/)
  })
})

describe('IdentityMarkSection — the switch', () => {
  it('a labelled switch, ON by default, whose DESCRIPTION is the notice — not part of its name', () => {
    mount(mark(null))
    const sw = screen.getByRole('switch', { name: MARK_NAME })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    const desc = (sw.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(desc).toBe(NOTICE_EN)
  })
  it('shows the server\'s word: hidden is off', () => {
    mount(mark('hidden', { on: false }))
    expect(screen.getByRole('switch', { name: MARK_NAME }).getAttribute('aria-checked')).toBe('false')
  })
  it('a toggle asks the form to save — off is a hide; a toggle while one is on its way is dropped', () => {
    const onToggle = vi.fn()
    mount(mark(null, { onToggle }))
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(false)
    cleanup()
    const busyToggle = vi.fn()
    mount(mark(null, { onToggle: busyToggle, busy: true }))
    expect(screen.getByText('Saving…')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch'))
    expect(busyToggle).not.toHaveBeenCalled()
  })
  it('a NEW profile (no profile yet): ENABLED and held on the page — the line says when the choice is saved', () => {
    const onToggle = vi.fn()
    mount(mark('no_profile', { local: true, onToggle }))
    const sw = screen.getByRole('switch', { name: MARK_NAME })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.getAttribute('aria-disabled') === 'true' || sw.hasAttribute('disabled') || sw.hasAttribute('data-disabled')).toBe(false)
    expect(screen.getByText(LOCAL_LINE)).toBeTruthy()
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith(false)
    // While the Publish carrying it is on its way: a tap is dropped, and the switch says nothing of its own save.
    cleanup()
    const publishing = vi.fn()
    mount(mark('no_profile', { local: true, busy: true, onToggle: publishing }))
    fireEvent.click(screen.getByRole('switch'))
    expect(publishing).not.toHaveBeenCalled()
    expect(screen.queryByText('Saving…')).toBeNull()
  })
  it('an edit whose profile did not load: disabled, never toggled — and no line promising a later switch-on', () => {
    const onToggle = vi.fn()
    mount(mark('unknown', { canSave: false, onToggle }))
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-disabled') === 'true' || sw.hasAttribute('disabled') || sw.hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(sw)
    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.queryByText(LOCAL_LINE)).toBeNull()
  })
  it('⛔ no opt-in nudge is left: no "switch this on", no notice-changed warning', () => {
    for (const m of [mark(null), mark('hidden', { on: false }), mark('no_profile', { local: true }), mark('unknown', { canSave: false })]) {
      const c = mount(m)
      expect(c.textContent).not.toMatch(/switch (this|it) on|What this switch does has changed/i)
      cleanup()
    }
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
  // ⚠️ Beside a HIDDEN mark (switch off), a line never promises it will show: the hide outlasts any approval.
  const HIDDEN_LINES: Record<string, RegExp> = {
    unverified: LINES.unverified,
    pending: /^eno’s team is checking your ID\.$/,
    expired: /^Your verified ID has expired\. Verify my identity$/,
    no_name: /^We have no name on record from your ID\. Verify my identity$/,
    name_mismatch: LINES.name_mismatch,
    revoked: LINES.revoked,
  }
  const ALL = [...Object.values(LINES), ...Object.values(HIDDEN_LINES)]
  const lineTexts = (c: HTMLElement) => [...c.querySelectorAll('section > p')].map((p) => p.textContent ?? '')

  it.each(Object.keys(LINES))('%s', (reason) => {
    const c = mount(mark(reason as IdentityMarkReason))
    const lines = lineTexts(c).filter((t) => ALL.some((re) => re.test(t)))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(LINES[reason])
  })

  it.each(Object.keys(HIDDEN_LINES))('%s, beside a hidden mark: no promise that it shows', (reason) => {
    const c = mount(mark(reason as IdentityMarkReason, { on: false }))
    const lines = lineTexts(c).filter((t) => ALL.some((re) => re.test(t)))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(HIDDEN_LINES[reason])
    expect(lines[0]).not.toMatch(/It shows once approved|to show it/)
  })

  it('the link opens the verify page in a new tab, where it is offered', () => {
    for (const reason of ['unverified', 'expired', 'no_name'] as const) {
      for (const on of [true, false]) {
        mount(mark(reason, { on }))
        const link = screen.getByRole('link', { name: 'Verify my identity' })
        expect(link.getAttribute('href')).toBe('/dashboard/account/verify')
        expect(link.getAttribute('target')).toBe('_blank')
        cleanup()
      }
    }
    for (const reason of ['pending', 'name_mismatch', 'revoked', 'hidden', 'no_profile', null] as const) {
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

  it('shown, hidden, no profile yet, or not known: no state line', () => {
    for (const reason of [null, 'hidden', 'no_profile', 'unknown'] as const) {
      const c = mount(mark(reason, { on: reason !== 'hidden' }))
      expect(lineTexts(c).filter((t) => ALL.some((re) => re.test(t))), String(reason)).toEqual([])
      cleanup()
    }
  })

  it('in Vietnamese: the curated lines — "xác minh", never "xác thực"', () => {
    const c = mount(mark('unverified'), 'vi')
    expect(c.textContent).toContain('Hãy xác minh danh tính trước — đội ngũ eno kiểm tra giấy tờ tùy thân và ảnh chân dung.')
    expect(screen.getByRole('link', { name: 'Xác minh danh tính' })).toBeTruthy()
    for (const on of [true, false]) {
      for (const reason of ['pending', 'expired', 'no_name', 'name_mismatch', 'revoked', 'hidden', 'no_profile'] as const) {
        cleanup()
        const v = mount(mark(reason, { on, local: reason === 'no_profile' }), 'vi')
        expect(v.textContent, `${reason} ${on}`).toContain('Hiển thị “Đã xác minh danh tính” trên hồ sơ') // really Vietnamese
        expect(v.innerHTML, `${reason} ${on}`).not.toContain('xác thực')
      }
    }
    cleanup()
    expect(mount(mark('pending', { on: false }), 'vi').textContent).toContain('Đội ngũ eno đang kiểm tra giấy tờ của bạn.')
    cleanup()
    expect(mount(mark('no_profile', { local: true }), 'vi').textContent).toContain('Lựa chọn của bạn được lưu khi bạn đăng hồ sơ.')
  })
})

describe('IdentityMarkSection — the trust line', () => {
  const TRUST = 'Your verified identity also adds 10 points to your trust score — one of the factors in the order of teacher lists — whether or not you show it.'
  it('only while the identity check is LIVE — a hide, the name or no profile yet holding the mark back included', () => {
    for (const reason of [null, 'hidden', 'no_profile', 'no_name', 'name_mismatch'] as const) {
      expect(mount(mark(reason, { on: reason !== 'hidden' })).textContent, String(reason)).toContain(TRUST)
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
    ['changed', 'This switch was changed in another window. It now shows what is saved — change it again if you want to.', 'status'],
    ['rate_limited', 'Too many requests — please try again in a few minutes.', 'status'],
    ['failed', 'Could not save the switch. Please try again.', 'alert'],
    ['unknown', 'Could not check the switch. Reload the page to see what is saved.', 'alert'],
  ] as const)('%s: a calm line', (message, text, role) => {
    mount(mark('hidden', { on: false, message }))
    const el = screen.getByText(text)
    expect(el.getAttribute('role')).toBe(role)
  })
  it('no "reload the page to read it" line any more — the mark has no notice to re-read (2026-10-16)', () => {
    for (const message of ['', 'changed', 'rate_limited', 'failed', 'unknown'] as const) {
      expect(mount(mark(null, { message })).textContent, message).not.toMatch(/Reload the page to read it|switch it on again/)
      cleanup()
    }
  })
})
