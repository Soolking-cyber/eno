// @vitest-environment jsdom
/**
 * FavoritesProvider with an account (saves across devices, owner 2026-11-09: "3 ok"). The guest path is
 * favorites-context.test.tsx; the engine's races are src/lib/saved-sync.test.ts. Here: which list a tab shows, when, and
 * what it leaves behind — a guest never loads the engine; a signed-in first paint shows only ITS OWN cache; a first
 * sign-in moves the guest saves in; signing out leaves nothing of the account on the device.
 */
import React from 'react'
import { cleanup, render, screen, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: { loading: true, user: null as { id: string } | null },
  engineLoaded: false,
  engineFails: false,
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/saved' }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuthMaybe: () => h.auth }))
// The provider subscribes once when it loads the engine — that call is the proof it was loaded (an import flag would be set
// by this file's own import of the reset seam).
vi.mock('@/lib/saved-sync', async (orig) => {
  const m = await orig<typeof import('@/lib/saved-sync')>()
  return { ...m, subscribeSaved: (fn: () => void) => { if (h.engineFails) throw new Error('chunk load failed'); h.engineLoaded = true; return m.subscribeSaved(fn) } }
})

import { FavoritesProvider, useFavorites } from './favorites-context'
import { resetSavedForTest } from '@/lib/saved-sync'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (sub: string) => `${b64url('{}')}.${b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
let cookieUid: string | null = null
function cookie(uid: string | null) {
  cookieUid = uid
  document.cookie = 'sb-sb-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  if (uid) document.cookie = `sb-sb-auth-token=${encodeURIComponent('base64-' + b64url(JSON.stringify({ access_token: jwt(uid) })))}; path=/`
}
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size }, key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null), setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) }, clear: () => { map.clear() },
  } as Storage
}

let server: Set<string>
let available: boolean
let failGet = false
let failPost = false
let apiCalls: Array<{ method: string; body?: { uid: string; add?: string[]; remove?: string[] } }>
let beacons: string[]
let beaconBodies: unknown[]
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as Response
    if (url === '/api/saved-listings') {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      apiCalls.push({ method, ...(body ? { body } : {}) })
      if (!available) return method === 'GET' ? json({ uid: cookieUid, ids: [], available: false }) : json({ error: 'saved_listings_unavailable' }, 503)
      if (method === 'GET') return failGet ? json({}, 500) : json({ uid: cookieUid, ids: [...server].reverse() })
      if (failPost) return json({ error: 'internal_error' }, 500)
      for (const id of body.remove ?? []) server.delete(id)
      for (const id of body.add ?? []) { server.delete(id); server.add(id) }
      return json({ ok: true, notStored: [] })
    }
    if (url.includes('/save')) { beacons.push(url); beaconBodies.push(JSON.parse(String(init?.body))); return json({}) }
    if (url.includes('?ids=')) {
      const ids = decodeURIComponent(url.split('?ids=')[1].split('&')[0]).split(',')
      return json({ listings: ids.map((id) => ({ id })), total: ids.length, evaluated: ids, gone: [], sold: [] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

function Probe() {
  const { ids, count, saved, synced, toggle, savedDelta, savedError, retrySaved } = useFavorites()
  return (
    <div>
      <span data-testid="ids">{[...ids].join(',')}</span>
      <span data-testid="count">{count}</span>
      <span data-testid="state">{saved === null ? 'loading' : `n=${saved.length}`}</span>
      <span data-testid="synced">{synced ? 'synced' : 'device'}</span>
      <span data-testid="delta">{savedDelta('n1')}</span>
      <span data-testid="error">{savedError ? 'error' : 'ok'}</span>
      <button type="button" onClick={() => toggle('n1')}>heart</button>
      <button type="button" onClick={() => retrySaved()}>retry</button>
    </div>
  )
}
const text = (id: string) => screen.getByTestId(id).textContent
let rerender: (ui: React.ReactElement) => void
async function mount() {
  ;({ rerender } = render(<FavoritesProvider><Probe /></FavoritesProvider>))
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}
async function settle(user: { id: string } | null) {
  h.auth = { loading: false, user }
  rerender(<FavoritesProvider><Probe /></FavoritesProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(600) })
}

beforeEach(() => {
  resetSavedForTest()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('navigator', { userAgent: 'test' })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  h.auth = { loading: true, user: null }
  h.engineLoaded = false
  h.engineFails = false
  server = new Set()
  available = true
  failGet = false
  failPost = false
  apiCalls = []
  beacons = []
  beaconBodies = []
  stubFetch()
  cookie(null)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); cookie(null) })

describe('a guest', () => {
  it('never loads the account engine and never asks the account API — today\'s device list, newest first', async () => {
    localStorage.setItem('eno:favorites', JSON.stringify(['g1', 'g2']))
    await mount()
    await settle(null)
    expect(text('ids')).toBe('g2,g1')
    expect(text('synced')).toBe('device')
    expect(apiCalls).toEqual([])
    expect(h.engineLoaded).toBe(false)
  })
})

describe('the first paint of a signed-in tab (auth not booted yet)', () => {
  it('shows this account\'s cache at once — the session cookie names it', async () => {
    cookie(U)
    localStorage.setItem('eno:favorites:acct', JSON.stringify({ u: U, ids: ['s2', 's1'] }))
    await mount()
    expect(text('ids')).toBe('s2,s1')
    expect(text('synced')).toBe('synced')
    expect(apiCalls).toEqual([]) // nothing asked before auth settles
  })
  it('the account\'s list only, even with guest saves on the device — the engine\'s own invariant, so the badge never jumps', async () => {
    cookie(U)
    localStorage.setItem('eno:favorites:acct', JSON.stringify({ u: U, ids: ['s1'] }))
    localStorage.setItem('eno:favorites', JSON.stringify(['g1']))
    await mount()
    expect(text('ids')).toBe('s1')
    expect(text('count')).toBe('1')
  })
  it('⛔ never another account\'s cache: the cookie names V, the cache is U\'s → the device list', async () => {
    cookie(V)
    localStorage.setItem('eno:favorites:acct', JSON.stringify({ u: U, ids: ['theirs'] }))
    localStorage.setItem('eno:favorites', JSON.stringify(['g1']))
    await mount()
    expect(text('ids')).toBe('g1')
    expect(text('synced')).toBe('device')
  })
})

describe('auth settles', () => {
  it('a first sign-in here: skeletons (never "nothing saved") until the account answers; the guest saves move in', async () => {
    cookie(U)
    server = new Set(['s1'])
    localStorage.setItem('eno:favorites', JSON.stringify(['g1']))
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => { if (u === '/api/saved-listings' && !i?.method) await gate; return real(u, i) }))
    await mount()
    h.auth = { loading: false, user: { id: U } }
    rerender(<FavoritesProvider><Probe /></FavoritesProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(text('state')).toBe('loading')
    release()
    await waitFor(() => expect(text('ids')).toBe('g1,s1'))
    expect(text('synced')).toBe('synced')
    expect(JSON.parse(localStorage.getItem('eno:favorites')!)).toEqual([])
    expect(JSON.parse(localStorage.getItem('eno:favorites:acct')!)).toEqual({ u: U, ids: ['g1', 's1'] })
    await waitFor(() => expect(text('state')).toBe('n=2'))
  })

  it('a tap writes to the account, names it, and still feeds the public saved count', async () => {
    cookie(U)
    await mount()
    await settle({ id: U })
    await act(async () => { screen.getByText('heart').click() })
    expect(text('ids')).toBe('n1')
    await waitFor(() => expect(server.has('n1')).toBe(true))
    expect(apiCalls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({ uid: U, add: ['n1'] })
    expect(beacons).toEqual(['/api/listings/n1/save'])
  })

  it('⛔ signed out: back to the device list, and nothing of the account stays on the device', async () => {
    cookie(U)
    server = new Set(['s1'])
    await mount()
    await settle({ id: U })
    await waitFor(() => expect(text('state')).toBe('n=1'))
    expect(JSON.parse(localStorage.getItem('eno-saved-cache')!).u).toBe(U)
    cookie(null)
    await settle(null)
    expect(text('ids')).toBe('')
    expect(text('synced')).toBe('device')
    expect(localStorage.getItem('eno:favorites:acct')).toBeNull()
    expect(localStorage.getItem('eno-saved-cache')).toBeNull()
  })

  it('⛔ another account: the shown one is dropped first, and only the new one is shown', async () => {
    cookie(U)
    localStorage.setItem('eno:favorites:acct', JSON.stringify({ u: U, ids: ['mine'] }))
    await mount()
    expect(text('ids')).toBe('mine')
    cookie(V)
    server = new Set(['vs'])
    await settle({ id: V })
    await waitFor(() => expect(text('ids')).toBe('vs'))
    expect(JSON.parse(localStorage.getItem('eno:favorites:acct')!)).toEqual({ u: V, ids: ['vs'] })
  })

  it('⛔ a refused save goes back — heart AND count — and the public count is never moved', async () => {
    cookie(U)
    await mount()
    await settle({ id: U })
    failPost = true
    // Hold the account write, to see the heart and the count move first.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => { if (u === '/api/saved-listings' && i?.method === 'POST') await gate; return real(u, i) }))
    await act(async () => { screen.getByText('heart').click() })
    expect(text('ids')).toBe('n1')
    expect(text('delta')).toBe('1')
    release()
    await waitFor(() => expect(text('ids')).toBe(''))
    expect(text('delta')).toBe('0')
    // The public count: +1 at the tap (a closed tab still counts), −1 when the account refused it.
    expect(beacons).toEqual(['/api/listings/n1/save', '/api/listings/n1/save'])
    expect(beaconBodies).toEqual([{ saved: true }, { saved: false }])
  })

  it('a failed account read says so on /saved (never "nothing saved"), and Retry asks again', async () => {
    cookie(U)
    server = new Set(['s1'])
    failGet = true
    await mount()
    await settle({ id: U })
    await waitFor(() => expect(text('error')).toBe('error'))
    expect(text('synced')).toBe('synced')
    failGet = false
    await act(async () => { screen.getByText('retry').click() })
    await waitFor(() => expect(text('ids')).toBe('s1'))
    expect(text('error')).toBe('ok')
  })

  it('no table for one account does not switch accounts off for the next one to sign in', async () => {
    cookie(U)
    available = false
    await mount()
    await settle({ id: U })
    await waitFor(() => expect(text('synced')).toBe('device'))
    available = true
    server = new Set(['vs'])
    cookie(V)
    await settle({ id: V })
    await waitFor(() => expect(text('ids')).toBe('vs'))
    expect(text('synced')).toBe('synced')
  })

  it('no table yet: this page keeps device saves, as before — and a tap goes to the device list', async () => {
    cookie(U)
    available = false
    localStorage.setItem('eno:favorites', JSON.stringify(['g1']))
    await mount()
    await settle({ id: U })
    await waitFor(() => expect(text('synced')).toBe('device'))
    expect(text('ids')).toBe('g1')
    await act(async () => { screen.getByText('heart').click() })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('eno:favorites')!)).toEqual(['g1', 'n1']))
    expect(apiCalls.filter((c) => c.method === 'POST')).toEqual([])
  })
})

describe('wiring', () => {
  it('⛔ FavoritesProvider sits INSIDE AuthProvider — outside it, auth would never settle and accounts would never sync', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/app/[lang]/providers.tsx', 'utf8')
    const at = (s: string) => src.indexOf(s)
    expect(at('<AuthProvider>')).toBeGreaterThan(-1)
    expect(at('<AuthProvider>') < at('<FavoritesProvider>') && at('</FavoritesProvider>') < at('</AuthProvider>')).toBe(true)
  })

  it('a count nudge does not follow the account that tapped it into the next one', async () => {
    cookie(U)
    await mount()
    await settle({ id: U })
    await act(async () => { screen.getByText('heart').click() })
    await waitFor(() => expect(server.has('n1')).toBe(true))
    expect(text('delta')).toBe('1')
    cookie(V)
    await settle({ id: V })
    expect(text('delta')).toBe('0')
  })

  it('⛔ the engine fails to load (a deploy swapped its chunk): device saves for this page — no endless skeletons, no lost tap', async () => {
    h.engineFails = true
    cookie(U)
    localStorage.setItem('eno:favorites', JSON.stringify(['g1']))
    await mount()
    await settle({ id: U })
    await waitFor(() => expect(text('synced')).toBe('device'))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    await waitFor(() => expect(text('state')).toBe('n=1'))
    await act(async () => { screen.getByText('heart').click() })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('eno:favorites')!)).toEqual(['g1', 'n1']))
  })
})
