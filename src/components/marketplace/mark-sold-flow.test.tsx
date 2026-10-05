// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * <MarkSoldFlow> — the mark-sold sheet wired to the server (B6). The sheet's own rules are pinned in
 * mark-sold-sheet.test.tsx; THIS file pins what the wiring adds: who it asks the server for, what one
 * tap sends, and that no failure — of the lookup or of the write — can turn into a false answer, a dead
 * end or a silent undo.
 *
 * ⚠️ EXPLICIT `cleanup` — no vitest globals, so Testing Library registers no afterEach of its own.
 */

const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }))
vi.mock('sonner', () => ({
  toast: { success: (m: string) => { toasts.success.push(m) }, error: (m: string) => { toasts.error.push(m) } },
}))
const lang = vi.hoisted(() => ({ lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => lang, useTr: () => lang.tr }))

import { MarkSoldFlow, markSoldRequest, soldSheetApplies, type MarkSoldRequest } from './mark-sold-flow'

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  Element.prototype.getAnimations ??= () => []
  Element.prototype.scrollIntoView ??= () => {}
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  }
})

const LISTING = { id: 'l1', title: 'Honda Vision 2021', price: 12_000_000 }
const row = (conversationId: string, profileId: string, name: string | null) =>
  ({ conversationId, profileId, name, avatarUrl: null, avatarColor: null, lastMessageAt: '2026-10-01T00:00:00.000Z' })

/** The route's answer when nobody ever messaged about the listing — and it can PROVE it (`nobodyMessaged`). */
const NOBODY = { buyers: [], nobodyMessaged: true, asksBuyer: true }
let buyersReply: { status: number; body: unknown } | 'never' = { status: 200, body: NOBODY }
let fetches: string[] = []

