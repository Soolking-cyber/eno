// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import { LanguageProvider } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { DESCRIPTION_CLAMP_CHARS, DESCRIPTION_CLAMP_LINES, ListingDescription, LocalizedTitle, LocalizedTitleHeading, RichText, localizedPlan, ownDescriptionVi, useLocalized, type LocalizedColumn } from './listing-content'

/**
 * THE LIGHT-MARKDOWN FORMATTER, which now renders BOTH listing descriptions and storefront bios.
 *
 * ⚠️ THE FAILURE THIS SUITE EXISTS FOR IS NOT "A MARKER SHOWS AS A LITERAL CHARACTER". It is far
 * worse than that and it is invisible in a diff: an UNRECOGNISED marker falls through to the
 * paragraph branch, and paragraph lines are JOINED WITH SPACES. So four tick lines did not render
 * as four plain lines — they merged into one run-on sentence. Any new marker added to
 * formatDescription needs a case here, because "it renders the text somehow" is exactly what the
 * broken version also did.
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach and the second render in the file would fail on a duplicate.
 */
afterEach(cleanup)

// Bare words in JSX trip `react/jsx-no-literals` (an ERROR in npm run lint, tests included).
const TICK_BIO = ['Welcome to Eno', '', '✓ Clear options & upfront pricing', '✓ Standard and express e-Visa processing', '✓ Friendly support when you need help'].join('\n')
const BOLD_BIO = 'We make it simpler — from **Vietnam e-Visas** to **free trip planning**.'
const DASH_LIST = ['Included:', '- Official assistance', '- Multiple entry'].join('\n')
const MIXED = ['1. First', '2. Second'].join('\n')

function renderRich(text: string) {
  return render(
    <LanguageProvider>
      <RichText text={text} />
    </LanguageProvider>,
  )
}

