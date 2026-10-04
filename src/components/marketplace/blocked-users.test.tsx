// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { BlockedUsers } from './blocked-users'

// ── Settings › Privacy › Blocked users (App Store gate `ugc-safety`) — opaque handles, honest failures ──

const fetchMock = vi.fn()
const H = 'K'.repeat(22)
const row = (handle: string | null, name = 'Lan') => ({ handle, name, avatarUrl: null, avatarColor: '#111111', blockedAt: '2026-10-01T00:00:00.000Z' })
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

function mount() {
  return render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <BlockedUsers />
    </LanguageProvider>,
  )
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('BlockedUsers', () => {
  it('unblocks by HANDLE — no profile id is ever sent', async () => {
    fetchMock.mockResolvedValueOnce(ok({ enabled: true, blocked: [row(H)] })).mockResolvedValueOnce(ok({ blocked: false }))
    mount()
    const button = await screen.findByRole('button', { name: 'Unblock' }, { timeout: 10_000 })
    await act(async () => { fireEvent.click(button) })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ handle: H, blocked: false })
    expect(await screen.findByText('You have not blocked anyone.')).toBeTruthy()
  })

  it('a stale handle (404) says the list was refreshed, and re-reads it', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ enabled: true, blocked: [row(H)] }))
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) })
      .mockResolvedValueOnce(ok({ enabled: true, blocked: [row('Z'.repeat(22))] }))
    mount()
    const button = await screen.findByRole('button', { name: 'Unblock' }, { timeout: 10_000 })
    await act(async () => { fireEvent.click(button) })
    expect((await screen.findByRole('alert')).textContent).toBe('This list was out of date and has been refreshed — please try again.')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a row the server could not sign says unblocking is unavailable instead of a dead button', async () => {
    fetchMock.mockResolvedValueOnce(ok({ enabled: true, blocked: [row(null)] }))
    mount()
    expect(await screen.findByText('Unblocking is unavailable right now. Please try again later.', undefined, { timeout: 10_000 })).toBeTruthy()
  })
})