beforeEach(() => {
  toasts.success.length = 0
  toasts.error.length = 0
  fetches = []
  buyersReply = { status: 200, body: NOBODY }
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    fetches.push(String(input))
    if (buyersReply === 'never') return new Promise(() => {})
    const r = buyersReply
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body) } as Response)
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The flow behind a parent that owns `open`, the way every entry point does. */
function mount(props: Partial<React.ComponentProps<typeof MarkSoldFlow>> & { write: (s: MarkSoldRequest) => Promise<boolean> }) {
  const onOpenChange = vi.fn()
  function Parent() {
    const [open, setOpen] = React.useState(true)
    return <MarkSoldFlow listing={LISTING} {...props} open={open} onOpenChange={(o) => { onOpenChange(o); setOpen(o) }} />
  }
  const view = render(<Parent />)
  return { ...view, onOpenChange }
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const cta = () => screen.getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement

describe('soldSheetApplies — "Who bought it?" is for a SALE of goods', () => {
  it('sell, wholesale, free (a giveaway), and the column default when the type is missing', () => {
    for (const listingType of ['sell', 'wholesale', 'free', null, undefined]) expect(soldSheetApplies({ listingType })).toBe(true)
  })
  it('⛔ never a tenancy, a hire, a teacher, a service, an event or a buyer\'s own "wanted" post', () => {
    for (const listingType of ['rent', 'job', 'teacher', 'service', 'event', 'wanted']) expect(soldSheetApplies({ listingType })).toBe(false)
  })
  it('⛔ nor a "sell" row in rentals, nor a FREE community post (a meetup, lost & found)', () => {
    expect(soldSheetApplies({ listingType: 'sell', categorySlug: 'rentals' })).toBe(false)
    expect(soldSheetApplies({ listingType: 'free', categorySlug: 'community-events' })).toBe(false)
    expect(soldSheetApplies({ listingType: 'free', categorySlug: 'pets' })).toBe(true)
  })
})

describe('markSoldRequest — the sheet\'s answer as the POST /sold body', () => {
  it('a named person → buyerProfileId (the route checks they really messaged this seller)', () => {
    expect(markSoldRequest({ buyerId: 'p1', price: 11_000_000 })).toEqual({ buyerProfileId: 'p1', salePrice: 11_000_000 })
  })
  it('"someone not on eno" → channel external — a real sale, recorded off-platform', () => {
    expect(markSoldRequest({ buyerId: null, price: 12_000_000 })).toEqual({ channel: 'external', salePrice: 12_000_000 })
  })
  it('a giveaway\'s 0 travels as null — "did not say", never an implausible figure', () => {
    expect(markSoldRequest({ buyerId: null, price: 0 })).toEqual({ channel: 'external', salePrice: null })
  })
})

describe('who it asks the server for', () => {
  it('the people who messaged about THIS listing — and nothing is answerable until they are in', async () => {
    buyersReply = 'never'
    mount({ write: vi.fn() })
    expect(fetches).toEqual(['/api/listings/l1/buyers?scope=listing'])
    expect(cta().disabled).toBe(true)
    expect(screen.getByText('Looking up who messaged you…')).toBeTruthy()
  })

  it('NOBODY — and the route PROVES it → "someone not on eno" is already picked: one tap files an off-eno sale, closes, and says so', async () => {
    const user = userEvent.setup()
    const write = vi.fn(async () => true)
    const { onOpenChange } = mount({ write })
    await settle()
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('true')
    await user.click(cta())
    await settle()
    expect(write).toHaveBeenCalledWith({ channel: 'external', salePrice: 12_000_000 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toasts.success).toEqual(['Marked as sold'])
  })

  it('⛔ AN EMPTY LIST THE ROUTE CANNOT VOUCH FOR picks NOTHING — a thread that moved away may have been the buyer (B6 review)', async () => {
    buyersReply = { status: 200, body: { buyers: [], nobodyMessaged: false, asksBuyer: true } }
    const write = vi.fn()
    mount({ write })
    await settle()
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('false')
    expect(cta().disabled).toBe(true)
    expect(screen.getByText('No chat is linked to this listing right now.')).toBeTruthy()
    expect(write).not.toHaveBeenCalled()
  })

  it('⛔ and a route that does not SAY (an older server, a reply without the flag) is "unsure" too — nothing picked', async () => {
    buyersReply = { status: 200, body: { buyers: [] } }
    mount({ write: vi.fn() })
    await settle()
    expect(screen.getByRole('radio', { name: /Someone not on eno/ }).getAttribute('aria-checked')).toBe('false')
    expect(cta().disabled).toBe(true)
  })

  it('FROM A THREAD WITH A DEAL → that thread\'s buyer first and picked, at the price they agreed: one tap names them', async () => {
    const user = userEvent.setup()
    buyersReply = { status: 200, body: { buyers: [row('c-other', 'p-other', 'Huy'), row('c-thread', 'p-thread', 'Lan')], nobodyMessaged: false, asksBuyer: true } }
    const write = vi.fn(async () => true)
    mount({ write, threadConversationId: 'c-thread', threadHasDeal: true, threadAcceptedOffer: 11_000_000 })
    await settle()
    const radios = screen.getAllByRole('radio')
    expect(radios[0].textContent).toContain('Lan')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement).value).toBe('11,000,000')
    // …and the footer's promise is on, because the route says naming them really asks them.
    expect(screen.getByText('Lan will be asked to confirm.')).toBeTruthy()
    await user.click(cta())
    await settle()
    expect(write).toHaveBeenCalledWith({ buyerProfileId: 'p-thread', salePrice: 11_000_000 })
  })

  it('⛔ FROM A THREAD WITHOUT A DEAL → their row is FIRST but NOT picked: an open chat is not evidence they bought it (B6 review)', async () => {
    buyersReply = { status: 200, body: { buyers: [row('c-other', 'p-other', 'Huy'), row('c-thread', 'p-thread', 'Lan')], nobodyMessaged: false, asksBuyer: true } }
    mount({ write: vi.fn(), threadConversationId: 'c-thread' })
    await settle()
    const radios = screen.getAllByRole('radio')
    expect(radios[0].textContent).toContain('Lan')
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(cta().disabled).toBe(true)
  })

  it('⛔ the footer promises a question ONLY where the route says one is sent (`asksBuyer`) — otherwise just the record', async () => {
    const user = userEvent.setup()
    buyersReply = { status: 200, body: { buyers: [row('c1', 'p1', 'Minh')], nobodyMessaged: false, asksBuyer: false } }
    mount({ write: vi.fn() })
    await settle()
    await user.click(screen.getByRole('radio', { name: /Minh/ }))
    expect(screen.getByText('Recorded as sold to Minh.')).toBeTruthy()
    expect(screen.queryByText(/will be asked to confirm/)).toBeNull()
  })

  it('people, but none from this thread (the dashboard) → nobody is picked: the seller chooses', async () => {
    buyersReply = { status: 200, body: { buyers: [row('c1', 'p1', 'Minh')], nobodyMessaged: false, asksBuyer: true } }
    mount({ write: vi.fn() })
    await settle()
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(cta().disabled).toBe(true)
  })

  it('one row per person (two threads with one seller), and a nameless account still reads as someone', async () => {
    buyersReply = { status: 200, body: { buyers: [row('c1', 'p1', null), row('c2', 'p1', null)] } }
    mount({ write: vi.fn() })
    await settle()
    expect(screen.getAllByRole('radio')).toHaveLength(2) // the person + "Someone not on eno"
    expect(screen.getAllByRole('radio')[0].textContent).toContain('Buyer')
  })

  it('⛔ A FAILED LOOKUP NEVER READS AS "NOBODY MESSAGED": the sheet closes and says so, and nothing is filed', async () => {
    buyersReply = { status: 500, body: { error: 'server_error' } }
    const write = vi.fn()
    const { onOpenChange } = mount({ write })
    await settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toasts.error).toEqual(['Could not load who messaged you — please try again.'])
    expect(write).not.toHaveBeenCalled()
  })
})

