// @vitest-environment jsdom
import * as React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * <IdentityReviewPanel> — what the reviewer is told to check by eye (2026-10-15). The paper code left the selfie step
 * on 2026-09-04, yet this screen still asked for "Code that must appear in the selfie" and, with none recorded, said
 * to reject — a careful reviewer would have refused every honest applicant. Pinned: the face-against-document
 * instruction, and no code, no "none recorded", no steer toward Reject.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('./actions', () => ({ approveIdentityAction: vi.fn(), refreshIdentityCapturesAction: vi.fn(), rejectIdentityAction: vi.fn() }))

import { IdentityReviewPanel } from './review-panel'

afterEach(() => { cleanup() })

const item = {
  id: 'iv1', tier: 'B', fullName: 'ANNA MARIA ERIKSSON', nationality: 'SWE', nationalitySuggested: null,
  nationalityFromMrz: true, documentExpiresAt: '2034-08-05T17:00:00.000Z', submittedAt: '2026-10-15T03:00:00.000Z',
  method: 'manual', documentUrl: null, selfieUrl: null, checksPassed: ['mrz_checksums'],
  email: 'anna@example.com', phone: null, accountName: 'Anna',
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
