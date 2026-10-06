import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE iOS APP'S UNIVERSAL-LINK ASSOCIATION, eno.vn ONLY (owner, 2026-10-06: "ship both with eno.vn").
 * ios/App/App/App.entitlements claims applinks:eno.vn alone; these pin the other half — the file Apple's
 * CDN fetches — so the two cannot drift: dormant without APPLE_TEAM_ID, never served by the services
 * edition, and the excludes ahead of the catch-all (iOS takes the FIRST matching component).
 */
const h = vi.hoisted(() => ({ marketplace: true }))
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  get IS_MARKETPLACE() { return h.marketplace },
}))

import { GET } from './route'

beforeEach(() => { h.marketplace = true })
afterEach(() => { vi.unstubAllEnvs() })

describe('/.well-known/apple-app-site-association', () => {
  it('404s with no body while APPLE_TEAM_ID is unset — the dormant state', async () => {
    vi.stubEnv('APPLE_TEAM_ID', '')
    const res = await GET()
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('404s on eno.forum even when its env carries APPLE_TEAM_ID — no forum link may open the app', async () => {
    vi.stubEnv('APPLE_TEAM_ID', 'DTP9SKVFMQ')
    h.marketplace = false
    expect((await GET()).status).toBe(404)
  })

  it('on eno.vn: 200 JSON for <team>.vn.eno.app, auth + sign-in excluded BEFORE the catch-all', async () => {
    vi.stubEnv('APPLE_TEAM_ID', 'DTP9SKVFMQ')
    vi.stubEnv('APPLE_BUNDLE_ID', '')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    const body = await res.json()
    expect(body.applinks.details).toHaveLength(1)
    expect(body.applinks.details[0].appIDs).toEqual(['DTP9SKVFMQ.vn.eno.app'])
    expect(body.applinks.details[0].components).toEqual([
      { '/': '/auth*', exclude: true },
      { '/': '/signin*', exclude: true },
      { '/': '/*' },
    ])
  })
})
