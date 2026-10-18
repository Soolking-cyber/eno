// @vitest-environment jsdom
/**
 * ui/dropdown-menu AT BOTH WIDTHS (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card style like
 * the filter card"). From `sm` up: Base UI's menu, role="menu" / role="menuitem", unchanged. Below `sm` (useIsPhone's
 * real gate through a matchMedia stub): the same trigger opens an ACTION SHEET — a named dialog holding plain buttons
 * (never role="menu" inside a dialog), every call site unchanged.
 *
 * Defended: a row runs its onClick once and closes the sheet; `closeOnClick={false}` keeps it open; a label outside a
 * Group renders (Base UI's throws); separators and destructive rows draw; the title falls back to the trigger's name;
 * a caller's `onOpenChange` hears the open (trip-cards loads its list on it) and can refuse it; `sheet={false}` keeps
 * the popover on a phone; a row marked `navigates` releases the sheet's history entry instead of popping it.
 */
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests, overlayMarkOf } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Button } from './button'

beforeAll(() => installDrawerPolyfills())

/** The rows' words, held in constants for the i18n lint. */
const L = { loose: 'Loose', listing: 'Listing', hide: 'Hide', preview: 'Preview', view: 'View listing', del: 'Delete listing' }
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

function RowMenu({ onHide = vi.fn(), onDelete = vi.fn(), onView = vi.fn(), onOpenChange, sheet, title, looseLabel = false }: {
  onHide?: () => void; onDelete?: () => void; onView?: () => void
  onOpenChange?: React.ComponentProps<typeof DropdownMenu>['onOpenChange']; sheet?: boolean; title?: string
  /** A label OUTSIDE any Group: Base UI's GroupLabel throws there (desktop); the sheet's must not. */
  looseLabel?: boolean
}) {
  return (
    <LanguageProvider>
      <DropdownMenu sheet={sheet} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger render={<Button aria-label="More actions">…</Button>} />
        <DropdownMenuContent sheetTitle={title}>
          {looseLabel && <DropdownMenuLabel>{L.loose}</DropdownMenuLabel>}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{L.listing}</DropdownMenuLabel>
            <DropdownMenuItem onClick={onHide}>{L.hide}</DropdownMenuItem>
            <DropdownMenuItem closeOnClick={false} onClick={onView}>{L.preview}</DropdownMenuItem>
            <DropdownMenuItem navigates onClick={onView}>{L.view}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>{L.del}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </LanguageProvider>
  )
}

const trigger = () => screen.getByRole('button', { name: 'More actions', hidden: true })

describe('ui/dropdown-menu · desktop', () => {
  it('is Base UI’s menu: role="menu" with menuitems', async () => {
    const onHide = vi.fn()
    render(<RowMenu onHide={onHide} />)
    await userEvent.setup().click(trigger())
    const menu = await screen.findByRole('menu')
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Hide' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ui/dropdown-menu · phone', () => {
  beforeEach(() => { setViewport('phone') })

  it('opens an action sheet: a dialog named by the trigger, plain buttons, no role="menu"', async () => {
    render(<RowMenu looseLabel />)
    await userEvent.setup().click(trigger())
    const sheet = await screen.findByRole('dialog', { name: 'More actions' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Hide' }).className).toContain('min-h-12')
    expect(within(sheet).getByText('Listing')).toBeTruthy()
    // The label outside a Group draws as a heading instead of throwing.
    expect(within(sheet).getByText('Loose')).toBeTruthy()
    expect(within(sheet).getByRole('separator')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Delete listing' }).className).toContain('text-destructive')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('a sheetTitle names the sheet', async () => {
    render(<RowMenu title="Honda Vision 2021" />)
    await userEvent.setup().click(trigger())
    expect(await screen.findByRole('dialog', { name: 'Honda Vision 2021' })).toBeTruthy()
  })

  it('a row runs once and closes the sheet; closeOnClick={false} keeps it open; focus returns to the trigger', async () => {
    const onHide = vi.fn()
    const onView = vi.fn()
    render(<RowMenu onHide={onHide} onView={onView} />)
    const user = userEvent.setup()
    await user.click(trigger())
    let sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: 'Preview' }))
    expect(onView).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBe(sheet)
    await user.click(within(sheet).getByRole('button', { name: 'Hide' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
    // And it opens again.
    await user.click(trigger())
    sheet = await screen.findByRole('dialog')
    expect(sheet).toBeTruthy()
  })

  it("the caller's onOpenChange hears the open, and can refuse it", async () => {
    const heard = vi.fn()
    const { unmount } = render(<RowMenu onOpenChange={(open) => heard(open)} />)
    await userEvent.setup().click(trigger())
    await screen.findByRole('dialog')
    expect(heard).toHaveBeenCalledWith(true)
    unmount()
    render(<RowMenu onOpenChange={(open, details) => { if (open) details.cancel() }} />)
    await userEvent.setup().click(trigger())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a row that navigates releases the sheet’s Back entry rather than popping it under the navigation', async () => {
    const onView = vi.fn()
    render(<RowMenu onView={onView} />)
    const user = userEvent.setup()
    await user.click(trigger())
    await screen.findByRole('dialog')
    await waitFor(() => expect(overlayMarkOf(window.history.state)).not.toBeNull())
    const key = overlayMarkOf(window.history.state)!.key
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'View listing' }))
    expect(onView).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Still on top, now marked released: the next push (the route change) replaces it.
    expect(overlayMarkOf(window.history.state)).toMatchObject({ key, released: true })
  })

  it('sheet={false} keeps the popover on a phone (admin)', async () => {
    render(<RowMenu sheet={false} />)
    await userEvent.setup().click(trigger())
    expect(await screen.findByRole('menu')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
