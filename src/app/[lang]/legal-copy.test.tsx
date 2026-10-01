import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AMENDED } from '@/lib/compliance/legal-amendment'
import { TOS_EFFECTIVE_AT, TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

/**
 * THE PUBLISHED LEGAL TEXTS SAY WHAT THE CODE DOES (W-B, 2026-10-01).
 *
 * /terms, /returns, /prohibited, /regulations and /legal/ranking are statements a regulator reads.
 * These tests render each page's own markup (chrome replaced by thin stand-ins, as in
 * about/about-page.test.tsx) and pin the corrections: a curated Vietnamese body on the `vi` variant
 * with no "English is authoritative" note, the linked-listings regime, the narrowed returns scope,
 * the Law 122/2025 + Decree 248/2026 basis, the per-issue complaint deadlines, and a ranking
 * disclosure that no longer denies the For You rail or implies featured placement is bought.
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
vi.mock('@/components/marketplace/partner-badge', () => ({ PartnerBadge: () => null }))
vi.mock('@/components/marketplace/linkified-tr', () => ({ LinkifiedTr: ({ text }: { text: string }) => text }))
vi.mock('@/components/marketplace/cookie-settings-button', () => ({ CookieSettingsButton: () => null }))
vi.mock('@/components/marketplace/content-page', () => ({
  ContentPage: ({ title, titleVi, meta, intro, sections, children }: {
    title: string; titleVi?: string; meta?: ReactNode; intro?: ReactNode
    sections?: { id: string; label: string; labelVi?: string }[]; children: ReactNode
  }) => (
    <main>
      <h1>{h.lang === 'vi' && titleVi ? titleVi : title}</h1>
      {meta}
      <p>{intro}</p>
      <nav>{sections?.map((s) => <a key={s.id} href={`#${s.id}`}>{h.lang === 'vi' && s.labelVi ? s.labelVi : s.label}</a>)}</nav>
      {children}
    </main>
  ),
  ContentSection: ({ id, title, titleVi, children }: { id?: string; title?: string; titleVi?: string; children: ReactNode }) => (
    <section id={id}>
      {title && <h2>{h.lang === 'vi' && titleVi ? titleVi : title}</h2>}
      {children}
    </section>
  ),
}))

vi.setConfig({ testTimeout: 30_000 })

async function page<T>(path: string, lang: 'en' | 'vi', edition: 'marketplace' | 'services' = 'marketplace'): Promise<T> {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', edition === 'marketplace' ? 'https://eno.vn' : 'https://www.eno.forum')
  vi.resetModules()
  h.lang = lang
  return import(/* @vite-ignore */ path) as Promise<T>
}

type LangPage = { default: (p: { params: Promise<{ lang: string }> }) => Promise<React.ReactElement> }

async function renderLang(path: string, lang: 'en' | 'vi') {
  const mod = await page<LangPage>(path, lang)
  return renderToStaticMarkup(await mod.default({ params: Promise.resolve({ lang }) }))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  h.lang = 'en'
})

/** Pin the clock (Date only) so a page that reads the version in force renders deterministically. */
function clockAt(at: number) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
}

/** Text a page renders, with React's attribute/text escaping undone, for phrase assertions. */
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

const ENGLISH_AUTHORITATIVE = /English version of (these terms|this policy) is the authoritative/i

