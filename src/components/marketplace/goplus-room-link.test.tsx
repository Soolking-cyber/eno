// @vitest-environment jsdom
/**
 * A GoPlus room's own page on goplus.com.vn — for the GoPlus account and eno's admins ONLY (owner, 2026-10-30: "available
 * only for admins goplus email and suport email … user shouldnt see the links"). The link holds no URL: it asks
 * GET /api/listings/[id]/goplus-link (route.test.ts there decides who is told), and shows only what that answers.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ user: null as { id: string } | null, loading: false }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user, loading: h.loading }) }))

import { GoplusRoomLink } from './goplus-room-link'

const ROOM = 'https://goplus.com.vn/phong/d1c036ae6826f5254ba9e8d9'
const LINK = /View on GoPlus/
const fetchMock = vi.fn()
const answers = (url: unknown) => ({ ok: true, json: async () => ({ url }) })

beforeEach(() => {
  h.user = null
  h.loading = false
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GoplusRoomLink', () => {
  it('a guest: asks nothing and shows nothing', () => {
    const { container } = render(<GoplusRoomLink listingId="L1" />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })

  it('the GoPlus account or an admin (the server answers the URL): the room on goplus.com.vn, in a new tab, no referrer', async () => {
    h.user = { id: 'goplus-owner' }
    fetchMock.mockResolvedValue(answers(ROOM))
    render(<GoplusRoomLink listingId="L1" />)
    const a = await screen.findByRole('link', { name: LINK })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/listings/L1/goplus-link')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
    expect(a.getAttribute('href')).toBe(ROOM)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.getAttribute('rel')).toContain('noreferrer')
  })

  it('anyone else (the server answers null), a failed answer, or an address that is not a GoPlus room page: nothing', async () => {
    h.user = { id: 'renter' }
    for (const reply of [answers(null), { ok: false, json: async () => ({}) }, answers('https://goplus.com.vn.evil.example/phong/d1c036ae6826f5254ba9e8d9'), answers('https://goplus.com.vn/')]) {
      fetchMock.mockReset().mockResolvedValue(reply)
      const { container, unmount } = render(<GoplusRoomLink listingId="L1" />)
      await act(async () => {})
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(container.textContent).toBe('')
      unmount()
    }
  })

  it('switching account while it asks: the first account\'s late answer never shows for the next one', async () => {
    let answerFirst!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise((r) => { answerFirst = r })).mockResolvedValueOnce(answers(null))
    h.user = { id: 'goplus-owner' }
    const { rerender, container } = render(<GoplusRoomLink listingId="L1" />)
    h.user = { id: 'renter' }
    rerender(<GoplusRoomLink listingId="L1" />)
    await act(async () => { answerFirst(answers(ROOM)) })
    expect(container.textContent).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('back on a room after access was taken away: nothing while it asks again, nothing when that fails (codex, round 2)', async () => {
    h.user = { id: 'goplus-owner' }
    let failAgain!: (e: unknown) => void
    fetchMock
      .mockResolvedValueOnce(answers(ROOM)) // L1, the first visit
      .mockReturnValueOnce(new Promise(() => {})) // L2: never answers, so nothing replaces L1's answer there
      .mockReturnValueOnce(new Promise((_, reject) => { failAgain = reject })) // L1 again: out, then fails
      .mockResolvedValueOnce(answers(null)) // L1 once more: the server says no
    const { rerender, container } = render(<GoplusRoomLink listingId="L1" />)
    await screen.findByRole('link', { name: LINK })
    rerender(<GoplusRoomLink listingId="L2" />)
    rerender(<GoplusRoomLink listingId="L1" />)
    await act(async () => {})
    expect(container.textContent).toBe('') // the first visit's answer never shows while this one is out
    await act(async () => { failAgain(new TypeError('offline')) })
    expect(container.textContent).toBe('') // nor after it fails
    rerender(<GoplusRoomLink listingId="L1" key="again" />)
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(container.textContent).toBe('')
  })

  it('another room: the answer for the first one does not follow', async () => {
    h.user = { id: 'goplus-owner' }
    fetchMock.mockResolvedValueOnce(answers(ROOM)).mockReturnValueOnce(new Promise(() => {}))
    const { rerender, container } = render(<GoplusRoomLink listingId="L1" />)
    await screen.findByRole('link', { name: LINK })
    rerender(<GoplusRoomLink listingId="L2" />)
    expect(container.textContent).toBe('')
  })
})

describe('⛔ no page or payload carries the URL — only the endpoint does', () => {
  const pdp = readFileSync('src/app/[lang]/listings/[id]/(pdp)/page.tsx', 'utf8')
  const thread = readFileSync('src/app/[lang]/messages/[id]/page.tsx', 'utf8')

  it('the listing page and the chat thread hand the link a listing id, never an address', () => {
    for (const src of [pdp, thread]) {
      const mounts = src.match(/<GoplusRoomLink\b[^>]*\/>/g) ?? []
      expect(mounts.length).toBeGreaterThan(0)
      for (const m of mounts) {
        expect(m).toMatch(/listingId=\{/)
        expect(m).not.toMatch(/href=/)
      }
    }
  })

  it('the cached listing page keeps only a yes/no: goplusRoomPageUrl is compared, never rendered', () => {
    expect(pdp.match(/goplusRoomPageUrl\([^)]*\)/g)).toEqual(['goplusRoomPageUrl(rawListing.externalId)'])
    expect(pdp).toMatch(/goplusRoomPageUrl\(rawListing\.externalId\) !== null/)
  })

  it('the chat thread GET still selects no externalId', () => {
    expect(readFileSync('src/app/api/conversations/[id]/route.ts', 'utf8')).not.toMatch(/externalId/)
  })
})
