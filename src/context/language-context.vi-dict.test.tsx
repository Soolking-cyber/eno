// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import type { Root } from 'react-dom/client'

/**
 * ⛔ THE VIETNAMESE DICTIONARY IS NO LONGER A PROP (audit #1). It rode the root layout into every
 * vi document's RSC payload — 171 KB, 53 KB gz, 66% of a static page — and LanguageProvider now
 * SUSPENDS on the lazy chunk instead. These pin what that must still guarantee:
 *   · the SERVER renders Vietnamese dictionary strings with no prop at all;
 *   · a FRESH client (dictionary not loaded) hydrates that HTML with no mismatch and stays Vietnamese;
 *   · the English variant never loads the dictionary.
 *
 * The dictionary-loaded flag is module state, so each test imports a fresh copy of the provider —
 * language-context.ssr.test.tsx seeds a two-word stand-in dictionary that would otherwise leak in.
 */

// The dictionary import is made SLOW, as a chunk over the network is, so hydration really suspends
// and resumes. The real module is returned, just late.
// ⚠️ WHAT THIS CANNOT CATCH: the first cut of this change — `use()` at the top of LanguageProvider,
// before its hooks — threw React #467 ("Update hook called on initial render") in the production
// build in a real browser, and still passes here. That regression is pinned by the structure (the
// hookless ViDictGate in language-context.tsx) and by a browser check, not by this file.
vi.mock('@/generated/vi-overrides', async (importOriginal) => {
  await new Promise((r) => setTimeout(r, 30))
  return importOriginal()
})

// A real entry from the generated dictionary, so the test exercises the chunk that ships.
async function realEntry(): Promise<[string, string]> {
  const { VI_OVERRIDES } = await import('@/generated/vi-overrides')
  const hit = Object.entries(VI_OVERRIDES).find(([en, vi]) => en.length > 8 && vi !== en && !/[<>{}]/.test(en))
  if (!hit) throw new Error('no usable dictionary entry')
  return hit
}

async function freshProvider() {
  vi.resetModules()
  return import('@/context/language-context')
}

async function serverHtml(node: React.ReactElement): Promise<string> {
  const { renderToReadableStream } = await import('react-dom/server')
  const stream = await renderToReadableStream(node)
  await stream.allReady
  return (await new Response(stream).text()).replace(/<!-- -->/g, '')
}

beforeEach(() => {
  try { window.localStorage?.clear?.() } catch { /* ignore */ }
  document.cookie = 'lang=; path=/; max-age=0'
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
})
/**
 * ⛔ EVERY ROOT THIS FILE MOUNTS IS UNMOUNTED AFTER ITS TEST — that is what runs useTr's effect cleanup,
 * and the cleanup is the only thing that stops a translation landing later from calling setState.
 * Until 2026-10-03 no root was ever unmounted, so that guard never tripped: the failed-chunk test left
 * a <Tr> whose machine-translation batch (60 ms window + an /api/translate that rejects in jsdom) settled
 * AFTER the file's last test — measured 35 ms past afterAll, with `window` already deleted by vitest's
 * jsdom teardown — and React's dispatchSetState read `window.event` there. CI run 36978253786 failed on
 * exactly that ("ReferenceError: window is not defined", 11,714 tests green). Mount through `roots`.
 * (RTL's auto-cleanup does not run here either: it registers only when `afterEach` is a global, and
 * vitest.config.ts does not set `globals`.)
 */
const roots: Root[] = []
async function unmountRoots() {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
}
afterEach(async () => {
  await unmountRoots()
  document.body.innerHTML = ''
})