describe('/terms', () => {
  it('serves a curated Vietnamese body on the vi variant, with no "English governs" note', async () => {
    const html = await renderLang('./terms/page', 'vi')
    expect(html).toContain('<h1>Điều khoản dịch vụ</h1>')
    expect(html).toContain('<section id="linked"><h2>Tin đăng liên kết</h2>')
    expect(html).toContain('trang nguồn')
    expect(html).toContain('ít nhất 20 ngày trước ngày áp dụng')
    expect(html).not.toMatch(ENGLISH_AUTHORITATIVE)
    // LegalLanguageNote, unapproved: no language is declared authoritative.
    expect(html).toContain('đang được luật sư rà soát')
    expect(html).toContain('chưa có bản ngôn ngữ nào')
    expect(html).toContain(`Cập nhật lần cuối: ${AMENDED.publishedVi}`)
  })

  it('carries the linked-listings regime and the commission disclosure, and drops "every listing is posted by its seller"', async () => {
    const html = await renderLang('./terms/page', 'en')
    expect(html).toContain('<section id="linked"><h2>Linked listings</h2>')
    expect(html).toContain('Every linked listing names its source site')
    expect(html).toContain('We may earn a commission from some partners and affiliate shops')
    expect(html).toContain('at least 20 days before they apply')
    expect(html).not.toContain('Every listing is created and published by the person or business')
    expect(html).not.toMatch(ENGLISH_AUTHORITATIVE)
    // The pre-existing promise, kept word for word (it binds a TOS_VERSION bump), and the note's wording.
    expect(html).toContain('the version shown at the top of this page changes with them')
    expect(html).toContain(`Changes published on ${AMENDED.publishedEn}, in force from ${AMENDED.inForceEn}`)
    expect(html).toContain('a translation prepared by eno that our lawyers are still reviewing')
    expect(html).not.toContain('reviewed translation')
  })

  it('headlines the version IN FORCE during the notice window and says which text binds', async () => {
    clockAt(TOS_EFFECTIVE_AT - 1)
    const en = text(await renderLang('./terms/page', 'en'))
    expect(en).toContain(`Version ${TOS_PREVIOUS_VERSION}</p>`)
    expect(en).toContain(`The text below is version ${TOS_VERSION}, published on ${AMENDED.publishedEn} and in force from ${AMENDED.inForceEn}. Until then, version ${TOS_PREVIOUS_VERSION} remains in force.`)
    const viHtml = text(await renderLang('./terms/page', 'vi'))
    expect(viHtml).toContain(`Trước ngày đó, phiên bản ${TOS_PREVIOUS_VERSION} vẫn là phiên bản đang có hiệu lực.`)
  })

  it('links the text in force — published, not "write to us for a copy" (Quy chế Article 15)', async () => {
    clockAt(TOS_EFFECTIVE_AT - 1)
    const en = text(await renderLang('./terms/page', 'en'))
    expect(en).toContain(`<a href="/terms/v${TOS_PREVIOUS_VERSION}" class="font-semibold text-accent-foreground hover:underline">Read version ${TOS_PREVIOUS_VERSION}</a>`)
    expect(en).not.toMatch(/write to us for a copy/i)
    // The change note names it too, linked (the vi body is linkified on the server).
    const viHtml = text(await renderLang('./terms/page', 'vi'))
    expect(viHtml.match(/href="\/terms\/v1"/g)?.length).toBe(2)
  })

  it('headlines the new version alone from the in-force instant', async () => {
    clockAt(TOS_EFFECTIVE_AT)
    const en = text(await renderLang('./terms/page', 'en'))
    expect(en).toContain(`Version ${TOS_VERSION}</p>`)
    expect(en).not.toContain('The text below is version')
  })

  it('does not promise a button that opens the original posting, and lists every substantive edit', async () => {
    const en = text(await renderLang('./terms/page', 'en'))
    expect(en).toContain('its button takes you to the source site')
    expect(en).not.toContain('opens the original posting')
    for (const edit of ['who posts listings rewritten', 'where complaints about them go', 'applying to listings posted here', 'Official partner badge reserved', 'at least 20 days ahead instead of 5']) {
      expect(en).toContain(edit)
    }
    const viHtml = text(await renderLang('./terms/page', 'vi'))
    expect(viHtml).toContain('nút trên tin sẽ đưa bạn sang trang nguồn')
    expect(viHtml).toContain('trốn tránh biện pháp tạm khoá tài khoản')
    expect(viHtml).not.toContain('lách việc')
    // Unambiguous: the NOTICE grows from 5 to 20 days, not the fee.
    expect(viHtml).toContain('mọi thay đổi về phí được công bố trước ít nhất 20 ngày, thay vì 5 ngày như trước đây')
    expect(viHtml).not.toContain('tăng từ 5 lên 20 ngày')
    // One term for the trust score — the one the UI uses (trust-score.tsx, /trust).
    expect(viHtml).toContain('điểm uy tín')
    expect(viHtml).not.toMatch(/tín nhiệm|điểm tin cậy/)
  })
})

