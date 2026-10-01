import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AMENDED, LEGAL_AMENDMENT } from './legal-amendment'
import { AMENDMENT_NOTICE, AMENDMENT_NOTICE_ID_PREFIX, AMENDMENT_NOTICE_URL, noticeSendable } from './legal-amendment-notice'
import { TOS_EFFECTIVE_AT } from '@/lib/site-legal'

/**
 * The notice to registered users (Quy chế Article 15) — the bell copy scripts/notify-legal-amendment.ts
 * writes, and when it may be written.
 */
const ROOT = join(__dirname, '..', '..', '..')

describe('the amendment notice to registered users', () => {
  it('says exactly what the site-wide strip says', () => {
    const strip = readFileSync(join(ROOT, 'src/components/marketplace/tos-change-notice.tsx'), 'utf8')
    const [en, vi] = [...strip.matchAll(/^\s*'((?:Our Terms|Điều khoản dịch vụ, Quy chế)[^']+)',$/gm)].map((m) => m[1])
    expect(en).toBeTruthy()
    expect(vi).toBeTruthy()
    expect(AMENDMENT_NOTICE.en.body).toBe(en.replace('{date}', AMENDED.inForceEn))
    expect(AMENDMENT_NOTICE.vi.body).toBe(vi.replace('{date}', AMENDED.inForceVi))
    expect(AMENDMENT_NOTICE_URL).toBe('/regulations#changelog')
    expect(strip).toContain(`href="${AMENDMENT_NOTICE_URL}"`)
  })

  it('names no site and nothing across the edition boundary — one row is read on both editions', () => {
    const all = JSON.stringify(AMENDMENT_NOTICE)
    expect(all).not.toMatch(/eno\.(vn|forum)|visa|itinerar|PayPal/i)
  })

  it('derives one id per account per amendment', () => {
    expect(AMENDMENT_NOTICE_ID_PREFIX).toBe(`legal-amendment-${LEGAL_AMENDMENT.published}-`)
  })

  it('may be sent only inside the notice window, measured in Vietnam time', () => {
    const published = Date.parse(`${LEGAL_AMENDMENT.published}T00:00:00+07:00`)
    expect(noticeSendable(new Date(published - 1)).ok).toBe(false)
    expect(noticeSendable(new Date(published)).ok).toBe(true)
    expect(noticeSendable(new Date(TOS_EFFECTIVE_AT - 1)).ok).toBe(true)
    // The same instant that switches the Terms version in force closes the window.
    const closed = noticeSendable(new Date(TOS_EFFECTIVE_AT))
    expect(closed.ok).toBe(false)
    expect(closed.ok ? '' : closed.reason).toContain('notice window is over')
    expect(noticeSendable(new Date(Number.NaN)).ok).toBe(false)
  })

  it('the script reads its copy, id and window from here and writes nothing without --apply', () => {
    const script = readFileSync(join(ROOT, 'scripts/notify-legal-amendment.ts'), 'utf8')
    expect(script).toContain("from '../src/lib/compliance/legal-amendment-notice'")
    expect(script).toContain('ON CONFLICT (id) DO NOTHING')
    expect(script).toContain("default_transaction_read_only=on")
    expect(script).toMatch(/if \(apply\) throw new Error\(`refusing to send: \$\{window\.reason\}`\)/)
  })
})