describe('the vi dictionary loads as a chunk, not a prop', () => {
  it('the server renders dictionary Vietnamese with no initialViDict', async () => {
    const [en, vi] = await realEntry()
    const { LanguageProvider, Tr } = await freshProvider()
    const html = await serverHtml(<LanguageProvider initialLang="vi"><p><Tr text={en} /></p></LanguageProvider>)
    expect(html).toContain(vi)
  })

  it('a fresh client hydrates that HTML with no mismatch, and stays Vietnamese', async () => {
    const [en, vi] = await realEntry()
    // The server copy is SEEDED, so its HTML is Vietnamese whatever the provider's own loading does —
    // this test is about the client side of the handshake only.
    const server = await freshProvider()
    const { VI_OVERRIDES } = await import('@/generated/vi-overrides')
    const html = await serverHtml(
      <server.LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}><p id="t"><server.Tr text={en} /></p></server.LanguageProvider>,
    )
    expect(html).toContain(vi)

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const client = await freshProvider() // dictionary NOT loaded in this copy — the real first visit
    const { viLoaded: before } = await import('@/lib/i18n/mt-client')
    expect(before).toBe(false)

    const { hydrateRoot } = await import('react-dom/client')
    const recoverable: unknown[] = []
    await act(async () => {
      roots.push(hydrateRoot(container, <client.LanguageProvider initialLang="vi"><p id="t"><client.Tr text={en} /></p></client.LanguageProvider>, {
        onRecoverableError: (e) => { recoverable.push(e) },
      }))
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    expect(recoverable).toEqual([])
    expect(container.querySelector('#t')?.textContent).toBe(vi)
  })

  it('the production pairing: an UNSEEDED server and a fresh client agree', async () => {
    const [en, vi] = await realEntry()
    const server = await freshProvider()
    const html = await serverHtml(<server.LanguageProvider initialLang="vi"><p id="t"><server.Tr text={en} /></p></server.LanguageProvider>)
    expect(html).toContain(vi)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    const client = await freshProvider()
    const { hydrateRoot } = await import('react-dom/client')
    const recoverable: unknown[] = []
    await act(async () => {
      roots.push(hydrateRoot(container, <client.LanguageProvider initialLang="vi"><p id="t"><client.Tr text={en} /></p></client.LanguageProvider>, {
        onRecoverableError: (e) => { recoverable.push(e) },
      }))
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
    expect(recoverable).toEqual([])
    expect(container.querySelector('#t')?.textContent).toBe(vi)
  })

  it('the English variant never loads the dictionary', async () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
    const { LanguageProvider } = await freshProvider()
    await serverHtml(<LanguageProvider initialLang="en"><p>x</p></LanguageProvider>)
    // Wait out the (mocked, 30 ms) load before looking: read at once, a load English STARTED would
    // not have finished yet and this would pass whether or not it happened.
    await new Promise((r) => setTimeout(r, 120))
    const { viLoaded } = await import('@/lib/i18n/mt-client')
    expect(viLoaded).toBe(false)
  })
  // Last in the file: it replaces the dictionary module with one that fails to load.
  // (The SERVER half of the failure path lives in language-context.vi-dict.server.test.tsx — it needs
  // a node environment, where `window` is undefined.)
  it('CLIENT: a chunk that fails during hydration degrades the page to English — it does not throw', async () => {
    const [en, viText] = await realEntry()
    const server = await freshProvider()
    const { VI_OVERRIDES } = await import('@/generated/vi-overrides')
    const html = await serverHtml(
      <server.LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}><p id="t"><server.Tr text={en} /></p></server.LanguageProvider>,
    )
    expect(html).toContain(viText)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    vi.resetModules()
    vi.doMock('@/generated/vi-overrides', async () => {
      await new Promise((r) => setTimeout(r, 10))
      throw new Error('ChunkLoadError: simulated — HTML from before a deploy, chunk gone')
    })
    const client = await import('@/context/language-context')
    const { hydrateRoot } = await import('react-dom/client')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable: unknown[] = []
    let uncaught: unknown = null
    await act(async () => {
      try {
        roots.push(hydrateRoot(container, <client.LanguageProvider initialLang="vi"><p id="t"><client.Tr text={en} /></p></client.LanguageProvider>, {
          onRecoverableError: (e) => { recoverable.push(e) },
          onUncaughtError: (e) => { uncaught = e },
        }))
      } catch (e) { uncaught = e }
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
    quiet.mockRestore()
    vi.doUnmock('@/generated/vi-overrides')

    expect(uncaught).toBeNull()
    expect(container.querySelector('#t')?.textContent).toBe(en) // degraded to English, but alive
  })
  it('CLIENT: a failed load is retried once per interval — never by every asker at once', async () => {
    vi.resetModules()
    vi.doMock('@/generated/vi-overrides', () => { throw new Error('simulated chunk failure') })
    const mt = await import('@/lib/i18n/mt-client')
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const first = mt.loadViOverrides()
      await expect(first).rejects.toThrow()
      expect(mt.loadViOverrides()).toBe(first) // every <Tr> in the page shares the one failure
      vi.advanceTimersByTime(mt.VI_RETRY_MS)
      const retry = mt.loadViOverrides()
      expect(retry).not.toBe(first) // …and after the pause, one fresh attempt
      await retry.catch(() => {})
    } finally {
      vi.useRealTimers()
      vi.doUnmock('@/generated/vi-overrides')
    }
  })
  /**
   * CI run 36978253786, made deterministic. The machine-translation answer is HELD until the page is
   * gone and `window` deleted, as vitest's jsdom teardown deletes it — the order a loaded runner
   * happened to produce. Take out the `unmountRoots()` below and this fails on every run, with that run's
   * error ("ReferenceError: window is not defined" ← dispatchSetState ← useTr's `.then`) caught here.
   */
  it('a translation that lands after the page is gone never reaches React', async () => {
    const text = 'A sentence no dictionary has'
    const translated = 'Một câu không từ điển nào có'
    let release = () => {}
    const held = vi.fn()
    // Only THIS test's request is held. An earlier test's batch timer can still fire in here (its root is
    // unmounted, so it is harmless), and it must neither count as ours nor take our `release`.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      if (!String(init?.body).includes(text)) return Promise.reject(new Error("another test's request"))
      held()
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, json: async () => ({ translations: [translated] }) })
      })
    })
    vi.resetModules()
    vi.doMock('@/generated/vi-overrides', () => { throw new Error('simulated chunk failure') })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const late: unknown[] = []
    const onLate = (reason: unknown) => { late.push(reason) }
    try {
      const mt = await import('@/lib/i18n/mt-client')
      const { LanguageProvider, Tr } = await import('@/context/language-context')
      const { createRoot } = await import('react-dom/client')
      const root = createRoot(document.body.appendChild(document.createElement('div')))
      roots.push(root)
      await act(async () => { root.render(<LanguageProvider initialLang="vi"><p><Tr text={text} /></p></LanguageProvider>) })
      // No dictionary, so useTr fell back to machine translation and its batch is now in flight.
      await vi.waitFor(() => expect(held).toHaveBeenCalledTimes(1))

      await unmountRoots() // what afterEach does…
      const win = Object.getOwnPropertyDescriptor(globalThis, 'window')!
      // …and then what the environment's teardown does. Asserted, or a window that would not delete
      // (another environment, a vitest upgrade) would leave this test guarding nothing.
      expect(Reflect.deleteProperty(globalThis, 'window')).toBe(true)
      process.on('unhandledRejection', onLate)
      try {
        release()
        // The cache is written just before each waiter of the batch resolves, and this check passes a
        // macrotask later at the earliest — by then useTr's `.then` has run, however the batch gets there.
        await vi.waitFor(() => expect(mt.trCache.get(`vi ${text}`)).toBe(translated))
      } finally {
        Object.defineProperty(globalThis, 'window', win)
        process.off('unhandledRejection', onLate)
      }
      expect(late.map(String)).toEqual([])
    } finally {
      quiet.mockRestore()
      vi.unstubAllGlobals()
      vi.doUnmock('@/generated/vi-overrides')
    }
  })
})
