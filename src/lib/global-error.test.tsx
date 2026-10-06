// @vitest-environment jsdom
/**
 * The root error page (outside every provider): first render is the bilingual EN · VI line (no
 * hydration difference), then the stored language — localStorage, else the `lang` cookie — where a
 * value that is not a site language is skipped rather than masking a valid cookie behind it.
 */
import * as React from 'react'
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
  await act(async () => { view = render(<GlobalError error={new Error('boom')} reset={() => {}} retry={() => {}} />) })
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

describe('global-error Try again', () => {
  it('⛔ RETRIES — refresh + reset (Next 16.3) — instead of only resetting into the same failed payload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    let view: ReturnType<typeof render> | undefined
    await act(async () => { view = render(<GlobalError error={new Error('boom')} reset={() => {}} retry={retry} />) })
    await act(async () => { view!.container.querySelector('button')!.click() })
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('global-error Try again — fallback and stuck states', () => {
  it('falls back to reset should a Next ever stop passing retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reset = vi.fn()
    let view: ReturnType<typeof render> | undefined
    await act(async () => { view = render(<GlobalError error={new Error('boom')} reset={reset} />) })
    await act(async () => { view!.container.querySelector('button')!.click() })
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('busy while a refresh hangs — and still pressable: the only control on the page is never disabled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Next's retry runs router.refresh() in its OWN startTransition; a refresh that never lands is a transition
    // that stays suspended — modelled here by a child that suspends forever once retry flips it.
    const never = new Promise<never>(() => {})
    function Hangs({ go }: { go: boolean }) { if (go) React.use(never); return null }
    function Page() {
      const [go, setGo] = React.useState(false)
      return (
        <React.Suspense fallback={null}>
          <GlobalError error={new Error('boom')} reset={() => {}} retry={() => React.startTransition(() => setGo(true))} />
          <Hangs go={go} />
        </React.Suspense>
      )
    }
    let view: ReturnType<typeof render> | undefined
    await act(async () => { view = render(<Page />) })
    await act(async () => { view!.container.querySelector('button')!.click() })
    const button = view!.container.querySelector('button')!
    expect(button.getAttribute('aria-busy')).toBe('true') // the nested transition is still pending, and it shows
    expect(button.hasAttribute('disabled')).toBe(false)
  })
})
