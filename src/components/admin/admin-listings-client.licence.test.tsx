// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE LISTINGS CONSOLE AND THE LICENCE CHECK (owner, 2026-10-14) — admin-listings-client.tsx. Pinned: an e-Visa / Legal &
 * permits row from anyone but the desk says WHICH hold it is in instead of the generic "held" ("Licence check",
 * "Licence details missing", VietKite's "No licence · until …", and a live unchecked row in the destructive tone); its
 * two values sit under the title verbatim in translate="no", with a link to the tab that approves them — a link that
 * does not toggle the row's selection; an approved or ordinary held row keeps "held"; and Publish's licenceCheck count
 * becomes its own warning.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// A plain anchor that runs the caller's onClick (the row-toggle guard under test) and then stays on the page — jsdom
// cannot navigate.
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, onClick, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} onClick={(e) => { onClick?.(e); e.preventDefault() }} {...rest}>{children}</a>
  ),
}))

import { AdminListingsClient } from './admin-listings-client'

const UNTIL = '21 Oct 2026, 00:00 ICT'
const base = { price: 1_500_000, currency: '₫', image: null, featured: false, sellerName: 'Shop', category: 'Services', createdAt: '2026-10-14T03:00:00.000Z' }
const licence = (state: string, legalName = 'CÔNG TY TNHH VISA5S.VN', licenceNo = '79-123/2019/TCDL-GP LHQT', enterpriseCode = false) => ({ state, legalName, licenceNo, enterpriseCode })
const LISTINGS = [
  { ...base, id: 'r1', title: 'Waiting e-Visa', status: 'active', verified: false, subcategory: 'visa-legal', licence: licence('pending') },
  { ...base, id: 'r2', title: 'Missing values', status: 'active', verified: false, subcategory: 'visa-legal', licence: licence('missing', '', '') },
  { ...base, id: 'r3', title: 'VietKite e-Visa', status: 'active', verified: true, subcategory: 'visa-legal', licence: licence('grandfathered', '', '') },
  { ...base, id: 'r4', title: 'Live unchecked', status: 'active', verified: true, subcategory: 'legal-permits', licence: licence('pending', 'Công ty Luật XYZ', '0312345678', true) },
  { ...base, id: 'r5', title: 'Approved but held', status: 'active', verified: false, subcategory: 'visa-legal', licence: licence('approved') },
  { ...base, id: 'r6', title: 'Ordinary held', status: 'active', verified: false, subcategory: 'phones-tablets' },
  // Commit gate, 2026-10-14: verified but hidden is not "live" to a buyer; a grandfathered state on a held row (which the
  // server never sends — licenceGrandfathered requires verified) still reads as held, never as live.
  { ...base, id: 'r7', title: 'Hidden unchecked', status: 'hidden', verified: true, subcategory: 'visa-legal', licence: licence('missing', '', '') },
  { ...base, id: 'r8', title: 'Held VietKite', status: 'active', verified: false, subcategory: 'visa-legal', licence: licence('grandfathered', '', '') },
]

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  for (const f of Object.values(toast)) f.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true, affected: 0, licenceCheck: 1 }) }
    return { ok: true, status: 200, json: async () => ({ listings: LISTINGS, total: LISTINGS.length }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The table row whose title is `title`. */
const rowOf = (title: string) => screen.getByText(title).closest('tr')!

describe('AdminListingsClient — licence-aisle rows', () => {
  it('says which hold a licence-aisle row is in instead of the generic "held"', async () => {
    render(<AdminListingsClient licenceGrandfatherUntil={UNTIL} />)
    await screen.findByText('Waiting e-Visa')
    expect(within(rowOf('Waiting e-Visa')).getByText('Licence check')).toBeTruthy()
    expect(within(rowOf('Missing values')).getByText('Licence details missing')).toBeTruthy()
    expect(within(rowOf('VietKite e-Visa')).getByText(`No licence · until ${UNTIL}`)).toBeTruthy()
    expect(within(rowOf('Live unchecked')).getByText('Live without a licence check')).toBeTruthy()
    for (const t of ['Waiting e-Visa', 'Missing values', 'VietKite e-Visa', 'Live unchecked']) expect(within(rowOf(t)).queryByText('held')).toBeNull()
    // An approved row that is held, and an ordinary one, are held for an ordinary reason.
    expect(within(rowOf('Approved but held')).getByText('held')).toBeTruthy()
    expect(within(rowOf('Ordinary held')).getByText('held')).toBeTruthy()
    expect(within(rowOf('Hidden unchecked')).getByText('Verified without a licence check')).toBeTruthy()
    expect(within(rowOf('Held VietKite')).queryByText(`No licence · until ${UNTIL}`)).toBeNull()
    expect(within(rowOf('Held VietKite')).getByText('held')).toBeTruthy()
  })

  it('prints the two values verbatim in translate="no", flags the phone-shaped code, and links to Licence checks', async () => {
    render(<AdminListingsClient licenceGrandfatherUntil={UNTIL} />)
    await screen.findByText('Waiting e-Visa')
    const verbatim = (t: string) => [...rowOf(t).querySelectorAll('[translate="no"]')].map((x) => x.textContent)
    expect(verbatim('Waiting e-Visa')).toEqual(['CÔNG TY TNHH VISA5S.VN', '79-123/2019/TCDL-GP LHQT'])
    expect(verbatim('Live unchecked')).toEqual(['Công ty Luật XYZ', '0312345678'])
    expect(rowOf('Live unchecked').textContent).toContain('phone-shaped: compare with the certificate')
    expect(rowOf('Waiting e-Visa').textContent).not.toContain('phone-shaped')
    expect(verbatim('Missing values')).toEqual([])
    expect(rowOf('Missing values').textContent).toContain('no registered name')
    const link = within(rowOf('Waiting e-Visa')).getByRole('link', { name: 'Licence checks' })
    expect(link.getAttribute('href')).toBe('/admin/catalogue?tab=licences')
    // No values line, no link, on a row outside the aisles.
    expect(within(rowOf('Ordinary held')).queryByRole('link')).toBeNull()
    // Following the link does not select the row.
    fireEvent.click(link)
    expect(screen.getByText('Select all')).toBeTruthy()
  })

  it('without the date from the page the grandfather badge still says what it is', async () => {
    render(<AdminListingsClient />)
    await screen.findByText('VietKite e-Visa')
    expect(within(rowOf('VietKite e-Visa')).getByText('No licence · grandfathered')).toBeTruthy()
  })

  it('Publish reports the rows it skipped for a licence check as their own warning', async () => {
    render(<AdminListingsClient licenceGrandfatherUntil={UNTIL} />)
    await screen.findByText('Waiting e-Visa')
    fireEvent.click(screen.getByText('Waiting e-Visa'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Publish/ })) })
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'verify', ids: ['r1'] })
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledWith('1 need a licence check — approve them under Licence checks'))
  })
})