describe('RichText / formatDescription', () => {
  it('keeps tick lines as separate list items instead of merging them into one paragraph', () => {
    const { container } = renderRich(TICK_BIO)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(3)
    // ⚠️ Assert on the TEXT span, not the <li> — the tick is a real (aria-hidden) child of the
    // item, so `li.textContent` legitimately reads "✓Clear options…". My first version of this
    // test asserted on the <li> and failed for that reason: the test was wrong, not the markup.
    expect(items[0]?.querySelectorAll('span')[1]?.textContent).toBe('Clear options & upfront pricing')
    // ⚠️ THE REGRESSION ASSERTION. Before the fix these three lines arrived as ONE paragraph with
    // the ticks embedded mid-sentence — "…upfront pricing ✓ Standard and express…". If a future
    // edit drops the tick branch, they merge again and this is what catches it.
    expect(container.textContent).not.toContain('pricing ✓')
  })

  it("keeps the seller's own tick glyph rather than normalising every mark to one", () => {
    const { container } = renderRich(['☑️ Boxed', '✅ Green', '✔ Heavy'].join('\n'))
    const marks = [...container.querySelectorAll('li')].map((li) => li.querySelector('span')?.textContent)
    expect(marks).toEqual(['☑', '✅', '✔'])
    // ⚠️ "☑️" is ☑ + an invisible U+FE0F. Without consuming it, the selector leads the TEXT and
    // renders as a stray box on some fonts — reviewer-caught, and invisible in a screenshot.
    expect([...container.querySelectorAll('li')][0]?.querySelectorAll('span')[1]?.textContent).toBe('Boxed')
  })

  it('does not give a tick list a second, disc marker', () => {
    const { container } = renderRich(TICK_BIO)
    const list = container.querySelector('ul')
    expect(list?.className).toContain('list-none')
    expect(list?.className).not.toContain('list-disc')
  })

  it('renders **bold** as a real <strong>, not literal asterisks', () => {
    const { container } = renderRich(BOLD_BIO)
    const strongs = [...container.querySelectorAll('strong')].map((s) => s.textContent)
    expect(strongs).toEqual(['Vietnam e-Visas', 'free trip planning'])
    expect(container.textContent).not.toContain('**')
  })

  it('still renders dash bullets as a disc list', () => {
    const { container } = renderRich(DASH_LIST)
    const list = container.querySelector('ul')
    expect(list?.className).toContain('list-disc')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('still renders numbered lines as an ordered list', () => {
    const { container } = renderRich(MIXED)
    expect(container.querySelector('ol')).not.toBeNull()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('keeps a blank-line-separated paragraph separate from the list that follows it', () => {
    const { container } = renderRich(TICK_BIO)
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByText('Welcome to Eno')).toBeTruthy()
  })
})

/**
 * AN IMPORTER'S 'Label: value' FACT BLOCK. One fact per SINGLE newline is a soft wrap to this parser,
 * so a rental's Type, Area and Bedrooms used to merge into one run-on paragraph — the same failure
 * the tick-list cases above guard, in the shape every imported rental description has.
 */
describe('RichText / fact lines', () => {
  it("turns a run of 'Label: value' lines into ONE spec list, after the prose above it", () => {
    const { container } = renderRich(['Listed on Nhatot.com.', '', 'Type: Apartment', 'Area: 28 m²', 'Bedrooms: 1'].join('\n'))
    expect(container.querySelectorAll('dl')).toHaveLength(1)
    expect([...container.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Type', 'Area', 'Bedrooms'])
    expect([...container.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['Apartment', '28 m²', '1'])
    expect(container.querySelectorAll('p')).toHaveLength(1)
    // ⚠️ The regression: before, all three facts were one paragraph.
    expect(container.textContent).not.toContain('Apartment Area')
  })

  it('keeps a single fact line as prose — one "Note:" is a sentence, not a table', () => {
    const { container } = renderRich(['Great bike.', 'Note: call first'].join('\n'))
    expect(container.querySelector('dl')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('Great bike. Note: call first')
  })

  it('reads Vietnamese labels, slashes included', () => {
    const { container } = renderRich(['Phường/xã: Tân Bình', 'Quận/huyện: Tân Bình'].join('\n'))
    expect(container.querySelectorAll('dl dt')).toHaveLength(2)
    expect(container.querySelector('dt')?.textContent).toBe('Phường/xã')
  })

  it('leaves a dash list of "Size: M" items a bullet list', () => {
    const { container } = renderRich(['- Size: M', '- Colour: red'].join('\n'))
    expect(container.querySelector('dl')).toBeNull()
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
  })

  it('does not build a list from a sentence with a parenthesis in its label', () => {
    const { container } = renderRich([
      'X · free',
      'Free (0đ): the eSIM plus 10GB of high-speed data for 24 hours, one per valid passport.',
      'Includes: data',
    ].join('\n'))
    expect(container.querySelector('dl')).toBeNull()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('leaves **bold:** lead-ins and links to the paragraph', () => {
    const { container } = renderRich(['**Who can buy:** anyone with a passport', 'Site: https://example.com', 'https://example.com/a'].join('\n'))
    expect(container.querySelector('dl')).toBeNull()
  })
})

/**
 * THE DESCRIPTION'S descriptionVi WHEN A FEED COPIED ONE ENGLISH TEXT INTO BOTH COLUMNS.
 * useLocalized prefers `vi` over the translation cache for a Vietnamese reader, so a `vi` that IS
 * the English source showed that reader English (1,922 stored descriptions, 2026-09-24). For
 * descriptions only, such a `vi` is treated as absent; titles keep their behaviour.
 */
const EN_DESC = 'Lightweight running shoe with a breathable mesh upper and a cushioned sole.'
const VI_MT = 'Giày chạy bộ nhẹ với thân lưới thoáng khí và đế êm.'
const VI_OWN = 'Giày chạy bộ siêu nhẹ, thân lưới thoáng khí, đế đệm êm ái.'
const VI_SRC = 'Giày chạy bộ nhẹ, thân lưới thoáng khí, đế đệm êm.'

describe('ownDescriptionVi — a descriptionVi that is the source text itself is not Vietnamese', () => {
  it('drops a copy of a source the detector does not read as Vietnamese, and keeps everything else', () => {
    expect(ownDescriptionVi(EN_DESC, EN_DESC)).toBeNull()
    // The same text with a trailing newline, CRLF line endings or typed NFD is still the same text.
    expect(ownDescriptionVi(EN_DESC, `${EN_DESC}\n`)).toBeNull()
    const twoLines = 'Espresso cups with saucers.\nSet of 4, dishwasher safe.'
    expect(ownDescriptionVi(twoLines, twoLines.replace(/\n/g, '\r\n'))).toBeNull()
    const accented = 'Café-style espresso cups with saucers, set of 4.'
    expect(accented.normalize('NFD')).not.toBe(accented)
    expect(ownDescriptionVi(accented, accented.normalize('NFD'))).toBeNull()
    // Terse English, French, Korean: all not-Vietnamese to the detector.
    for (const t of ['Brand new. Never used. Original box.', 'Café crème, 250 g — torréfaction artisanale.', '한국 화장품 세트']) {
      expect(ownDescriptionVi(t, t), t).toBeNull()
    }
    // A real Vietnamese description is kept, and so is a Vietnamese source copied into both.
    expect(ownDescriptionVi(EN_DESC, VI_OWN)).toBe(VI_OWN)
    expect(ownDescriptionVi(VI_SRC, VI_SRC)).toBe(VI_SRC)
    expect(ownDescriptionVi(EN_DESC, null)).toBeNull()
    expect(ownDescriptionVi(EN_DESC, undefined)).toBeNull()
    expect(ownDescriptionVi(EN_DESC, '')).toBeNull()
    expect(ownDescriptionVi('', VI_OWN)).toBe(VI_OWN)
    // The column is NOT NULL, but a render must degrade rather than throw if one ever arrives empty.
    expect(ownDescriptionVi(undefined as unknown as string, VI_OWN)).toBe(VI_OWN)
  })

  it('⛔ reads the language on the NFC form — a Vietnamese copy stored NFD is still Vietnamese, and kept', () => {
    // No 'đ' on purpose: đ has no decomposition, so it would give the language away even in NFD.
    const nfc = 'Giày chạy bộ nhẹ, thân lưới thoáng khí, êm chân.'
    const nfd = nfc.normalize('NFD')
    expect(detectContentLang(nfd)).toBeNull()            // what the raw column reads as
    expect(ownDescriptionVi(nfd, nfd)).toBe(nfd)
    expect(ownDescriptionVi(nfd, nfc)).toBe(nfc)
    // …and a Korean copy stored NFD is still Korean, and dropped.
    const ko = '한국 화장품 세트'.normalize('NFD')
    expect(ownDescriptionVi(ko, ko)).toBeNull()
  })

  it('the known cost, pinned: Vietnamese typed WITHOUT marks is invisible to the detector, so its copy takes the translation path too', () => {
    const unmarked = 'Giay chay bo nhe, than luoi thoang khi, de em. Hang chinh hang, bao hanh 12 thang.'
    expect(ownDescriptionVi(unmarked, unmarked)).toBeNull()
    // Its OWN Vietnamese (anything but a copy of the source) is never touched.
    expect(ownDescriptionVi(unmarked, VI_OWN)).toBe(VI_OWN)
  })
})

describe('ListingDescription / LocalizedTitle for a Vietnamese reader', () => {
  /**
   * A Vietnamese DEVICE as well as a Vietnamese page: the provider reconciles with the device language
   * on mount, and jsdom's is en-US — which would reload once and then flip the reader to English.
   */
  function renderVi(node: React.ReactNode) {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
    return render(<LanguageProvider initialLang="vi" initialViDict={{}}>{node}</LanguageProvider>)
  }
  afterEach(() => {
    // The override is an OWN property; deleting it restores the prototype's getter untouched.
    Reflect.deleteProperty(navigator, 'languages')
    vi.unstubAllGlobals()
  })

  it('⛔ a descriptionVi copied from the English source gives way to the cached Vietnamese translation', () => {
    const { container } = renderVi(<ListingDescription text={EN_DESC} vi={EN_DESC} i18n={{ vi: VI_MT }} />)
    // The description itself — a machine translation now carries the "Đã dịch tự động" line above it.
    expect(container.querySelector('.allow-select')!.textContent).toBe(VI_MT)
  })

  it('…and with nothing cached, to the client machine translation — not the English copy', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: [VI_MT] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderVi(<ListingDescription text={EN_DESC} vi={EN_DESC} />)
    expect(await screen.findByText(VI_MT)).toBeTruthy()
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toEqual({ texts: [EN_DESC], target: 'vi' })
  })

  it('a real descriptionVi still wins over the cache, and a Vietnamese source copied into both is shown as it is', () => {
    expect(renderVi(<ListingDescription text={EN_DESC} vi={VI_OWN} i18n={{ vi: VI_MT }} />).container.textContent).toBe(VI_OWN)
    cleanup()
    expect(renderVi(<ListingDescription text={VI_SRC} vi={VI_SRC} i18n={{ vi: VI_MT }} />).container.textContent).toBe(VI_SRC)
  })

  it('an English reader still reads the English source', () => {
    const { container } = render(<LanguageProvider initialLang="en"><ListingDescription text={EN_DESC} vi={EN_DESC} i18n={{ vi: VI_MT }} /></LanguageProvider>)
    expect(container.textContent).toBe(EN_DESC)
  })

  it('⛔ TITLES keep today’s behaviour: a titleVi equal to the English title is shown, not the cache', () => {
    const title = 'The Pragmatic Programmer, 20th Anniversary Edition'
    const { container } = renderVi(<LocalizedTitle title={title} titleVi={title} i18n={{ vi: 'Lập trình viên thực dụng' }} />)
    expect(container.textContent).toBe(title)
  })
})

/**
 * ⛔ THE AUTHORED VIETNAMESE COLUMN WINS — even when the English slot names a Vietnamese place.
 * detectContentLang reads one exclusive letter as "Vietnamese", so "… Tây Thạnh Ward" (ạ) used to be
 * shown AS the Vietnamese version, over the titleVi the importer wrote beside it: 22 English rental
 * cards on vi /c/rentals (2026-09-29). And an English reader of the same row was sent to
 * English→English machine translation, one request per card.
 */
const EN_RENTAL = 'Office / shopfront · 65 m² for rent — Tây Thạnh Ward, Tân Phú District'
const VI_RENTAL = 'Cho thuê Mặt bằng 65m² — Phường Tây Thạnh, Quận Tân Phú'
const EN_RENTAL_DESC = ['Listed on Muaban.net.', '', 'Type: Room', 'Ward: Vĩnh Hội Ward (new), District 4', 'Rent: 10,500,000 đ/month'].join('\n')
const VI_RENTAL_DESC = ['Tin đăng trên Muaban.net.', '', 'Loại: Phòng trọ', 'Phường: P. Vĩnh Hội mới, Quận 4', 'Giá thuê: 10.500.000 đ/tháng'].join('\n')

describe('useLocalized — an English slot that names a Vietnamese place', () => {
  function renderIn(lang: 'en' | 'vi', node: React.ReactNode) {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
    return render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  }
  /** Past the batcher's 60ms window, so a queued request would have been sent. */
  const settle = () => new Promise((r) => setTimeout(r, 120))
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
    vi.unstubAllGlobals()
  })

  it('a Vietnamese reader gets the titleVi, with no request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(detectContentLang(EN_RENTAL)).toBe('vi') // the false positive this guards
    const { container } = renderIn('vi', <LocalizedTitle title={EN_RENTAL} titleVi={VI_RENTAL} />)
    expect(container.textContent).toBe(VI_RENTAL)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a Vietnamese reader gets the descriptionVi of an English description that names "Vĩnh Hội"', () => {
    const { container } = renderIn('vi', <ListingDescription text={EN_RENTAL_DESC} vi={VI_RENTAL_DESC} />)
    expect(container.textContent).toContain('Tin đăng trên Muaban.net.')
    expect(container.textContent).not.toContain('Listed on')
  })

  it('an English reader gets the English title as it is, with no request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderIn('en', <LocalizedTitle title={EN_RENTAL} titleVi={VI_RENTAL} />)
    expect(container.textContent).toBe(EN_RENTAL)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a Vietnamese-source title with no titleVi still renders the source for a Vietnamese reader', () => {
    const src = 'Cho thuê phòng trọ gần chợ Bến Thành'
    const { container } = renderIn('vi', <LocalizedTitle title={src} titleVi={null} i18n={{ vi: 'Phòng trọ cho thuê gần chợ Bến Thành' }} />)
    expect(container.textContent).toBe(src)
  })

  it('⛔ an English title dense with place names is still the English slot — no request', async () => {
    // 3 unmarked words at most, so it LOOKS Vietnamese by shape: 2,684 real titles like it were sent
    // to English→English translation while a shape test sat on top of the schema rule (2026-09-29).
    const title = '300 m² for rent — Tân Định Ward (new), District 1'
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderIn('en', <LocalizedTitle title={title} titleVi="Cho thuê Nhà phố / Biệt thự 300m² — P. Tân Định mới, Quận 1" />)
    expect(container.textContent).toBe(title)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('⚠️ a DESCRIPTION beside a different descriptionVi is not assumed English — it still translates', () => {
    // The shape of one shop's spec sheets: the scraped Vietnamese original in `description`, a
    // re-labelled copy in descriptionVi. An English reader gets the embedded English, not the original.
    const src = 'Hãng sản xuất: Màn hình Dell · Model: P2723D · Kích thước màn hình: 27 inch · Độ phân giải: QHD (2560 x 1440)'
    const viCopy = 'Hãng sản xuất: Màn hình Dell · Mẫu: P2723D · Kích thước màn hình: 27 inch · Độ phân giải: QHD (2560 x 1440)'
    const en = 'Manufacturer: Dell monitor · Model: P2723D · Screen size: 27 inch · Resolution: QHD (2560 x 1440)'
    const { container } = renderIn('en', <ListingDescription text={src} vi={viCopy} i18n={{ en }} />)
    expect(container.querySelector('.allow-select')!.textContent).toBe(en)
  })

  it('an English reader of Vietnamese titles with nothing embedded: ONE request, each text once', async () => {
    const src = 'Giảng viên — Đại học Việt Nam'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: ['Lecturer — Vietnam University'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderIn('en', <><p><LocalizedTitle title={src} titleVi={null} /></p><p><LocalizedTitle title={src} titleVi={null} /></p></>)
    expect(await screen.findAllByText('Lecturer — Vietnam University')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toEqual({ texts: [src], target: 'en' })
  })
})

/**
 * ⛔ AN OFFICIAL HELP ANSWER IS ENGLISH BY AUTHORSHIP ('english'), SO NO LETTER IN IT SENDS IT TO
 * /api/translate target=en. 10 of the 40 seeded bodies carry one the detector reads as foreign — "đ"
 * in a VND price, "Cảm ơn" in a phrase list, "한국어" in the language list — and each was machine-
 * translated English→English after hydration, tagged vi or ko (review, 2026-09-29). `en` in the plan is
 * the only text useMachineEn ever sends, so '' there IS "no English-target request".
 */
const HELP_VND = 'After the photo, price is what buyers read first. 12.000.000 đ looks like a real price; 12tr reads like a guess.'
const HELP_LANGS = 'The site speaks these languages:\n\n• English, Tiếng Việt, 中文, 한국어, Русский'
const HELP_VND_VI = 'Sau ảnh, giá là điều người mua đọc đầu tiên. 12.000.000 đ trông như giá thật; 12tr đọc như đoán.'

describe("localizedPlan — 'english' (an official help answer)", () => {
  it.each([HELP_VND, HELP_LANGS])('an English reader gets the authored text and NO target=en request: %s', (text) => {
    expect(detectContentLang(text)).not.toBeNull() // the per-letter false positive this guards
    expect(localizedPlan(text, null, null, 'en', 'english')).toEqual({ embedded: text, tr: '', en: '' })
    // …even when the cache holds an `en` row for it.
    expect(localizedPlan(text, null, { en: 'MT' }, 'en', 'english').en).toBe('')
  })

  it('a Vietnamese reader gets the curated twin from the embed — not the English body read AS Vietnamese', () => {
    expect(localizedPlan(HELP_VND, null, { vi: HELP_VND_VI }, 'vi', 'english')).toEqual({ embedded: HELP_VND_VI, tr: '', en: '' })
    // A member's post ('description') no longer reads as Vietnamese on one "đ" either (2026-10-02,
    // detect-lang readsAsVietnamese); a 'title' still does.
    expect(localizedPlan(HELP_VND, null, { vi: HELP_VND_VI }, 'vi', 'description').embedded).toBe(HELP_VND_VI)
    expect(localizedPlan(HELP_VND, null, { vi: HELP_VND_VI }, 'vi', 'title').embedded).toBe(HELP_VND)
  })

  it('without an embed a non-English reader falls back to useTr (never target=en); another language to its own embed', () => {
    expect(localizedPlan(HELP_VND, null, null, 'vi', 'english')).toEqual({ embedded: null, tr: HELP_VND, en: '' })
    expect(localizedPlan(HELP_VND, null, { ko: '사진 다음은 가격' }, 'ko', 'english').embedded).toBe('사진 다음은 가격')
    expect(localizedPlan(HELP_VND, null, null, 'ko', 'english')).toEqual({ embedded: null, tr: HELP_VND, en: '' })
  })

  it("a member's Vietnamese post still translates for an English reader (the 2026-07-14 rule stands)", () => {
    const src = 'Làm sao để đăng tin cho thuê phòng?'
    expect(localizedPlan(src, null, null, 'en', 'description')).toEqual({ embedded: null, tr: '', en: src })
  })

  it('English text with no foreign letter is left alone in every column', () => {
    const text = 'How do I sign in?'
    for (const column of ['title', 'description', 'english'] as LocalizedColumn[]) {
      expect(localizedPlan(text, null, null, 'en', column)).toEqual({ embedded: text, tr: '', en: '' })
    }
  })
})

describe("useLocalized — 'english' rendered", () => {
  function Probe({ text, i18n }: { text: string; i18n?: Record<string, string> | null }) {
    return <>{useLocalized(text, null, i18n, 'english')}</>
  }
  function renderIn(lang: 'en' | 'vi', node: React.ReactNode) {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
    return render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  }
  const settle = () => new Promise((r) => setTimeout(r, 120))
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
    vi.unstubAllGlobals()
  })

  it('⛔ under the English UI: the authored body, and no request at all', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: ['MT[After the …]'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderIn('en', <><p><Probe text={HELP_VND} /></p><p><Probe text={HELP_LANGS} /></p></>)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain(HELP_VND)
    expect(container.textContent).not.toContain('MT[')
  })

  it('under the Vietnamese UI: the curated twin, synchronously', () => {
    const { container } = renderIn('vi', <Probe text={HELP_VND} i18n={{ vi: HELP_VND_VI }} />)
    expect(container.textContent).toBe(HELP_VND_VI)
  })
})

/**
 * ⛔ DESCRIPTIONS: THE ENGLISH SLOT, AND WHICH SIDE A TEXT IS ON (2026-10-02). Live rows from the audit
 * export (translation-audit-2026-10-02.md §8), cut down. `en` in the plan is the only text sent to
 * /api/translate target=en, so '' there means no English request.
 */
const BDS_EN = 'Listed on Batdongsan.com.vn.\n\nType: Apartment\nArea: 68 m²\nBedrooms: 2\nBathrooms: 2\nLocation: District 2 (An Khánh Ward, new)\nRent: 20,000,000 đ/month'
const BDS_VI = 'Tin đăng trên Batdongsan.com.vn.\n\nLoại hình: Căn hộ / Chung cư\nDiện tích: 68 m²\nPhòng ngủ: 2\nPhòng vệ sinh: 2\nKhu vực: Quận 2 (P. An Khánh mới)\nGiá thuê: 20.000.000 đ/tháng'
const MIOTO_EN = 'Self-drive car listed on Mioto.vn — book and pay on Mioto.\n\nPrice: 461,000 đ/day\nPickup area: Xã Phong Phú, Huyện Bình Chánh\nTrips completed on Mioto: 10\n\nOwner’s description (Vietnamese):\nXe đã trang bị Màn hình giải trí , nghe nhạc xem bản đồ, bộ bơm lốp kích bình'
const MIOTO_VI = 'Xe tự lái đăng trên Mioto.vn — đặt xe và thanh toán trên Mioto.\n\nGiá thuê: 461.000 đ/ngày\nKhu vực nhận xe: Xã Phong Phú, Huyện Bình Chánh\n\nMô tả của chủ xe:\nXe đã trang bị Màn hình giải trí , nghe nhạc xem bản đồ, bộ bơm lốp kích bình'
const SPEC_SRC = 'Hãng sản xuất: Màn hình Dell · Model: E2225HM · Kích thước màn hình: 21.5 inch · Độ phân giải: Full HD (1920 x 1080) · Tỉ lệ: 16:9 · Tấm nền màn hình: VA. New, supplied by BỀN COMPUTER.'
const SPEC_VI = 'Hãng sản xuất: Màn hình Dell · Mẫu: E2225HM · Kích thước màn hình: 21.5 inch · Độ phân giải: Full HD (1920 x 1080) · Tỉ lệ: 16:9 · Tấm nền màn hình: VA. Hàng mới, phân phối bởi BỀN COMPUTER.'
const USED_PHONE = 'Apple iPhone 14 Pro Max 128GB cũ 99%'
const TGDD = 'Xiaomi Mi Band 10 Pro viền gốm dây cao su Fluoro chính hãng, giá rẻ. Mua online giao nhanh toàn quốc 1 giờ, xem hàng không mua không sao. Click ngay!'
const ENO_COFFEE = 'Commercial grade green Robusta, sold by the kilogram.\n\nPrice shown is per kg. Minimum order and delivery terms by arrangement — message us for a quote on your volume.\n\nGreen (unroasted) coffee beans from Đắk Lắk. Moisture, screen size and defect ratio to the grade named in the title.'
const ENO_COFFEE_VI = 'Cà phê Robusta xanh thương phẩm, bán theo kilogram.'

describe("localizedPlan — 'description': the English slot and the reader's side", () => {
  it('⛔ an English rental description beside its descriptionVi is the English slot: no target=en request', () => {
    expect(detectContentLang(BDS_EN)).toBe('vi') // "Khánh" — the one letter that used to send it to vi→en
    expect(localizedPlan(BDS_EN, BDS_VI, null, 'en', 'description')).toEqual({ embedded: BDS_EN, tr: '', en: '' })
    // …even when an English→English row was already paid for and cached: the source wins.
    expect(localizedPlan(BDS_EN, BDS_VI, { en: 'MT of the same English' }, 'en', 'description').embedded).toBe(BDS_EN)
    expect(localizedPlan(BDS_EN, BDS_VI, null, 'vi', 'description').embedded).toBe(BDS_VI)
  })

  it('⚠️ a description carrying an importer\'s "(Vietnamese):" passage keeps the translate path', () => {
    expect(localizedPlan(MIOTO_EN, MIOTO_VI, null, 'en', 'description')).toEqual({ embedded: null, tr: '', en: MIOTO_EN })
    expect(localizedPlan(MIOTO_EN, MIOTO_VI, { en: 'cached English' }, 'en', 'description').embedded).toBe('cached English')
  })

  it('⚠️ a re-labelled COPY beside it is not a translation, so the Vietnamese spec sheet still translates', () => {
    expect(localizedPlan(SPEC_SRC, SPEC_VI, null, 'en', 'description')).toEqual({ embedded: null, tr: '', en: SPEC_SRC })
  })

  it('⛔ an English reader gets Vietnamese with no Vietnamese-EXCLUSIVE letter translated ("cũ 99%", "chính hãng")', () => {
    for (const t of [USED_PHONE, TGDD]) {
      expect(detectContentLang(t), t).toBeNull() // why it was never requested
      expect(localizedPlan(t, t, null, 'en', 'description'), t).toEqual({ embedded: null, tr: '', en: t })
    }
  })

  it('⛔ a Vietnamese reader of an English description that names "Đắk Lắk" gets the cached Vietnamese (eno Trading)', () => {
    expect(localizedPlan(ENO_COFFEE, null, { vi: ENO_COFFEE_VI }, 'vi', 'description').embedded).toBe(ENO_COFFEE_VI)
    expect(localizedPlan(ENO_COFFEE, null, null, 'vi', 'description')).toEqual({ embedded: null, tr: ENO_COFFEE, en: '' })
    // The English reader still reads it as it is — a translation request is the cost of the "đ" (no slot).
    expect(localizedPlan(ENO_COFFEE, null, { en: ENO_COFFEE }, 'en', 'description').embedded).toBe(ENO_COFFEE)
  })

  it('a Vietnamese source with a run of English model words is still shown as it is to a Vietnamese reader', () => {
    const src = 'Sạc nhanh Apple iPhone 15 Pro Max USB-C 20W chính hãng, bảo hành 12 tháng, giao hàng toàn quốc'
    expect(localizedPlan(src, null, null, 'vi', 'description')).toEqual({ embedded: src, tr: '', en: '' })
    expect(ownDescriptionVi(src, src)).toBe(src)
    // Through the real path: the copy in both columns is kept (ẻ, ề are Vietnamese-specific), then shown.
    expect(ownDescriptionVi(TGDD, TGDD)).toBe(TGDD)
    expect(localizedPlan(TGDD, ownDescriptionVi(TGDD, TGDD), null, 'vi', 'description').embedded).toBe(TGDD)
  })

  it('TITLES are unchanged: one exclusive letter still decides, and the English slot needs it', () => {
    expect(localizedPlan(USED_PHONE, null, null, 'en', 'title')).toEqual({ embedded: USED_PHONE, tr: '', en: '' })
    expect(localizedPlan(ENO_COFFEE, null, { vi: ENO_COFFEE_VI }, 'vi', 'title').embedded).toBe(ENO_COFFEE)
  })
})

/**
 * ⛔ A MACHINE TRANSLATION SAYS SO, AND THE ORIGINAL IS ONE TAP AWAY (pdp-05 / auth-10 / quality-09).
 * A vi PDP showed 'Đánh giá về Eyebrow Shaping & Grooming Kit' — a mistranslation of the English
 * 'Complete…' — with nothing on the page to say it was translated or to show the seller's words.
 */
describe('"Translated · See original" under a machine-translated H1 and above the description', () => {
  function renderLang(lang: 'vi' | 'en', node: React.ReactNode) {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
    return render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  }
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
    vi.unstubAllGlobals()
  })
  const EN_TITLE = 'Complete Eyebrow Shaping & Grooming Kit'
  const VI_MT_TITLE = 'Bộ dụng cụ tỉa lông mày hoàn chỉnh'

  it('an embedded machine translation of the title: the note shows, and "See original" swaps in the source marked lang="en"', () => {
    const { container } = renderLang('vi', <LocalizedTitleHeading title={EN_TITLE} titleVi={null} i18n={{ vi: VI_MT_TITLE }} />)
    const h1 = container.querySelector('h1')!
    expect(h1.textContent).toBe(VI_MT_TITLE)
    expect(h1.hasAttribute('data-fab-avoid')).toBe(true)
    expect(screen.getByText(/Đã dịch tự động/)).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Xem bản gốc' })
    // The label carries the state (as in the messenger) — no aria-pressed beside a label that changes.
    expect(toggle.hasAttribute('aria-pressed')).toBe(false)
    toggle.click()
    return Promise.resolve().then(async () => {
      await screen.findByRole('button', { name: 'Xem bản dịch' })
      expect(h1.textContent).toBe(EN_TITLE)
      expect(h1.querySelector('[lang="en"]')!.textContent).toBe(EN_TITLE)
    })
  })

  it('no note when the reader gets the author’s own words: the authored titleVi, or the source in their language', () => {
    const a = renderLang('vi', <LocalizedTitleHeading title={EN_TITLE} titleVi="Bộ tỉa lông mày" i18n={{ vi: VI_MT_TITLE }} />)
    expect(a.container.querySelector('h1')!.textContent).toBe('Bộ tỉa lông mày')
    expect(a.queryByText(/Đã dịch tự động/)).toBeNull()
    cleanup()
    const b = renderLang('en', <LocalizedTitleHeading title={EN_TITLE} titleVi={null} i18n={{ vi: VI_MT_TITLE }} />)
    expect(b.container.querySelector('h1')!.textContent).toBe(EN_TITLE)
    expect(b.queryByText(/Translated/)).toBeNull()
  })

  it('the description gets the same note above it; its own descriptionVi gets none', () => {
    const a = renderLang('vi', <ListingDescription text={EN_DESC} vi={null} i18n={{ vi: VI_MT }} />)
    expect(a.getByRole('button', { name: 'Xem bản gốc' })).toBeTruthy()
    cleanup()
    const b = renderLang('vi', <ListingDescription text={EN_DESC} vi={VI_OWN} i18n={{ vi: VI_MT }} />)
    expect(b.queryByRole('button', { name: 'Xem bản gốc' })).toBeNull()
  })

  /**
   * ⛔ THE NOTE'S LINE IS HELD WHILE A CLIENT TRANSLATION IS OUT (review, 2026-10-04): with nothing embedded,
   * the note arrived after hydration and pushed the first screen down ~24px. ⚠️ Each case uses its own text:
   * the translation cache is module state and would answer a repeated one at once.
   */
  const ssrVi = (node: React.ReactNode) => renderToString(<LanguageProvider initialLang="vi" initialViDict={{}}>{node}</LanguageProvider>)

  it('nothing embedded: the line is held from the server render until the answer lands, then the note takes it — in one commit', async () => {
    const title = 'Garmin Venu 3 smartwatch, boxed'
    const ssr = ssrVi(<LocalizedTitleHeading title={title} titleVi={null} />)
    expect(ssr).toContain('data-mt-reserve')
    expect(ssr).not.toContain('Đã dịch tự động')

    let answer!: (r: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { answer = r }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderLang('vi', <LocalizedTitleHeading title={title} titleVi={null} />)
    const reserve = () => container.querySelector('[data-mt-reserve]')
    expect(reserve()).not.toBeNull()
    expect(reserve()!.getAttribute('aria-hidden')).toBe('true')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)) // one batch, the text once
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ texts: [title], target: 'vi' })
    expect(reserve()).not.toBeNull()
    await act(async () => { answer(new Response(JSON.stringify({ translations: ['Đồng hồ Garmin Venu 3, còn hộp'] }), { status: 200 })) })
    await screen.findByText(/Đã dịch tự động/)
    expect(reserve()).toBeNull()
  })

  it('an answer that comes back unchanged releases the line — no note, nothing held', async () => {
    const title = 'Kindle Paperwhite 5 signature edition'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ translations: [title] }), { status: 200 })))
    const { container } = renderLang('vi', <LocalizedTitleHeading title={title} titleVi={null} />)
    expect(container.querySelector('[data-mt-reserve]')).not.toBeNull()
    await waitFor(() => expect(container.querySelector('[data-mt-reserve]')).toBeNull())
    expect(screen.queryByText(/Đã dịch tự động/)).toBeNull()
  })

  it('nothing is held where no note can come: an embedded translation, the author’s own words, a Vietnamese title for a Vietnamese reader', () => {
    expect(ssrVi(<LocalizedTitleHeading title="Sony WH-1000XM5 headphones" titleVi={null} i18n={{ vi: 'Tai nghe Sony WH-1000XM5' }} />)).not.toContain('data-mt-reserve')
    expect(ssrVi(<LocalizedTitleHeading title="Sony WH-1000XM4 headphones" titleVi="Tai nghe Sony WH-1000XM4" />)).not.toContain('data-mt-reserve')
    // translateText answers a Vietnamese-looking text for a Vietnamese reader with itself, at once.
    expect(ssrVi(<LocalizedTitleHeading title="Bán xe máy cũ giá rẻ" titleVi={null} />)).not.toContain('data-mt-reserve')
    expect(renderToString(<LanguageProvider initialLang="en"><LocalizedTitleHeading title="Dyson V12 vacuum" titleVi={null} /></LanguageProvider>)).not.toContain('data-mt-reserve')
  })

  it('the description holds its note’s line the same way', () => {
    expect(ssrVi(<ListingDescription text="A barely used standing desk, 120 x 60 cm, motor works perfectly." vi={null} />)).toContain('data-mt-reserve')
  })
})

