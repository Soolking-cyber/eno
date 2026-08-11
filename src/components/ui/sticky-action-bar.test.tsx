// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  StickyActionBar,
  StickyActionBarSpacer,
  STICKY_ACTION_BAR_VARS,
} from './sticky-action-bar'

/**
 * WHAT THIS FILE IS FOR.
 *
 * jsdom loads no stylesheet, so nothing here can prove a pixel. What it CAN hold are the three
 * invariants that have a documented history of being got wrong, each of which is expressed as a
 * class or an attribute in the markup and is therefore checkable:
 *
 *   1. THE BAR NEVER DECLARES ITS OWN BOTTOM INSET. Safe-area + keyboard come from `.kb-bottom`
 *      alone. A second env(safe-area-inset-bottom) here would double-count on every notched
 *      device, and it is a one-word edit away at all times.
 *   2. THE TAB-BAR OFFSET IS NEVER A LITERAL IN THIS PRIMITIVE. `PdpMobileBar` was deleted for
 *      owning the bottom edge (cd9127a7); the replacement must take that geometry from the
 *      caller, so the source may not contain the tab bar's height at all.
 *   3. `data-fab-clear` IS PRESENT. back-to-top.tsx's z-[60] cluster lifts off elements carrying
 *      it; without the attribute the floating chevron sits on the primary CTA, and nothing in a
 *      screenshot or a click-through test would show it.
 *
 * Plus the ordinary behaviour: one action or two, the actions fire, a disabled one does not.
 */

// ⚠️ EXPLICIT CLEANUP — this suite does not run with vitest globals, so Testing Library never
// registers its own afterEach and renders would stack. Same line, same reason, as
// chat-send-button.test.tsx.
afterEach(cleanup)

afterEach(() => {
  document.documentElement.style.removeProperty(STICKY_ACTION_BAR_VARS.height)
  document.documentElement.classList.remove('kb-open')
})

const bar = () => document.querySelector<HTMLElement>('[data-slot="sticky-action-bar"]')!
const panel = () => document.querySelector<HTMLElement>('[data-slot="sticky-action-bar-panel"]')!

describe('StickyActionBar keeps the action reachable', () => {
  it('pins itself to the bottom and never scrolls away', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    const cls = bar().className
    expect(cls).toContain('fixed')
    expect(cls).toContain('bottom-0')
    expect(cls).toContain('inset-x-0')
  })

  it('renders one action alone, and two when a secondary is given', async () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    cleanup()

    render(<StickyActionBar primary={{ label: 'Chat' }} secondary={{ label: 'Make offer' }} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    // The secondary reads FIRST, so the primary sits under the thumb on the side a
    // right-handed phone user reaches without moving their grip.
    expect(buttons[0].getAttribute('data-action')).toBe('secondary')
    expect(buttons[1].getAttribute('data-action')).toBe('primary')
  })

  it('fires each action, and a disabled one stays silent', async () => {
    const user = userEvent.setup()
    const onPrimary = vi.fn()
    const onSecondary = vi.fn()
    render(
      <StickyActionBar
        primary={{ label: 'Chat', onClick: onPrimary }}
        secondary={{ label: 'Make offer', onClick: onSecondary, disabled: true }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Chat' }))
    expect(onPrimary).toHaveBeenCalledTimes(1)

    const offer = screen.getByRole('button', { name: 'Make offer' })
    expect(offer.hasAttribute('disabled')).toBe(true)
    await user.click(offer)
    expect(onSecondary).not.toHaveBeenCalled()
  })

  it('defaults the button type so a bar inside a form cannot submit it', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('type')).toBe('button')
  })

  it('gives both actions a 48px floor as a MIN height, not a fixed one', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} secondary={{ label: 'Make offer' }} />)
    for (const b of screen.getAllByRole('button')) {
      // min-h-12 = 48px. `h-12` would be the same 48px until the OS text-size setting scales
      // the line box past it, and then it clips the label mid-glyph — which is exactly what the
      // deleted PdpMobileBar's `h-12` did.
      expect(b.className).toContain('min-h-12')
      expect(b.className).not.toMatch(/(?<![-\w])h-12(?![-\w])/)
    }
  })

  it('renders the primary as the one brand CTA', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} secondary={{ label: 'Make offer' }} />)
    // ui/button's `cta` variant is the only one that pairs the brand fill with font-bold.
    const primary = screen.getByRole('button', { name: 'Chat' })
    expect(primary.className).toContain('bg-primary')
    expect(primary.className).toContain('font-bold')
    // …and the secondary must not compete with it.
    expect(screen.getByRole('button', { name: 'Make offer' }).className).not.toContain('font-bold')
  })
})

