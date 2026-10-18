// @vitest-environment jsdom
/**
 * ui/popover `mobileSheet` (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card style like the
 * filter card"). A panel that IS a dropdown (the bell, Share, Get the app) opts in; below `sm` (useIsPhone's real gate
 * through a matchMedia stub) the same trigger opens its content inside the filter card's sheet.
 *
 * Defended: the sheet is a dialog named by `sheetTitle`; the popover's own PopoverHeader / PopoverTitle are dropped
 * there (never two titles); `sheetMeta` sits in the header; a caller that refuses the open (the bell, signed out)
 * gets no sheet; a popover WITHOUT `mobileSheet` stays a popover on a phone (the reaction bar, the filter panels);
 * desktop is the anchored card; a link inside releases the sheet's Back entry instead of popping it.
 */
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests, overlayMarkOf } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger, useInPopoverSheet } from './popover'
import { Button } from './button'

beforeAll(() => installDrawerPolyfills())
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

/** Words, held in constants for the i18n lint. */
const W = { bell: 'Bell', markAll: 'Mark all read', heading: 'Panel heading', action: 'Do it', link: 'A link' }

function Where() {
  return <span data-testid="where">{useInPopoverSheet() ? 'sheet' : 'popover'}</span>
}

function Panel({ mobileSheet = true, refuse = false, onAction = vi.fn() }: { mobileSheet?: boolean; refuse?: boolean; onAction?: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <LanguageProvider>
      <Popover mobileSheet={mobileSheet} open={open} onOpenChange={(next) => { if (next && refuse) return; setOpen(next) }}>
        <PopoverTrigger render={<Button aria-label="Notifications">{W.bell}</Button>} />
        <PopoverContent aria-label="Notifications panel" sheetTitle="Notifications" sheetMeta={<button type="button">{W.markAll}</button>}>
          <PopoverHeader>
            <PopoverTitle>{W.heading}</PopoverTitle>
          </PopoverHeader>
          <Where />
          <button type="button" onClick={onAction}>{W.action}</button>
          <a href="#somewhere" onClick={(e) => e.preventDefault()}>{W.link}</a>
        </PopoverContent>
      </Popover>
    </LanguageProvider>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Notifications', hidden: true })

describe('ui/popover · desktop', () => {
  it('mobileSheet changes nothing from sm up: the anchored card with its own heading', async () => {
    render(<Panel />)
    await userEvent.setup().click(trigger())
    const card = await screen.findByRole('dialog', { name: 'Panel heading' })
    expect(card.getAttribute('data-slot')).toBe('popover-content')
    expect(screen.getByTestId('where').textContent).toBe('popover')
  })
})

describe('ui/popover · phone', () => {
  beforeEach(() => { setViewport('phone') })

  it('opens the content in the filter card, titled by sheetTitle, its own heading dropped, meta in the header', async () => {
    render(<Panel />)
    await userEvent.setup().click(trigger())
    const sheet = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(sheet).queryByText('Panel heading')).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Mark all read' })).toBeTruthy()
    expect(within(sheet).getByTestId('where').textContent).toBe('sheet')
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('a caller that refuses the open gets no sheet (the bell, signed out)', async () => {
    render(<Panel refuse />)
    await userEvent.setup().click(trigger())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('without mobileSheet a popover stays a popover on a phone', async () => {
    render(<Panel mobileSheet={false} />)
    await userEvent.setup().click(trigger())
    const card = await screen.findByRole('dialog', { name: 'Panel heading' })
    expect(card.getAttribute('data-slot')).toBe('popover-content')
  })

  it('a link inside releases the Back entry rather than popping it under the navigation', async () => {
    render(<Panel />)
    const user = userEvent.setup()
    await user.click(trigger())
    const sheet = await screen.findByRole('dialog', { name: 'Notifications' })
    await waitFor(() => expect(overlayMarkOf(window.history.state)).not.toBeNull())
    const key = overlayMarkOf(window.history.state)!.key
    await user.click(within(sheet).getByRole('link', { name: 'A link' }))
    expect(overlayMarkOf(window.history.state)).toMatchObject({ key, released: true })
  })

  it('the ✕ closes it and focus goes back to the trigger', async () => {
    render(<Panel />)
    const user = userEvent.setup()
    await user.click(trigger())
    const sheet = await screen.findByRole('dialog', { name: 'Notifications' })
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
  })
})
