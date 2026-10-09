// @vitest-environment jsdom
/**
 * STEPS 5–6 AND PUBLISH (teacher onboarding redesign, 2026-10-08) — each consent is ONE act with its notice beside it:
 *   · the cover switch IS the consent (no tick box); the reach is a read-only line;
 *   · the two opt-ins are LABELLED switches, OFF by default, job seekers only, with one AI note naming Anthropic;
 *   · the phone is required only while staff may call;
 *   · Publish is the consent: the action bar says what goes public, "What's public?" lists it, and the save carries the
 *     notice versions the contract checks (publishNotice always; coverNotice with cover on; aiNotice with an opt-in on).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { AI_NOTICE_VERSION, PUBLISH_NOTICE_VERSION } from '@/lib/teachers/profile'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'
import { COMPLETE, fakeFetch, putDraft, stubBrowser, type Call } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => <div data-testid="push-card" /> }))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/me.webp'
let calls: Call[] = []
let putReply: (body: unknown) => { status?: number; json: unknown } = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } })
let gate: { ok: boolean; code: string | null } = { ok: true, code: null }

beforeEach(() => {
  stubBrowser()
  auth.user = { id: 'u1' }
  history.replaceState(null, '', '/teachers/join')
  gate = { ok: true, code: null }
  putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } })
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: gate, prefill: { displayName: 'Bea Smith', avatarUrl: PHOTO, phone: '+84901234567' } } }),
    'PUT /api/teachers/me': (b) => putReply(b),
  })
  calls = f.calls
  vi.stubGlobal('fetch', f.fn)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount() {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main>
    </LanguageProvider>,
  )
  return userEvent.setup()
}
const action = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const lastPut = () => calls.filter((c) => c.method === 'PUT').at(-1)?.body as Record<string, unknown> | undefined

describe('step 5 · Cover lessons', () => {
  it('the switch IS the consent — no tick box — with its notice beside it; on, it shows where schools find the teacher', async () => {
    putDraft({ ...COMPLETE, teachAreas: ['d7', 'd4'] }, 'cover')
    const user = mount()
    const sw = await screen.findByRole('switch', { name: 'Available for cover lessons' })
    // The notice is the switch's DESCRIPTION, read with it — and not part of its name.
    const desc = (sw.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(desc).toMatch(/public profile, where schools and search engines can see them/)
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    // In the stored (canonical) order, whatever order they were picked in.
    expect(screen.getByTestId('cover-reach').textContent).toBe('District 4 · District 7 (Phu My Hung)')
  })

  it('the reach never names a relocation city or Online, and "All of HCMC" carries the tip to narrow it', async () => {
    putDraft({ ...COMPLETE, relocate: 'some', teachAreas: ['online', 'ho-chi-minh-city', 'ha-noi'] }, 'cover')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: 'Available for cover lessons' }))
    expect(screen.getByTestId('cover-reach').textContent).toBe('Ho Chi Minh City')
    expect(screen.getByText(/Tip: schools look for cover by district/)).toBeTruthy()
  })

  it('with the work question left empty, cover must be switched on (goal_required)', async () => {
    putDraft({ ...COMPLETE, jobTypes: [], relocate: '' }, 'cover')
    const user = mount()
    expect(await screen.findByRole('switch', { name: 'Available for cover lessons' })).toBeTruthy()
    await user.click(action('Next'))
    expect(await screen.findByText(/Switch on cover lessons — or go back to step 1/)).toBeTruthy()
  })
})

describe('step 6 · Photo & publish', () => {
  it('job seekers get the two opt-ins as LABELLED switches, OFF by default, with ONE AI note naming Anthropic and the transfer abroad', async () => {
    putDraft(COMPLETE, 'finish')
    mount()
    const email = await screen.findByRole('switch', { name: 'Email me jobs that match my profile' })
    const calls_ = screen.getByRole('switch', { name: 'Our staff may call me' })
    expect(email.getAttribute('aria-checked')).toBe('false')
    expect(calls_.getAttribute('aria-checked')).toBe('false')
    const notes = screen.getAllByTestId('ai-note')
    expect(notes).toHaveLength(1)
    // WP5's wording, word for word (it matches what the matcher's export sends).
    expect(notes[0].textContent).toBe("If you switch on either option above, an AI model — Anthropic's Claude, which processes data outside Vietnam — compares your profile with teaching jobs. It receives your headline and about text (with your name taken out), your nationality and whether you are a native speaker, the city you live in and the cities you can teach in, subjects, age groups, job types, years of experience, degree, certificate types, expected salary and start date. It never receives your name, photo, video, phone, email or CV. See our Privacy Policy.")
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('a teacher with no job goal (cover only) is asked neither opt-in', async () => {
    putDraft({ ...COMPLETE, jobTypes: [], relocate: '' }, 'finish')
    mount()
    expect(await screen.findByText('Profile photo')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Email me jobs that match my profile' })).toBeNull()
    expect(screen.queryByTestId('ai-note')).toBeNull()
  })

  it('the phone is optional — until "Our staff may call me" is on', async () => {
    putDraft({ ...COMPLETE, photoUrl: PHOTO }, 'finish')
    const user = mount()
    expect(await screen.findByRole('textbox', { name: 'Phone number (optional)' })).toBeTruthy()
    await user.click(screen.getByRole('switch', { name: 'Our staff may call me' }))
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText(/Please add your phone number/)).toBeTruthy()
    expect(lastPut()).toBeUndefined()
  })

  it('⛔ a picked CV can be let go before Publish — back to none, and nothing is uploaded (gate review, 2026-10-08)', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const cv = within((await screen.findByText('CV (optional)')).closest('section')!)
    await user.upload(document.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]')!, new File(['%PDF-1.4'], 'my-cv.pdf', { type: 'application/pdf' }))
    expect(cv.getByText('my-cv.pdf')).toBeTruthy()
    await user.click(cv.getByRole('button', { name: 'Remove' }))
    expect(cv.queryByText('my-cv.pdf')).toBeNull()
    expect(cv.getByText('Choose PDF')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(calls.some((c) => c.url.startsWith('/api/teachers/me/cv'))).toBe(false)
  })

  it('the account photo and phone are OFFERED, never filled in unasked', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    expect(await screen.findByRole('button', { name: 'Use my account photo' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Phone number (optional)' }) as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: /Use my number/ }))
    expect((screen.getByRole('textbox', { name: 'Phone number (optional)' }) as HTMLInputElement).value).toBe('+84901234567')
  })

  it('an identity check the account still needs shows at the TOP of the step, not as a refusal at the last tap', async () => {
    gate = { ok: false, code: 'identity_unverified' }
    putDraft(COMPLETE, 'finish')
    mount()
    expect(await screen.findByText(/Vietnamese law requires sellers to verify their identity/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Verify my identity' }).getAttribute('href')).toBe('/dashboard/account/verify')
  })

  it('the Publish notice rides the action bar, and "What’s public?" lists every public field and what never is', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const note = (await screen.findAllByTestId('publish-notice'))[0]
    expect(note.textContent).toMatch(/everything except your phone, email, CV and a private video/)
    await user.click(screen.getAllByRole('button', { name: 'What’s public?' })[0])
    expect(await screen.findByText('Never public')).toBeTruthy()
    expect(screen.getByText(/Cover lessons — your free periods, hourly rate and where schools find you — only while cover is on/)).toBeTruthy()
  })

  it('no notice under the earlier steps of a NEW profile — only beside Publish', async () => {
    putDraft(COMPLETE, 'teaching')
    mount()
    expect(await screen.findByText('What do you teach?')).toBeTruthy()
    expect(screen.queryByTestId('publish-notice')).toBeNull()
  })
})

describe('Publish', () => {
  it('sends the notices it showed: publishNotice; coverNotice with cover on; aiNotice with an opt-in on — and never cover areas', async () => {
    putDraft({ ...COMPLETE, teachAreas: ['d7'] }, 'cover')
    const user = mount()
    await user.click(await screen.findByRole('switch', { name: 'Available for cover lessons' }))
    await user.click(screen.getByRole('button', { name: 'Monday evening' }))
    await user.click(screen.getByRole('button', { name: /300,000/ }))
    await user.click(action('Next'))
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(screen.getByRole('switch', { name: 'Email me jobs that match my profile' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    const body = lastPut()!
    expect(body).toMatchObject({
      publishNotice: PUBLISH_NOTICE_VERSION, coverNotice: COVER_CONSENT_VERSION, aiNotice: AI_NOTICE_VERSION,
      coverOpen: true, coverConsent: true, coverSlots: ['mon-eve'], coverRateVnd: 300_000,
      matchEmailOptIn: true, staffContactOptIn: false, photoUrl: PHOTO, teachAreas: ['d7'], teachAreasConfirmed: true,
      teacherProfileId: null, coverBase: null, videoBase: null,
    })
    expect('coverAreas' in body).toBe(false)
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(screen.getByTestId('push-card')).toBeTruthy() // cover is on: the push prompt is worth asking
  })

  it('without cover and without an opt-in, neither notice is sent — publishNotice always is', async () => {
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    const body = lastPut()!
    expect(body.publishNotice).toBe(PUBLISH_NOTICE_VERSION)
    expect('coverNotice' in body).toBe(false)
    expect('aiNotice' in body).toBe(false)
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(screen.queryByTestId('push-card')).toBeNull() // no cover: no push prompt
    expect(screen.getByRole('link', { name: 'Add an intro video' }).getAttribute('href')).toBe('/teachers/edit?step=finish')
    // The chat's Share button by the name the teacher will see: no phone on file → "Share my email & CV" (WP3, A3).
    expect(screen.getByText(/“Share my email & CV”/)).toBeTruthy()
  })

  it('with a phone on file, the done screen names the button "Share my phone, email & CV"', async () => {
    putDraft({ ...COMPLETE, phone: '+84901234567' }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText(/“Share my phone, email & CV”/)).toBeTruthy()
  })

  it('a text the server refuses sends the teacher to THAT field, named by the server (never the word)', async () => {
    putReply = () => ({ status: 422, json: { error: 'contact_in_text', detail: 'bio' } })
    putDraft({ ...COMPLETE, bio: 'call me' }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByRole('textbox', { name: 'About you (optional)' })).toBeTruthy()
    expect(screen.getAllByText(/Please remove phone numbers, emails and links/).length).toBeGreaterThan(0)
  })
})
