import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * /terms — the App Store Guideline 1.2 text (decision D8, docs/ios-appstore-release.md): zero tolerance for
 * objectionable content and abusive users, a 24-hour review of those reports, and no chance to put it right
 * for them. The rest of the page is pinned in ../legal-copy.test.tsx, whose stand-ins these repeat.
 */
const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi' }))

vi.mock('@/context/language-context', () => ({
  Tr: ({ text }: { text?: string | null }) => text ?? null,
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi != null ? vi : en) }),
}))
vi.mock('@/components/marketplace/bilingual', () => ({
  Bilingual: ({ en, vi, values }: { en: string; vi: string; values?: Record<string, string> }) =>
    Object.entries(values ?? {}).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), h.lang === 'vi' ? vi : en),
}))
vi.mock('@/components/marketplace/linkified-tr', () => ({ LinkifiedTr: ({ text }: { text: string }) => text }))
vi.mock('@/components/marketplace/content-page', () => ({
  ContentPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  ContentSection: ({ id, children }: { id?: string; children: ReactNode }) => <section id={id}>{children}</section>,
}))

vi.setConfig({ testTimeout: 30_000 })

afterEach(() => {
  vi.unstubAllEnvs()
  h.lang = 'en'
})

/** The page as one edition builds it, in one language, with React's text escaping undone. */
async function terms(lang: 'en' | 'vi', edition: 'marketplace' | 'services' = 'marketplace') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', edition === 'marketplace' ? 'https://eno.vn' : 'https://www.eno.forum')
  vi.resetModules()
  h.lang = lang
  const { default: TermsPage } = await import('./page')
  const html = renderToStaticMarkup(await TermsPage({ params: Promise.resolve({ lang }) }))
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

const section = (html: string, id: string) => html.match(new RegExp(`<section id="${id}">[\\s\\S]*?</section>`))?.[0] ?? ''

describe('/terms — objectionable content and abusive users (App Store Guideline 1.2)', () => {
  it('states zero tolerance in the posting rules, on both editions and in both languages', async () => {
    for (const edition of ['marketplace', 'services'] as const) {
      const en = section(await terms('en', edition), 'conduct')
      expect(en, edition).toContain('We have no tolerance for objectionable content or abusive users. You may not post, send or share content that is hateful or discriminatory')
      expect(en, edition).toContain('Severe terms are filtered before they are posted.')
      expect(en, edition).toContain('We review reports of objectionable content and abusive users within 24 hours, remove content that breaks this rule, and suspend or close the accounts responsible')
      const vi = section(await terms('vi', edition), 'conduct')
      expect(vi, edition).toContain('Chúng tôi không khoan nhượng với nội dung phản cảm và người dùng có hành vi lạm dụng. Bạn không được đăng, gửi hoặc chia sẻ nội dung')
      expect(vi, edition).toContain('Chúng tôi xem xét báo cáo về nội dung phản cảm và người dùng có hành vi lạm dụng trong vòng 24 giờ')
    }
  })

  // The eno team cannot be blocked (cannot_block_staff) and a shop eno lists on a business's behalf has no
  // account to block (src/app/api/blocks/route.ts), so the draft's "any user" would not have been true.
  it('promises a block on other users — never on "any user"', async () => {
    const en = await terms('en')
    expect(en).toContain('with the Report control on it, and you can block other users.')
    expect(en).not.toMatch(/block any user/i)
    const vi = await terms('vi')
    expect(vi).toContain('bằng nút Báo cáo trên đó, và có thể chặn người dùng khác.')
    expect(vi).not.toContain('chặn bất kỳ người dùng nào')
  })

  it('reviews those reports within 24 hours and keeps the 3-working-day acknowledgement for the rest', async () => {
    expect(section(await terms('en'), 'complaints')).toContain('Reports of objectionable content or abusive users are reviewed within 24 hours; other reports are acknowledged within 3 working days and handled through the process set out in Article 12')
    expect(section(await terms('vi'), 'complaints')).toContain('Báo cáo về nội dung phản cảm hoặc người dùng có hành vi lạm dụng được xem xét trong vòng 24 giờ; các báo cáo khác được xác nhận đã tiếp nhận trong vòng 3 ngày làm việc')
  })

  it('gives objectionable content and abuse no chance to put it right', async () => {
    expect(section(await terms('en'), 'termination')).toContain('give you a chance to put it right. Objectionable content and abuse of other users, described in the section on posting rules and conduct, are the exception: we act on them straight away, without that chance.')
    expect(section(await terms('vi'), 'termination')).toContain('cho bạn cơ hội khắc phục. Ngoại lệ là nội dung phản cảm và hành vi lạm dụng người dùng khác, nêu tại mục Quy tắc đăng tin và ứng xử: chúng tôi xử lý ngay mà không dành cơ hội khắc phục đó.')
  })
})
