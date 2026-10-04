import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AMENDED, REGULATIONS_AMENDED, REGULATIONS_AMENDMENT, dateEn, dateVi } from '@/lib/compliance/legal-amendment'
import { RANKING_DISCLOSURE_UPDATED } from '@/lib/compliance/ranking-disclosure'
import { REGULATIONS_PREVIOUS_VERSION, REGULATIONS_VERSION, TOS_EFFECTIVE_AT, TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

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

async function page<T>(path: string, lang: 'en' | 'vi', edition: 'marketplace' | 'services' = 'marketplace', window = false): Promise<T> {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', edition === 'marketplace' ? 'https://eno.vn' : 'https://www.eno.forum')
  vi.resetModules()
  if (window) withWindow()
  h.lang = lang
  return import(/* @vite-ignore */ path) as Promise<T>
}

type LangPage = { default: (p: { params: Promise<{ lang: string }> }) => Promise<React.ReactElement> }

async function renderLang(path: string, lang: 'en' | 'vi') {
  const mod = await page<LangPage>(path, lang)
  return renderToStaticMarkup(await mod.default({ params: Promise.resolve({ lang }) }))
}

afterEach(() => {
  vi.doUnmock('@/lib/compliance/legal-amendment')
  vi.unstubAllEnvs()
  vi.useRealTimers()
  h.lang = 'en'
})

/**
 * The pages as they would render for an amendment WITH a notice window — the default for the next one
 * (the dates 110295be shipped: published 01/10, in force 07/10). page(…, window = true) registers it
 * right after its resetModules, so the import sees it; afterEach removes it. BOTH records take the window
 * (legal-amendment.ts): /terms reads LEGAL_AMENDMENT, /regulations' META REGULATIONS_AMENDMENT.
 */
const WINDOW = { published: '2026-10-01', inForce: '2026-10-07' } as const
const WINDOW_EFFECTIVE_AT = Date.parse('2026-10-07T00:00:00+07:00')
function withWindow() {
  vi.doMock('@/lib/compliance/legal-amendment', async (importOriginal) => {
    const real = await importOriginal<typeof import('@/lib/compliance/legal-amendment')>()
    return {
      ...real,
      LEGAL_AMENDMENT: WINDOW, AMENDED: real.amendedDates(WINDOW),
      REGULATIONS_AMENDMENT: WINDOW, REGULATIONS_AMENDED: real.amendedDates(WINDOW),
    }
  })
}

/** 18:00 in Vietnam on 01/10/2026 — the day the owner made version 2 immediate. */
const OCT_1_EVENING = Date.parse('2026-10-01T18:00:00+07:00')

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
    // One date: version 2 was published and took effect the same day (immediate — owner, 2026-10-01).
    expect(html).toContain(`Changes in force from ${AMENDED.inForceEn}: the section on who posts listings`)
    expect(html).toContain('The previous wording (version 1) is published at /terms/v1.')
    expect(html).not.toMatch(/Changes published on|Until .* the previous wording applies/)
    expect(html).toContain('a translation prepared by eno that our lawyers are still reviewing')
    expect(html).not.toContain('reviewed translation')
  })

  // ⛔ Version 2 is IN FORCE (owner, 2026-10-01: "just change now … no need for announcement").
  it('headlines version 2 as in force now, with no "not yet in force" line', async () => {
    clockAt(OCT_1_EVENING)
    const en = text(await renderLang('./terms/page', 'en'))
    expect(en).toContain(`Version ${TOS_VERSION}</p>`)
    expect(en).not.toContain('The text below is version')
    expect(en).not.toMatch(/7 October|remains in force/)
    const viHtml = text(await renderLang('./terms/page', 'vi'))
    expect(viHtml).toContain(`Version ${TOS_VERSION}</p>`)
    expect(viHtml).toContain(`Các thay đổi có hiệu lực từ ngày ${AMENDED.inForceVi}:`)
    expect(viHtml).toContain('Nội dung trước sửa đổi (phiên bản 1) được lưu tại <a href="/terms/v1"')
    expect(viHtml).not.toMatch(/07\/10\/2026|Trước ngày|vẫn là phiên bản đang có hiệu lực/)
    // The previous version stays one tap away, from the change note.
    expect(viHtml.match(/href="\/terms\/v1"/g)?.length).toBe(1)
  })

  it('headlines the version IN FORCE during a notice window and says which text binds (the default)', async () => {
    clockAt(WINDOW_EFFECTIVE_AT - 1)
    const mod = await page<LangPage>('./terms/page', 'en', 'marketplace', true)
    const en = text(renderToStaticMarkup(await mod.default({ params: Promise.resolve({ lang: 'en' }) })))
    expect(en).toContain(`Version ${TOS_PREVIOUS_VERSION}</p>`)
    expect(en).toContain(`The text below is version ${TOS_VERSION}, published on 1 October 2026 and in force from 7 October 2026. Until then, version ${TOS_PREVIOUS_VERSION} remains in force.`)
    // The text in force is published, not "write to us for a copy" (Quy chế Article 15).
    expect(en).toContain(`<a href="/terms/v${TOS_PREVIOUS_VERSION}" class="font-semibold text-accent-foreground hover:underline">Read version ${TOS_PREVIOUS_VERSION}</a>`)
    expect(en).not.toMatch(/write to us for a copy/i)
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
    expect(html).toContain(`In force from ${AMENDED.inForceEn} · Applies to purchases in Vietnam`)
    expect(html).toContain(`This version is in force from ${AMENDED.inForceEn}. Before that date the`)
    // One date — published and in force the same day — never "published X and in force from X".
    expect(html).not.toMatch(/published on|Last updated: .* in force from|7 October/)
    // The old promise survives only as history inside the dated change note.
    expect(html).not.toContain('This policy is the returns commitment of the verified business storefronts')
    expect(html).not.toMatch(ENGLISH_AUTHORITATIVE)
  })

  it('renders the curated Vietnamese on the vi variant', async () => {
    const html = await renderLang('./returns/page', 'vi')
    expect(html).toContain('<h1>Đổi trả và hoàn tiền</h1>')
    expect(html).toContain('đã chấp nhận chính sách này với chúng tôi')
    expect(html).toContain(`Có hiệu lực từ ngày ${AMENDED.inForceVi} · Áp dụng cho giao dịch tại Việt Nam`)
    expect(html).toContain(`Phiên bản này có hiệu lực từ ngày ${AMENDED.inForceVi}. Trước ngày đó,`)
    expect(html).not.toMatch(/được công bố ngày|07\/10\/2026/)
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
  /** Article 17's entries as rendered — each `<p lang>` that carries a numbered list, in source order. */
  const entries = (log: string) => [...log.matchAll(/<p[^>]*lang="(?:vi|en)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]).filter((p) => /\(1\) /.test(p))

  it('cites Law 122/2025 and Decree 248/2026; the repealed decrees appear only in the change log', async () => {
    const html = await regs()
    expect(html).toContain('Luật Thương mại điện tử số 122/2025/QH15')
    expect(html).toContain('Nghị định 248/2026/NĐ-CP')
    const withoutLog = html.replace(section(html, 'changelog'), '')
    expect(withoutLog).not.toMatch(/52\/2013|85\/2021/)
    expect(section(html, 'changelog')).toContain(AMENDED.inForceVi)
    expect(section(html, 'changelog')).toContain(REGULATIONS_AMENDED.inForceVi)
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
    // One entry per amendment (version 2, then version 3), each in Vietnamese then English, and each list
    // counting 1..n with no gap — the two languages of an entry with the same n.
    const lists = entries(log).map((p) => [...p.matchAll(/\((\d+)\) /g)].map((m) => Number(m[1])))
    expect(lists).toHaveLength(4)
    for (const l of lists) expect(l).toEqual(Array.from({ length: l.length }, (_, i) => i + 1))
    expect(lists[0].length).toBe(lists[1].length)
    expect(lists[2]).toEqual([1, 2, 3, 4])
    expect(lists[3]).toEqual([1, 2, 3, 4])
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

  // ⛔ Version 3 — a Quy chế-only amendment of Article 14 — is IN FORCE from its publication day (owner,
  // 2026-10-05: "apply best recommended", the 2026-10-01 precedent). Its date is a placeholder the deployer
  // sets (REGULATIONS_AMENDMENT), so the tests read it rather than typing it.
  it('META: version 3 in force from its publication day, version 2 archived, the standing sentences kept', async () => {
    expect(REGULATIONS_VERSION).toBe('3')
    expect(REGULATIONS_PREVIOUS_VERSION).toBe('2')
    const html = text(await regs())
    const head = html.slice(0, html.indexOf('<nav>'))
    expect(head).toContain(`Phiên bản 3, có hiệu lực từ ngày ${REGULATIONS_AMENDED.inForceVi} (xem Điều 17). Phiên bản trước được lưu tại <a href="/regulations/v2"`)
    expect(head).toContain(`Version 3, in force from ${REGULATIONS_AMENDED.inForceEn} (see Article 17). The previous version is archived at <a href="/regulations/v2"`)
    expect(head).toContain('Bản tiếng Việt là bản có giá trị pháp lý; bản tiếng Anh là bản dịch tham khảo. Mọi sửa đổi được công bố trên sàn ít nhất 5 ngày trước ngày có hiệu lực.')
    expect(head).toContain('The Vietnamese text is the authoritative one; the English is a translation provided for convenience. Any amendment is announced on the platform at least 5 days before it takes effect.')
    expect(head).not.toMatch(/trước ngày đó|until then|công bố ngày|Phiên bản 2,|Version 2,/)
    expect(head.match(/href="\/regulations\/v2"/g)?.length).toBe(2) // META, both languages
    expect(head).not.toContain('href="/regulations/v1"')
    // The Terms did not change: their version stays 2.
    expect(TOS_VERSION).toBe('2')
  })

  it('Article 17: version 2’s entry unchanged (01/10/2026, version 1 archived), then version 3’s, one date each', async () => {
    const log = text(section(await regs(), 'changelog'))
    expect(log).toContain('Sửa đổi, bổ sung được công bố và có hiệu lực từ ngày 01/10/2026; nội dung trước sửa đổi (phiên bản 1) được lưu tại <a href="/regulations/v1"')
    expect(log).toContain('Amendments published on and in force from 1 October 2026; the previous text (version 1) is archived at <a href="/regulations/v1"')
    expect(log).toContain(`Sửa đổi, bổ sung được công bố và có hiệu lực từ ngày ${REGULATIONS_AMENDED.inForceVi}; nội dung trước sửa đổi (phiên bản 2) được lưu tại <a href="/regulations/v2"`)
    expect(log).toContain(`Amendments published on and in force from ${REGULATIONS_AMENDED.inForceEn}; the previous text (version 2) is archived at <a href="/regulations/v2"`)
    expect(log).not.toMatch(/trước ngày đó|until that date/)
    // Version 2's entry never names its abandoned 07/10 window (version 3's date is whatever day it deploys).
    const [v2vi, v2en] = entries(log)
    expect(`${v2vi} ${v2en}`).not.toMatch(/07\/10\/2026|7 October/)
    expect(log.match(/href="\/regulations\/v1"/g)?.length).toBe(2)
    expect(log.match(/href="\/regulations\/v2"/g)?.length).toBe(2)
    // Newest last (append-only).
    expect(log.indexOf('(phiên bản 1)')).toBeLessThan(log.indexOf('(phiên bản 2)'))
  })

  it('Article 17’s version 3 entry lists every Article 14 edit, in both languages', async () => {
    const [, , v3vi, v3en] = entries(text(section(await regs(), 'changelog')))
    for (const edit of [
      'kết quả được xếp theo hai nhóm',
      'hoặc trong tên của mục mà tin được đăng',
      'các tin bằng điểm nhau chỉ được xếp xen kẽ trong cùng một nhóm',
      'trước đây ghi là các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã, thương hiệu hoặc danh mục của chính tin đó được xếp trước, như một nhóm',
      'các từ chỉ tình trạng hàng hoá',
      'tin cho thuê xe dẫn từ các nền tảng và cửa hàng cho thuê xe',
      'tin tuyển dụng, tin cho thuê xe do thành viên tự đăng trên sàn vẫn giữ vị trí riêng',
      'ít nhất hai trong bốn vị trí đầu tiên và ít nhất bốn trong mười hai vị trí đầu tiên là đồ đã qua sử dụng',
    ]) expect(v3vi).toContain(edit)
    for (const edit of [
      'results are ordered in two groups',
      'or the name of the aisle they are listed in',
      'with listings of equal score interleaved within a group only',
      'it previously put the listings containing every search word in their own title, model, brand or category first, as one group',
      'words that describe condition',
      'vehicle rentals linked from rental platforms and shops',
      'job postings and vehicle rentals members post on the platform themselves keep their poster’s own seat',
      'at least two of the first four positions and at least four of the first twelve are second-hand goods for sale',
    ]) expect(v3en).toContain(edit)
  })

  // ⛔ ARTICLE 14 (version 3) SAYS WHAT THE RANKER DOES AND WHAT /legal/ranking SAYS (UX program 2):
  // keyword-rank.ts's two tiers, search-synonyms.ts's condition words, feed-diversity.ts's vehicle seat, and the
  // home feed's second-hand floor (the home-feed package).
  it('Article 14 states the two-tier keyword order, the condition words, the vehicle seat and the home floor — in both languages', async () => {
    const r = text(section(await regs(), 'ranking'))
    for (const fact of [
      'kết quả được xếp theo hai nhóm. Nhóm thứ nhất gồm các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã hoặc thương hiệu của chính tin đó, hoặc trong tên của mục mà tin được đăng; nhóm thứ hai gồm các tin cần đến danh mục của tin mới khớp được một trong các từ khoá',
      'việc chia nhóm không làm thay đổi tỷ trọng này',
      'các tin bằng điểm nhau được xếp xen kẽ theo người bán và mẫu sản phẩm, chỉ trong phạm vi cùng một nhóm',
      'Các từ chỉ tình trạng hàng hoá, như “second hand”, “used”, “cũ”, “đồ cũ” hoặc “đã qua sử dụng”, không được dùng để tìm trong nội dung tin đăng và không lọc kết quả theo tình trạng',
      'Khi từ khoá chỉ gồm những từ này, kết quả là các món hàng đang được đăng bán',
      'Tình trạng hoặc loại tin do người sử dụng tự chọn trong bộ lọc vẫn được áp dụng như bình thường',
      'tin cho thuê xe dẫn từ các nền tảng và cửa hàng cho thuê xe dùng chung một vị trí',
      'Tin tuyển dụng và tin cho thuê xe do thành viên tự đăng trên sàn vẫn giữ vị trí riêng của người đăng',
      'Khi người sử dụng mở riêng mục eSIM, danh mục Việc làm hoặc một mục cho thuê xe',
      'Ở trang chủ, theo thứ tự mặc định, khi có đủ tin, ít nhất hai trong bốn vị trí đầu tiên và ít nhất bốn trong mười hai vị trí đầu tiên là đồ đã qua sử dụng đang được đăng bán',
    ]) expect(r).toContain(fact)
    for (const fact of [
      'results are ordered in two groups. The first group is the listings whose own title, model or brand, or the name of the aisle they are listed in, contains every search word; the second is the listings that need their category to match one of the words',
      'the grouping does not change those weights',
      'listings with equal scores are interleaved by seller and by product model, within the same group only',
      'Words that describe condition, such as “second hand”, “used”, “cũ”, “đồ cũ” or “đã qua sử dụng”, are not looked for in the listing text and do not filter results by condition',
      'A search made only of such words shows the items for sale.',
      'A condition or listing type the user picks in the filters applies as usual.',
      'vehicle rentals linked from rental platforms and shops share one',
      'Job postings and vehicle rentals that members post on the platform themselves keep their poster’s own seat',
      'When the user opens the eSIM aisle, the Jobs category or a vehicle-rental aisle itself',
      'On the home page, in the default order, where enough such listings exist, at least two of the first four positions and at least four of the first twelve are second-hand goods for sale.',
    ]) expect(r).toContain(fact)
    // Version 2's one-group sentence is gone from the text in force (Article 17 quotes it as history).
    expect(r).not.toContain('các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã, thương hiệu hoặc danh mục của chính tin đó được xếp trước')
    expect(r).not.toContain('listings that contain every search term in their own title, model, brand or category come first')
    expect(r).not.toContain('as do job postings linked from job boards, so that')
    // The weights are still where /legal/ranking publishes them.
    expect(r).toContain('<a href="/legal/ranking"')
  })

  it('Article 14 and its Article 17 entry are the same on eno.forum', async () => {
    const forum = text(await regs('services'))
    expect(section(forum, 'ranking')).toContain('kết quả được xếp theo hai nhóm')
    expect(section(forum, 'ranking')).toContain('ít nhất hai trong bốn vị trí đầu tiên')
    expect(section(forum, 'changelog')).toContain(`(phiên bản 2) được lưu tại <a href="/regulations/v2"`)
    const head = forum.slice(0, forum.indexOf('<nav>'))
    expect(head).toContain(`Phiên bản 3, có hiệu lực từ ngày ${REGULATIONS_AMENDED.inForceVi}`)
  })

  it('META with a notice window (the default): says the previous version governs until the in-force date', async () => {
    const mod = await page<{ default: () => React.ReactElement }>('./regulations/page', 'en', 'marketplace', true)
    const html = text(renderToStaticMarkup(mod.default()))
    const head = html.slice(0, html.indexOf('<nav>'))
    expect(head).toContain(`Phiên bản ${REGULATIONS_VERSION}, sửa đổi công bố ngày 01/10/2026, có hiệu lực từ ngày 07/10/2026 (xem Điều 17); trước ngày đó, phiên bản ${REGULATIONS_PREVIOUS_VERSION} vẫn là bản đang áp dụng`)
    expect(head).toContain(`<a href="/regulations/v${REGULATIONS_PREVIOUS_VERSION}"`)
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
  const importRegs = () => page<{ default: () => React.ReactElement }>('./regulations/page', 'vi')

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
    // ⚠️ ITS OWN DATE (ranking-disclosure.ts RANKING_DISCLOSURE_UPDATED, set on deploy day), not the legal
    // amendment's: the disclosure follows the code and changed after 01/10/2026 (UX program 2).
    expect(html).toContain(`Last updated: ${dateEn(RANKING_DISCLOSURE_UPDATED)}`)
    expect(html).not.toContain(`Last updated: ${AMENDED.publishedEn}`)
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

  // UX program 2 (2026-10-04): the disclosure follows the code — keyword-rank.ts's title tier (MatchClass),
  // the condition words (search-synonyms.ts splitConditionWords) and the vehicle storefronts' shared seat
  // (feed-diversity.ts SHARED_SEAT_SELLERS). ⚖️ Article 14 of /regulations says the same since version 3
  // (2026-10-05) — the /regulations tests above pin it, and the agreement test below holds the two together.
  it('states the title tier, the condition words and the vehicle seat, in both languages', async () => {
    const en = text(await ranking('en'))
    expect(en).toContain('listings come first when every word you typed is in their own title, model or brand, or is the name of the aisle they are listed in; then come listings that need their category for one of the words')
    expect(en).toContain('are not looked for in the listing text and do not filter by condition')
    expect(en).toContain('A search made only of such words shows the items for sale.')
    // The withdrawn "not new" narrowing (commit gate, 2026-10-04) is no longer described.
    expect(en).not.toContain('items for sale that give no condition')
    expect(en).toContain('vehicle rentals linked from rental platforms and shops')
    const vi = text(await ranking('vi'))
    expect(vi).toContain('hoặc là tên của mục mà tin được đăng, sẽ được xếp trước; tiếp theo là các tin cần đến danh mục của tin để khớp một trong các từ')
    expect(vi).toContain('không được dùng để tìm trong nội dung tin và không lọc theo tình trạng')
    expect(vi).toContain('kết quả là các món hàng đang được đăng bán')
    expect(vi).toContain('tin cho thuê xe dẫn từ các nền tảng, cửa hàng cho thuê xe')
  })

  // UX program 2, plan C7 (owner 2026-10-05): the home feed's goods seats. The words ARE feed-diversity.ts
  // GOODS_SEATS — change one and this fails until the other follows. ⚖️ Quy chế v3 Article 14 states the same
  // rule (tested below), and ships in the same commit as the code.
  it('states the home feed’s goods seats in both languages, in the numbers the code uses', async () => {
    const { GOODS_SEATS } = await import('@/lib/feed-diversity')
    expect(GOODS_SEATS).toEqual([{ within: 4, min: 2 }, { within: 12, min: 4 }])
    expect(text(await ranking('en'))).toContain('On the home page, in the default order, at least two of the first four listings and four of the first twelve are second-hand goods for sale, when there are enough of them.')
    expect(text(await ranking('vi'))).toContain('Ở trang chủ, theo thứ tự mặc định, ít nhất hai trong bốn tin đầu tiên và bốn trong mười hai tin đầu tiên là đồ đã qua sử dụng đang được đăng bán, khi có đủ tin như vậy.')
  })

  it('prints its own last-updated date, in both languages, later than the amendment it outlived', async () => {
    expect(RANKING_DISCLOSURE_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The disclosure changed after the October 2026 amendment was published (01/10/2026) — never
    // LEGAL_AMENDMENT.published: that constant moves on with the next Terms amendment, this fact does not.
    expect(RANKING_DISCLOSURE_UPDATED > '2026-10-01').toBe(true)
    expect(text(await ranking('vi'))).toContain(`Cập nhật lần cuối: ${dateVi(RANKING_DISCLOSURE_UPDATED)}`)
  })

  // ⛔ ONE DATE FOR ONE DEPLOY (2026-10-05): this change reaches the page and Quy chế Article 14 together, so
  // the page's date IS the Quy chế amendment's — the placeholder the deployer sets once, held by the deploy
  // gate. Only while version 3 is current: a later Quy chế amendment must not re-date this page.
  it('is dated with the Quy chế’s version 3 — one date, set once, while version 3 is current', () => {
    if (REGULATIONS_VERSION === '3') expect(RANKING_DISCLOSURE_UPDATED).toBe(REGULATIONS_AMENDMENT.published)
    else expect(RANKING_DISCLOSURE_UPDATED, 'type this page’s own deploy day: the tie was for version 3 only').not.toBe(REGULATIONS_AMENDMENT.published)
  })

  it('states the home feed’s second-hand floor, in both languages', async () => {
    const en = text(await ranking('en'))
    expect(en).toContain('On the home page, in the default order, at least two of the first four listings and four of the first twelve are second-hand goods for sale, when there are enough of them.')
    const vi = text(await ranking('vi'))
    expect(vi).toContain('Ở trang chủ, theo thứ tự mặc định, ít nhất hai trong bốn tin đầu tiên và bốn trong mười hai tin đầu tiên là đồ đã qua sử dụng đang được đăng bán, khi có đủ tin như vậy.')
  })

  // The filed text and the code-following disclosure must not disagree (ranking-content.tsx: "change one and
  // change the other"). The facts UX program 2 added, each in the curated Vietnamese of both pages.
  it('agrees with Article 14 of /regulations on every fact UX program 2 added', async () => {
    const page = text(await ranking('vi'))
    const mod = await importRegs()
    const art14 = text(renderToStaticMarkup(mod.default())).match(/<section id="ranking">[\s\S]*?<\/section>/)?.[0] ?? ''
    for (const [onPage, inArt14] of [
      ['hoặc là tên của mục mà tin được đăng', 'hoặc trong tên của mục mà tin được đăng'],
      ['tiếp theo là các tin cần đến danh mục của tin để khớp một trong các từ', 'nhóm thứ hai gồm các tin cần đến danh mục của tin mới khớp được một trong các từ khoá'],
      ['không được dùng để tìm trong nội dung tin và không lọc theo tình trạng', 'không được dùng để tìm trong nội dung tin đăng và không lọc kết quả theo tình trạng'],
      ['kết quả là các món hàng đang được đăng bán', 'kết quả là các món hàng đang được đăng bán'],
      ['tin cho thuê xe dẫn từ các nền tảng, cửa hàng cho thuê xe', 'tin cho thuê xe dẫn từ các nền tảng và cửa hàng cho thuê xe'],
      ['ít nhất hai trong bốn tin đầu tiên và bốn trong mười hai tin đầu tiên là đồ đã qua sử dụng đang được đăng bán', 'ít nhất hai trong bốn vị trí đầu tiên và ít nhất bốn trong mười hai vị trí đầu tiên là đồ đã qua sử dụng đang được đăng bán'],
    ]) {
      expect(page).toContain(onPage)
      expect(art14).toContain(inArt14)
    }
  })
})

describe('version 1, archived (/terms/v1, /regulations/v1)', () => {
  it('/terms/v1 is version 1, says what replaced it and when, and is never indexed', async () => {
    const { V1_SUPERSEDED } = await import('@/lib/compliance/legal-archive')
    const mod = await page<LangPage & { metadata: { robots?: unknown; alternates?: { canonical?: string } } }>('./terms/v1/page', 'en')
    const en = text(renderToStaticMarkup(await mod.default({ params: Promise.resolve({ lang: 'en' }) })))
    expect(en).toContain(`This is version 1 of these Terms. Version 2 replaced it with effect from ${V1_SUPERSEDED.inForceEn}.`)
    expect(en).not.toMatch(/until then|takes effect on|7 October/)
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
      expect(html, edition).toContain(`Đây là phiên bản 1 của Quy chế. Phiên bản 2 thay thế phiên bản này kể từ ngày ${V1_SUPERSEDED.inForceVi}. Bản mới nhất được đăng tại`)
      expect(html, edition).toContain(`This is version 1 of these Regulations. Version 2 replaced it with effect from ${V1_SUPERSEDED.inForceEn}.`)
      expect(html, edition).not.toMatch(/trước ngày đó, phiên bản 1|until then, version 1|07\/10\/2026/)
      expect(html, edition).toContain('Phiên bản 1. Bản tiếng Việt là bản có giá trị pháp lý')
      expect(html, edition).not.toContain('Phiên bản 2.')
      expect(html, edition).not.toContain('<section id="changelog">')
      // Version 1's own legal basis — the decree version 2 replaced.
      expect(html, edition).toContain('52/2013')
      expect(mod.metadata.robots).toEqual({ index: false, follow: true })
    }
  })
})

// ⛔ THE QUY CHẾ'S VERSION 2 — in force from 01/10/2026 until version 3 (2026-10-05, Article 14). Archived
// verbatim (regulations/v2/page.tsx header), permanently, on both editions: the Terms accepted in that
// period incorporate it, and Article 15 promises every version in force stays published.
describe('version 2 of the Quy chế, archived (/regulations/v2)', () => {
  async function v2(edition: 'marketplace' | 'services') {
    const mod = await page<{ default: () => React.ReactElement; metadata: { robots?: unknown; alternates?: { canonical?: string } } }>('./regulations/v2/page', 'en', edition)
    return { html: text(renderToStaticMarkup(mod.default())), metadata: mod.metadata }
  }
  const section = (html: string, id: string) => html.match(new RegExp(`<section id="${id}">[\\s\\S]*?</section>`))?.[0] ?? ''

  it('says what it is, what replaced it and when — one date — and is never indexed, on both editions', async () => {
    const { V2_SUPERSEDED } = await import('@/lib/compliance/legal-archive')
    for (const edition of ['marketplace', 'services'] as const) {
      const { html, metadata } = await v2(edition)
      expect(html, edition).toContain(`Đây là phiên bản 2 của Quy chế. Phiên bản 3 thay thế phiên bản này kể từ ngày ${V2_SUPERSEDED.inForceVi}. Bản mới nhất được đăng tại <a href="/regulations"`)
      expect(html, edition).toContain(`This is version 2 of these Regulations. Version 3 replaced it with effect from ${V2_SUPERSEDED.inForceEn}. The latest text is published at <a href="/regulations"`)
      expect(html, edition).not.toMatch(/until then|trước ngày đó, phiên bản 2/)
      expect(metadata.robots).toEqual({ index: false, follow: true })
      expect(metadata.alternates?.canonical).toBe('/regulations/v2')
    }
  })

  it('prints version 2’s own META and Article 17 — 01/10/2026, version 1 archived — and no version-3 entry', async () => {
    const { html } = await v2('marketplace')
    const head = html.slice(0, html.indexOf('<nav>'))
    expect(head).toContain('Phiên bản 2, có hiệu lực từ ngày 01/10/2026 (xem Điều 17). Phiên bản trước được lưu tại <a href="/regulations/v1"')
    expect(head).toContain('Version 2, in force from 1 October 2026 (see Article 17). The previous version is archived at <a href="/regulations/v1"')
    expect(head).not.toContain('Phiên bản 3,')
    const log = section(html, 'changelog')
    expect(log).toContain('Sửa đổi, bổ sung được công bố và có hiệu lực từ ngày 01/10/2026; nội dung trước sửa đổi (phiên bản 1) được lưu tại <a href="/regulations/v1"')
    expect(log).not.toContain('(phiên bản 2)')
    expect(log).not.toContain('/regulations/v2')
  })

  it('keeps version 2’s Article 14 — one keyword group, no vehicle seat, no condition words, no home floor', async () => {
    for (const edition of ['marketplace', 'services'] as const) {
      const r = section((await v2(edition)).html, 'ranking')
      expect(r, edition).toContain('các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã, thương hiệu hoặc danh mục của chính tin đó được xếp trước')
      expect(r, edition).toContain('Các gói eSIM của mọi nhà mạng dùng chung một vị trí trong lượt xen kẽ đó, và tin tuyển dụng dẫn từ các trang tuyển dụng cũng vậy')
      // The live constants are frozen at what version 2 printed.
      expect(r, edition).toContain('the first 60 positions are interleaved by seller')
      expect(r, edition).not.toMatch(/cho thuê xe|hai nhóm|second hand|đồ đã qua sử dụng đang được đăng bán/)
    }
    expect(section((await v2('marketplace')).html, 'process')).toContain('tối đa 5 tin mỗi lần')
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
