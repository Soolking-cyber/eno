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

const auth = vi.hoisted(() => ({
  user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn(),
  // An onboarded account by default; the "new account" cases below clear it.
  accountType: 'individual' as string | null, identityLoaded: true, markOnboarded: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => <div data-testid="push-card" /> }))
// App Store gate `ios-hide-kyc` — off (the web) unless a test turns it on.
const ios = vi.hoisted(() => ({ on: false }))
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => ios.on }))

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
// GET /api/teachers/me's "Identity verified" state for an account with no profile yet (identity-mark.ts: no name to judge)
// — not known (null, no line) unless a test says otherwise.
let markState: { shown: boolean; reason: string | null } | null = null

beforeEach(() => {
  stubBrowser()
  auth.user = { id: 'u1' }
  auth.accountType = 'individual'
  auth.identityLoaded = true
  auth.markOnboarded = vi.fn()
  history.replaceState(null, '', '/teachers/join')
  gate = { ok: true, code: null }
  markState = null
  ios.on = false
  putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } })
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: gate, prefill: { displayName: 'Bea Smith', avatarUrl: PHOTO, phone: '+84901234567' }, identityMark: markState, identityMarkStamps: { at: null, withdrawnAt: null } } }),
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
    expect(desc).toMatch(/Anyone can see your profile: schools, other members and search engines/)
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
    putDraft({ ...COMPLETE, jobTypes: [], relocate: '', coverSlots: ['mon-am'], coverRateVnd: 300_000 }, 'finish')
    const user = mount()
    // A draft holds no cover switch (forDraft), and a cover-only profile needs it: it reopens on Cover, where it is given
    // again — never past the first step that fails (draftResumeStep, 2026-10-11).
    const sw = await screen.findByRole('switch', { name: 'Available for cover lessons' })
    await user.click(sw)
    await user.click(action('Next'))
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
    // The opt-in mark, informational (plan review Q3: its own switch and notice — PUBLISH_NOTICE_VERSION does not cover it).
    // ⛔ The mark is NOT in this list (commit gate, 2026-10-16): the list is the text PUBLISH_NOTICE_VERSION stands for, and
    // the mark has its own switch and notice beside it — adding it here would change the publish consent without a bump.
    expect(screen.getAllByRole('listitem').some((li) => /Identity verified/.test(li.textContent ?? ''))).toBe(false)
  })

  it('⛔ iOS (`ios-hide-kyc`): the identity check at the top names the website — never a "Verify my identity" link', async () => {
    ios.on = true
    gate = { ok: false, code: 'identity_unverified' }
    putDraft(COMPLETE, 'finish')
    mount()
    expect(await screen.findByText(/Vietnamese law requires sellers to verify their identity/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Verify my identity' })).toBeNull()
    expect(screen.getAllByText(/Identity verification is available on our website, in a web browser:/).length).toBeGreaterThan(0)
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

// ── A new account signs in on this form and is NOT sent to /onboard (onboarding-gate.ts resumesInPlace) — so its first
// Publish is the assent, under the Terms line, and the SERVER records the account step (api/teachers/me PUT) — owner,
// 2026-10-11; commit gate: never from the browser, never skipped while the identity loads. ────────────────────────────
describe('Publish for an account that has not chosen its type yet', () => {
  const putBodies = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body as Record<string, unknown>)

  it('⛔ the line above Publish names the three documents, and the save carries acceptTerms — no browser-side account call', async () => {
    auth.accountType = null
    putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null, onboarded: true } })
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const terms = (await screen.findAllByTestId('publish-terms'))[0]
    expect(terms.textContent).toBe('By publishing you agree to our Terms of Service, Operating regulations and Privacy Policy.')
    await user.click(screen.getByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()!.acceptTerms).toBe(true)
    expect(calls.some((c) => c.url === '/api/profile/account-type')).toBe(false)
    // the server said it recorded the step: the session learns it, so the gate never sends this account to /onboard
    await waitFor(() => expect(auth.markOnboarded).toHaveBeenCalledWith('individual'))
  })

  it('⛔ while the identity is still loading: no line, so no acceptTerms — the server refuses (terms_required), the line appears, and the next Publish under it goes through', async () => {
    auth.accountType = null
    auth.identityLoaded = false
    let first = true
    putReply = () => {
      if (first) { first = false; return { status: 409, json: { error: 'terms_required' } } }
      return { json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null, onboarded: true } }
    }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    expect(screen.queryAllByTestId('publish-terms')).toHaveLength(0)
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Please read the line below, then tap Publish again.')).toBeTruthy()
    expect(screen.getAllByTestId('publish-terms').length).toBeGreaterThan(0)
    expect(putBodies()[0].acceptTerms).toBeUndefined()
    await user.click(action('Publish profile'))
    await waitFor(() => expect(putBodies()).toHaveLength(2))
    expect(putBodies()[1].acceptTerms).toBe(true)
  })

  it('an onboarded account sees no Terms line and sends no acceptTerms', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    expect(screen.queryAllByTestId('publish-terms')).toHaveLength(0)
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    expect(lastPut()!.acceptTerms).toBeUndefined()
    expect(auth.markOnboarded).not.toHaveBeenCalled()
  })
})

