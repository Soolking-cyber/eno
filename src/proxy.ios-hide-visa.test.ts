import { afterEach, describe, expect, it, vi } from 'vitest'

// ── App Store gate `ios-hide-visa` (D5 = b): the API backstop in src/proxy.ts ─────────────────────────
// Off ⇒ the proxy behaves exactly as before for every caller. On ⇒ a WRITE from the iOS app to an e-Visa
// application or identity/business-verification route is refused with 403 `ios_app_unavailable`; reads, the
// desk's admin routes, other API routes, Android and the web are untouched.

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function call(path: string, method: string, ua: string) {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
  const { NextRequest } = await import('next/server')
  const { proxy } = await import('./proxy')
  // Same-origin browser write (the app's own WebView), so the cross-origin guard lets it through.
  const res = proxy(new NextRequest(`https://www.eno.forum${path}`, { method, headers: { host: 'www.eno.forum', origin: 'https://www.eno.forum', 'user-agent': ua } }))
  const body = res.status === 403 ? await res.json().catch(() => null) : null
  return { status: res.status, body }
}

const WRITES: [string, string][] = [
  ['POST', '/api/visa/applications/start'],
  ['POST', '/api/visa/applications/abc/documents'],
  ['POST', '/api/visa/cards/m1/act'],
  ['POST', '/api/seller/identity/documents'],
  ['POST', '/api/seller/verification/documents'],
]

describe('ios-hide-visa backstop — gate OFF (the shipped default)', () => {
  it.each(WRITES)('%s %s from the iOS app passes through', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await call(path, method, IOS_APP)).status).not.toBe(403)
  })
})

describe('ios-hide-visa backstop — gate ON', () => {
  it.each(WRITES)('%s %s from the iOS app is refused', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(await call(path, method, IOS_APP)).toEqual({ status: 403, body: { error: 'ios_app_unavailable' } })
  })

  it.each(WRITES)('%s %s from Android or Safari passes through', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect((await call(path, method, ANDROID_APP)).status).not.toBe(403)
    expect((await call(path, method, IOS_SAFARI)).status).not.toBe(403)
  })

  it('reads, the desk admin and unrelated writes from the iOS app pass through', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    for (const [method, path] of [
      ['GET', '/api/seller/identity/status'],
      ['GET', '/api/visa/applications/abc/result'],
      ['POST', '/api/visa/admin/applications/abc/result'],
      ['POST', '/api/conversations'],
      ['POST', '/api/messages/translate'],
    ]) expect((await call(path, method, IOS_APP)).status, `${method} ${path}`).not.toBe(403)
  })
})
