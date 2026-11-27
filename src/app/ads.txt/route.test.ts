import { afterEach, describe, expect, it, vi } from 'vitest'

const load = async (edition: 'marketplace' | 'services') => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  return import('./route')
}
afterEach(() => { vi.unstubAllEnvs() })

describe('/ads.txt', () => {
  it("eno.vn serves Google's AdSense line for pub-8024177228787683, as plain text", async () => {
    const res = (await load('marketplace')).GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toBe('google.com, pub-8024177228787683, DIRECT, f08c47fec0942fa0\n')
  })

  it('a services build answers 404 — the account names eno.vn', async () => {
    expect((await load('services')).GET().status).toBe(404)
  })
})
