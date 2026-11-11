// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'

import { LanguageProvider, Tr, useLanguage, useTr, type Language } from '@/context/language-context'
import { __resetMtMissesForTests, trCache } from '@/lib/i18n/mt-client'

/**
 * ⛔ WHO REPAINTS WHEN A MACHINE TRANSLATION LANDS (speed audit, 2026-11-10). A landing used to re-render every
 * useLanguage() consumer — 1,203 components on Vietnamese /c/rentals, for 2 card titles. Only tr() needs that: it reads
 * the cache during render. <Tr>/useTr takes its answer from its own promise. These pin both halves in a nine-language
 * reader (Korean, on the English variant): a title landing leaves the rest of the page alone, and a tr() string the UI
 * dictionary does not have still turns Korean.
 */

// The third language's UI catalogue is kept empty: this file is about the per-string translator behind tr() and <Tr>.
// (One test fills it, to have the dictionary land after a failed request; afterEach empties it again.)
const catalogue = vi.hoisted(() => [] as string[])
vi.mock('@/generated/ui-strings', () => ({ UI_STRINGS: catalogue }))
vi.mock('@/generated/ui-strings.services', () => ({ UI_STRINGS_SERVICES: [] }))

// ⚠️ NAMED CONSTANTS, NEVER A LITERAL INSIDE tr('…') OR <Tr text="…">. scripts/gen-ui-strings.mjs harvests those literals
// from every file under src, tests included, so a literal here lands in src/generated/ui-strings.ts as app copy and CI's
// drift check goes red (it did, on the first version of this file).
const CARD = 'A card title nobody warmed'
const LABEL = 'A label no dictionary has'
const KO: Record<string, string> = {
  [CARD]: '아무도 미리 번역하지 않은 카드 제목',
  [LABEL]: '사전에 없는 라벨',
}

// Every /api/translate answer waits for the test, so render counts are read on both sides of the landing.
let held: (() => void)[] = []
const asked: string[] = []
function stubTranslate() {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!String(url).includes('/api/translate')) return Promise.reject(new Error(`unexpected request ${url}`))
    const { texts } = JSON.parse(String(init?.body)) as { texts: string[] }
    asked.push(...texts)
    return new Promise((resolve) => {
      held.push(() => resolve({ ok: true, json: async () => ({ translations: texts.map((t) => KO[t] ?? t) }) }))
    })
  })
}

// A fresh store per test (Node 25 gives jsdom a localStorage with no methods; CI's Node 24 keeps one across tests).
let stored = new Map<string, string>()
function stubStorage(seed: Record<string, string>) {
  const m = (stored = new Map(Object.entries(seed)))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  })
}

let bystanderRenders = 0
/** Any useLanguage() consumer that shows no machine translation: a price, a button, a card frame. */
function Bystander() {
  useLanguage()
  bystanderRenders++
  return null
}
function Label() {
  const { tr } = useLanguage()
  return <span data-testid="label">{tr(LABEL)}</span>
}

const roots: Root[] = []
async function mount(node: React.ReactElement, provider: { initialLang?: Language; initialViDict?: Record<string, string> } = {}) {
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  roots.push(root)
  await act(async () => { root.render(<LanguageProvider initialLang="en" {...provider}>{node}</LanguageProvider>) })
}
const text = () => document.body.textContent ?? ''
// Lets the mount's language switch, the catalogue warm-up and the 60 ms batch window all settle.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 120)) })

beforeEach(() => {
  held = []
  asked.length = 0
  bystanderRenders = 0
  stubStorage({ lang: 'ko' })
  stubTranslate()
})
// Unmounted before vitest tears jsdom down, so no answer can reach a gone page (language-context.vi-dict.test.tsx).
afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  catalogue.length = 0
  __resetMtMissesForTests()
})

describe('a machine translation landing (speed audit, 2026-11-10)', () => {
  it('a <Tr> title lands without re-rendering the other useLanguage() consumers', async () => {
    await mount(<><Bystander /><p><Tr text={CARD} /></p></>)
    // The Korean catalogue warm-up has repainted (it is stored right after), so the count below moves only for the landing.
    await vi.waitFor(() => expect([...stored.keys()].some((k) => k.startsWith('ui-dict:'))).toBe(true))
    await settle()
    expect(asked).toEqual([CARD])
    const before = bystanderRenders
    await act(async () => { held.splice(0).forEach((answer) => answer()) })
    await vi.waitFor(() => expect(text()).toContain(KO[CARD]))
    await settle()
    expect(bystanderRenders).toBe(before)
  })

  it('⛔ a tr() string missing from the dictionary still turns Korean when it lands', async () => {
    await mount(<><Bystander /><Label /></>)
    await settle()
    expect(asked).toEqual([LABEL])
    expect(text()).toContain(LABEL)
    await act(async () => { held.splice(0).forEach((answer) => answer()) })
    await vi.waitFor(() => expect(text()).toContain(KO[LABEL]))
  })
})

