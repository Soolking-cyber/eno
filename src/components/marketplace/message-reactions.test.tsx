// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

import { BubbleChrome } from '@/components/marketplace/message-reactions'

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
  reactions: [],
  onToggle: () => {},
  myReaction: null,
  top: ['❤️', '😂', '👍', '😮', '😢'],
  align: 'start' as const,
  barOpen: true,
  onBarOpenChange: () => {},
  actionsOpen: true,
  onActionsOpenChange: () => {},
  actions: { onReply: () => {}, onCopy: () => {} },
  sent: null,
  onLockChange: () => {},
}

describe('BubbleChrome', () => {
  it('renders the one-tap react mark on either pointer', () => {
    render(<BubbleChrome {...props} />)
    expect(screen.getAllByRole('button', { name: /React with/i }).length).toBeGreaterThan(0)
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
    expect(screen.queryAllByRole('button', { name: /React with/i })).toHaveLength(1) // the one-tap mark only
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
