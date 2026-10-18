// @vitest-environment jsdom
/**
 * THE INTRO VIDEO'S FIVE MINUTES, IN THE FORM (owner, 2026-10-18: "the teacher profile video is at 1 minute now make it 5
 * but the size limit stays the same"). The step states five minutes; the upload names its kind, so the server keeps five
 * minutes of it, not a listing's one; while it runs the page asks to stay open (a long video takes minutes to shrink and
 * send, and a page left loses it); and a clip the server found over five minutes says so — the length message, not
 * "upload failed".
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, getConfig, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { COMPLETE, fakeFetch, putDraft, stubBrowser } from './teacher-form.fixtures'

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as null | { id: string }, loading: false, openSignIn: vi.fn(), accountType: 'individual' as string | null, identityLoaded: true, markOnboarded: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/marketplace/push-opt-in-card', () => ({ PushOptInCard: () => <div data-testid="push-card" /> }))
vi.mock('@/hooks/use-ios-hide-kyc', () => ({ useIosHideKyc: () => false }))
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f }))
vi.mock('@/lib/teachers/video-prep', () => ({ prepareTeacherVideo: async (file: File) => ({ file, hevc: false }) }))
const up = vi.hoisted(() => ({ opts: [] as unknown[], next: null as null | (() => Promise<string | null>) }))
vi.mock('@/lib/video-upload-client', () => ({
  uploadListingVideo: async (_f: File, opts: unknown) => { up.opts.push(opts); return up.next ? up.next() : 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-efgh34.mp4' },
}))

import { TeacherForm } from './teacher-form'

const asyncUtilTimeout = getConfig().asyncUtilTimeout
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 60_000 })
afterAll(() => { configure({ asyncUtilTimeout }); vi.resetConfig() })
beforeAll(() => { Element.prototype.scrollIntoView ??= function () {} })

const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/me.webp'
const KEEP_OPEN = 'Keep this page open until it’s done — a long video can take a few minutes.'
beforeEach(() => {
  stubBrowser()
  up.opts = []; up.next = null
  history.replaceState(null, '', '/teachers/join')
  const f = fakeFetch({
    'GET /api/teachers/me': () => ({ json: { teacher: null, publishGate: { ok: true, code: null }, prefill: { displayName: 'Bea Smith', avatarUrl: PHOTO, phone: '+84901234567' }, identityMark: null, identityMarkHidden: false, identityMarkStamps: { at: null, withdrawnAt: null } } }),
  })
  vi.stubGlobal('fetch', f.fn)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function pick() {
  putDraft(COMPLETE, 'finish')
  render(<LanguageProvider initialLang="en" initialViDict={{}}><main><TeacherForm mode="join" draftHost={false} apexOrigin="https://eno.vn" /></main></LanguageProvider>)
  const user = userEvent.setup()
  await waitFor(() => expect(document.querySelector(`img[src="${PHOTO}"]`)).toBeTruthy())
  await user.upload(document.querySelector<HTMLInputElement>('input[accept="video/mp4,video/quicktime,video/webm"]')!, new File(['v'], 'hello.mp4', { type: 'video/mp4' }))
}

describe('the intro video — five minutes', () => {
  it('the step says five minutes; the upload names its kind; the page asks to stay open while it runs, and stops asking after', async () => {
    let finish!: (url: string) => void
    up.next = () => new Promise((resolve) => { finish = resolve })
    await pick()
    expect(screen.getByText('Up to 5 minutes: say hello and show how you teach.')).toBeTruthy()
    const status = await screen.findByText(KEEP_OPEN)
    expect(status.getAttribute('role')).toBe('status')
    expect(up.opts).toEqual([{ hevc: false, kind: 'teacher_intro' }])
    finish('https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000002-ijkl56.mp4')
    await screen.findByText('Replace video')
    expect(screen.queryByText(KEEP_OPEN)).toBeNull()
  })

  it('⛔ a clip the server found over five minutes shows the length message — not "upload failed"', async () => {
    up.next = async () => { throw new Error('video_too_long') }
    await pick()
    expect(await screen.findByText('Your intro video must be 5 minutes or less.')).toBeTruthy()
    expect(screen.queryByText(/Video upload failed/)).toBeNull()
  })

  it('too many tries, or a server asking to try again, says to try again later — not "upload failed"', async () => {
    up.next = async () => { throw new Error('video_busy') }
    await pick()
    expect(await screen.findByText('Video uploads are busy right now — please try again later.')).toBeTruthy()
    expect(screen.queryByText(/Video upload failed/)).toBeNull()
  })

  it('any other failure is the upload message, with the five-minute hint', async () => {
    up.next = async () => { throw new Error('video') }
    await pick()
    expect(await screen.findByText('Video upload failed. Please try again — keep it under 5 minutes.')).toBeTruthy()
  })
})
