// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { ScrollToTop } from './scroll-to-top'

/**
 * ScrollToTop resets a page the CLIENT mounted (a soft navigation, or a new `id`), and never the page
 * the browser loaded (SEO wave B, P0t). On a slow phone the reset used to run when hydration finished,
 * seconds in, and threw a reader who had scrolled down to the listing's reports-and-disputes row back
 * to the top, so their tap landed on the photo gallery. See the note in scroll-to-top.tsx.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

let scrollTo: ReturnType<typeof vi.fn>
const roots: Root[] = []

beforeEach(() => {
  scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
})

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  cleanup()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

/** Server-render, then hydrate, the way a hard load reaches the component. */
async function hydrate(id: string | undefined) {
  const tree = (i: string | undefined) => <ScrollToTop id={i} />
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree(id))
  document.body.appendChild(container)
  const recoverable: unknown[] = []
  let root!: Root
  await act(async () => {
    root = hydrateRoot(container, tree(id), { onRecoverableError: (e) => { recoverable.push(e) } })
  })
  roots.push(root)
  return { recoverable, rerender: (i: string | undefined) => act(async () => root.render(tree(i))) }
}

describe('ScrollToTop: the client resets, the browser load is left alone (P0t)', () => {
  it('hydrating a page the browser loaded does not scroll, for a listing and for a storefront (no id)', async () => {
    for (const id of ['listing-a', undefined]) {
      const { recoverable } = await hydrate(id)
      expect(recoverable).toEqual([])
    }
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('a client mount (a soft navigation) scrolls to the top once', () => {
    render(<ScrollToTop id="listing-a" />)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 })
  })

  it('after hydration, a new id (a soft navigation to another listing) scrolls, and so does coming back', async () => {
    const { rerender } = await hydrate('listing-a')
    expect(scrollTo).not.toHaveBeenCalled()
    await rerender('listing-b')
    expect(scrollTo).toHaveBeenCalledTimes(1)
    await rerender('listing-a')
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('a re-render with the same id after hydration does not scroll', async () => {
    const { rerender } = await hydrate('listing-a')
    await rerender('listing-a')
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
