// @vitest-environment jsdom
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * <IdentityReviewPanel> — what the reviewer is told to check by eye (2026-10-15). The paper code left the selfie step
 * on 2026-09-04, yet this screen still asked for "Code that must appear in the selfie" and, with none recorded, said
 * to reject — a careful reviewer would have refused every honest applicant. Pinned: the face-against-document
 * instruction, and no code, no "none recorded", no steer toward Reject.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const approve = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, code: 'number_mismatch' as const })))
vi.mock('./actions', () => ({ approveIdentityAction: approve, refreshIdentityCapturesAction: vi.fn(), rejectIdentityAction: vi.fn() }))

import { IdentityReviewPanel } from './review-panel'

afterEach(() => { cleanup() })

const item = {
  id: 'iv1', tier: 'B', fullName: 'ANNA MARIA ERIKSSON', nationality: 'SWE', nationalitySuggested: null,
  nationalityFromMrz: true, documentExpiresAt: '2034-08-05T17:00:00.000Z', submittedAt: '2026-10-15T03:00:00.000Z',
  method: 'manual', documentUrl: null, selfieUrl: null, checksPassed: ['mrz_checksums'],
  email: 'anna@example.com', phone: null, accountName: 'Anna', readDisagreement: null,
}

describe('IdentityReviewPanel — the check by eye', () => {
  it('asks the reviewer to compare the face with the document photo — never for a code', () => {
    const { container } = render(<IdentityReviewPanel item={item} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Check by eye')
    expect(text).toContain('The selfie shows the same person as the photo on the document.')
    expect(text).toContain('No code or paper is needed in the selfie')
    // A case submitted before the code was retired may still hold one up — the reviewer is told to ignore it.
    expect(text).toContain('An older selfie may still show one: ignore it.')
    expect(text).not.toMatch(/Code that must appear|none recorded/i)
  })
})

// ⛔ A TYPED PASSPORT (2026-10-21): the form stopped asking for the MRZ lines, so nothing machine-read this number —
// the duplicate-identity key. The reviewer re-types it off the photo; the server matches it (review.ts).
describe('IdentityReviewPanel — a typed passport', () => {
  // Approve also waits for both captures to have loaded, so these cases carry links and fire the loads.
  const withCaptures = { ...item, documentUrl: 'https://storage.test/doc.jpg', selfieUrl: 'https://storage.test/selfie.jpg' }
  const typed = { ...withCaptures, method: 'passport_manual', nationality: null, nationalityFromMrz: false, checksPassed: [] }
  const loadCaptures = (root: HTMLElement) => { for (const img of root.querySelectorAll('img')) fireEvent.load(img) }

  it('says the details were typed, asks for the number and expiry off the photo, and will not approve without both', async () => {
    const { container } = render(<IdentityReviewPanel item={typed} />)
    loadCaptures(container)
    expect(container.textContent).toContain('Typed, not machine-read')
    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Passport number (as on the photo)'), { target: { value: 'x1234567' } })
    expect(approveButton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Expiry date (as on the photo)'), { target: { value: '2030-01-01' } })
    expect(approveButton).toHaveProperty('disabled', false)
    fireEvent.click(approveButton)
    await vi.waitFor(() => expect(approve).toHaveBeenCalledWith('iv1', undefined, 'X1234567', '2030-01-01'))
  })

  it('shows an expiry as its day in Vietnam — an ICT midnight is the previous day in UTC', () => {
    // 2034-08-05T17:00Z is 2034-08-06 00:00 in Hanoi: slicing the ISO string showed it a day early.
    const { container } = render(<IdentityReviewPanel item={item} />)
    expect(container.textContent).toContain('2034-08-06')
    expect(container.textContent).not.toContain('2034-08-05')
  })

  it('warns, without blocking, when the reviewer\'s expiry differs from the applicant\'s', () => {
    const { container } = render(<IdentityReviewPanel item={typed} />)
    fireEvent.change(screen.getByLabelText('Expiry date (as on the photo)'), { target: { value: '2036-08-06' } })
    expect(container.textContent).toContain("Differs from the applicant's 2034-08-06")
    fireEvent.change(screen.getByLabelText('Expiry date (as on the photo)'), { target: { value: '2034-08-06' } })
    expect(container.textContent).not.toContain('Differs from the applicant')
  })

  it('flags what the code lines said where the applicant typed otherwise — and still asks for both off the photo', () => {
    const { container } = render(<IdentityReviewPanel item={{ ...typed, readDisagreement: { number: true, expiry: '2024-05-01' } }} />)
    expect(container.textContent).toContain('gave a different passport number from the one the applicant typed')
    expect(container.textContent).toContain('gave the expiry as 2024-05-01')
    // The lines came from the applicant's device, so nothing here is presented as a machine read to rely on.
    expect(container.textContent).not.toMatch(/read by the camera/)
    expect(screen.getByLabelText('Expiry date (as on the photo)')).toBeTruthy()
  })

  it('a camera-read passport shows no number box and approves as before', () => {
    const { container } = render(<IdentityReviewPanel item={withCaptures} />)
    loadCaptures(container)
    expect(screen.queryByLabelText('Passport number (as on the photo)')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', false)
  })
})
