// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { responseSignal, type ResponseFacts } from '@/lib/response-signal'
import { ResponseChip, ResponseChipView } from './response-chip'

/**
 * <ResponseChip> — the four things a screenshot cannot show: that an UNMEASURED seller renders
 * literally nothing, that the chip is absent from the SERVER pass (the anti-mismatch contract for
 * a 30-day ISR page), that the slow tier still renders and still renders QUIETLY, and that a
 * screen reader hears "about" where the eye sees "~".
 *
 * ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest `globals: true`, so Testing Library
 * never registers its own afterEach. Without this line the second render in the file fails with
 * "Found multiple elements". (Same note as count-chip.test.tsx; any new component test needs it.)
 */
afterEach(cleanup)

/**
 * ⚠️ THE LANGUAGE IS DRIVEN THROUGH `setLang`, NOT THROUGH localStorage — the provider's mount
 * effect reads localStorage, but under this vitest/jsdom combination `window.localStorage` has no
 * getItem/setItem at all, so a stored preference is silently swallowed and every "vi" assertion
 * would have run in English. Same harness, and same reason, as count-chip.test.tsx.
 */
function clearLangPref() {
  try {
    window.localStorage?.removeItem?.('lang')
  } catch {
    /* no usable storage in this environment — nothing to clear */
  }
}
beforeEach(clearLangPref)
afterEach(clearLangPref)
afterEach(() => vi.restoreAllMocks())

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

/**
 * ⚠️ EVERY ASSERTION IN THIS FILE IS SYNCHRONOUS, AND THAT IS DELIBERATE RATHER THAN LUCKY.
 * Testing Library wraps render() in act(), which flushes effects AND the re-render that
 * <LangSwitch>'s setLang schedules — so both the mount gate and the language switch have already
 * settled by the time render() returns. There is nothing async in this component to wait for.
 *
 * ⚠️ AND `waitFor` MUST NOT BE REINTRODUCED ALONGSIDE A STUBBED CLOCK. Measured while writing this
 * file: with `Date.now` pinned to a constant, waitFor's own elapsed-time check never advances, so
 * a retry loop runs until vitest kills the test at 5s. Four tests failed that way and every one of
 * them looked like a component bug. If a future assertion genuinely needs waiting, unstub the
 * clock for it.
 */
function renderIn(lang: Language, ui: React.ReactNode) {
  return render(
    <LanguageProvider>
      <LangSwitch to={lang} />
      {ui}
    </LanguageProvider>,
  )
}

const DAY_MS = 86_400_000
/** Receipts are built against the REAL clock so the component's own Date.now() agrees with them. */
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS)

function facts(over: Partial<ResponseFacts> = {}): ResponseFacts {
  return {
    responseRate: 95,
    responseTime: 'within an hour',
    measuredAt: daysAgo(1),
    convoCount: 12,
    ...over,
  }
}

const FAST_EN = 'Replies within an hour'
const FAST_VI = 'Phản hồi trong vòng 1 giờ'
const SLOW_EN = 'Replies in a few days'
const chipOf = (c: HTMLElement) => c.querySelector('[data-slot="response-chip"]') as HTMLElement | null
/**
 * ⚠️ THE TWO HALVES ARE READ BY SELECTOR, NOT BY `getByText`, AND THAT IS FORCED BY THE DESIGN.
 * On the coarse path the visible sentence and the spoken one are the SAME words (there is no "~"
 * to spell out), so the chip legitimately holds that text twice — once aria-hidden for the eye,
 * once sr-only for the ear — and `getByText` throws "Found multiple elements". Splitting the
 * accessors keeps each assertion about the half it names.
 */
const visibleText = (c: HTMLElement) => chipOf(c)?.querySelector('span[aria-hidden="true"]')?.textContent ?? ''
const spokenText = (c: HTMLElement) => chipOf(c)?.querySelector('span.sr-only')?.textContent ?? ''

describe('the unmeasured seller renders NOTHING — the assertion the whole feature rests on', () => {
  const nothing: Array<[string, Partial<ResponseFacts>]> = [
    ['no receipt (the row still holds the fabricated 100 default)', { measuredAt: null }],
    ['a conversation count below the floor', { convoCount: 2 }],
    ['a receipt older than the sweep window', { measuredAt: daysAgo(30) }],
    ['a responseTime string nothing recognises', { responseTime: 'soon-ish' }],
  ]

  for (const [why, over] of nothing) {
    it(`renders no element with ${why}`, () => {
      const { container } = renderIn('en', <ResponseChip facts={facts(over)} />)
      expect(chipOf(container)).toBeNull()
      expect(container.textContent).toBe('')
    })
  }

  it('accepts null/undefined facts without a caller-side guard', () => {
    const first = renderIn('en', <ResponseChip facts={null} />)
    expect(first.container.textContent).toBe('')
    cleanup()
    const second = renderIn('en', <ResponseChip facts={undefined} />)
    expect(second.container.textContent).toBe('')
  })

  it('renders nothing from ResponseChipView when the signal is unmeasured or absent', () => {
    const unmeasured = responseSignal(facts({ measuredAt: null }), Date.now())
    const first = renderIn('en', <ResponseChipView signal={unmeasured} />)
    expect(first.container.textContent).toBe('')
    cleanup()
    const second = renderIn('en', <ResponseChipView signal={null} />)
    expect(second.container.textContent).toBe('')
  })
})

