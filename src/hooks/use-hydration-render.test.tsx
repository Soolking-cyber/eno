// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { useHydrationRender } from './use-hydration-render'

afterEach(cleanup)

describe('useHydrationRender', () => {
  it('true on the server and through hydration, and hydrating costs no second render', async () => {
    const seen: boolean[] = []
    const Probe = () => { const v = useHydrationRender(); seen.push(v); return <i>{String(v)}</i> }
    expect(renderToString(<Probe />)).toBe('<i>true</i>')
    seen.length = 0
    const box = document.createElement('div')
    box.innerHTML = '<i>true</i>'
    document.body.appendChild(box)
    const errors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => { root = hydrateRoot(box, <Probe />, { onRecoverableError: (e) => { errors.push(e) } }) })
    expect(errors).toEqual([])
    expect(seen).toEqual([true])
    act(() => root.unmount())
    box.remove()
  })

  it('false for a client-side mount: Back, an in-app link', () => {
    const seen: boolean[] = []
    const Probe = () => { seen.push(useHydrationRender()); return null }
    render(<Probe />)
    expect(seen).toEqual([false])
  })

  it('the answer holds for the life of the instance', async () => {
    const seen: boolean[] = []
    let bump = () => {}
    const Probe = () => { const [, set] = React.useState(0); bump = () => set((n) => n + 1); seen.push(useHydrationRender()); return <i>x</i> }
    const box = document.createElement('div')
    box.innerHTML = '<i>x</i>'
    document.body.appendChild(box)
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => { root = hydrateRoot(box, <Probe />) })
    await act(async () => { bump() })
    expect(seen).toEqual([true, true])
    act(() => root.unmount())
    box.remove()
  })
})
