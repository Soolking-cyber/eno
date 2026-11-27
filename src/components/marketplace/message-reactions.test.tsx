// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
// ⚠️ `useLanguage` THROWS OUTSIDE ITS PROVIDER, so the component cannot render at all without
// either wrapping every case in one or stubbing it. Stubbed: this file is about which BRANCH
// renders, and a real provider would drag the machine-translation dictionary and its fetches in
// behind it.
vi.mock('@/context/language-context', async (orig) => ({
  ...(await orig<typeof import('@/context/language-context')>()),
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, setLang: () => {} }),
  useTr: (t: string) => t,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))

vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn(), hapticSelection: vi.fn(), hapticLongPress: vi.fn() }))

import { BubbleChrome, ReactionBadge, longPressHandlers } from '@/components/marketplace/message-reactions'
import { hapticLongPress, hapticSelection, hapticTap } from '@/lib/haptics'

/**
 * THE REACTION BAR HAS TWO HOMES, AND THIS PINS THAT BOTH OF THEM RENDER.
 *
 * ⛔ WHY A TEST AND NOT A SCREENSHOT. The bar lives inside an authenticated thread, so the only
 * rendered verification available is the authed e2e suite — which needs a seeded database and does
 * not run on an ordinary change. That left a structural rewrite (a CSS-positioned descendant for a
 * mouse, a portalled Base UI popup for a finger) with no gate at all between "it compiles" and
 * "somebody opens a chat on a phone". This is that gate. It cannot check GEOMETRY — jsdom has no
 * layout, which is exactly why the positioning was handed to Base UI rather than hand-rolled — but
 * it catches the failure that actually matters after a restructure: a branch that renders nothing.
 *
 * ⚠️ `matchMedia` IS MOCKED BECAUSE jsdom HAS NONE. `usePointerCoarse` subscribes to
 * `(pointer: coarse)`, and without a stub the hook throws on mount and every test here fails for
 * the wrong reason.
 */

