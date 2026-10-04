// @vitest-environment jsdom
/**
 * The contract <LocalizedDate> rests on, exercised end to end with the REAL LanguageProvider: the server
 * renders the en variant for a Russian reader (the nine machine-translated languages are never
 * server-rendered), the client's first render agrees with that HTML — so hydration is clean — and only
 * then does the provider swap to Russian and the date take Russian month names.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { LanguageProvider } from '@/context/language-context'
import { LocalizedDate } from './localized-date'

const OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
const tree = (
  <LanguageProvider initialLang="en">
    <p>
      <LocalizedDate iso="2026-10-04T20:00:00.000Z" options={OPTS} enText="5 October 2026" viText="5 tháng 10, 2026" />
    </p>
  </LanguageProvider>
)

let root: Root | null = null
// navigator.languages is redefined below; put the jsdom original back so no later test runs "in Russia".
const originalLanguages = Object.getOwnPropertyDescriptor(navigator, 'languages')
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalLanguages) Object.defineProperty(navigator, 'languages', originalLanguages)
  else delete (navigator as { languages?: readonly string[] }).languages
})

describe('<LocalizedDate> under the real provider', () => {
  it('a Russian reader: the English server HTML hydrates without a mismatch, then reads Russian', async () => {
    const html = renderToString(tree)
    expect(html).toContain('5 October 2026')

    // The browser: a Russian device, no stored choice. Translation fetches answer empty.
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['ru-RU', 'ru'] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    const recoverable: unknown[] = []
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (e) => { recoverable.push(e) } })
    })

    expect(recoverable).toEqual([])
    expect(errors.mock.calls.filter((c) => /hydrat/i.test(String(c[0])))).toEqual([])
    expect(container.textContent).toMatch(/^5\s+октября\s+2026/)
  })
})