describe('sharing the profile (owner, 2026-10-11: "easy to share on facebook and zalo or whatsapp")', () => {
  it('the done screen offers the public page on Zalo, WhatsApp and Facebook', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    const share = within(screen.getByRole('region', { name: 'Share your profile' }))
    // this edition's own host (the env, else the form's apexOrigin) — the page's canonical
    const page = encodeURIComponent(`${(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').replace(/\/+$/, '')}/listings/L1`)
    await user.click(share.getByRole('button', { name: 'Zalo' }))
    await user.click(share.getByRole('button', { name: 'WhatsApp' }))
    await user.click(share.getByRole('button', { name: 'Facebook' }))
    const urls = open.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toBe(`https://sp.zalo.me/plugins/share?url=${page}`)
    expect(urls[1]).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(urls[1]).toContain(page)
    expect(urls[2]).toBe(`https://www.facebook.com/sharer/sharer.php?u=${page}`)
  })

  it('a profile saved but not visible to schools is not offered for sharing', async () => {
    putReply = () => ({ json: { listingId: 'L1', teacherProfileId: 'tp1', live: false, noGoal: false, cover: null, video: null } })
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Share your profile' })).toBeNull()
  })
})

// "IDENTITY VERIFIED" ON A NEW PROFILE (owner, 2026-10-15; plan review R2): the switch has its own endpoint, which needs a
// profile — so before the first Publish it is shown with its notice and its line, DISABLED, and says when it can be
// switched on; nothing is sent, and Publish carries none of it. Once published, an account whose identity check is
// already live is pointed at it (Edit › Photo & publish) — never one that has yet to verify.
describe('the "Identity verified" switch on a NEW profile', () => {
  const MARK_NAME = 'Show “Identity verified” on my profile'
  it('shown with its notice and line, disabled, saying when — and a tap sends nothing', async () => {
    markState = { shown: false, reason: 'unverified' }
    putDraft(COMPLETE, 'finish')
    const user = mount()
    const sw = await screen.findByRole('switch', { name: MARK_NAME })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('identity-mark-note').textContent).toMatch(/^Off unless you switch it on\./)
    expect(screen.getByText('You can switch this on after you publish your profile.')).toBeTruthy()
    // The account has not verified yet: the line says so, with the way there.
    expect(screen.getByText(/^Verify your identity first/)).toBeTruthy()
    await user.click(sw).catch(() => {})
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(calls.some((c) => c.url.startsWith('/api/teachers/me/identity-mark'))).toBe(false)
  })

  it('⛔ Publish never carries the switch or its notice', async () => {
    putDraft(COMPLETE, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    await waitFor(() => expect(lastPut()).toBeTruthy())
    for (const k of Object.keys(lastPut()!)) expect(k, k).not.toMatch(/identity/i)
  })

  it('published with a LIVE identity check: the done screen points at the switch; still to verify: it does not', async () => {
    markState = { shown: false, reason: 'off' }
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    let user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(screen.getByRole('link', { name: MARK_NAME }).getAttribute('href')).toBe('/teachers/edit?step=finish')
    cleanup()
    markState = { shown: false, reason: 'unverified' }
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect(screen.queryByRole('link', { name: MARK_NAME })).toBeNull()
  })

  // Commit gate, 2026-10-16: the state read on load had no profile to judge (no name → not known), so the pointer can only
  // come from a re-read AFTER the first publish — the hand-set state above never exercised that.
  it('a FIRST publish re-reads the mark: unknown before the profile existed, the pointer once the server can judge it', async () => {
    markState = null
    putReply = () => {
      markState = { shown: false, reason: 'off' }
      return { json: { listingId: 'L1', teacherProfileId: 'tp1', live: true, noGoal: false, cover: null, video: null } }
    }
    putDraft({ ...COMPLETE, photoUrl: null }, 'finish')
    const user = mount()
    await user.click(await screen.findByRole('button', { name: 'Use my account photo' }))
    await user.click(action('Publish profile'))
    expect(await screen.findByText('Your profile is live')).toBeTruthy()
    expect((await screen.findByRole('link', { name: MARK_NAME })).getAttribute('href')).toBe('/teachers/edit?step=finish')
    const putAt = calls.findIndex((c) => c.method === 'PUT')
    expect(calls.slice(putAt + 1).some((c) => c.method === 'GET')).toBe(true)
  })
})
