import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigationStarted, subscribeNavigationStart } from './nav-progress'
import { onRouterTransitionStart } from '@/instrumentation-client'

/** FAST-2: the "a navigation started" signal Next's instrumentation hook feeds the progress bar. */

let off: (() => void) | null = null
afterEach(() => { off?.(); off = null })

describe('navigationStarted', () => {
  it('a push or a replace reaches the listener with a fresh id; back/forward does not', () => {
    const seen: number[] = []
    off = subscribeNavigationStart((id) => seen.push(id))
    navigationStarted('push')
    navigationStarted('traverse')
    navigationStarted('replace')
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBeGreaterThan(seen[0])
  })

  it('unsubscribing stops it — and a stale unsubscribe never removes a newer listener (StrictMode remounts)', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeNavigationStart(a)
    off = subscribeNavigationStart(b)
    offA()
    navigationStarted('push')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    off()
    off = null
    navigationStarted('push')
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('with no bar mounted it is a no-op, not a throw', () => {
    expect(() => navigationStarted('push')).not.toThrow()
  })
})

describe('src/instrumentation-client.ts', () => {
  it('forwards Next\'s onRouterTransitionStart(url, navigationType) to the signal', () => {
    const seen = vi.fn()
    off = subscribeNavigationStart(seen)
    onRouterTransitionStart('/listings/x', 'push')
    onRouterTransitionStart('/', 'traverse')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('stays tiny: it is in every page\'s first JavaScript, so it imports the signal and nothing else', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/instrumentation-client.ts'), 'utf8')
    expect([...SRC.matchAll(/^import /gm)]).toHaveLength(1)
    expect(SRC).toContain("from '@/lib/nav-progress'")
  })
})