describe('/returns', () => {
  it('binds only business sellers who sell through chat and accepted the policy; linked listings follow the shop', async () => {
    const html = await renderLang('./returns/page', 'en')
    expect(html).toContain('applies only to purchases from a business seller that sells through chat on eno.vn and has accepted this policy')
    expect(html).toContain('A linked listing')
    expect(html).toContain('follows that seller&#x27;s own returns and refund policy')
    expect(html).toContain(`in force from ${AMENDED.inForceEn}`)
    // The old promise survives only as history inside the dated change note.
    expect(html).not.toContain('This policy is the returns commitment of the verified business storefronts')
    expect(html).not.toMatch(ENGLISH_AUTHORITATIVE)
  })

  it('renders the curated Vietnamese on the vi variant', async () => {
    const html = await renderLang('./returns/page', 'vi')
    expect(html).toContain('<h1>Đổi trả và hoàn tiền</h1>')
    expect(html).toContain('đã chấp nhận chính sách này với chúng tôi')
    expect(html).toContain(`có hiệu lực từ ngày ${AMENDED.inForceVi}`)
  })
})

describe('/prohibited', () => {
  it('renders the curated Vietnamese list on the vi variant', async () => {
    const html = await renderLang('./prohibited/page', 'vi')
    expect(html).toContain('Hàng hoá và dịch vụ cấm đăng')
    expect(html).toContain('Ma tuý, tiền chất ma tuý')
    expect(html).toContain('<h2>Xử lý vi phạm</h2>')
    expect(html).toContain('đang được luật sư rà soát')
  })
})

describe('/partners', () => {
  it('says eno grants and withdraws the badge — not "a person, never an algorithm", which bulk importers falsify', async () => {
    for (const lang of ['en', 'vi'] as const) {
      const mod = await page<{ default: () => React.ReactElement }>('./partners/page', lang)
      const html = renderToStaticMarkup(mod.default())
      expect(html).not.toMatch(/algorithm|thuật toán|a person at eno|một người của eno/)
      expect(html).toContain(lang === 'en' ? 'The badge is granted and withdrawn by eno' : 'Huy hiệu do eno cấp và thu hồi')
      expect(html).not.toContain('It is not advertising')
      // Not every shop button reaches the product (SuperSports lands on the shop; some campaigns take two steps).
      expect(text(html)).not.toMatch(/opens the product|mở sản phẩm/)
      expect(text(html)).toContain(lang === 'en' ? "its button takes you to the shop's own website" : 'nút trên tin đưa bạn sang chính website của cửa hàng')
    }
    const viHtml = renderToStaticMarkup((await page<{ default: () => React.ReactElement }>('./partners/page', 'vi')).default())
    expect(viHtml).toContain('Nói rõ về vai trò của eno')
    expect(viHtml).not.toMatch(/Vị trí của eno|tín nhiệm/)
  })
})

