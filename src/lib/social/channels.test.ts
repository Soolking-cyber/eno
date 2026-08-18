import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHANNELS, postFacebook, postLinkedIn, postInstagram, postThreads, postReddit } from './channels'
import type { PostInput } from './caption'

/**
 * ⚠️ WHAT THIS SUITE IS ACTUALLY GUARDING: that an UNCONFIGURED channel is a no-op, and that a
 * configured one which the platform rejects THROWS. Four of the five channels are pending app
 * approval, so "no credentials" is the normal state for months — if that path threw, the daily job
 * would log five errors every morning and nobody would read the sixth.
 *
 * The Reddit case is the one worth writing by hand: it answers HTTP 200 with the rejection inside
 * the body, so a status-code check reports every removal as a success.
 */
const l: PostInput = {
  id: 'x1', title: 'Test listing', price: 1_000_000, currency: 'VND',
  location: 'Ho Chi Minh City', district: null, image: 'https://img.example/a.jpg',
  categoryName: 'Motorbikes',
}

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); vi.restoreAllMocks() })

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (u: RequestInfo | URL) => impl(String(u)))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('social channels', () => {
  it('every channel is a no-op when its credentials are absent', async () => {
    for (const k of Object.keys(process.env)) {
      if (/^(FB_|LINKEDIN_|IG_|THREADS_|REDDIT_)/.test(k)) delete process.env[k]
    }
    const spy = mockFetch(() => new Response('{}', { status: 200 }))
    for (const [name, fn] of Object.entries(CHANNELS)) {
      const r = await fn(l)
      expect(r.skipped, `${name} should skip when unconfigured`).toBe('not_configured')
    }
    // The real assertion: nothing was even attempted.
    expect(spy).not.toHaveBeenCalled()
  })

  it('instagram skips a listing with no image rather than failing', async () => {
    process.env.IG_USER_ID = '1'; process.env.IG_ACCESS_TOKEN = 't'
    const spy = mockFetch(() => new Response('{}', { status: 200 }))
    const r = await postInstagram({ ...l, image: null })
    expect(r.skipped).toBe('no_image')
    expect(spy).not.toHaveBeenCalled()
  })

  it('threads posts text-only when there is no image', async () => {
    process.env.THREADS_USER_ID = '1'; process.env.THREADS_ACCESS_TOKEN = 't'
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return new Response(JSON.stringify({ id: '9' }), { status: 200 })
    }))
    const r = await postThreads({ ...l, image: null })
    expect(bodies[0]).toContain('media_type=TEXT')
    expect(r.id).toBe('9')
  })

  it('⛔ reddit treats an in-body error as a failure, not a 200 success', async () => {
    process.env.REDDIT_ACCESS_TOKEN = 't'; process.env.REDDIT_SUBREDDIT = 'test'
    mockFetch(() => new Response(JSON.stringify({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'no', null]] } }), { status: 200 }))
    await expect(postReddit(l)).rejects.toThrow(/reddit rejected/)
  })

  it('reddit succeeds when the body carries no errors', async () => {
    process.env.REDDIT_ACCESS_TOKEN = 't'; process.env.REDDIT_SUBREDDIT = 'test'
    mockFetch(() => new Response(JSON.stringify({ json: { errors: [] } }), { status: 200 }))
    await expect(postReddit(l)).resolves.toMatchObject({ channel: 'reddit' })
  })

  it('linkedin reads the post id from the x-restli-id header, not the body', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 't'; process.env.LINKEDIN_ORG_URN = 'urn:li:organization:1'
    mockFetch(() => new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:77' } }))
    await expect(postLinkedIn(l)).resolves.toMatchObject({ id: 'urn:li:share:77' })
  })

  it('facebook throws on a non-2xx so the daily job records it', async () => {
    process.env.FB_PAGE_ID = '1'; process.env.FB_PAGE_TOKEN = 't'
    mockFetch(() => new Response('{"error":{"message":"bad token"}}', { status: 401 }))
    await expect(postFacebook(l)).rejects.toThrow(/facebook 401/)
  })
})