const mq = { matches: false }
beforeEach(() => {
  mq.matches = false
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    get matches() { return mq.matches },
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false },
    onchange: null,
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const props = {
  onPick: () => {},
  onRemove: () => {},
  reactions: [] as { emoji: string; count: number; mine: boolean }[],
  myReaction: null,
  top: ['❤️', '😂', '👍', '😮', '😢'],
  align: 'start' as const,
  barOpen: true,
  onBarOpenChange: () => {},
  actionsOpen: true,
  onActionsOpenChange: () => {},
  actions: { onReply: () => {}, onCopy: () => {} },
  onLockChange: () => {},
}

describe('BubbleChrome', () => {
  it('⛔ no resting heart on a bubble: with no reactions, nothing sits on its corner (owner 2026-11-27, Messenger)', () => {
    for (const coarse of [false, true]) {
      cleanup()
      mq.matches = coarse
      render(<BubbleChrome {...props} barOpen={false} actionsOpen={false} />)
      expect(screen.queryByRole('button', { name: /React with|Reactions:/i })).toBeNull()
    }
  })

  it('⛔ touch without a gesture: a React button screen readers reach opens the long-press card (commit gate, opus)', () => {
    mq.matches = true
    const onBarOpenChange = vi.fn(); const onActionsOpenChange = vi.fn()
    render(<BubbleChrome {...props} barOpen={false} actionsOpen={false} onBarOpenChange={onBarOpenChange} onActionsOpenChange={onActionsOpenChange} />)
    const react = screen.getByRole('button', { name: 'React' })
    expect(react.className).toMatch(/sr-only/)
    fireEvent.click(react)
    expect(onBarOpenChange).toHaveBeenCalledWith(true)
    expect(onActionsOpenChange).toHaveBeenCalledWith(true)
  })

  it('the desktop toolbar leads with React, which opens the bar', () => {
    mq.matches = false
    const onBarOpenChange = vi.fn()
    render(<BubbleChrome {...props} barOpen={false} onBarOpenChange={onBarOpenChange} />)
    const buttons = screen.getAllByRole('button', { hidden: true })
    expect(buttons[0]!.getAttribute('aria-label')).toBe('React')
    fireEvent.click(buttons[0]!)
    expect(onBarOpenChange).toHaveBeenCalledWith(true)
    // Already open (the hover delay opened it): a click keeps it open, never toggles it shut.
    cleanup()
    const again = vi.fn()
    render(<BubbleChrome {...props} barOpen onBarOpenChange={again} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'React' })[0]!)
    expect(again).not.toHaveBeenCalledWith(false)
  })

  it('⛔ a keyboard can react: React is always tabbable, and focusing it shows the toolbar (commit gate, opus)', () => {
    mq.matches = false
    const onActionsOpenChange = vi.fn()
    render(<BubbleChrome {...props} barOpen={false} actionsOpen={false} onActionsOpenChange={onActionsOpenChange} />)
    const react = screen.getByRole('button', { name: 'React' })
    expect(react.getAttribute('tabindex')).not.toBe('-1')
    act(() => { react.focus() })
    expect(onActionsOpenChange).toHaveBeenCalledWith(true)
    // The other actions stay out of the tab order and hidden while the toolbar is closed.
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it('renders the bar with a FINE pointer — the descendant path', () => {
    mq.matches = false
    render(<BubbleChrome {...props} />)
    // The top-five are rendered as buttons named after each reaction; the exact copy is the
    // reaction label, so assert on the count rather than on one string.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(props.top.length)
    // ⚠️ The mouse bar must NOT be portalled — that is what keeps it reachable on the way from the
    // mark to the bar. If it ever moves to the body, hovering across the gap closes it.
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull()
  })

  it('renders the bar with a COARSE pointer — the portalled path', () => {
    mq.matches = true
    render(<BubbleChrome {...props} />)
    // Base UI portals the popup out of the component's subtree; finding it at all proves the
    // coarse branch mounted, which is the half no CSS gate could have expressed.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(props.top.length)
  })

  /**
   * ⚠️ THE ASYMMETRIC STATE, WHICH IS THE ONE THAT BROKE. A long press opens both rows; tapping an
   * emoji then clears `barOpen` and leaves `actionsOpen` true. The first version of the touch popup
   * rendered the emoji row unconditionally, so it stayed VISIBLE with `tabIndex={-1}` — clickable,
   * unreachable by keyboard, and contradicting its own closed state. All three reviewers found it
   * and none of the original cases could have, because every one of them passed both flags true.
   */
  it('hides the emoji row on touch once the bar closes, keeping the actions', () => {
    mq.matches = true
    render(<BubbleChrome {...props} barOpen={false} actionsOpen />)
    expect(screen.queryAllByRole('button', { name: /Thả tim|Heart|Laugh|Like/i })).toHaveLength(0) // no emoji row
    expect(screen.getAllByRole('button', { name: /Reply/i })).toHaveLength(1)
  })

  it('renders the quick actions exactly once, never in both homes at the same time', () => {
    for (const coarse of [false, true]) {
      cleanup()
      mq.matches = coarse
      render(<BubbleChrome {...props} />)
      // Reply is in the actions toolbar. Two copies would mean both the beside-the-bubble pill and
      // the stacked popup row rendered — the overlap the owner reported, in a different form.
      expect(screen.getAllByRole('button', { name: /Reply/i })).toHaveLength(1)
    }
  })
})

describe('ReactionBadge (owner 2026-11-27: one pill on the bubble\'s corner, Messenger)', () => {
  const R = (emoji: string, count: number, mine = false) => ({ emoji, count, mine })

  it('one pill on the INNER corner: bottom-right of theirs, bottom-left of mine', () => {
    // Its inner end 2rem in from the bubble's inner corner, growing toward the middle of the thread.
    const { rerender } = render(<ReactionBadge reactions={[R('❤️', 1)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').className).toMatch(/left-\[calc\(100%-2rem\)\]/)
    rerender(<ReactionBadge reactions={[R('❤️', 1)]} align="end" onOpen={() => {}} />)
    expect(screen.getByRole('button').className).toMatch(/right-\[calc\(100%-2rem\)\]/)
  })

  it('up to three emoji, and the total only when more than one reacted', () => {
    const { rerender } = render(<ReactionBadge reactions={[R('❤️', 1)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').textContent).toBe('❤️')
    rerender(<ReactionBadge reactions={[R('❤️', 2, true), R('😂', 1), R('👍', 1), R('😮', 1)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').textContent).toBe('❤️😂👍5')
  })

  it('its spoken label marks yours and says what pressing does', () => {
    const { rerender } = render(<ReactionBadge reactions={[R('❤️', 1, true), R('😂', 1)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/\(yours\).*Change your reaction$/)
    rerender(<ReactionBadge reactions={[R('😂', 1)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/Add yours$/)
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/yours\)/)
    // Counts are spoken when more than one person chose the same emoji.
    rerender(<ReactionBadge reactions={[R('😂', 3)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/ 3\. Add yours$/)
  })

  it('nothing at all with no reactions', () => {
    render(<ReactionBadge reactions={[]} align="start" onOpen={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('pops when a reaction lands — never on first paint', () => {
    const { rerender } = render(<ReactionBadge reactions={[R('❤️', 1)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').className).not.toMatch(/reaction-pop/)
    const node = screen.getByRole('button')
    node.focus()
    rerender(<ReactionBadge reactions={[R('❤️', 2, true)]} align="start" onOpen={() => {}} />)
    expect(screen.getByRole('button').className).toMatch(/reaction-pop/)
    // The same node, and focus kept on it (it used to be re-keyed and remounted).
    expect(screen.getByRole('button')).toBe(node)
    expect(document.activeElement).toBe(node)
  })

  it('with a mouse, a badge-opened bar is pinned against the leave-close, and released when it closes', () => {
    mq.matches = false
    const onLockChange = vi.fn()
    const { rerender } = render(<BubbleChrome {...props} reactions={[R('❤️', 1)]} barOpen={false} actionsOpen={false} onLockChange={onLockChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Reactions:/ }))
    expect(onLockChange).toHaveBeenLastCalledWith(true)
    rerender(<BubbleChrome {...props} reactions={[R('❤️', 1)]} barOpen actionsOpen={false} onLockChange={onLockChange} />)
    rerender(<BubbleChrome {...props} reactions={[R('❤️', 1)]} barOpen={false} actionsOpen={false} onLockChange={onLockChange} />)
    expect(onLockChange).toHaveBeenLastCalledWith(false)
  })

  it('pressing it opens the picker, with a selection haptic', () => {
    const onBarOpenChange = vi.fn()
    render(<BubbleChrome {...props} reactions={[R('❤️', 1)]} barOpen={false} actionsOpen={false} onBarOpenChange={onBarOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Reactions:/ }))
    expect(onBarOpenChange).toHaveBeenCalledWith(true)
    expect(hapticSelection).toHaveBeenCalled()
  })
})

describe('double-tap ❤️ and the long-press haptic (owner 2026-11-27)', () => {
  const touch = (x = 10, y = 10, target?: Element) => ({ pointerType: 'touch', clientX: x, clientY: y, currentTarget: el, target: target ?? el }) as unknown as React.PointerEvent
  let el: HTMLElement
  beforeEach(() => { el = document.createElement('div'); vi.mocked(hapticTap).mockClear(); vi.mocked(hapticLongPress).mockClear() })

  it('two quick taps on a bubble fire it once, with a tap haptic', () => {
    const onDouble = vi.fn()
    const h = longPressHandlers(() => {}, onDouble)
    h.onPointerDown(touch()); h.onPointerUp(touch())
    h.onPointerDown(touch(12, 11)); h.onPointerUp(touch(12, 11))
    expect(onDouble).toHaveBeenCalledOnce()
    expect(hapticTap).toHaveBeenCalledOnce()
  })

  it('never from a control inside the bubble, a moved finger, a mouse, or two slow taps', async () => {
    const onDouble = vi.fn()
    const h = longPressHandlers(() => {}, onDouble)
    const button = document.createElement('button'); el.appendChild(button)
    h.onPointerDown(touch(10, 10, button)); h.onPointerUp(touch()); h.onPointerDown(touch(10, 10, button)); h.onPointerUp(touch())
    h.onPointerDown(touch()); h.onPointerMove(touch(40, 10)); h.onPointerUp(touch(40, 10)); h.onPointerDown(touch()); h.onPointerUp(touch())
    const mouse = { ...touch(), pointerType: 'mouse' } as React.PointerEvent
    h.onPointerDown(mouse); h.onPointerUp(mouse); h.onPointerDown(mouse); h.onPointerUp(mouse)
    expect(onDouble).not.toHaveBeenCalled()
    // A fresh bubble, so nothing from the sequences above (module state: one finger) can pair with these taps.
    el = document.createElement('div')
    vi.useFakeTimers()
    try {
      const h2 = longPressHandlers(() => {}, onDouble)
      h2.onPointerDown(touch()); h2.onPointerUp(touch())
      vi.advanceTimersByTime(400)
      h2.onPointerDown(touch()); h2.onPointerUp(touch())
      expect(onDouble).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('a long press opens the chrome with the platform long-press haptic, and is never also a tap', async () => {
    vi.useFakeTimers()
    try {
      const onLong = vi.fn(); const onDouble = vi.fn()
      const h = longPressHandlers(onLong, onDouble)
      h.onPointerDown(touch())
      await act(async () => { vi.advanceTimersByTime(500) })
      h.onPointerUp(touch())
      h.onPointerDown(touch()); h.onPointerUp(touch())
      expect(onLong).toHaveBeenCalledOnce()
      expect(hapticLongPress).toHaveBeenCalledOnce()
      expect(onDouble).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
