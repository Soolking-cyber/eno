import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isReservedHandle } from '@/lib/handle-format'
import { contentDigest } from '@/lib/teach-guides/digest'
import { moneyText, parseInline } from '@/lib/teach-guides/inline'
import { teachGuideSchema } from '@/lib/teach-guides/schema'
import { pinnedPair, pinnedRoute, pinnedVariant } from '@/lib/lang-pinned'
import { EDITION_BANNED } from '@/test/edition-words'
import { GUIDE_CONTENT } from './content.generated'
import { bannedWordIn, GUIDE_BANNED } from './edition'
import { GUIDES, guideDates, guidePath, isGuideLive, liveGuides, type GuideEntry } from './registry'

const ROOT = process.cwd()
const entry = (extra: Partial<GuideEntry> = {}): GuideEntry => ({ slug: 'a-guide', lang: 'en', published: '2026-11-04', ...extra })
const VN_NOON = new Date('2026-11-04T05:00:00Z')
const content = { 'a-guide': {} }

describe('the general guide library', () => {
  it('needs a person\'s review, its day, and its text in the build', () => {
    expect(isGuideLive(entry(), VN_NOON, content)).toBe(false)
    expect(isGuideLive(entry({ reviewed: '2026-11-04' }), VN_NOON, content)).toBe(true)
    expect(isGuideLive(entry({ reviewed: '2026-11-04', published: '2026-11-05' }), VN_NOON, content)).toBe(false)
    expect(isGuideLive(entry({ reviewed: '2026-11-05' }), VN_NOON, content)).toBe(false)
    expect(isGuideLive(entry({ reviewed: '2026-11-04', slug: 'no-text' }), VN_NOON, content)).toBe(false)
  })

  it('has one address per language, and dates a guide by the day it went live', () => {
    expect(guidePath(entry())).toBe('/guides/a-guide')
    expect(guidePath(entry({ lang: 'vi' }))).toBe('/huong-dan/a-guide')
    expect(guideDates(entry({ published: '2026-11-04', reviewed: '2026-11-06' })).published).toBe('2026-11-06')
    expect(guideDates(entry({ reviewed: '2026-11-04', updated: '2026-11-20' })).updated).toBe('2026-11-20')
    expect(guideDates(entry({ updated: '2026-11-05', reviewed: '2026-11-10' })), 'edited before it went live').toEqual({ published: '2026-11-10' })
  })

  it('the address pins the language for everyone, and nothing else is caught by it', () => {
    expect(pinnedRoute('/guides/a-guide')).toEqual({ variant: 'en', internalPath: '/guides/a-guide' })
    expect(pinnedRoute('/huong-dan/thue-xe-dien')).toEqual({ variant: 'vi', internalPath: '/huong-dan/thue-xe-dien' })
    expect(pinnedVariant('/guides'), 'the list of them').toBe('en')
    expect(pinnedVariant('/huong-dan'), 'the list of them').toBe('vi')
    for (const other of ['/guides/', '/huong-dan/', '/guides/a/b', '/guides/A', '/guides/a_b', '/guide/x', '/guides/%2e%2e']) expect(pinnedVariant(other), other).toBeNull()
    expect(pinnedPair('/guides/a-guide'), 'pinned by its address, so no entry in the fixed list to read').toBeNull()
  })

  it('no shop can take its address', () => {
    for (const h of ['guides', 'huong-dan', 'huongdan', 'huong_dan']) expect(isReservedHandle(h), h).toBe(true)
  })

  it('registry and content are one to one, and content.generated.ts matches the directory (node scripts/gen-guides.mjs)', () => {
    const dir = readdirSync(join(ROOT, 'src/content/guides')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
    expect(Object.keys(GUIDE_CONTENT).sort()).toEqual(dir)
    expect(GUIDES.map((e) => e.slug).sort()).toEqual(dir)
  })

  it('the rule enforced at build time is the edition rule itself, and catches Vietnamese', () => {
    expect(GUIDE_BANNED.source).toBe(EDITION_BANNED.source)
    expect(GUIDE_BANNED.flags).toBe(EDITION_BANNED.flags)
    for (const w of ['visa', 'e-visa', 'thị thực', 'tạm trú', 'nhập cảnh', 'PayPal']) expect(bannedWordIn(`Một câu có ${w} ở đây`), w).not.toBeNull()
  })

  it('it reads what a reader would see, however the file spells it', () => {
    expect(bannedWordIn({ a: ['fine', { b: 'first line\nvisa on the second' }] }), 'after a newline').toBe('visa')
    expect(bannedWordIn('**vi**sa and Pay**Pal**'), 'split by bold').toBe('visa')
    expect(bannedWordIn('thị thực'.normalize('NFD')), 'decomposed Vietnamese').toBe('thị thực')
    expect(bannedWordIn('Pay[Pal](https://example.com) here'), 'split by a link').toMatch(/paypal/i)
    expect(bannedWordIn('vi\u00adsa'), 'split by a soft hyphen').toBe('visa')
    expect(bannedWordIn('see [the office](https://example.com/visa)'), 'in an address').toBe('visa')
    for (const hidden of ['/temporary-residence', 'temporary-**residence**', 'entry_permit']) expect(bannedWordIn(hidden), hidden).not.toBeNull()
    expect(bannedWordIn('https://eno.vn/huong-dan/thue-xe-dien-vinfast-tphcm')).toBeNull()
    expect(bannedWordIn('vi\u2063sa'), 'any character nobody sees').toBe('visa')
    // One of these wrongly caught would fail the build.
    for (const fine of ['hành vi sai trái', 'hành vi sa thải', 'di truyền', 'xác định cư dân', 'thue-kho-luu-tru', 'thue-xe-may-sai-gon-kinh-nghiem', 'kho lưu trữ', 'tuyen-giao-vien-nuoc-ngoai', 'cho-nguoi-nuoc-ngoai-thue-nha-tphcm']) expect(bannedWordIn(fine), fine).toBeNull()
    expect(bannedWordIn({ a: 'renting a motorbike in Ho Chi Minh City' })).toBeNull()
  })

  it('the edition rule holds over every guide and registry value', () => {
    expect(GUIDES.map((e) => e.slug).filter((t) => bannedWordIn(t))).toEqual([])
    for (const slug of Object.keys(GUIDE_CONTENT)) expect(bannedWordIn(JSON.parse(readFileSync(join(ROOT, `src/content/guides/${slug}.json`), 'utf8'))), slug).toBeNull()
  })

  it('money follows the article\'s language everywhere inline text allows it, and the default stays English', () => {
    expect(moneyText(150000, undefined, 'vi')).toBe('150.000 đ')
    expect(moneyText(150000, 200000, 'vi')).toBe('150.000–200.000 đ')
    expect(moneyText(150000)).toBe('150,000 đ')
    expect(parseInline('**Giá {{vnd:150000}}**', 'vi')).toEqual([{ t: 'bold', children: [{ t: 'text', v: 'Giá ' }, { t: 'money', text: '150.000 đ' }] }])
    expect(parseInline('{{vnd:150000}}')).toEqual([{ t: 'money', text: '150,000 đ' }])
  })

  it('a Vietnamese guide passes the real schema and digest, and prints its money in Vietnamese', () => {
    const para = 'Thuê xe ở đây khá đơn giản, và những bước kiểm tra dưới đây quan trọng hơn việc chọn cửa hàng nào, vì một vết xước không được ghi lại có thể tốn tiền khi trả xe và mất nhiều thời gian để giải quyết với chủ xe sau đó.'
    const doc = {
      slug: 'thue-xe-dien-vinfast-tphcm', title: 'Thuê xe điện VinFast ở TP.HCM: giá và cọc', description: 'Giá thuê xe điện VinFast ở TP.HCM, tiền cọc, giấy tờ cần có và những điều nên kiểm tra trước khi nhận xe để tránh mất tiền khi trả xe.',
      h1: 'Thuê xe điện VinFast ở TP.HCM', eyebrow: 'Đi lại', intro: 'Hầu hết cửa hàng yêu cầu tiền cọc và bản sao giấy tờ. Bài này nói rõ giá, cọc và những điều nên kiểm tra trước khi nhận xe.',
      keyPoints: ['Chụp ảnh mọi vết xước.', 'Giá từ {{vnd:150000}} một ngày.', '**Tiền cọc {{vnd:2000000}}** là phổ biến.'],
      sections: [1, 2, 3, 4].map((i) => ({ id: `phan-${i}`, title: `Phần ${i}`, blocks: [{ type: 'p', text: para }, { type: 'p', text: para }, { type: 'p', text: para }] })),
      faqs: [{ q: 'Có cần bằng lái không?', a: 'Có, bạn cần bằng lái phù hợp với loại xe mà bạn thuê.' }],
      sources: [{ title: 'Luật Trật tự, an toàn giao thông đường bộ', publisher: 'Chính phủ Việt Nam', url: 'https://vanban.chinhphu.vn/x' }],
      related: [], lastChecked: '2026-11-04',
    }
    const parsed = teachGuideSchema.safeParse(doc)
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true)
    expect(contentDigest(doc)).toMatch(/^[0-9a-f]{16}$/)
    expect(bannedWordIn(doc)).toBeNull()
    expect(parseInline(doc.keyPoints[1], 'vi')).toContainEqual({ t: 'money', text: '150.000 đ' })
  })

  it('the index lists each guide, so it reaches the standalone build', async () => {
    const { renderIndex } = await import('../../../scripts/gen-guides.mjs')
    const out = renderIndex(['thue-xe', 'rent-a-bike'])
    expect(out).toContain("import g0 from '@/content/guides/thue-xe.json'")
    expect(out).toContain("'rent-a-bike': g1,")
    expect(renderIndex([])).toContain('Record<string, unknown>> = {\n}')
  })

  it('every slug has the shape the address pins, so no guide can escape its language', () => {
    for (const e of GUIDES) expect(pinnedVariant(guidePath(e)), e.slug).toBe(e.lang)
  })

  it('every registry date is a real date, every pair exists and points back, and only live guides are offered', () => {
    for (const e of GUIDES) {
      for (const d of [e.published, e.reviewed, e.updated, e.released]) if (d) expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10), e.slug).toBe(d)
      if (e.pair) {
        const other = GUIDES.find((x) => x.slug === e.pair)
        expect(other?.pair, e.slug).toBe(e.slug)
        expect(other?.lang, e.slug).not.toBe(e.lang)
      }
    }
    expect(liveGuides().every((e) => !!e.reviewed)).toBe(true)
  })
})
