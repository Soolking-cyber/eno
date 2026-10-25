import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The marketplace email footer's tagline speaks the email's language (sweep, 2026-10-22): every Vietnamese email —
 * sign-in link and code, verification outcomes, the teacher photo and video asks — closed on the English line
 * "eno.vn — free classifieds for expats and locals in Vietnam." The edition flag is read at import, so the module is
 * loaded as the marketplace build.
 */
async function marketplaceLayout() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  return import('./layout')
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('email footer tagline', () => {
  it('Vietnamese email → Vietnamese tagline; English (or unspecified) → English', async () => {
    const { renderBrandEmail } = await marketplaceLayout()
    const vi_ = renderBrandEmail({ preheader: 'x', bodyHtml: '', origin: 'https://eno.vn', lang: 'vi' })
    expect(vi_).toContain('rao vặt')
    expect(vi_).not.toContain('classifieds for expats')
    const en = renderBrandEmail({ preheader: 'x', bodyHtml: '', origin: 'https://eno.vn' })
    expect(en).toContain('classifieds for expats and locals in Vietnam.')
  })
})
