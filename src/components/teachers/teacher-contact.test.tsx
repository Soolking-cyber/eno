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

import { TEACHER_CONTACT_ID, TeacherContact, TeacherContactJump, TeacherCoverAsk } from './teacher-contact'

/**
 * The block's "Message teacher" BUTTON (from lg). Since 2026-11-14 (owner-approved, cook r04 teachers) its twin is the counsel
 * panel's link below lg — the same handler and label; CSS shows one per width, and jsdom has no CSS, so both are here.
 */
const messageButton = () => screen.getAllByRole('button', { name: 'Message teacher' }).find((b) => b.getAttribute('data-teacher-message') === 'button')!
/** The block's live region — always mounted since 2026-11-14 (a refusal can start from the cover ask under the week). */
const said = () => screen.getByRole('status').textContent

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

describe('TeacherContactJump — "Contact teacher" beside the name', () => {
  it('scrolls to the contact block and asks a guest to sign in: "Sign in to message teachers."', () => {
    profile()
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    expect(stash).toHaveBeenCalledTimes(1)
    // A person, never "we are hiring" on behalf of a school it is not.
    expect(stash.mock.calls[0][0]).toMatchObject({ listingId: 't1', listingTitle: 'Ms Lan', ...PERSON_PICK })
    expect(stash.mock.calls[0][0]).not.toHaveProperty('body')
    expect(push).toHaveBeenCalledWith('/messages/pending')
    expect(said()).toBe('')
  })

  it('a personal account over its daily limit gets the ladder’s refusal under the contact button — nothing stashed, no chat', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    profile()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
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
    expect(said()).toBe('') // nothing is said before the tap
    fireEvent.click(messageButton())
    await settle() // the tap re-asks before it refuses
    expect(fetchMock).toHaveBeenCalledTimes(2) // ⛔ asked again on the tap — never a refusal from a stale answer
    expect(screen.getByText('You can start chats with up to 3 new teachers a day. Verify your identity to raise this to 10, or start more after midnight.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Verify your identity' }).getAttribute('href')).toBe('/dashboard/account/verify')
    expect(stash).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    // The button is not left spinning.
    expect(messageButton()).toBeTruthy()
  })

  it('⛔ a stale refusal never blocks: the tap re-asks, and a fresh answer under the limit opens the chat', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    // Past the Vietnam midnight (or an identity check approved meanwhile): the server now allows a new chat.
    quotaAnswer = standing({ used: 0, remaining: 3 })
    fireEvent.click(messageButton())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(said()).toBe('')
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
    fireEvent.click(messageButton())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(said()).toBe('')
    expect(stash).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('⛔ a refusal belongs to the account it was said to: signed out, it is gone (gate review, 2026-10-13)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    const { rerender } = render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(messageButton())
    await settle()
    expect(said()).not.toBe('')
    Object.assign(auth, { user: null, identityLoaded: false, accountType: null })
    rerender(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    expect(said()).toBe('')
    // Another account signing in on the same page starts from its own answer, never the last one's refusal.
    Object.assign(auth, { user: { id: 'u2' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = UNDER_LIMIT
    rerender(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    expect(said()).toBe('')
  })

  it('a teacher this account already writes to is never counted: at 0 left, the chat still opens', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = standing({ used: 3, remaining: 0, reason: 'limit', hasThread: true })
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(messageButton())
    expect(said()).toBe('')
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
    fireEvent.click(messageButton())
    expect(said()).toBe('')
    expect(stash).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('sends an already-onboarded personal account at its identity limit to the account-type switch, never to /onboard (which bounces it)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = standing({ tier: 'identity', limit: 10, used: 10, remaining: 0, next: 'switch_to_business', nextLimit: 30, reason: 'limit' })
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(messageButton())
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
    fireEvent.click(messageButton())
    await settle() // the tap re-asks before it refuses
    expect(screen.getByRole('link', { name: 'Set up a business account' }).getAttribute('href')).toBe('/onboard')
  })

  it('in the iOS app with ios-hide-kyc on, the identity step is plain text naming the website — never a link', async () => {
    ios.hideKyc = true
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = OVER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    fireEvent.click(messageButton())
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
    expect(messageButton()).toBeTruthy()
  })
})

describe('TeacherContactJump on a cover teacher (best-practice gap 2026-11-10: the first button starts the message)', () => {
  // Nothing is sent from here (owner, 2026-10-21): the chooser shows the openers, so the jump opens it for a school too.
  it('a school gets the chooser with the cover-lesson opener among its chips — nothing sent, the page scrolled there', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = BUSINESS
    render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    expect(scrolled.map((el) => el.id)).toEqual([TEACHER_CONTACT_ID])
    expect(stash).toHaveBeenCalledTimes(1)
    expect(stash.mock.calls[0][0]).toMatchObject({ pick: { voice: 'school', cover: true } })
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('a school that taps before its account type has loaded still gets the cover opener when the replay runs (review)', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: false, accountType: null })
    quotaAnswer = BUSINESS
    const view = render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    expect(stash).not.toHaveBeenCalled() // queued until the account type is known
    Object.assign(auth, { identityLoaded: true, accountType: 'business' })
    view.rerender(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    expect(stash.mock.calls[0][0]).toMatchObject({ pick: { voice: 'school', cover: true } })
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('…and a personal account that taps while loading gets the job openers, never the cover one', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: false, accountType: null })
    quotaAnswer = UNDER_LIMIT
    const view = render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    Object.assign(auth, { identityLoaded: true, accountType: 'individual' })
    view.rerender(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    expect(stash.mock.calls[0][0]).toMatchObject(PERSON_PICK)
  })

  it('a guest is asked to sign in "about a teaching job" — never "a cover lesson": they may be a parent', () => {
    render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(auth.openSignIn.mock.calls[0][0]).toMatchObject({ listingTitle: 'a teaching job' })
    expect(stash).not.toHaveBeenCalled()
  })

  it('a school over its daily limit gets the refusal where it lands — nothing stashed', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = standing({ tier: 'business', limit: 30, used: 30, remaining: 0, reason: 'limit', next: 'tomorrow', nextLimit: null })
    render(
      <>
        <TeacherContactJump listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    await settle()
    expect(stash).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(said()).not.toBe('')
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
    fireEvent.click(screen.getByRole('button', { name: 'Contact teacher' }))
    expect(stash.mock.calls[0][0]).toMatchObject(PERSON_PICK)
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })
})

/**
 * ONE PRIMARY IN VIEW ON A PHONE (owner-approved 2026-11-14, cook r04 teachers): below lg the block is the counsel panel — the
 * page's identity sentence (`counsel`), the note — and the cover ask is a link under the week (TeacherCoverAsk), a remote that
 * runs THIS block's action with the cover opener and mirrors its busy state. Since build 7 (owner-approved 2026-11-15, cook r07
 * teachers) each counsel line leads with its glyph (below lg) and "Message teacher" is the panel's full-width filled button.
 */
describe('the counsel panel and the cover ask under the week (cook r04)', () => {
  it('two "Message teacher" controls, one per width: the desktop button (max-lg:hidden) and the panel\'s full-width filled button (lg:hidden) — both start the chat', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    quotaAnswer = UNDER_LIMIT
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    await settle()
    const [button, panel] = screen.getAllByRole('button', { name: 'Message teacher' })
    expect(button.getAttribute('data-teacher-message')).toBe('button')
    expect(button.className.split(' ')).toContain('max-lg:hidden')
    expect(panel.getAttribute('data-teacher-message')).toBe('panel')
    // The brand cta at full width (ui/button: 48px with a 16px label on a phone), 16px under the note, phones and tablets only.
    expect(panel.className.split(' ')).toEqual(expect.arrayContaining(['bg-primary', 'text-white', 'font-bold', 'w-full', 'max-sm:min-h-12', 'max-sm:text-base', 'max-lg:mt-4', 'lg:hidden']))
    expect(panel.querySelector('svg')).toBeNull() // no chevron: it is a button now, not a link
    fireEvent.click(panel)
    expect(stash).toHaveBeenCalledTimes(1)
    expect(stash.mock.calls[0][0]).toMatchObject(PERSON_PICK)
  })

  it('the counsel opens the panel (below lg only) behind the success shield, then the note behind a lock, then the button — every word kept', () => {
    const COUNSEL = 'eno checked this teacher’s ID.'
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} counsel={<span>{COUNSEL}</span>} />)
    const line = screen.getByText('eno checked this teacher’s ID.').closest('[data-counsel-line]') as HTMLElement
    expect(line.getAttribute('data-counsel-line')).toBe('checked')
    expect(line.className).toBe('flex gap-3 text-sm text-body lg:hidden')
    const shield = line.firstElementChild!
    expect(shield.tagName.toLowerCase()).toBe('svg')
    expect(shield.getAttribute('aria-hidden')).toBe('true')
    expect(shield.getAttribute('class')).toMatch(/\bsize-5\b.*\btext-success\b/)
    const panel = line.parentElement!
    expect(panel.className).toBe('space-y-3 max-lg:rounded-xl max-lg:bg-tint max-lg:p-4')
    const kids = [...panel.children]
    expect(kids[0]).toBe(line)
    expect(kids[1].getAttribute('data-counsel-line')).toBe('contact')
    expect(kids[1].textContent).toContain('shared with you only if they choose to')
    // The lock is a phone/tablet glyph only: from lg the note reads as it did.
    const lock = kids[1].firstElementChild!
    expect(lock.tagName.toLowerCase()).toBe('svg')
    expect(lock.getAttribute('class')).toMatch(/\bsize-5\b.*\blg:hidden\b/)
    expect(kids[2].getAttribute('data-teacher-message')).toBe('panel')
  })

  it('no counsel: the panel holds the note and the button only', () => {
    render(<TeacherContact listingId="t1" name="Ms Lan" image={null} />)
    const panelButton = screen.getAllByRole('button', { name: 'Message teacher' })[1]
    expect(panelButton.parentElement!.children).toHaveLength(2)
  })

  it('the cover ask asks the block for the COVER opener — a school gets the chooser with it', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = BUSINESS
    render(
      <>
        <TeacherCoverAsk listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    const ask = screen.getAllByRole('button', { name: /Ask about a cover lesson/ }).find((b) => b.hasAttribute('data-teacher-cover-ask'))!
    fireEvent.click(ask)
    expect(scrolled.map((el) => el.id)).toEqual([TEACHER_CONTACT_ID])
    expect(stash).toHaveBeenCalledTimes(1)
    expect(stash.mock.calls[0][0]).toMatchObject({ pick: { voice: 'school', cover: true } })
    expect(push).toHaveBeenCalledWith('/messages/pending')
  })

  it('a guest who taps it is asked to sign in about "a cover lesson" (they chose the cover ask)', () => {
    render(
      <>
        <TeacherCoverAsk listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /Ask about a cover lesson/ }).find((b) => b.hasAttribute('data-teacher-cover-ask'))!)
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
    expect(auth.openSignIn.mock.calls[0][0]).toMatchObject({ listingTitle: 'a cover lesson' })
  })

  it('⛔ a personal account: the ask keeps its box but turns invisible (nothing under it moves) — and the block offers no cover cta', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'individual' })
    render(
      <>
        <TeacherCoverAsk listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    const ask = document.querySelector('[data-teacher-cover-ask]')!
    expect(ask).toBeTruthy()
    expect(ask.className.split(' ')).toContain('invisible')
    expect(document.querySelectorAll('button').length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button', { name: /Ask about a cover lesson/ }).filter((b) => !b.hasAttribute('data-teacher-cover-ask'))).toHaveLength(0)
  })

  it('a guest or a school sees it (no `invisible`), and a still-loading account too — the same rule as the block (useOfferCover)', async () => {
    for (const who of [{ user: null, identityLoaded: false, accountType: null }, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' }, { user: { id: 'u1' }, identityLoaded: false, accountType: null }]) {
      Object.assign(auth, who)
      render(<TeacherCoverAsk listingId="t1" />)
      expect(document.querySelector('[data-teacher-cover-ask]')!.className.split(' ')).not.toContain('invisible')
      cleanup()
    }
  })

  it('mirrors the block\'s busy state: "Opening chat…" and disabled while the block opens the cover chat, then idle again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
      render(
        <>
          <TeacherCoverAsk listingId="t1" />
          <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
        </>,
      )
      const ask = () => document.querySelector('[data-teacher-cover-ask]') as HTMLButtonElement
      expect(ask().textContent).toBe('Ask about a cover lesson')
      expect(ask().disabled).toBe(false)
      act(() => { fireEvent.click(ask()) })
      expect(ask().textContent).toBe('Opening chat…')
      expect(ask().disabled).toBe(true)
      act(() => { vi.advanceTimersByTime(8000) }) // the block's backstop releases it
      expect(ask().textContent).toBe('Ask about a cover lesson')
      expect(ask().disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the busy mirror is per listing, idle with no block mounted, and taken back when the block unmounts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
      const view = render(
        <>
          <TeacherCoverAsk listingId="other" />
          <TeacherCoverAsk listingId="t1" />
          <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
        </>,
      )
      const [other, mine] = [...document.querySelectorAll('[data-teacher-cover-ask]')] as HTMLButtonElement[]
      act(() => { fireEvent.click(mine) })
      expect(mine.disabled).toBe(true)
      expect(other.disabled).toBe(false)
      view.rerender(
        <>
          <TeacherCoverAsk listingId="other" />
          <TeacherCoverAsk listingId="t1" />
        </>,
      )
      expect((document.querySelectorAll('[data-teacher-cover-ask]')[1] as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the live region is in the page before anything is said, and a refusal started from the cover ask lands in it', async () => {
    Object.assign(auth, { user: { id: 'u1' }, identityLoaded: true, accountType: 'business' })
    quotaAnswer = standing({ tier: 'business', limit: 30, used: 30, remaining: 0, reason: 'limit', next: 'tomorrow', nextLimit: null })
    render(
      <>
        <TeacherCoverAsk listingId="t1" />
        <TeacherContact listingId="t1" name="Ms Lan" image={null} cover />
      </>,
    )
    await settle()
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')
    expect(region.className).toBe('empty:-mt-2')
    fireEvent.click(document.querySelector('[data-teacher-cover-ask]')!)
    await settle()
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).not.toBe('')
    expect(stash).not.toHaveBeenCalled()
  })
})
