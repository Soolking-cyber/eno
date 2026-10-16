import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TRUST } from '@/lib/trust-math'

/**
 * ⛔ WHAT THE VERIFY PAGE SAYS A VERIFIED IDENTITY DOES (owner, 2026-10-15) — read from the source, as the /trust
 * contract does: the +points sentence is TRUST.V_KYC and lasts "while your verification is current"; a teacher may show
 * it on their profile, never the document; "you do this once" admits the expiry; "xác minh", never "xác thực" (Decree
 * 69/2024). And the trust claim stays OFF the hub (dashboard/verification), which the iOS app shows under ios-hide-kyc.
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

  it('a teacher may show “Identity verified” — never the document', () => {
    const { en, vi } = pair('If you have a teacher profile')
    expect(en).toContain('“Identity verified”')
    expect(en).toContain('never your document or anything on it')
    expect(vi).toContain('“Đã xác minh danh tính”')
    expect(vi).not.toContain('xác thực')
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