describe('/regulations', () => {
  async function regs(edition: 'marketplace' | 'services' = 'marketplace') {
    const mod = await page<{ default: () => React.ReactElement }>('./regulations/page', 'en', edition)
    return renderToStaticMarkup(mod.default())
  }
  const section = (html: string, id: string) => html.match(new RegExp(`<section id="${id}">[\\s\\S]*?</section>`))?.[0] ?? ''

  it('cites Law 122/2025 and Decree 248/2026; the repealed decrees appear only in the change log', async () => {
    const html = await regs()
    expect(html).toContain('Luật Thương mại điện tử số 122/2025/QH15')
    expect(html).toContain('Nghị định 248/2026/NĐ-CP')
    const withoutLog = html.replace(section(html, 'changelog'), '')
    expect(withoutLog).not.toMatch(/52\/2013|85\/2021/)
    expect(section(html, 'changelog')).toContain(AMENDED.inForceVi)
    expect(html).not.toMatch(/01\/10\/2026, có hiệu lực từ ngày 06\/10/)
  })

  it('names the legal representative and the ERC issuing authority (Article 2)', async () => {
    const { COMPANY } = await import('@/lib/site-legal')
    const op = section(await regs(), 'operator')
    expect(op).toContain(`Người đại diện theo pháp luật: ${COMPANY.legalRep}`)
    expect(op).toContain(`do ${COMPANY.ercAuthority} cấp ngày ${COMPANY.ercIssued}`)
  })

  it('publishes a per-issue deadline table in Article 12', async () => {
    const c = section(await regs(), 'complaints')
    expect(c).toContain('<table')
    expect((c.match(/<tr/g) ?? []).length).toBe(7) // header + six kinds of issue
    expect(c).toContain('Yêu cầu của cơ quan nhà nước có thẩm quyền')
    expect(c).toContain('2 ngày làm việc')
  })

  it('defines linked listings and the official-partner badge, and discloses the ranking facts', async () => {
    const html = await regs()
    expect(section(html, 'activity')).toContain('Tin đăng liên kết.')
    expect(section(html, 'activity')).toContain('Cửa hàng liên kết')
    const r = section(html, 'ranking')
    expect(r).toContain('Dành cho bạn')
    // Recently viewed is history-based display too (ND 248/2026 Art 11.2(c)) and is disclosed.
    expect(r).toContain('Đã xem gần đây')
    expect(r).toContain('Recently viewed')
    // Names the switch, not a default this tree may not have; no database fact, no unrendered label.
    expect(r).not.toContain('only if the user turns personalisation on')
    expect(r).not.toContain('No listing is featured at present')
    expect(r).not.toContain('Hiện chưa có tin nào được chọn làm tin nổi bật')
    expect(r).toContain('eSIM')
    expect(r).toContain('không được bán')
    expect(r).not.toContain('không được công bố nhằm tránh bị thao túng')
    expect(section(html, 'amendments')).toContain('20 ngày làm việc')
    expect(section(html, 'fees')).toContain('ít nhất 20 ngày')
  })

  it('describes the brand rule per page of results, and no button as opening the original posting', async () => {
    const html = text(await regs())
    const r = section(html, 'ranking')
    expect(r).toContain('trong mỗi trang kết quả được tải')
    expect(r).toContain('no listing is moved from one page of results to another')
    expect(html).not.toMatch(/tin gốc|opens the original posting|link to the original/)
    expect(section(html, 'activity')).toContain('có nút đưa người mua sang trang nguồn')
    expect(r).not.toMatch(/Ô tin đăng|[Dd]ải /)
    // Only Article 17 may name the retired term — it records the change.
    expect(html.replace(section(html, 'changelog'), '')).not.toMatch(/tín nhiệm|tin cậy của người bán/)
  })

  it('logs EVERY substantive edit in Article 17, numbered in sequence (eno.vn)', async () => {
    const log = text(section(await regs(), 'changelog'))
    for (const edit of [
      'cơ quan cấp Giấy chứng nhận đăng ký doanh nghiệp tại Điều 2',
      'đăng ký nền tảng thương mại điện tử trung gian, thay cho “đăng ký website cung cấp dịch vụ thương mại điện tử”',
      'nghĩa vụ của đơn vị vận hành tại Điều 4',
      'rà soát tự động trước khi hiển thị tại Điều 10 vào tin do người bán đăng trên sàn',
      'có hiệu lực từ ngày ghi tại Điều 17',
      'biểu phí phải được công bố ít nhất 20 ngày trước ngày áp dụng thay vì 5 ngày',
    ]) expect(log).toContain(edit)
    expect(log).not.toContain('từ 5 lên 20')
    const numbers = [...log.matchAll(/\((\d+)\) /g)].map((m) => Number(m[1]))
    // Vietnamese then English: each list counts 1..n with no gap.
    const n = numbers.length / 2
    expect(numbers).toEqual([...Array.from({ length: n }, (_, i) => i + 1), ...Array.from({ length: n }, (_, i) => i + 1)])
  })

  it('claims on eno.forum only the Article 2 additions eno.forum actually got', async () => {
    const html = text(await regs('services'))
    const op = section(html, 'operator')
    expect(op).not.toContain('cấp ngày đang cập nhật') // the authority clause is not rendered there…
    const log = section(html, 'changelog')
    expect(log).not.toContain('cơ quan cấp Giấy chứng nhận') // …so the log must not claim it
    expect(log).not.toContain('authority that issued')
    expect(log).toContain('bổ sung mục người đại diện theo pháp luật tại Điều 2')
    // The MoIT test-operation paragraph is eno.vn-only, and so is its log line.
    expect(log).not.toContain('đăng ký website cung cấp dịch vụ thương mại điện tử')
  })

  it('publishes where the version in force lives, linked from META and Article 17', async () => {
    const html = text(await regs())
    const head = html.slice(0, html.indexOf('<nav>'))
    expect(head).toContain(`Phiên bản ${TOS_VERSION}, sửa đổi công bố ngày ${AMENDED.publishedVi}`)
    expect(head.match(/href="\/regulations\/v1"/g)?.length).toBe(2) // META, both languages
    expect(section(html, 'changelog').match(/href="\/regulations\/v1"/g)?.length).toBe(2)
  })

  // ⛔ eno.forum is the edition that will NEVER register with Bộ Công Thương as an intermediary platform
  // (regulations/page.tsx, the Article 2 note), so its Quy chế may not state the duty, promise re-filing,
  // or log either edit (2026-10-01 review).
  it('keeps the MoIT intermediary-platform registration out of eno.forum’s Articles 4, 15 and 17', async () => {
    const forum = text(await regs('services'))
    for (const id of ['operator-duties', 'amendments', 'changelog']) {
      const s = section(forum, id)
      expect(s, id).not.toContain('đăng ký nền tảng thương mại điện tử trung gian')
      expect(s, id).not.toContain('Ministry of Industry and Trade as an intermediary e-commerce platform')
      expect(s, id).not.toContain('re-filing of each change with the Ministry of Industry and Trade')
      expect(s, id).not.toContain('is filed with the Ministry as an amendment to that registration')
      expect(s, id).not.toContain('sửa đổi, bổ sung đăng ký với Bộ Công Thương')
    }
    expect(section(forum, 'operator-duties')).toContain('thực hiện các thủ tục đăng ký, thông báo với cơ quan nhà nước có thẩm quyền mà pháp luật yêu cầu')
    expect(section(forum, 'changelog')).toContain('nêu nghĩa vụ đăng ký, thông báo của đơn vị vận hành tại Điều 4')
    // …while eno.vn, the edition that IS registering, keeps all three.
    const vn = text(await regs())
    expect(section(vn, 'operator-duties')).toContain('đăng ký nền tảng thương mại điện tử trung gian với Bộ Công Thương')
    expect(section(vn, 'amendments')).toContain('sửa đổi, bổ sung đăng ký với Bộ Công Thương trong thời hạn 20 ngày làm việc')
    expect(section(vn, 'changelog')).toContain('việc thực hiện thủ tục sửa đổi, bổ sung đăng ký với Bộ Công Thương sau mỗi lần thay đổi')
  })
})