describe('StickyActionBar shares the bottom edge instead of taking it', () => {
  it('does not hard-code the tab bar anywhere in its markup', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    // No offset prop ⇒ no inline custom property at all, so an ancestor's value inherits.
    expect(bar().style.getPropertyValue(STICKY_ACTION_BAR_VARS.offset)).toBe('')
    // And the clearance it does declare is a var() reference, never a number.
    expect(bar().className).toContain('[--kb-bottom-extra:var(--sticky-action-bar-offset,0px)]')
    expect(bar().className).not.toContain('4.5rem')
  })

  it('takes the offset from the caller as a CSS length', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} offsetBottom="4.5rem" />)
    expect(bar().style.getPropertyValue(STICKY_ACTION_BAR_VARS.offset)).toBe('4.5rem')
  })

  it('treats an EMPTY offset as zero, not as absent', () => {
    // `offsetBottom={showTabs ? '4.5rem' : ''}` is the obvious way to write this at a call site,
    // and it means "no clearance". Left alone the bar inherited the ancestor's offset instead
    // and floated above an edge nothing owns.
    // ⚠️ THIS TEST FAILED AGAINST THE FIRST FIX AND THAT IS WHY THE COMPONENT NORMALISES. Simply
    // swapping the truthiness test for `!== undefined` is not enough: React drops a style entry
    // whose value is the empty string and emits no style attribute at all. Measured here.
    render(
      <div style={{ [STICKY_ACTION_BAR_VARS.offset]: '4.5rem' } as React.CSSProperties}>
        <StickyActionBar primary={{ label: 'Chat' }} offsetBottom="" />
      </div>,
    )
    expect(bar().style.getPropertyValue(STICKY_ACTION_BAR_VARS.offset)).toBe('0px')
  })

  it('drops that offset while the keyboard is up, because the tab bar hides then', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} offsetBottom="4.5rem" />)
    // The override is a stylesheet rule (`html.kb-open` + the class), so jsdom can only be asked
    // whether the primitive declares it. It out-specifies the resting declaration two classes to
    // one, which is why it is a variant rather than a JS branch.
    expect(bar().className).toContain('[html.kb-open_&]:[--kb-bottom-extra:0px]')
  })

  it('carries data-fab-clear so back-to-top lifts off the CTA', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    expect(bar().hasAttribute('data-fab-clear')).toBe(true)
  })

  it('sits under the tab bar in z-order, since their backgrounds overlap by design', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    // MobileNav is z-40; this bar's background runs beneath it to bottom-0.
    expect(bar().className).toContain('z-30')
  })
})

describe('StickyActionBar reserves the bottom inset exactly once', () => {
  it('delegates safe-area and keyboard to .kb-bottom and declares neither itself', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} offsetBottom="4.5rem" />)
    const cls = bar().className
    expect(cls).toContain('kb-bottom')
    // ⚠️ THE DOUBLE-COUNT GUARD. Not one env(safe-area-inset-bottom) in the bar's own classes.
    expect(cls).not.toContain('safe-area-inset-bottom')
    // Nor an inline padding, which would outrank .kb-bottom and delete both behaviours.
    expect(bar().style.paddingBottom).toBe('')
  })

  it('keeps its resting padding on the measured panel, not on the root', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    // The root's bottom padding is the offset + the inset; the panel's is the bar's own
    // breathing room. That split is what lets the spacer reserve the panel alone.
    expect(panel().className).toContain('py-3')
    expect(bar().className).not.toMatch(/(?<![-\w])py-3(?![-\w])/)
  })
})