describe('the write — optimistic in the caller, told by the sheet', () => {
  it('a failure is said IN the sheet, which stays open and re-arms — and the retry starts with a clean slate', async () => {
    const user = userEvent.setup()
    let release: (ok: boolean) => void = () => {}
    const write = vi.fn(() => new Promise<boolean>((r) => { release = r }))
    mount({ write })
    await settle()
    await user.click(cta())
    expect(cta().disabled).toBe(true) // the spinner, synchronously
    await act(async () => { release(false) })
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Could not mark as sold — please try again.')
    expect(cta().disabled).toBe(false)
    await user.click(cta())
    expect(screen.queryByRole('alert')).toBeNull() // cleared the moment the retry left
    expect(write).toHaveBeenCalledTimes(2)
    await act(async () => { release(true) })
    await settle()
    expect(toasts.success).toEqual(['Marked as sold'])
  })

  it('a write that THROWS is a failure, never a spinner that sticks', async () => {
    const user = userEvent.setup()
    mount({ write: vi.fn(async () => { throw new Error('boom') }) })
    await settle()
    await user.click(cta())
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Could not mark as sold — please try again.')
    expect(cta().disabled).toBe(false)
  })

  it('dismissed mid-write and then refused: there is no sheet to say it in, so it is a toast — never a silent undo', async () => {
    const user = userEvent.setup()
    let release: (ok: boolean) => void = () => {}
    mount({ write: () => new Promise<boolean>((r) => { release = r }) })
    await settle()
    await user.click(cta())
    await user.keyboard('{Escape}') // Escape and the swipe stay live mid-write, by the sheet's design
    await act(async () => { release(false) })
    await settle()
    expect(toasts.error).toEqual(['Could not mark as sold — please try again.'])
  })
})

describe('a write that outlives its sheet (the thread keys one sheet per sale)', () => {
  it('its answer is still TOLD — but it never closes or errors whatever the parent shows now', async () => {
    const user = userEvent.setup()
    const releases: ((ok: boolean) => void)[] = []
    const onOpenChange = vi.fn()
    const flow = (key: string) => (
      <MarkSoldFlow key={key} listing={LISTING} open onOpenChange={onOpenChange} write={() => new Promise<boolean>((r) => { releases.push(r) })} />
    )
    const view = render(flow('sale-a'))
    await settle()
    await user.click(cta())
    view.rerender(flow('sale-b')) // the next sale's sheet replaces it while A's write is out
    await settle()
    onOpenChange.mockClear()
    await act(async () => { releases[0](true) })
    await settle()
    expect(toasts.success).toEqual(['Marked as sold'])
    expect(onOpenChange).not.toHaveBeenCalled() // sale B's sheet stays open
    expect(cta().disabled).toBe(false) // …and is not frozen by A's spinner
  })

  it('a refusal for the replaced sheet is a toast, never an error on the new one', async () => {
    const user = userEvent.setup()
    const releases: ((ok: boolean) => void)[] = []
    const flow = (key: string) => (
      <MarkSoldFlow key={key} listing={LISTING} open onOpenChange={() => {}} write={() => new Promise<boolean>((r) => { releases.push(r) })} />
    )
    const view = render(flow('sale-a'))
    await settle()
    await user.click(cta())
    view.rerender(flow('sale-b'))
    await settle()
    await act(async () => { releases[0](false) })
    await settle()
    expect(toasts.error).toEqual(['Could not mark as sold — please try again.'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('re-opening starts over', () => {
  it('a new open asks the server again — the list can have changed — and carries no old message', async () => {
    const user = userEvent.setup()
    let release: (ok: boolean) => void = () => {}
    const onOpenChange = vi.fn()
    function Parent() {
      const [open, setOpen] = React.useState(true)
      return (
        <>
          <button type="button" aria-label="reopen" onClick={() => setOpen(true)} />
          <MarkSoldFlow listing={LISTING} open={open} onOpenChange={(o) => { onOpenChange(o); setOpen(o) }} write={() => new Promise<boolean>((r) => { release = r })} />
        </>
      )
    }
    render(<Parent />)
    await settle()
    await user.click(cta())
    await act(async () => { release(false) })
    await settle()
    expect(screen.getByRole('alert')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'reopen', hidden: true }))
    await settle()
    expect(fetches.filter((u) => u.includes('/buyers'))).toHaveLength(2)
    const dialogs = screen.getAllByRole('dialog', { hidden: true })
    expect(within(dialogs[dialogs.length - 1]).queryByRole('alert', { hidden: true })).toBeNull()
  })
})
