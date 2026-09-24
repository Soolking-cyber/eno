// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { ListingDescription, LocalizedTitle, RichText, ownDescriptionVi } from './listing-content'

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
    expect(container.textContent).toBe(VI_MT)
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
