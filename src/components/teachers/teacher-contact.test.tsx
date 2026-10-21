// @vitest-environment jsdom
/**
 * The teacher profile's contact block, and its first-screen "Message" (rentals-12), which is not a second contact button
 * with its own rules: it scrolls to the contact block and runs THAT block's action, so the teacher DM ladder (owner,
 * 2026-10-13 — any signed-in account, within its daily limit of NEW teachers; it replaced the 2026-09-30 business-only
 * rule) and the sign-in prompt are the same code path. The block asks GET /api/teachers/dm-quota where the account
 * stands before it stashes an opener, so a refusal is said in place, with the step that lifts it.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, push, stash, ios } = vi.hoisted(() => ({
  push: vi.fn(),
  stash: vi.fn(),
  ios: { hideKyc: false },
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
vi.mock('@/lib/quick-contact', () => ({ stashCompose: stash }))
// App Store gate `ios-hide-kyc`: true only in the iOS app with the gate on (src/hooks/use-ios-hide-kyc.ts).
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => ios.hideKyc }))

import { TEACHER_CONTACT_ID, TeacherContact, TeacherContactJump } from './teacher-contact'

/** The one-tap openers (src/lib/teachers/first-message.ts): a business speaks as the school, anyone else as a person. */
// ⛔ The button never sends (owner, 2026-10-21): it stashes "let the writer choose" in its voice — /messages/pending shows
// the opener chips. No body is ever stashed here.
const PERSON_PICK = { pick: { voice: 'person', cover: false } }
const SCHOOL_PICK = { pick: { voice: 'school', cover: false } }

/** GET /api/teachers/dm-quota's answer (src/app/api/teachers/dm-quota/route.ts): an unverified account, 0 of 3 used. */
const standing = (o: Record<string, unknown> = {}) => ({
  tier: 'unverified', limit: 3, used: 0, remaining: 3, resetAt: '2026-10-13T17:00:00.000Z',
  next: 'verify_identity', nextLimit: 10, reason: null, hasThread: false, ...o,
})
const UNDER_LIMIT = standing({ used: 1, remaining: 2 })
const OVER_LIMIT = standing({ used: 3, remaining: 0, reason: 'limit' })
const BUSINESS = standing({ tier: 'business', limit: 30, remaining: 30, next: 'tomorrow', nextLimit: null })

