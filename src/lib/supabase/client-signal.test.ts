import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE CLIENT SIGNAL IS WHAT WAKES auth-context FOR A VISITOR WITHOUT A SESSION (speed plan item 7, 2026-10-16) — so it
 * must fire from the real factory, exactly once, and replay for a listener that arrives late (client-signal.ts says why).
 */

const createBrowserClient = vi.hoisted(() => vi.fn())
vi.mock('@supabase/ssr', () => ({ createBrowserClient }))

beforeEach(() => {
  vi.resetModules()
  createBrowserClient.mockReset()
  createBrowserClient.mockImplementation(() => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    realtime: { setAuth: () => {} },
  }))
})

describe('createSupabaseBrowser → the client signal', () => {
  it('fires once, when the per-tab client is created — not on the calls that return it', async () => {
    const { onClientCreated } = await import('./client-signal')
    const { createSupabaseBrowser } = await import('./browser')
    const heard = vi.fn()
    onClientCreated(heard)
    expect(heard).not.toHaveBeenCalled()
    createSupabaseBrowser()
    createSupabaseBrowser()
    expect(createBrowserClient).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('replays for a listener that subscribes after the client exists (a child effect ran first)', async () => {
    const { onClientCreated } = await import('./client-signal')
    const { createSupabaseBrowser } = await import('./browser')
    createSupabaseBrowser()
    const late = vi.fn()
    onClientCreated(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('an unsubscribed listener is not called, and one that unsubscribes while being called does not break the rest', async () => {
    const { onClientCreated, noteClientCreated } = await import('./client-signal')
    const gone = vi.fn()
    onClientCreated(gone)()
    const second = vi.fn()
    const off = onClientCreated(() => off())
    onClientCreated(second)
    noteClientCreated()
    noteClientCreated()
    expect(gone).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
