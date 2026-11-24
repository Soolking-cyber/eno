import { describe, expect, it, vi } from 'vitest'

// The marketplace: eno.forum has no /vi twins (lang-pinned.ts VI_PILOT is empty there), so the link never renders on it.
vi.mock('@/lib/edition', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/edition')>()), IS_SERVICES: false, IS_MARKETPLACE: true }))
import { renderToStaticMarkup } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { ViTwinLink } from './vi-twin-link'

const html = (path: string, lang: string) => renderToStaticMarkup(<LanguageProvider initialLang="en"><ViTwinLink path={path} lang={lang} /></LanguageProvider>)

/** Owner 2026-11-24 ("Add the link"): an English page with a /vi twin links it; nothing else does (Seobility: 979 sitemap-only pages). */
describe('ViTwinLink', () => {
  it('an English family page links its /vi twin, named in Vietnamese, hidden below sm', () => {
    const out = html('/help/help-who-can-leave-a-review', 'en')
    expect(out).toContain('href="/vi/help/help-who-can-leave-a-review"')
    expect(out).toContain('hrefLang="vi-VN"')
    expect(out).toContain('lang="vi"')
    expect(out).toContain('>Tiếng Việt</a>')
    expect(out).toContain('max-sm:sr-only')
    expect(html('/c/rentals/d2', 'en')).toContain('href="/vi/c/rentals/d2"')
    expect(html('/tools', 'en')).toContain('href="/vi/tools"')
  })
  it('never on the Vietnamese twin, a pilot page (it has its own switch), or a page with no twin', () => {
    expect(html('/help/help-who-can-leave-a-review', 'vi')).toBe('')
    expect(html('/', 'en')).toBe('')
    expect(html('/c/furniture-appliances', 'en')).toBe('')
    expect(html('/about', 'en')).toBe('')
    expect(html('/c/teachers', 'en')).toBe('')
  })
})