describe('/legal/ranking', () => {
  async function ranking(lang: 'en' | 'vi') {
    const mod = await page<typeof import('./legal/ranking/ranking-content')>('./legal/ranking/ranking-content', lang)
    return renderToStaticMarkup(<mod.RankingContent diversityWindow={60} />)
  }

  it('no longer denies the For You rail or implies featured placement can be bought', async () => {
    const html = await ranking('en')
    expect(html).not.toContain('cannot be increased by paying more')
    expect(html).not.toContain('always visibly labelled')
    expect(html).not.toContain('no result is reordered based on who you are')
    expect(html).not.toContain('No listing is featured today')
    expect(html).not.toContain('it will be labelled')
    expect(html).toContain('never sold')
    expect(html).toContain('For You')
    expect(html).toContain('Recently viewed rail on the home page and on listing pages')
    expect(html).toContain('The only exceptions are the For You and Recently viewed rails')
    expect(html).not.toContain('the one rail that can adapt to you')
    expect(html).toContain('the first 60 positions')
    expect(html).toContain(`Last updated: ${AMENDED.publishedEn}`)
    // The brand rule is applied to each returned page (api/listings/route.ts `ordered`), never across pages.
    expect(text(html)).toContain('each page of results puts that brand’s listings in your category ahead of the rest of that page')
  })

  it('renders the curated Vietnamese', async () => {
    const html = await ranking('vi')
    expect(html).toContain('Dành cho bạn')
    expect(html).toContain('Đã xem gần đây')
    expect(html).not.toContain('Hiện chưa có tin nào là tin nổi bật')
    expect(html).toContain('Điểm uy tín của bạn')
    expect(html).toContain('Điểm uy tín của người bán')
    expect(html).not.toMatch(/tin cậy|Ô tin đăng|[Dd]ải /)
    expect(html).toContain('trong mỗi trang kết quả')
  })
})