/**
 * ⛔ A LONG DESCRIPTION IS CLAMPED TO 8 LINES BELOW md, AND THE WHOLE TEXT STAYS IN THE DOM (pdp-04 A).
 */
describe('ListingDescription — "See more" on a long description', () => {
  const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long import description with plenty of words.`).join('\n')

  it('over the threshold: clamped below md, full text in the DOM, a See more button wired with aria-expanded/controls', () => {
    expect(LONG.length).toBeGreaterThan(DESCRIPTION_CLAMP_CHARS)
    const { container } = render(<LanguageProvider initialLang="en"><ListingDescription text={LONG} /></LanguageProvider>)
    const body = container.querySelector('.allow-select')!
    expect(body.className).toContain('max-md:line-clamp-8')
    expect(body.textContent).toContain('Line 30 of a long import description')
    const btn = screen.getByRole('button', { name: 'See more' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBe(body.id)
    expect(btn.className).toContain('md:hidden')
    btn.click()
    return screen.findByRole('button', { name: 'See less' }).then((less) => {
      expect(less.getAttribute('aria-expanded')).toBe('true')
      expect(body.className).not.toContain('line-clamp')
    })
  })

  it('many short lines under the character threshold are clamped too (by line count)', () => {
    const SHORT_LINES = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`).join('\n')
    expect(SHORT_LINES.length).toBeLessThan(DESCRIPTION_CLAMP_CHARS)
    expect(SHORT_LINES.split('\n').length).toBeGreaterThan(DESCRIPTION_CLAMP_LINES)
    const { container } = render(<LanguageProvider initialLang="en"><ListingDescription text={SHORT_LINES} /></LanguageProvider>)
    expect(container.querySelector('.allow-select')!.className).toContain('max-md:line-clamp-8')
    expect(screen.getByRole('button', { name: 'See more' })).toBeTruthy()
  })

  it('a short description is never clamped and has no button', () => {
    const { container } = render(<LanguageProvider initialLang="en"><ListingDescription text="A short note." /></LanguageProvider>)
    expect(container.querySelector('.allow-select')!.className).not.toContain('line-clamp')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