// The block's only request. No answer set = the route failed (500): the tap then goes through and the server decides.
let quotaAnswer: Record<string, unknown> | null = null
const fetchMock = vi.fn(async (url: string) => {
  if (!url.startsWith('/api/teachers/dm-quota?')) throw new Error(`unexpected request: ${url}`)
  const body = quotaAnswer
  return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 500, json: async () => ({ error: 'internal' }) }
})
/** Lets the quota ask (an effect, once the account is known) answer before the tap. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

const scrolled: Element[] = []
beforeEach(() => {
  Object.assign(auth, { user: null, loading: false, accountType: null, identityLoaded: false })
  auth.openSignIn.mockClear()
  push.mockClear()
  stash.mockClear()
  fetchMock.mockClear()
  quotaAnswer = null
  ios.hideKyc = false
  vi.stubGlobal('fetch', fetchMock)
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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
  it('scrolls to the contact block and asks a guest to sign in: "Sign in to message teachers."', () => {
    profile()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(scrolled.map((el) => el.id)).toEqual([TEACHER_CONTACT_ID])
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(auth.openSignIn.mock.calls[0][0]).toMatchObject({ sellerName: 'Ms Lan', listingTitle: 'a teaching job', note: 'Sign in to message teachers.' })
    // A guest has no standing to ask about, and nothing is stashed for one.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stash).not.toHaveBeenCalled()
  })

  it('a personal account under its daily limit opens the chat — the same path as the contact button, in its own voice', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = UNDER_LIMIT
    profile()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(stash).toHaveBeenCalledTimes(1)
    // A person, never "we are hiring" on behalf of a school it is not.
    expect(stash.mock.calls[0][0]).toMatchObject({ listingId: 't1', listingTitle: 'Ms Lan', ...PERSON_PICK })
    expect(stash.mock.calls[0][0]).not.toHaveProperty('body')
    expect(push).toHaveBeenCalledWith('/messages/pending')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a personal account over its daily limit gets the ladder’s refusal under the contact button — nothing stashed, no chat', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    profile()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    await settle() // the tap re-asks before it refuses
    expect(scrolled.map((el) => el.id)).toEqual([TEACHER_CONTACT_ID])
    expect(screen.getByRole('status').textContent).toContain('You can start chats with up to 3 new teachers a day.')
    expect(stash).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('opens the chat for a business account — the same path as the contact button, speaking as the school', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = BUSINESS
    profile()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(stash.mock.calls[0][0]).toMatchObject(SCHOOL_PICK)
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

// ── The daily limit of NEW teachers (the DM ladder, owner 2026-10-13: 3 unverified, 10 identity-verified, 30 business) ──
describe('TeacherContact — the daily limit', () => {
  it('over the limit, the tap says so with the step that lifts it — nothing is stashed, no chat', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    // Asked once the account is known, about this teacher, never from a cache.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // …bounded at 8 s, so a dead connection never holds the buttons on "Opening chat…".
    expect(fetchMock).toHaveBeenCalledWith('/api/teachers/dm-quota?listingId=t1', { cache: 'no-store', signal: expect.any(AbortSignal) })
    expect(screen.queryByRole('status')).toBeNull() // nothing is said before the tap
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle() // the tap re-asks before it refuses
    expect(fetchMock).toHaveBeenCalledTimes(2) // ⛔ asked again on the tap — never a refusal from a stale answer
    expect(screen.getByText('You can start chats with up to 3 new teachers a day. Verify your identity to raise this to 10, or start more after midnight.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Verify your identity' }).getAttribute('href')).toBe('/dashboard/account/verify')
    expect(stash).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    // The button is not left spinning.
    expect(screen.getByRole('button', { name: 'Message teacher' })).toBeTruthy()
  })

  it('⛔ a stale refusal never blocks: the tap re-asks, and a fresh answer under the limit opens the chat', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    // Past the Vietnam midnight (or an identity check approved meanwhile): the server now allows a new chat.
    quotaAnswer = standing({ used: 0, remaining: 3 })
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).toBeNull()
    expect(stash).toHaveBeenCalledTimes(1)
    expect(stash.mock.calls[0][0]).toMatchObject(PERSON_PICK)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('⛔ a FAILED re-ask lets the server decide: the chat opens — never a refusal from the stale answer (pre-review, 2026-10-13)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    quotaAnswer = null // the re-ask fails (a network blip, a 5xx)
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).toBeNull()
    expect(stash).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('⛔ a refusal belongs to the account it was said to: signed out, it is gone (gate review, 2026-10-13)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    const { rerender } = render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle()
    expect(screen.getByRole('status')).toBeTruthy()
    Object.assign(auth, { user: null, identityLoaded: false, accountType: null })
    rerender(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    expect(screen.queryByRole('status')).toBeNull()
    // Another account signing in on the same page starts from its own answer, never the last one's refusal.
    Object.assign(auth, { user: { id: 'u2' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = UNDER_LIMIT
    rerender(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a teacher this account already writes to is never counted: at 0 left, the chat still opens', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = standing({ used: 3, remaining: 0, reason: 'limit', hasThread: true })
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(stash).toHaveBeenCalledTimes(1)
    expect(stash.mock.calls[0][0]).toMatchObject(PERSON_PICK)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('a writer who already has a thread with this teacher goes back INTO it — no chooser, nothing stashed (opus, gate 13c)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = { ...BUSINESS, hasThread: true, threadId: 'c9' }
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} cover />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about a cover lesson' }))
    expect(push).toHaveBeenCalledWith('/messages/c9')
    expect(stash).not.toHaveBeenCalled()
  })

  it('a failed ask changes nothing: the tap goes through and the server decides', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(stash).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('sends an already-onboarded personal account at its identity limit to the account-type switch, never to /onboard (which bounces it)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = standing({ tier: 'identity', limit: 10, used: 10, remaining: 0, next: 'switch_to_business', nextLimit: 30, reason: 'limit' })
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle() // the tap re-asks before it refuses
    expect(screen.getByText('You can start chats with up to 10 new teachers a day. A verified business account can start up to 30.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Switch to a business account' }).getAttribute('href')).toBe('/dashboard/settings?tab=account')
    expect(stash).not.toHaveBeenCalled()
  })

  it('an account that never chose a type is sent to set one up — the step reads the viewer’s own account type', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: null })
    quotaAnswer = standing({ tier: 'identity', limit: 10, used: 10, remaining: 0, next: 'switch_to_business', nextLimit: 30, reason: 'limit' })
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle() // the tap re-asks before it refuses
    expect(screen.getByRole('link', { name: 'Set up a business account' }).getAttribute('href')).toBe('/onboard')
  })

  it('in the iOS app with ios-hide-kyc on, the identity step is plain text naming the website — never a link', async () => {
    ios.hideKyc = true
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message teacher' }))
    await settle() // the tap re-asks before it refuses
    const said = screen.getByRole('status').textContent
    expect(said).toContain('You can start chats with up to 3 new teachers a day.')
    expect(said).toContain('Identity verification is available on our website, in a web browser:')
    expect(screen.queryByRole('link')).toBeNull()
    expect(stash).not.toHaveBeenCalled()
  })
})

describe('TeacherContact — cover lessons (2026-10-07)', () => {
  it('offers "Ask about a cover lesson" only on a cover teacher, and asks the chooser for the cover opener', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = BUSINESS
    const { unmount } = render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    expect(screen.queryByRole('button', { name: 'Ask about a cover lesson' })).toBeNull()
    unmount()
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} cover />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about a cover lesson' }))
    expect(stash.mock.calls[0][0]).toMatchObject({ pick: { voice: 'school', cover: true } })
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  // ⛔ A cover lesson is asked by a business only (cover work is lawful only for the employer holding the work permit).
  it.each([
    ['a personal account', false, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' }],
    ['an account that never chose a type', false, { user: { id: 'u1' }, identityLoaded: true, accountType: null }],
    ['a business account', true, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' }],
    ['a guest (they may be a school)', true, { user: null, identityLoaded: false, accountType: null }],
    ['an account still loading (it may be a school)', true, { user: { id: 'u1' }, identityLoaded: false, accountType: null }],
  ])('on a cover teacher, %s — cover button offered: %s', async (_, offered, who) => {
    Object.assign(auth, who)
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} cover />)
    await settle()
    expect(!!screen.queryByRole('button', { name: 'Ask about a cover lesson' })).toBe(offered)
    expect(screen.getByRole('button', { name: 'Message teacher' })).toBeTruthy()
  })
})

describe('TeacherContactJump on a cover teacher', () => {
  it('only brings the school to the two openers — it never sends the hiring opener for them', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = BUSINESS
    render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(scrolled.map((el) => el.id)).toEqual([TEACHER_CONTACT_ID])
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ask about a cover lesson' })).toBeTruthy()
  })

  it('a personal account has one opener there, so the jump starts it — in its own voice', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = UNDER_LIMIT
    render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Message' }))
    expect(stash.mock.calls[0][0]).toMatchObject(PERSON_PICK)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })
})
