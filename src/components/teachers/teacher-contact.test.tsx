// @vitest-environment jsdom
/**
 * The teacher profile's first-screen "Message" (rentals-12) is not a second contact button with its own
 * rules: it scrolls to the contact block and runs THAT block's action, so the business-only rule (owner,
 * 2026-09-30) and the sign-in prompt are the same code path.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, push } = vi.hoisted(() => ({
  push: vi.fn(),
  auth: {
    user: null as null | { id: string },
    loading: false,
    accountType: null as string | null,
    identityLoaded: false,
    openSignIn: vi.fn(),
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/lib/quick-contact', () => ({ stashCompose: vi.fn() }))

import { TEACHER_CONTACT_ID, TeacherContact, TeacherContactJump } from './teacher-contact'

const scrolled: Element[] = []
beforeEach(() => {
  Object.assign(auth, { user: null, loading: false, accountType: null, identityLoaded: false })
  auth.openSignIn.mockClear()
  push.mockClear()
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
})
afterEach(cleanup)

function profile() {
  return render(
    <>
      <TeacherContactJump listingId="t1" />
      {/* …the bio, the teaching rows, the experience… */}
      <TeacherContact listingId="t1" name="Ms Lan" image={null} />
    </>,
  )
}

describe('TeacherContactJump — "Message" beside the name', () => {
  it('scrolls to the contact block and asks a guest to sign in, with the school-account note', () => {
    profile()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(scrolled.map((el) => el.id)).toEqual([TEACHER_CONTACT_ID])
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(auth.openSignIn.mock.calls[0][0].note).toMatch(/school or company account/)
  })

  it('keeps the business-only rule: a personal account gets the note under the contact button, no chat', () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    profile()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(screen.getByText(/Only school and company accounts can message teachers/)).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it('opens the chat for a business account — the same path as the contact button', () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    profile()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it("answers only its own listing's event", () => {
    render(
      <>
        <TeacherContactJump listingId="other" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(auth.openSignIn).not.toHaveBeenCalled()
  })
})