describe('version 1, archived (/terms/v1, /regulations/v1)', () => {
  it('/terms/v1 is version 1, says what replaced it and when, and is never indexed', async () => {
    const { V1_SUPERSEDED } = await import('@/lib/compliance/legal-archive')
    const mod = await page<LangPage & { metadata: { robots?: unknown; alternates?: { canonical?: string } } }>('./terms/v1/page', 'en')
    const en = text(renderToStaticMarkup(await mod.default({ params: Promise.resolve({ lang: 'en' }) })))
    expect(en).toContain(`This is version 1 of these Terms. Version 2, published on ${V1_SUPERSEDED.publishedEn}, takes effect on ${V1_SUPERSEDED.inForceEn} and replaces it`)
    expect(en).toContain('Last updated: August 2026 · Version 1</p>')
    expect(en).toContain('<a href="/terms"')
    // Version 1's own body: no linked-listings section, which version 2 added.
    expect(en).not.toContain('<section id="linked">')
    expect(mod.metadata.robots).toEqual({ index: false, follow: true })
    expect(mod.metadata.alternates?.canonical).toBe('/terms/v1')
  })

  it('/regulations/v1 is version 1 on both editions, with no change log', async () => {
    const { V1_SUPERSEDED } = await import('@/lib/compliance/legal-archive')
    for (const edition of ['marketplace', 'services'] as const) {
      const mod = await page<{ default: () => React.ReactElement; metadata: { robots?: unknown } }>('./regulations/v1/page', 'en', edition)
      const html = text(renderToStaticMarkup(mod.default()))
      expect(html, edition).toContain(`Đây là phiên bản 1 của Quy chế. Phiên bản 2, công bố ngày ${V1_SUPERSEDED.publishedVi}, có hiệu lực từ ngày ${V1_SUPERSEDED.inForceVi}`)
      expect(html, edition).toContain('Phiên bản 1. Bản tiếng Việt là bản có giá trị pháp lý')
      expect(html, edition).not.toContain('Phiên bản 2.')
      expect(html, edition).not.toContain('<section id="changelog">')
      // Version 1's own legal basis — the decree version 2 replaced.
      expect(html, edition).toContain('52/2013')
      expect(mod.metadata.robots).toEqual({ index: false, follow: true })
    }
  })
})

describe('/privacy', () => {
  async function privacy(edition: 'marketplace' | 'services') {
    const mod = await page<LangPage>('./privacy/page', 'en', edition)
    return text(renderToStaticMarkup(await mod.default({ params: Promise.resolve({ lang: 'en' }) })))
  }

  // ⛔ The PDPL impact-assessment dossiers are drafts (docs/compliance/pdpl-dossier-draft.md, "NOT FILED").
  // The filed sentence used to follow OPERATOR_REGISTERED, true on eno.vn since its ERC — a false claim.
  // It now follows PDP_DOSSIERS_FILED (per edition, src/lib/site-legal.ts); privacy/page.test.tsx pins
  // the filed branch.
  it('does not claim the dossiers are filed with the Ministry of Public Security on eno.vn', async () => {
    const html = await privacy('marketplace')
    expect(html).not.toContain('file them with the Ministry of Public Security, and update them')
    expect(html).not.toContain('have filed both with the Ministry of Public Security')
    expect(html).toContain('They have not been filed yet')
    // The correction changed eno.vn's text, so its date moved with the amendment's publication.
    expect(html).toContain(`Last updated: ${AMENDED.publishedEn}`)
  })

  it('claims no filing on eno.forum either — and its text changed too, so its date moved with it', async () => {
    const html = await privacy('services')
    expect(html).not.toContain('file them with the Ministry of Public Security, and update them')
    expect(html).not.toContain('have filed both with the Ministry of Public Security')
    expect(html).toContain('They have not been filed yet')
    expect(html).toContain(`Last updated: ${AMENDED.publishedEn}`)
    expect(html).not.toContain('Last updated: August 2026')
  })
})
