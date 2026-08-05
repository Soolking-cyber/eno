// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatSendButton } from '@/components/marketplace/chat-parts'

/**
 * THE COMPOSER'S FOCUS-HOLD — the first component test in this repo, on a documented landmine.
 *
 * ⚠️ WHY THIS COMPONENT FIRST. CLAUDE.md names this invariant explicitly and warns that it reads
 * backwards: text mode DOES have a tap-Send button (the Zalo/FB pattern), and what makes that safe
 * is that `ChatSendButton` fires on **onMouseDown + preventDefault, never onPointerDown**. The
 * preventDefault is what stops the browser moving focus off the textarea — without it the tap blurs
 * the field, the mobile keyboard collapses, the layout reflows, and the button slides out from under
 * the finger mid-tap. "No tap-Send" was an earlier workaround for that and is explicitly obsolete.
 *
 * It is exactly the class of bug a click-through test cannot see, because clicking still works.
 * The assertion below is behavioural rather than structural: focus a field, press the button, and
 * check the field still has focus — which is the thing the user experiences.
 *
 * ⚠️ COMPONENT TESTS WERE IMPOSSIBLE HERE UNTIL 2026-08-05, not merely absent: vitest collected only
 * `src/**\/*.test.ts` and there was no jsdom or Testing Library installed. This file is also the
 * proof that the harness works — if the setup regresses, it stops running rather than failing, so
 * keep at least one component test that would notice.
 */

// ⚠️ EXPLICIT CLEANUP, BECAUSE THIS SUITE DOES NOT RUN WITH `globals: true`. Testing Library
// auto-registers its afterEach only when vitest's globals are on; without it every render stacks in
// the same document and the SECOND test fails with "Found multiple elements" — which is how this
// was found. Any future component test needs this line too, or it will fail for a reason that has
// nothing to do with the component.
afterEach(cleanup)

describe('ChatSendButton holds the composer’s focus', () => {
  it('a press does not blur the field the user was typing in', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <>
        <textarea aria-label="composer" />
        <ChatSendButton aria-label="Send" onClick={onClick} />
      </>,
    )

    const composer = screen.getByLabelText('composer')
    composer.focus()
    expect(document.activeElement).toBe(composer)

    await user.click(screen.getByLabelText('Send'))

    // The whole point: the send fired AND the keyboard did not collapse.
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(composer)
  })

  it('mousedown is default-prevented — the mechanism behind the focus-hold', async () => {
    const user = userEvent.setup()
    render(<ChatSendButton aria-label="Send" />)
    const btn = screen.getByLabelText('Send')

    // Listen at the document, so this observes the event AFTER the component's handler ran.
    const seen: boolean[] = []
    document.addEventListener('mousedown', (e) => seen.push(e.defaultPrevented))
    await user.click(btn)

    expect(seen).toContain(true)
  })

  it('⚠️ a caller-supplied onMouseDown REPLACES the guard — spread order makes this possible', () => {
    // Not a defect being asserted as correct, but a sharp edge worth pinning: `{...props}` is
    // spread AFTER `onMouseDown` in chat-parts.tsx, so a call site passing its own handler silently
    // drops the preventDefault and reintroduces the keyboard-collapse bug at that one site. There
    // are no such call sites today. If this test ever starts failing because the spread order was
    // changed to protect the guard, that is an improvement — update it rather than reverting.
    const own = vi.fn((e: React.MouseEvent) => { /* deliberately does not preventDefault */ })
    render(<ChatSendButton aria-label="Send" onMouseDown={own} />)
    const btn = screen.getByLabelText('Send')

    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(ev)

    expect(own).toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false) // the built-in guard was overridden
  })

  it('renders a real <button>, not a div with a handler', () => {
    // A Base UI / a11y check that costs nothing: keyboard users and screen readers need the
    // element to actually be a button, and `IconButton` is what guarantees it.
    render(<ChatSendButton aria-label="Send" />)
    expect(screen.getByLabelText('Send').tagName).toBe('BUTTON')
  })
})
