// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { easeOutStrong, useTapGlide } from './use-tap-glide'

type Place = { x?: number; y?: number; hidden?: boolean }
const places = new Map<string, Place>()
const animate = vi.fn()
const seen = () => animate.mock.calls.map(([frames], i) => [(animate.mock.contexts[i] as Element).id, frames[0]])
const at = (id: string, y: number, x = 0) => places.set(id, { x, y })
/** The x a glide started from, by call order. */
const fromX = (i: number) => Number(/translate\((-?[\d.]+)px/.exec((seen()[i][1] as { transform: string }).transform)?.[1])

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
    vi.useFakeTimers({ toFake: ['performance'] })
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: performance.now() })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(500)
    at('tile', 84, 844)
    press('commit')
    expect(seen()[1]).toEqual(['tile', { transform: 'translate(430px, 0px)' }])
  })

  // ⛔ Live desktop, 2026-11-06, screen frames: the page was busy rendering the results, its copy of the first glide still said "not
  // started" while the screen had it nearly done, and reading that put every tile back where it was before the tap, over the plate.
  it('a move during a glide starts from where the glide has the piece now, by its own start time and curve', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: performance.now() })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(55) // a quarter of the way through its 220 ms
    at('tile', 84, 844)
    press('commit')
    expect(fromX(1)).toBeCloseTo(430 - 740 * (1 - easeOutStrong(0.25)), 3)
  })

  it('drawn, but the page has not heard its start: placed by the frame it went out in', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    let frame: FrameRequestCallback = () => {}
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1 })
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: null })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(16)
    frame(performance.now())
    vi.advanceTimersByTime(110) // half of 220 ms after that frame
    at('tile', 84, 844)
    press('commit')
    expect(fromX(1)).toBeCloseTo(430 - 740 * (1 - easeOutStrong(0.5)), 3)
  })

  // Review (opus, 2026-11-06), measured in the browser harness: the plate narrowing 10-20 ms into the first glide, then the page busy
  // for 100 ms, left the new glide a step behind the old one on screen and the tile wobbled back 54-115 px. Set again at its frame: 0.
  it('a glide replacing one in flight starts, in the frame that draws it, from where the old one is at THAT frame', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    const setKeyframes = vi.fn()
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: performance.now(), effect: { setKeyframes: vi.fn() } })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(20)
    animate.mockReturnValueOnce({ startTime: null, effect: { setKeyframes } })
    at('tile', 84, 844)
    press('commit')
    expect(fromX(1)).toBeCloseTo(430 - 740 * (1 - easeOutStrong(20 / 220)), 3)
    vi.advanceTimersByTime(100) // busy: the frame that draws it comes 100 ms later
    frames.at(-1)!(performance.now())
    const at120 = 430 - 740 * (1 - easeOutStrong(120 / 220))
    expect(setKeyframes).toHaveBeenCalledTimes(1)
    expect(setKeyframes.mock.calls[0][0]).toEqual([{ transform: `translate(${at120}px, 0px)` }, { transform: 'translate(0, 0)' }])
  })

  it('a glide already on screen when the rAF comes (its commit landed after that frame\'s rAF) is not rewritten', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    const setKeyframes = vi.fn()
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: performance.now(), effect: { setKeyframes: vi.fn() } })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(20)
    animate.mockReturnValueOnce({ startTime: null, pending: false, effect: { setKeyframes } })
    at('tile', 84, 844)
    press('commit')
    vi.advanceTimersByTime(16)
    frames.at(-1)!(performance.now())
    expect(setKeyframes).not.toHaveBeenCalled()
  })

  it('with no WAAPI the piece moves at once, and a later move carries nothing from it', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    at('tile', 84, 1274)
    press('commit') // animate() returns undefined here
    vi.advanceTimersByTime(50)
    at('tile', 84, 844)
    press('commit')
    expect(seen()[1]).toEqual(['tile', { transform: 'translate(430px, 0px)' }])
  })

  it('a glide replacing nothing is left as it was made when its frame comes', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    const setKeyframes = vi.fn()
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: null, effect: { setKeyframes } })
    at('tile', 84, 1274)
    press('commit')
    frames.at(-1)!(performance.now() + 50)
    expect(setKeyframes).not.toHaveBeenCalled()
  })

  it('not drawn yet (no frame since it was made): the screen still shows its first frame, so the next glide starts there', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: null })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(150) // a busy page: no frame ran
    at('tile', 84, 844)
    press('commit')
    expect(seen()[1]).toEqual(['tile', { transform: 'translate(-310px, 0px)' }])
  })

  it('a glide that was cancelled moves nothing any more, so the next one starts from the layout alone', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    animate.mockReturnValueOnce({ startTime: null, playState: 'idle' })
    at('tile', 84, 1274)
    press('commit')
    vi.advanceTimersByTime(30)
    at('tile', 84, 844)
    press('commit')
    expect(seen()[1]).toEqual(['tile', { transform: 'translate(430px, 0px)' }])
  })

  it("a tile's own CSS transform (a hover lift) is not taken for a glide", () => {
    at('tile', 84, 534)
    render(<Ladder />)
    press('tap')
    at('tile', 84, 1274)
    const commit = screen.getByRole('button', { name: 'commit' })
    // After the role lookup, which reads computed styles itself.
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(1, 0, 0, 1, 0, -2)' }))
    act(() => { commit.click() })
    expect(seen()).toEqual([['tile', { transform: 'translate(-740px, 0px)' }]])
  })

  it('the curve is the one the browser runs: cubic-bezier(0.23, 1, 0.32, 1)', () => {
    expect(easeOutStrong(0)).toBe(0)
    expect(easeOutStrong(1)).toBe(1)
    // Values from an independent solver (60 rounds of halving): most of the way there in the first quarter.
    expect(easeOutStrong(0.1)).toBeCloseTo(0.3981, 3)
    expect(easeOutStrong(0.25)).toBeCloseTo(0.7754, 3)
    expect(easeOutStrong(0.5)).toBeCloseTo(0.966, 3)
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
