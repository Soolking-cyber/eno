// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTapGlide } from './use-tap-glide'

type Place = { x?: number; y?: number; hidden?: boolean }
const places = new Map<string, Place>()
const animate = vi.fn()
const seen = () => animate.mock.calls.map(([frames], i) => [(animate.mock.contexts[i] as Element).id, frames[0]])
const at = (id: string, y: number, x = 0) => places.set(id, { x, y })

beforeEach(() => {
  places.clear()
  animate.mockClear()
  Element.prototype.animate = animate as unknown as Element['animate']
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get(this: HTMLElement) { return places.get(this.id)?.y ?? 0 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get(this: HTMLElement) { return places.get(this.id)?.x ?? 0 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get(this: HTMLElement) { return places.get(this.id)?.hidden ? null : document.body } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const k of ['offsetTop', 'offsetLeft', 'offsetParent']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]
})

function Ladder({ extra = false }: { extra?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const glide = useTapGlide(ref, '[data-cat]')
  const [, commit] = useState(0)
  return (
    <>
      <button type="button" onClick={() => glide()}>tap</button>
      <button type="button" onClick={() => commit((n) => n + 1)}>commit</button>
      <div ref={ref}>
        <div id="rail"><a id="tile" data-cat="x" /></div>
        <div id="results" />
        {extra && <div id="brands" />}
      </div>
    </>
  )
}
const press = (name: string) => act(() => { screen.getByRole('button', { name }).click() })

describe('a tile tap moves things instead of jumping them', () => {
  it('a row starts where it was and glides to where it now is', () => {
    at('results', 390)
    render(<Ladder />)
    press('tap')
    at('results', 275)
    press('commit')
    expect(seen()).toEqual([['results', { transform: 'translate(0px, 115px)' }]])
  })

  it('downward too: the desktop brand row opening pushes the results 108 px down', () => {
    at('results', 356)
    render(<Ladder />)
    press('tap')
    at('results', 464)
    press('commit')
    expect(seen()).toEqual([['results', { transform: 'translate(0px, -108px)' }]])
  })

  it('a tile inside a row glides sideways: the plate opening beside the tapped tile pushes it along', () => {
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    at('tile', 84, 1274)
    press('commit')
    expect(seen()).toEqual([['tile', { transform: 'translate(-740px, 0px)' }]])
  })

  it('a row that arrived with the tap fades in, and nothing about it moves', () => {
    const { rerender } = render(<Ladder />)
    press('tap')
    rerender(<Ladder extra />)
    expect(seen()).toEqual([['brands', { opacity: 0 }]])
  })

  it('it follows: the plate narrowing when the counts answer, half a second later, glides as well', () => {
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    at('tile', 84, 1274)
    press('commit')
    at('tile', 84, 844)
    press('commit')
    expect(seen()[1]).toEqual(['tile', { transform: 'translate(430px, 0px)' }])
  })

  it('a move during a glide starts from where the piece is on screen, not from where it was laid out', () => {
    at('tile', 84, 1274)
    render(<Ladder />)
    press('tap')
    at('tile', 84, 844)
    const commit = screen.getByRole('button', { name: 'commit' })
    // After the role lookup, which reads computed styles itself.
    vi.stubGlobal('DOMMatrixReadOnly', class { m41 = 100; m42 = 0 })
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(1, 0, 0, 1, 100, 0)' }))
    act(() => { commit.click() })
    expect(seen()).toEqual([['tile', { transform: 'translate(530px, 0px)' }]])
  })

  it('a commit that moved nothing starts nothing, and a running glide is left to finish', () => {
    at('results', 390)
    render(<Ladder />)
    press('tap')
    press('commit')
    expect(animate).not.toHaveBeenCalled()
  })

  it('a change with no tap before it does not glide: only the tiles ask for this', () => {
    at('results', 390)
    render(<Ladder />)
    at('results', 275)
    press('commit')
    expect(animate).not.toHaveBeenCalled()
  })

  it('a tap that moved nothing does not lend its glide to a later, unrelated change', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    at('results', 390)
    render(<Ladder />)
    press('tap')
    vi.advanceTimersByTime(1_501)
    at('results', 275)
    press('commit')
    expect(animate).not.toHaveBeenCalled()
  })

  it('it stops following a second after the last move', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    at('results', 390)
    render(<Ladder />)
    press('tap')
    at('results', 275)
    press('commit')
    expect(animate).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_001)
    at('results', 200)
    press('commit')
    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('a hairline settle of a pixel or two is not a move', () => {
    at('results', 390)
    render(<Ladder />)
    press('tap')
    at('results', 392)
    press('commit')
    expect(animate).not.toHaveBeenCalled()
  })

  it('a piece with no layout of its own (display: none) is left alone', () => {
    places.set('results', { y: 390, hidden: true })
    render(<Ladder />)
    press('tap')
    places.set('results', { y: 0, hidden: true })
    press('commit')
    expect(animate).not.toHaveBeenCalled()
  })

  it('whoever asked for less motion gets the old instant change', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    at('results', 390)
    render(<Ladder />)
    press('tap')
    at('results', 275)
    press('commit')
    expect(animate).not.toHaveBeenCalled()
  })
})
