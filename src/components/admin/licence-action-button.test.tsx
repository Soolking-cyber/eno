// @vitest-environment jsdom
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * <LicenceActionButton> (owner, 2026-10-14) — the Approve / Revoke / Unpublish confirm on Admin › Catalogue › Licence
 * checks. Pinned: the POST body is exactly { action, ids, seen } (seen only on Approve — the stamps the admin was looking
 * at); the confirmation repeats the name, the number and the count, verbatim and in translate="no"; every count the
 * route answers becomes its own toast (approved, published, held, still held, stale, invalid); the server render is
 * refreshed on success; a refusal stays in the open dialog and refreshes nothing.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const { refresh, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast }))

import { LicenceActionButton } from './licence-action-button'

const SUMMARY = { legalName: 'CÔNG TY TNHH VISA5S.VN', licenceNo: '79-123/2019/TCDL-GP LHQT', seller: 'Visa5s', aisle: 'e-Visa' }
const STAMP = `licence:v1:${'a'.repeat(64)}`
const fetchMock = vi.fn()
const answer = (status: number, body: unknown) => fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  fetchMock.mockReset()
  refresh.mockReset()
  for (const f of Object.values(toast)) f.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The trigger: its name starts with the visible label and says which group (there is one per group on the tab). */
const trigger = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label} — `) })
async function confirm(label: string) {
  fireEvent.click(trigger(label))
  const dialog = await screen.findByRole('alertdialog')
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: label })) })
  return dialog
}
const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string)

describe('LicenceActionButton — Approve', () => {
  it('confirms with the name, the number and the count, then POSTs { action, ids, seen } and reports each count', async () => {
    answer(200, { ok: true, affected: 1, approved: 2, stillHeld: 1 })
    render(<LicenceActionButton action="licence-approve" ids={['l1', 'l2']} seen={{ l1: STAMP, l2: STAMP }} summary={SUMMARY} />)
    expect(trigger('Approve').getAttribute('aria-label')).toBe(`Approve — ${SUMMARY.legalName} (2 listings)`)
    fireEvent.click(trigger('Approve'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve this licence for 2 listings?' })
    const verbatim = [...dialog.querySelectorAll('[translate="no"]')].map((x) => x.textContent)
    expect(verbatim).toEqual([SUMMARY.legalName, SUMMARY.licenceNo])
    expect(dialog.textContent).toContain('2 · e-Visa')
    expect(dialog.textContent).toContain('Visa5s')

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/listings', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }))
    expect(sent()).toEqual({ action: 'licence-approve', ids: ['l1', 'l2'], seen: { l1: STAMP, l2: STAMP } })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Approved 2 listings · 1 published')
    expect(toast.info).toHaveBeenCalledWith('1 approved but still unpublished: an open or confirmed report, the owner\'s account held or suspended, a Restricted storefront, or taken down by a moderator — see “Approved, still unpublished”.')
    expect(toast.error).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  // Commit gate, 2026-10-14: a cleared row its seller had hidden or marked sold is not "published" — buyers cannot see it.
  it('a cleared row the seller had hidden is told apart: "published" counts only what buyers can see', async () => {
    answer(200, { ok: true, affected: 3, approved: 3, notLive: 1 })
    render(<LicenceActionButton action="licence-approve" ids={['l1', 'l2', 'l3']} seen={{ l1: STAMP, l2: STAMP, l3: STAMP }} summary={SUMMARY} />)
    await confirm('Approve')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Approved 3 listings · 2 published')
    expect(toast.info).toHaveBeenCalledWith('1 listing cleared but hidden or sold by the seller — live once they relist.')
  })

  it('stale and invalid rows each get their own toast — a stale one asks to check the values again', async () => {
    answer(200, { ok: true, affected: 0, approved: 0, stale: 1, invalid: 1 })
    render(<LicenceActionButton action="licence-approve" ids={['l1', 'l2']} seen={{ l1: STAMP, l2: STAMP }} summary={SUMMARY} />)
    await confirm('Approve')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('1 changed since you opened the page — it has reloaded: check the values again.')
    expect(toast.error).toHaveBeenCalledWith('1 cannot be approved: no longer in a licence aisle, eno\'s desk, or the values are missing or invalid.')
  })

  it('identity-gate holds are reported as such, and a re-approval that changes nothing says so', async () => {
    answer(200, { ok: true, affected: 0, approved: 1, held: 1 })
    render(<LicenceActionButton action="licence-approve" ids={['l1']} seen={{ l1: STAMP }} summary={SUMMARY} />)
    await confirm('Approve')
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledWith('1 held until the seller verifies their identity — they publish automatically once verified.'))
    cleanup()
    for (const f of Object.values(toast)) f.mockReset()
    answer(200, { ok: true, affected: 0, approved: 0 })
    render(<LicenceActionButton action="licence-approve" ids={['l1']} seen={{ l1: STAMP }} summary={SUMMARY} />)
    await confirm('Approve')
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith('Nothing changed — already approved.'))
  })

  it('a bare enterprise code is called out before approving', async () => {
    render(<LicenceActionButton action="licence-approve" ids={['l1']} seen={{ l1: STAMP }} summary={{ ...SUMMARY, licenceNo: '0312345678', aisle: 'Legal & permits', enterpriseCode: true }} />)
    fireEvent.click(trigger('Approve'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve this licence for 1 listing?' })
    expect(dialog.textContent).toContain('This number has the shape of a phone number')
  })

  it('a refusal stays in the open dialog, names the code, and refreshes nothing', async () => {
    answer(400, { error: 'bad_action' })
    render(<LicenceActionButton action="licence-approve" ids={['l1']} seen={{ l1: STAMP }} summary={SUMMARY} />)
    await confirm('Approve')
    expect((await screen.findByRole('alert')).textContent).toBe('Could not approve: bad_action.')
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('LicenceActionButton — Revoke and Unpublish', () => {
  it('Revoke POSTs no `seen` and says the listings are unpublished until checked again', async () => {
    answer(200, { ok: true, affected: 3 })
    render(<LicenceActionButton action="licence-revoke" ids={['a1', 'a2', 'a3']} summary={SUMMARY} />)
    expect(trigger('Revoke licence check').getAttribute('title')).toBe('Expired, revoked or changed: unpublishes until checked again')
    const dialog = await confirm('Revoke licence check')
    expect(dialog.textContent).toContain('Revoke the licence check on 3 listings?')
    expect(dialog.textContent).toContain('expired, been revoked or changed: unpublishes until checked again')
    expect(sent()).toEqual({ action: 'licence-revoke', ids: ['a1', 'a2', 'a3'] })
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Licence check revoked · 3 listings unpublished until checked again'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('on a row that was never approved the same action is labelled Unpublish', async () => {
    answer(200, { ok: true, affected: 1 })
    render(<LicenceActionButton action="licence-revoke" ids={['b1']} summary={SUMMARY} unapproved />)
    expect(screen.queryByRole('button', { name: /^Revoke licence check/ })).toBeNull()
    const dialog = await confirm('Unpublish')
    expect(dialog.textContent).toContain('Unpublish 1 listing?')
    expect(sent()).toEqual({ action: 'licence-revoke', ids: ['b1'] })
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Unpublished 1 listing — they wait for a licence check.'))
  })

  // Commit gate, 2026-10-14: on VietKite's grandfathered rows (offered only while the grandfather does not resolve) the
  // dialog must not claim they break the rule or that the sweep would pull them — and must say there is no way back here.
  it('on grandfathered rows while the grandfather does not resolve, the dialog says the sweep leaves them and it cannot be undone', async () => {
    answer(200, { ok: true, affected: 2 })
    render(<LicenceActionButton action="licence-revoke" ids={['g1', 'g2']} summary={SUMMARY} unapproved grandfatherUnresolved />)
    const dialog = await confirm('Unpublish')
    expect(dialog.textContent).toContain('the daily sweep leaves these listings alone')
    expect(dialog.textContent).toContain('it cannot be undone here')
    expect(dialog.textContent).not.toContain('This does now what the 00:00 ICT sweep would do')
  })

  it('nothing revoked is not reported as a success', async () => {
    answer(200, { ok: true, affected: 0 })
    render(<LicenceActionButton action="licence-revoke" ids={['a1']} summary={SUMMARY} />)
    await confirm('Revoke licence check')
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith('Nothing changed — already unpublished, or no longer in a licence aisle.'))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
