// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'

import { LanguageProvider, Tr, useLanguage } from '@/context/language-context'
import { __resetMtMissesForTests } from '@/lib/i18n/mt-client'

/**
 * ⛔ WHO REPAINTS WHEN A MACHINE TRANSLATION LANDS (speed audit, 2026-11-10). A landing used to re-render every
 * useLanguage() consumer — 1,203 components on Vietnamese /c/rentals, for 2 card titles. Only tr() needs that: it reads
 * the cache during render. <Tr>/useTr takes its answer from its own promise. These pin both halves in a nine-language
 * reader (Korean, on the English variant): a title landing leaves the rest of the page alone, and a tr() string the UI
 * dictionary does not have still turns Korean.
 */

// The third language's UI catalogue is kept empty: this file is about the per-string translator behind tr() and <Tr>.
vi.mock('@/generated/ui-strings', () => ({ UI_STRINGS: [] }))
vi.mock('@/generated/ui-strings.services', () => ({ UI_STRINGS_SERVICES: [] }))

const KO: Record<string, string> = {
  'A card title nobody warmed': '아무도 미리 번역하지 않은 카드 제목',
  'A label no dictionary has': '사전에 없는 라벨',
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
  return <span data-testid="label">{tr('A label no dictionary has')}</span>
}

const roots: Root[] = []
async function mount(node: React.ReactElement) {
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  roots.push(root)
  await act(async () => { root.render(<LanguageProvider initialLang="en">{node}</LanguageProvider>) })
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
  __resetMtMissesForTests()
})

describe('a machine translation landing (speed audit, 2026-11-10)', () => {
  it('a <Tr> title lands without re-rendering the other useLanguage() consumers', async () => {
    await mount(<><Bystander /><p><Tr text="A card title nobody warmed" /></p></>)
    // The Korean catalogue warm-up has repainted (it is stored right after), so the count below moves only for the landing.
    await vi.waitFor(() => expect([...stored.keys()].some((k) => k.startsWith('ui-dict:'))).toBe(true))
    await settle()
    expect(asked).toEqual(['A card title nobody warmed'])
    const before = bystanderRenders
    await act(async () => { held.splice(0).forEach((answer) => answer()) })
    await vi.waitFor(() => expect(text()).toContain(KO['A card title nobody warmed']))
    await settle()
    expect(bystanderRenders).toBe(before)
  })

  it('⛔ a tr() string missing from the dictionary still turns Korean when it lands', async () => {
    await mount(<><Bystander /><Label /></>)
    await settle()
    expect(asked).toEqual(['A label no dictionary has'])
    expect(text()).toContain('A label no dictionary has')
    await act(async () => { held.splice(0).forEach((answer) => answer()) })
    await vi.waitFor(() => expect(text()).toContain(KO['A label no dictionary has']))
  })
})