/**
 * ⛔ ONE FAILED REQUEST MUST NOT LEAVE <Tr>/useTr TEXT ENGLISH FOR THE VISIT (2026-11-11). On the wave-1 build, after one
 * 500 on the first per-string batch, 0/12 card titles turned Korean on / and 0/12 Vietnamese on /vi, and "Listings" and
 * "Other categories" stayed English on Korean /c/rentals even once the UI dictionary held them: the retry only repainted,
 * and useTr's effect never asks again. These pin that the retry — or the dictionary — reaches those texts, and that it
 * re-renders only the component showing the text: no app-wide repaint, at the retry or at its landing.
 */
describe('⛔ a text a failed request left in English (2026-11-11)', () => {
  const VI_TITLE = 'Một tiêu đề thẻ chưa ai dịch'
  const LATE = 'A label the dictionary brings late'
  const LATE_KO = '사전이 늦게 가져오는 라벨'
  const NEIGHBOUR = 'A second catalogue entry'
  let titleRenders = 0
  /** A card title, as listing-content's useLocalized asks for it. */
  function Title() {
    const shown = useTr(CARD)
    titleRenders++
    return <span>{shown}</span>
  }
  /** Request number `i` answers 500 when `fail(i)`; every other one translates from `table`. */
  function stubFailing(fail: (i: number) => boolean, table: Record<string, string>) {
    let i = 0
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (!String(url).includes('/api/translate')) return Promise.reject(new Error(`unexpected request ${url}`))
      const { texts } = JSON.parse(String(init?.body)) as { texts: string[] }
      asked.push(...texts)
      if (fail(i++)) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Translation failed' }) })
      return Promise.resolve({ ok: true, json: async () => ({ translations: texts.map((t) => table[t] ?? t) }) })
    })
  }
  // The tests above land CARD in Korean; the cache is module state, and a cached title is never asked for.
  beforeEach(() => { titleRenders = 0; trCache.clear() })

  it('Korean: the retry lands the card title, re-rendering only the title', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubFailing((i) => i === 0, KO)
    await mount(<><Bystander /><Title /></>)
    await vi.waitFor(() => expect([...stored.keys()].some((k) => k.startsWith('ui-dict:'))).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(asked).toEqual([CARD]) // the request that failed
    expect(text()).toBe(CARD)
    const bystander = bystanderRenders
    const title = titleRenders
    await act(async () => { await vi.advanceTimersByTimeAsync(15_200) }) // the wait ends; the retry goes and lands
    expect(asked).toEqual([CARD, CARD])
    expect(text()).toBe(KO[CARD])
    expect(titleRenders).toBe(title + 1)
    expect(bystanderRenders).toBe(bystander)
  })

  it('Vietnamese: the same, for a title with no Vietnamese column', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubStorage({ lang: 'vi' })
    stubFailing((i) => i === 0, { [CARD]: VI_TITLE })
    await mount(<><Bystander /><Title /></>, { initialLang: 'vi', initialViDict: {} })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(asked).toEqual([CARD])
    expect(text()).toBe(CARD)
    const bystander = bystanderRenders
    const title = titleRenders
    await act(async () => { await vi.advanceTimersByTimeAsync(15_200) })
    expect(asked).toEqual([CARD, CARD])
    expect(text()).toBe(VI_TITLE)
    expect(titleRenders).toBe(title + 1)
    expect(bystanderRenders).toBe(bystander)
  })

  it('a server that keeps failing is asked once per wait, not in a loop, and the page keeps the English', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubFailing(() => true, KO)
    await mount(<><Bystander /><Title /></>)
    await vi.waitFor(() => expect([...stored.keys()].some((k) => k.startsWith('ui-dict:'))).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    const bystander = bystanderRenders
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60_000) })
    // 0 s, then 15 s, 75 s, 315 s and 915 s after it: five requests in twenty minutes.
    expect(asked).toEqual([CARD, CARD, CARD, CARD, CARD])
    expect(text()).toBe(CARD)
    expect(bystanderRenders).toBe(bystander)
  })

  it('a <Tr> label the UI dictionary brings after its own request failed turns Korean when the dictionary lands', async () => {
    catalogue.push(LATE, NEIGHBOUR)
    const chunk: (() => void)[] = []
    let failed = false
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (!String(url).includes('/api/translate')) return Promise.reject(new Error(`unexpected request ${url}`))
      const { texts } = JSON.parse(String(init?.body)) as { texts: string[] }
      asked.push(...texts)
      // The dictionary chunk (both catalogue entries) is held, as on a slow network; the per-string batch fails.
      if (texts.length === 2) return new Promise((resolve) => { chunk.push(() => resolve({ ok: true, json: async () => ({ translations: [LATE_KO, NEIGHBOUR] }) })) })
      failed = true
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
    })
    await mount(<><Bystander /><p><Tr text={LATE} /></p></>)
    await vi.waitFor(() => expect(failed && chunk.length === 1).toBe(true))
    await settle()
    expect(text()).toBe(LATE)
    await act(async () => { chunk.splice(0).forEach((answer) => answer()) })
    await vi.waitFor(() => expect(text()).toBe(LATE_KO))
  })
})
