// @vitest-environment jsdom
/**
 * The root error page (outside every provider): first render is the bilingual EN · VI line (no
 * hydration difference), then the stored language — localStorage, else the `lang` cookie — where a
 * value that is not a site language is skipped rather than masking a valid cookie behind it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import GlobalError from '@/app/global-error'

// Node's own experimental localStorage shadows jsdom's here, so the test brings a plain one.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
})

const show = async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}) // <html> inside the test container, and the logged error
  let view: ReturnType<typeof render> | undefined
  await act(async () => { view = render(<GlobalError error={new Error('boom')} reset={() => {}} />) })
  return view!.container.querySelector('h1')?.textContent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  store.clear()
  document.cookie = 'lang=; path=/; max-age=0'
})

describe('global-error language', () => {
  it('a stale localStorage value does not mask a valid cookie', async () => {
    localStorage.setItem('lang', 'bogus')
    document.cookie = 'lang=fr; path=/'
    expect(await show()).toBe('Une erreur s’est produite')
  })
  it('en keeps the bilingual line; a prototype key is not a language', async () => {
    localStorage.setItem('lang', 'en')
    expect(await show()).toBe('Something went wrong · Đã xảy ra lỗi')
    localStorage.setItem('lang', 'constructor')
    cleanup()
    expect(await show()).toBe('Something went wrong · Đã xảy ra lỗi')
  })
})
