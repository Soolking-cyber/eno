// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

/**
 * ⛔ THE LANDING IS IN THE SERVER'S HTML (owner 2026-11-17, "Ad landing page"): the old ad landing was blank until its script ran,
 * and a third of the visitors left in that wait. The words AND the sign-in form must render on the server, before any script.
 */
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: true, openSignIn: () => {} }) }))
// ⛔ useSearchParams THROWS here: on this static page any call would drop the whole tree out of the server's HTML (Next's
// client-only bailout), so the render must not reach it anywhere below the landing.
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }), usePathname: () => '/post/facebook', useSearchParams: () => { throw new Error('useSearchParams on the static landing') } }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: {} }) }))
const { FacebookImportLanding } = await import('./facebook-import-landing')

describe('the Facebook-import landing, server-rendered', () => {
  it('in Vietnamese: the heading, the line and a working email field — with no script run', () => {
    const html = renderToString(
      <LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}>
        <FacebookImportLanding />
      </LanguageProvider>,
    )
    expect(html).toContain('Đăng tin Marketplace lên eno.vn, miễn phí')
    expect(html).toContain('không cần gõ lại')
    expect(html).toMatch(/<input[^>]+type="email"/)
  })
})
