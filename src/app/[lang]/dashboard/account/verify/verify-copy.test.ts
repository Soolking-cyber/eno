import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TRUST } from '@/lib/trust-math'

/**
 * ⛔ WHAT THE VERIFY PAGE SAYS A VERIFIED IDENTITY DOES (owner, 2026-10-15) — read from the source, as the /trust
 * contract does: the +points sentence is TRUST.V_KYC and lasts "while your verification is current"; a teacher profile
 * shows "Identity verified" AUTOMATICALLY (owner, 2026-10-16 — identity-v2's clause 5), never the document, and the
 * teacher can hide it; "you do this once" admits the expiry; "xác minh", never "xác thực" (Decree 69/2024). A superseded
 * declaration (the challenge route's 409 notice_changed) says "reload", never "try again". And the trust claim stays OFF
 * the hub (dashboard/verification), which the iOS app shows under ios-hide-kyc.
 * ⚠️ No translation-call literal in this file (gen-ui-strings harvests tests too): the sentences are found by their text.
 */
const page = readFileSync('src/app/[lang]/dashboard/account/verify/verify-client.tsx', 'utf8')
const hub = readFileSync('src/app/[lang]/dashboard/verification/verification-client.tsx', 'utf8')

/** The `{ en, vi }` pair whose English starts with `start` — the two single-quoted arguments that follow it. */
function pair(start: string): { en: string; vi: string } {
  const at = page.indexOf(`'${start}`)
  expect(at, start).toBeGreaterThan(-1)
  const m = page.slice(at).match(/^'([^']*)',\s*'([^']*)'/)
  expect(m, start).toBeTruthy()
  return { en: m![1], vi: m![2] }
}

describe('the verify page — what a verified identity does', () => {
  it('the trust sentence is TRUST.V_KYC points, while the verification is current — in both languages', () => {
    const { en, vi } = pair('A verified identity also adds')
    expect(en).toContain(`${TRUST.V_KYC} points to your trust score`)
    expect(en).toContain('while your verification is current')
    expect(vi).toContain(`${TRUST.V_KYC} điểm vào điểm uy tín`)
    expect(vi).toContain('còn hiệu lực')
    expect(vi).not.toContain('xác thực')
  })

  it('⛔ a teacher profile shows “Identity verified” automatically — never the document — and the teacher can hide it', () => {
    const { en, vi } = pair('If you have a teacher profile')
    expect(en).toContain('it shows “Identity verified” once your identity is verified')
    expect(en).toContain('never your document or anything on it')
    expect(en).toContain('You can hide it in your teacher profile.')
    // The opt-in sentence (2026-10-15) is gone: nothing here may say the teacher has to choose to show it.
    expect(en).not.toMatch(/choose to show|switch it on/)
    expect(vi).toContain('hồ sơ sẽ hiển thị nhãn “Đã xác minh danh tính” khi danh tính của bạn đã được xác minh')
    expect(vi).toContain('không bao giờ hiển thị giấy tờ hay thông tin trên giấy tờ')
    expect(vi).toContain('Bạn có thể ẩn nhãn này trong hồ sơ giáo viên.')
    expect(vi).not.toContain('chọn hiển thị')
    expect(vi).not.toContain('xác thực')
  })

  it('⛔ a superseded declaration (409 notice_changed) says "reload" — never "try again", which would loop — and offers the reload', () => {
    const { en, vi } = pair('The declaration has changed since you opened this page')
    expect(en).toContain('Reload the page to read the new one, then tick the box again.')
    expect(vi).toContain('Hãy tải lại trang để đọc nội dung mới')
    expect(vi).not.toContain('xác thực')
    // The branch keys on the route's refusal, sets the stale flag that disables the tier buttons, and renders the button.
    expect(page).toMatch(/r\.status === 409 && [^\n]*\.error === 'notice_changed'\)\s*\{\s*\/\/[^\n]*\n\s*setDeclarationChanged\(true\)/)
    expect(page.match(/disabled=\{!accepted \|\| retrySecs > 0 \|\| declarationChanged\}/g)).toHaveLength(2)
    expect(page).toContain('onClick={() => window.location.reload()}')
    expect(pair('Reload the page')).toEqual({ en: 'Reload the page', vi: 'Tải lại trang' })
  })

  it('renders the declaration in force — never a hard-coded version', () => {
    expect(page).toContain('DECLARATIONS[CURRENT_DECLARATION]')
    expect(page).toContain('version: CURRENT_DECLARATION, accepted: true')
    expect(page).not.toMatch(/['"]identity-v\d+['"]/)
  })

  it('"you do this once" admits the expiry (Q9: no longer true for a document that expires)', () => {
    const { en, vi } = pair('Vietnamese law requires sellers to verify their identity')
    expect(en).toContain('you do this once — again only if your document expires or is replaced')
    expect(vi).toContain('chỉ làm lại khi giấy tờ hết hạn hoặc được thay mới')
  })

  it('⛔ the hub the iOS app shows makes no trust-score claim', () => {
    expect(hub).not.toMatch(/trust score|điểm uy tín/)
  })
})