describe('StickyActionBar enters, and stops entering under reduced motion', () => {
  it('animates from below via @starting-style, so the SSR html already shows it', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    const cls = bar().className
    expect(cls).toContain('starting:translate-y-full')
    expect(cls).toContain('starting:opacity-0')
    // The resting state is the visible one — nothing is gated on a mount flag, so the bar is
    // present and usable in the server HTML before any JS runs.
    expect(cls).toContain('translate-y-0')
    expect(cls).toContain('opacity-100')
  })

  it('transitions `translate`, not `transform`', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    // Tailwind v4 emits translate utilities as the standalone `translate` property. A transition
    // naming only `transform` animates nothing — the omission ui/button.tsx documents at length.
    expect(bar().className).toContain('transition-[translate,opacity]')
  })

  it('kills the motion when the user asks for less of it', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    expect(bar().className).toContain('motion-reduce:transition-none')
  })
})

describe('StickyActionBar publishes its height so the page can reserve it', () => {
  it('writes the measured panel height onto <html>', () => {
    // jsdom reports 0 for every layout box, so the value is 0px here. What is under test is that
    // the bar writes the property at all and that the spacer reads the same name — the coupling
    // between two components with no shared React state, which is the part that can silently rot.
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    expect(
      document.documentElement.style.getPropertyValue(STICKY_ACTION_BAR_VARS.height),
    ).toBe('0px')
  })

  it('publishes 0px when the last bar unmounts — it does not remove the property', () => {
    // ⚠️ REMOVING IT WAS WRONG, AND A REVIEWER FOUND THE SHAPE. The spacer's fallback means "no
    // bar has measured yet", not "no bar exists". With `{canContact && <StickyActionBar/>}` next
    // to an unconditional spacer, a seller viewing their own listing would reserve 72px for a
    // bar that is not on the page. 0px is the true statement.
    const view = render(<StickyActionBar primary={{ label: 'Chat' }} />)
    view.unmount()
    expect(document.documentElement.style.getPropertyValue(STICKY_ACTION_BAR_VARS.height)).toBe(
      '0px',
    )
  })

  it('observes the panel for growth when ResizeObserver exists', () => {
    // ⚠️ THIS USED TO ASSERT `typeof ResizeObserver === 'undefined'`, i.e. it tested jsdom rather
    // than the component (a reviewer's finding, and a fair one). Both branches are now driven.
    const observe = vi.fn()
    const disconnect = vi.fn()
    const ctor = vi.fn()
    class FakeRO {
      constructor(cb: ResizeObserverCallback) {
        ctor(cb)
      }
      observe = observe
      unobserve = vi.fn()
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', FakeRO)
    try {
      const view = render(<StickyActionBar primary={{ label: 'Chat' }} />)
      expect(ctor).toHaveBeenCalledTimes(1)
      // The PANEL is what is watched, not the root — the root's height moves with the keyboard
      // and the offset, neither of which the spacer reserves.
      expect(observe).toHaveBeenCalledWith(panel())
      view.unmount()
      expect(disconnect).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to resize/orientationchange on an engine with no ResizeObserver', () => {
    // Old Android WebViews and the Zalo / Facebook in-app browsers. Measuring once and stopping
    // strands the last row of the page after a rotation brings a `lg:hidden` bar back.
    //
    // ⚠️ THE ABSENCE IS STUBBED, NOT ASSUMED. This read `expect(typeof ResizeObserver).toBe(
    // 'undefined')` — an assertion about jsdom, which is exactly the sin the sibling test above
    // says was fixed. Someone adding a ResizeObserver polyfill to the vitest setup (routine once
    // Base UI components get tested) would have turned this red for the wrong reason, and the
    // repair would most likely have deleted the fallback branch's only coverage.
    vi.stubGlobal('ResizeObserver', undefined)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    try {
      const view = render(<StickyActionBar primary={{ label: 'Chat' }} />)
      const added = add.mock.calls.map((c) => c[0])
      expect(added).toContain('resize')
      expect(added).toContain('orientationchange')
      view.unmount()
      const removed = remove.mock.calls.map((c) => c[0])
      expect(removed).toContain('resize')
      expect(removed).toContain('orientationchange')
    } finally {
      add.mockRestore()
      remove.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('warns in dev when a second bar mounts, and stays quiet for one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    // The assertion that actually protects anything: the normal case must not cry wolf.
    expect(warn).not.toHaveBeenCalled()
    cleanup()

    render(
      <>
        <StickyActionBar primary={{ label: 'Chat' }} />
        <StickyActionBar primary={{ label: 'Call' }} />
      </>,
    )
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toContain('StickyActionBar')
    warn.mockRestore()
  })
})

describe('StickyActionBarSpacer stands in for the bar in the flow', () => {
  it('sizes itself from the published height with a correct resting fallback', () => {
    render(<StickyActionBarSpacer />)
    const spacer = document.querySelector<HTMLElement>('[data-slot="sticky-action-bar-spacer"]')!
    // 4.5rem = 72px = py-3 (24) + a 48px control: what the panel measures at the default text
    // size, so the first paint reserves the right amount before any measurement lands.
    expect(spacer.className).toContain('var(--sticky-action-bar-h,4.5rem)')
    // It adds the bottom inset itself — the panel height deliberately excludes it.
    expect(spacer.className).toContain('safe-area-inset-bottom')
    // Invisible to assistive tech: it is pure geometry.
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
  })

  it('does NOT collapse while the keyboard is up', () => {
    // ⚠️ REGRESSION GUARD. The first version copied `html.kb-open .bottom-nav-spacer` from
    // globals.css. That rule is right for the tab bar, which HIDES with the keyboard; this bar
    // stays on screen and rides up onto it, so collapsing the spacer would strand the last row
    // of the page under the CTA at the exact moment the user is typing into it.
    render(<StickyActionBarSpacer />)
    const spacer = document.querySelector<HTMLElement>('[data-slot="sticky-action-bar-spacer"]')!
    expect(spacer.className).not.toContain('kb-open')
  })

  it('re-measures when the LABEL changes, with no viewport event to go on', () => {
    // ⚠️ THE CASE THE OBSERVER BRANCH MISSES. A visitor switching EN→VI makes the primary label
    // wrap; the panel grows; no resize, orientationchange or font event fires. On an engine
    // without ResizeObserver (this one — jsdom has none) the only signal is the render itself.
    // jsdom reports 0 for every box, so what is provable here is that a re-render re-publishes
    // at all; the layout effect that does it has no dependency array for exactly this reason.
    const view = render(<StickyActionBar primary={{ label: 'Chat' }} />)
    document.documentElement.style.removeProperty(STICKY_ACTION_BAR_VARS.height)
    view.rerender(<StickyActionBar primary={{ label: 'Nhắn tin cho người bán' }} />)
    expect(document.documentElement.style.getPropertyValue(STICKY_ACTION_BAR_VARS.height)).toBe(
      '0px',
    )
  })

  it('takes the same visibility class the bar takes, so the pair can be hidden together', () => {
    // The bar and the spacer are two declarations of one decision — the same coupling
    // <MobileNav> and <BottomNavSpacer> have. A bar hidden at lg with a spacer that is not
    // reserves the static fallback on a desktop page for a bar that is not there.
    render(
      <>
        <StickyActionBar primary={{ label: 'Chat' }} className="lg:hidden" />
        <StickyActionBarSpacer className="lg:hidden" />
      </>,
    )
    expect(bar().className).toContain('lg:hidden')
    expect(
      document.querySelector<HTMLElement>('[data-slot="sticky-action-bar-spacer"]')!.className,
    ).toContain('lg:hidden')
  })

  it('names the same custom property the bar writes', () => {
    render(
      <>
        <StickyActionBar primary={{ label: 'Chat' }} />
        <StickyActionBarSpacer />
      </>,
    )
    const spacer = document.querySelector<HTMLElement>('[data-slot="sticky-action-bar-spacer"]')!
    expect(spacer.className).toContain(STICKY_ACTION_BAR_VARS.height)
  })
})

describe('StickyActionBar can render an action as something else', () => {
  it('keeps a link a link — role="link", not role="button"', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <StickyActionBar
        primary={{
          label: 'Message seller',
          render: <a href="/messages" />,
          // preventDefault only so jsdom does not log "Not implemented: navigation to another
          // Document" on the click below; the assertion is that the handler ran at all.
          onClick: (e) => {
            e.preventDefault()
            onClick()
          },
        }}
      />,
    )
    // ui/button's asChild clones rather than wrapping precisely so navigation elements keep
    // their native role; the alternative shipped 28 links announced as buttons.
    const link = screen.getByRole('link', { name: 'Message seller' })
    expect(link.getAttribute('href')).toBe('/messages')
    expect(link.className).toContain('min-h-12')
    expect(screen.queryByRole('button')).toBeNull()

    // asChild does NOT compose handlers, so onClick has to be put on the child. Prove it is.
    await user.click(link)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('composes the child’s own onClick instead of replacing it', async () => {
    // ⚠️ ALL THREE REVIEWERS FLAGGED THE FIRST VERSION, WHICH REPLACED IT. React props are
    // replaced, not merged, so `render={<a onClick={track} />}` plus an action onClick silently
    // dropped the caller's analytics ping — no error, nothing to see.
    const user = userEvent.setup()
    const order: string[] = []
    render(
      <StickyActionBar
        primary={{
          // An in-page href: a real navigation would make jsdom log "Not implemented", and
          // preventDefault()ing it here would test the OPPOSITE case (see the next test).
          label: 'Message seller',
          render: <a href="#contact" onClick={() => order.push('child')} />,
          onClick: () => order.push('action'),
        }}
      />,
    )
    await user.click(screen.getByRole('link', { name: 'Message seller' }))
    // Child first: it is the more specific statement about that element.
    expect(order).toEqual(['child', 'action'])
  })

  it('does NOT run the action when the child cancelled the activation', async () => {
    // ⚠️ THE PREVIOUS VERSION OF THIS FILE ASSERTED THE OPPOSITE AND PINNED A BUG IN PLACE: its
    // child called preventDefault() (only to quiet jsdom) and it still expected the action to
    // fire. A guest tapping a gated link is the real shape — the child cancels navigation and
    // opens the sign-in sheet, and a contact-reveal logged anyway is a trust number recording an
    // event that did not happen. Same guard as Base UI's composeEventHandlers.
    const user = userEvent.setup()
    const action = vi.fn()
    render(
      <StickyActionBar
        primary={{
          label: 'Message seller',
          render: <a href="#contact" onClick={(e) => e.preventDefault()} />,
          onClick: action,
        }}
      />,
    )
    await user.click(screen.getByRole('link', { name: 'Message seller' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('keeps a bare rendered button off submit, and never touches an explicit one', () => {
    // `render` is meant for navigation, but a <button> passed here would otherwise inherit
    // HTML's `submit` default — the exact accident `type` prevents on the ordinary path.
    const { unmount } = render(
      <StickyActionBar primary={{ label: 'Publish', render: <button /> }} />,
    )
    expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('type')).toBe('button')
    unmount()

    render(
      <StickyActionBar
        primary={{ label: 'Publish', render: <button type="submit" />, type: 'button' }}
      />,
    )
    // The caller said submit on their own element. That wins.
    expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('type')).toBe('submit')
  })

  it('puts no type attribute on a rendered anchor', () => {
    render(<StickyActionBar primary={{ label: 'Message seller', render: <a href="/messages" /> }} />)
    expect(screen.getByRole('link', { name: 'Message seller' }).hasAttribute('type')).toBe(false)
  })

  it('falls back to a real disabled button when the action is disabled', () => {
    render(
      <StickyActionBar
        primary={{ label: 'Message seller', render: <a href="/messages" />, disabled: true }}
      />,
    )
    // An <a> has no disabled state, so a disabled action must never render as one.
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Message seller' }).hasAttribute('disabled')).toBe(
      true,
    )
  })
})

describe('StickyActionBar names itself only when there is something to say', () => {
  it('becomes a labelled group when given a label', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} label="Seller actions" />)
    expect(screen.getByRole('group', { name: 'Seller actions' })).toBeTruthy()
  })

  it('claims no role at all without one — an unnamed group is noise to a screen reader', () => {
    render(<StickyActionBar primary={{ label: 'Chat' }} />)
    expect(bar().hasAttribute('role')).toBe(false)
  })
})