describe('a measured seller gets the relative time, in the reader language', () => {
  it('renders the English sentence', () => {
    const { container } = renderIn('en', <ResponseChip facts={facts()} />)
    expect(visibleText(container)).toBe(FAST_EN)
    expect(spokenText(container)).toBe(FAST_EN)
  })

  it('renders the Vietnamese sentence', () => {
    const { container } = renderIn('vi', <ResponseChip facts={facts()} />)
    expect(visibleText(container)).toBe(FAST_VI)
  })

  it('tags the tier on the element, so a call site can style or test without re-deriving it', () => {
    const { container } = renderIn('en', <ResponseChip facts={facts()} />)
    expect(chipOf(container)?.getAttribute('data-tier')).toBe('fast')
  })

  it('⚠️ STILL RENDERS for a slow seller — the listing is real and the buyer needs this most here', () => {
    const { container } = renderIn('en', <ResponseChip facts={facts({ responseTime: 'within a few days', responseRate: 90 })} />)
    expect(visibleText(container)).toBe(SLOW_EN)
    expect(chipOf(container)?.getAttribute('data-tier')).toBe('slow')
  })

  it('⚠️ never paints the slow chip as a warning — the demotion happens in ranking, not on the card', () => {
    const slow = renderIn('en', <ResponseChip facts={facts({ responseTime: 'within a few days', responseRate: 90 })} />)
    const slowChip = chipOf(slow.container) as HTMLElement
    // The badge palette maps its alert tones onto these tokens; a slow chip must carry neither.
    expect(slowChip.className).not.toContain('destructive')
    expect(slowChip.className).not.toContain('warning')
    cleanup()
    // And it must be visually IDENTICAL to the middle tier — `fast` is the only coloured one.
    const ok = renderIn('en', <ResponseChip facts={facts({ responseTime: 'within a day', responseRate: 90 })} />)
    expect((chipOf(ok.container) as HTMLElement).className).toBe(slowChip.className)
  })

  it('⛔ tells a buyer the seller often does not reply, instead of quoting a flattering median', () => {
    // The live prod shape: responseRate 33 with a sub-hour stored median. Until a reviewer caught
    // it this chip read "Replies within an hour" — a promise made to the two buyers in three who
    // get no answer at all. See unreliableLabels() in response-signal.ts.
    const { container } = renderIn('en', <ResponseChip facts={facts({ responseRate: 33 })} />)
    expect(visibleText(container)).toBe('Often no reply within a day')
    expect(chipOf(container)?.getAttribute('data-tier')).toBe('slow')
    // ⚠️ AND IT STAYS NEUTRAL. The sentence carries the fact; the colour must not carry a verdict.
    expect((chipOf(container) as HTMLElement).className).not.toContain('destructive')
  })

  it('colours ONLY the fast tier', () => {
    const { container } = renderIn('en', <ResponseChip facts={facts()} />)
    expect((chipOf(container) as HTMLElement).className).toContain('success')
  })
})

describe('what a screen reader actually hears', () => {
  it('hides the visible text from the accessible tree and offers a spoken form instead', () => {
    const { container } = renderIn('en', <ResponseChip facts={facts({ medianReplyMinutes: 12 })} />)

    expect(visibleText(container)).toBe('Replies in ~10 min')
    // The spoken half spells the tilde out — "tilde ten min" and "exactly ten minutes" are both
    // wrong, and which one a reader says depends on its punctuation-verbosity setting.
    expect(spokenText(container)).toBe('Replies in about 10 minutes')
    expect(chipOf(container)?.querySelector('span.sr-only')?.getAttribute('aria-hidden')).toBeNull()
  })

  it('keeps the clock glyph out of the accessible name', () => {
    const { container } = renderIn('en', <ResponseChip facts={facts()} />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBeTruthy()
  })
})

/**
 * ⚠️ THE ANTI-MISMATCH CONTRACT, and it can only be checked on the SERVER renderer.
 * Testing Library flushes effects inside render(), so the pre-mount pass is invisible to a client
 * test — the only place it can be observed is renderToString, which is exactly what Next bakes
 * into a cached page. These two assertions are the whole reason <ResponseChip> and
 * <ResponseChipView> are separate exports.
 */
describe('the server pass', () => {
  it('emits NO chip from <ResponseChip>, however measured the seller is', () => {
    const html = renderToString(
      <LanguageProvider>
        <ResponseChip facts={facts()} />
      </LanguageProvider>,
    )
    expect(html).not.toContain(FAST_EN)
    expect(html).not.toContain('response-chip')
  })

  it('DOES emit a chip from <ResponseChipView>, which is what a request-rendered page wants', () => {
    const html = renderToString(
      <LanguageProvider>
        <ResponseChipView signal={responseSignal(facts(), Date.now())} />
      </LanguageProvider>,
    )
    expect(html).toContain(FAST_EN)
    expect(html).toContain('response-chip')
  })
})

describe('the clock belongs to the VIEWER, which is what makes a 30-day ISR page safe', () => {
  it('drops a chip whose receipt expired after the page was baked', () => {
    // IDENTICAL props both times. Only the reader's clock moves — exactly what happens when a
    // cached page is opened nine days after it was generated. A server-computed answer would
    // still be asserting a reply time here.
    const baked = facts({ measuredAt: new Date(Date.now()) })

    const fresh = renderIn('en', <ResponseChip facts={baked} />)
    expect(chipOf(fresh.container)).toBeTruthy()
    cleanup()

    const nineDaysOn = Date.now() + 9 * DAY_MS
    vi.spyOn(Date, 'now').mockReturnValue(nineDaysOn)
    const stale = renderIn('en', <ResponseChip facts={baked} />)
    expect(stale.container.textContent).toBe('')
  })
})
