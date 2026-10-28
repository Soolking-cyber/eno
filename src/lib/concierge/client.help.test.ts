// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ASKING FOR HELP (client.ts askForHelp) — in a browser document: the page's own path decides where the guide opens.
 * ⚠️ eno.vn's EDITION, IMPORTED AFTER THE STUB (as client.test.ts): vitest.config.ts pins 'services'.
 */
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { CONCIERGE_OPEN_EVENT, askForHelp, resetConciergeKnown, setConciergeAvailable, takePendingOpen } = await import('./client')
describe('askForHelp — every "Ask eno AI" (owner, 2026-10-28: "opens avatar ai all across the app … the message one is fallback")', () => {
  const nav = () => ({ push: vi.fn() })
  const at = (path: string) => window.history.pushState({}, '', path)
  const opens = () => { const f = vi.fn(); window.addEventListener(CONCIERGE_OPEN_EVENT, f); return f }
  afterEach(() => { at('/'); setConciergeAvailable(false); takePendingOpen('/') })

  it('where the window may float: it opens in place, and the app does not move', async () => {
    at('/?category=teachers'); setConciergeAvailable(true)
    const n = nav(); const opened = opens()
    await askForHelp(n, 'en')
    expect(opened).toHaveBeenCalledTimes(1)
    expect(n.push).not.toHaveBeenCalled()
    window.removeEventListener(CONCIERGE_OPEN_EVENT, opened)
  })

  it('from the messenger (the inbox, a thread, the text assistant): the explorer, where the host opens it — once, within 15 s', async () => {
    for (const path of ['/messages', '/messages/abc', '/messages/ai']) {
      at(path); setConciergeAvailable(true)
      const n = nav()
      await askForHelp(n, 'en', { voiceOnly: path === '/messages/ai' })
      expect(n.push, path).toHaveBeenCalledWith('/')
      expect(takePendingOpen(path), path).toBe(false) // still where it was asked: not yet, and kept
      expect(takePendingOpen('/'), path).toBe(true)
      expect(takePendingOpen('/'), path).toBe(false)
    }
    vi.useFakeTimers()
    try {
      at('/messages'); await askForHelp(nav(), 'en')
      vi.advanceTimersByTime(16_000)
      expect(takePendingOpen('/')).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('a page the person cannot leave without losing work (the post flow, a teacher\'s form): the text assistant, as before', async () => {
    for (const path of ['/post', '/teachers/join', '/signin']) {
      at(path); setConciergeAvailable(true)
      const n = nav()
      await askForHelp(n, 'en')
      expect(n.push, path).toHaveBeenCalledWith('/messages/ai')
    }
  })

  it('an account the guide is closed to: the text assistant — and from that assistant itself (voiceOnly), nothing', async () => {
    at('/'); setConciergeAvailable(false)
    const n = nav()
    await askForHelp(n, 'en')
    expect(n.push).toHaveBeenCalledWith('/messages/ai')
    const m = nav()
    at('/messages/ai')
    await askForHelp(m, 'en', { voiceOnly: true })
    expect(m.push).not.toHaveBeenCalled()
  })

  it('a tap before the host has looked: the host is asked NOW and its answer awaited — never the text by mistake (plan review, opus)', async () => {
    vi.resetModules()
    const c = await import('./client')
    at('/')
    const asked = vi.fn(() => { setTimeout(() => c.setConciergeAvailable(true), 30) })
    const opened = vi.fn()
    window.addEventListener(c.CONCIERGE_ASK_EVENT, asked)
    window.addEventListener(c.CONCIERGE_OPEN_EVENT, opened)
    try {
      const n = nav()
      await c.askForHelp(n, 'en')
      expect(asked).toHaveBeenCalledTimes(1)
      expect(opened).toHaveBeenCalledTimes(1)
      expect(n.push).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(c.CONCIERGE_ASK_EVENT, asked)
      window.removeEventListener(c.CONCIERGE_OPEN_EVENT, opened)
    }
  })

  it('…and with no answer within 2 s, the text assistant', async () => {
    vi.resetModules()
    const c = await import('./client')
    vi.useFakeTimers()
    try {
      at('/')
      const n = nav()
      const p = c.askForHelp(n, 'en')
      await vi.advanceTimersByTimeAsync(2_000)
      await p
      expect(n.push).toHaveBeenCalledWith('/messages/ai')
    } finally { vi.useRealTimers() }
  })

  it('⛔ after a sign-in (known reset), a tap waits for THIS account\'s answer — never the signed-out "no" (commit review, codex + opus)', async () => {
    at('/')
    setConciergeAvailable(false) // the signed-out page, or auth still loading
    resetConciergeKnown() // the host, about to ask for the account that signed in
    const opened = opens()
    const n = nav()
    const p = askForHelp(n, 'en')
    setTimeout(() => setConciergeAvailable(true), 30)
    await p
    expect(opened).toHaveBeenCalledTimes(1)
    expect(n.push).not.toHaveBeenCalled()
    window.removeEventListener(CONCIERGE_OPEN_EVENT, opened)
  })

  it('⛔ the person moved on while it waited: nothing happens (codex — a ✨ tap, then the post flow)', async () => {
    at('/')
    setConciergeAvailable(false)
    resetConciergeKnown()
    const n = nav()
    const p = askForHelp(n, 'en')
    at('/post')
    setTimeout(() => setConciergeAvailable(false), 30)
    await p
    expect(n.push).not.toHaveBeenCalled()
  })

  it('⛔ an abandoned move drops its open (commit review round 3, codex: /messages → /post → / never opens unasked)', async () => {
    at('/messages'); setConciergeAvailable(true)
    await askForHelp(nav(), 'en')
    expect(takePendingOpen('/messages')).toBe(false) // still where it was asked: kept
    expect(takePendingOpen('/post')).toBe(false) // somewhere else: dropped…
    expect(takePendingOpen('/')).toBe(false) // …so the explorer, later, does not open it
  })
})
