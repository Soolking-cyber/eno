// @vitest-environment jsdom
/**
 * THE CONTROL IS NEVER WRAPPED AND NEVER REMOUNTED (speed audit, 2026-11-03): hydrating a page must not rebuild every control under a tooltip,
 * and hovering one must not replace the element under the pointer. The popup is stubbed: Base UI's own positioning is not what is under test here.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'

vi.mock('./tooltip-popup', () => ({
  TooltipPopup: ({ open, instant, children, onClosed }: { open: boolean; instant: boolean; children: React.ReactNode; onClosed: () => void }) => (
    <div role="tooltip" data-open={String(open)} data-instant={String(instant)} onClick={onClosed}>{children}</div>
  ),
}))

const { Tooltip } = await import('./tooltip')
const X = 'x', A = 'a', B = 'b'

/** Let the dynamic import and the open timer settle. */
const hover = async (el: Element, pointerType = 'mouse') => {
  fireEvent.pointerEnter(el, { pointerType })
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Tooltip', () => {
  it('adds nothing to the HTML: the control alone, on the server and after hydration, with no error', async () => {
    const element = <Tooltip content="Hint"><button aria-label="Do">{X}</button></Tooltip>
    const html = renderToString(element)
    expect(html).toBe('<button aria-label="Do">x</button>')
    const box = document.createElement('div')
    box.innerHTML = html
    document.body.appendChild(box)
    const before = box.querySelector('button')
    const errors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => { root = hydrateRoot(box, element, { onRecoverableError: (e) => { errors.push(e) } }) })
    expect(errors).toEqual([])
    expect(box.querySelector('button')).toBe(before)
    act(() => root.unmount())
    box.remove()
  })

  it('opens after the delay, and the control under the pointer is the same element', async () => {
    render(<Tooltip content="Hint"><button>{X}</button></Tooltip>)
    const btn = screen.getByRole('button')
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(screen.getByRole('tooltip').textContent).toBe('Hint')
    expect(screen.getByRole('button')).toBe(btn)
  })

  it('never opens on touch, which is what the control\'s own aria-label is for', async () => {
    render(<Tooltip content="Hint"><button>{X}</button></Tooltip>)
    await hover(screen.getByRole('button'), 'touch')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('leaving before the delay cancels it', async () => {
    render(<Tooltip content="Hint"><button>{X}</button></Tooltip>)
    const btn = screen.getByRole('button')
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('leaving closes it after the grace that lets a reader cross to the hint, and a press closes it at once', async () => {
    render(<Tooltip content="Hint"><button>{X}</button></Tooltip>)
    const btn = screen.getByRole('button')
    await hover(btn)
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip').dataset.open).toBe('true')
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(screen.getByRole('tooltip').dataset.open).toBe('false')
    await act(async () => { fireEvent.click(screen.getByRole("tooltip")) })
    expect(screen.queryByRole('tooltip')).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await hover(btn)
    fireEvent.pointerDown(btn)
    expect(screen.getByRole('tooltip').dataset.open).toBe('false')
  })

  it('a neighbour opened right after hands over with no wait and no motion', async () => {
    render(<><Tooltip content="One"><button>{A}</button></Tooltip><Tooltip content="Two"><button>{B}</button></Tooltip></>)
    const [a, b] = screen.getAllByRole('button')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await hover(a)
    fireEvent.pointerLeave(a, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(120) })
    fireEvent.pointerEnter(b, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const two = screen.getAllByRole('tooltip').find((t) => t.textContent === 'Two')!
    expect(two.dataset.instant).toBe('true')
  })

  it('crossing straight to a neighbour, before this one has closed, hands over too', async () => {
    render(<><Tooltip content="One"><button>{A}</button></Tooltip><Tooltip content="Two"><button>{B}</button></Tooltip></>)
    const [a, b] = screen.getAllByRole('button')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await hover(a)
    fireEvent.pointerLeave(a, { pointerType: 'mouse' })
    fireEvent.pointerEnter(b, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getAllByRole('tooltip').find((t) => t.textContent === 'Two')?.dataset.instant).toBe('true')
  })

  it('the control keeps its own handlers', async () => {
    const onPointerEnter = vi.fn(), onFocus = vi.fn()
    render(<Tooltip content="Hint"><button onPointerEnter={onPointerEnter} onFocus={onFocus}>{X}</button></Tooltip>)
    const btn = screen.getByRole('button')
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    fireEvent.focus(btn)
    expect(onPointerEnter).toHaveBeenCalledOnce()
    expect(onFocus).toHaveBeenCalledOnce()
  })

  it('content going away cancels a pending open, and the next control does not count it as still showing', async () => {
    const { rerender } = render(<><Tooltip content="Hint"><button>{X}</button></Tooltip><Tooltip content="Other"><button>{A}</button></Tooltip></>)
    const [one, other] = screen.getAllByRole('button')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await hover(one)
    rerender(<><Tooltip content={undefined}><button>{X}</button></Tooltip><Tooltip content="Other"><button>{A}</button></Tooltip></>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.pointerEnter(other, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('content going away on a mounted control does not remount it', () => {
    const { rerender } = render(<Tooltip content="Hint"><button>{X}</button></Tooltip>)
    const btn = screen.getByRole('button')
    rerender(<Tooltip content={undefined}><button>{X}</button></Tooltip>)
    expect(screen.getByRole('button')).toBe(btn)
    rerender(<Tooltip content="Back"><button>{X}</button></Tooltip>)
    expect(screen.getByRole('button')).toBe(btn)
  })
})
