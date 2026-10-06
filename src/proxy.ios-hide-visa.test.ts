import { afterEach, describe, expect, it, vi } from 'vitest'

// ── App Store gates `ios-hide-visa` and `ios-hide-kyc`: the API backstops in src/proxy.ts ─────────────────
// Off ⇒ the proxy behaves exactly as before for every caller. `ios-hide-visa` on ⇒ a WRITE from the iOS app to an
// e-Visa application route is refused with 403 `ios_app_unavailable`; `ios-hide-kyc` on ⇒ the same for an identity /
// business-verification route. Each leaves the other's routes alone (split 2026-10-06: the owner keeps the e-Visa
// flow in both apps). Reads, the desk's admin routes, other API routes, Android and the web are untouched.

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

const VISA_WRITES: [string, string][] = [
  ['POST', '/api/visa/applications/start'],
  ['POST', '/api/visa/applications/abc/documents'],
  ['POST', '/api/visa/cards/m1/act'],
]
const KYC_WRITES: [string, string][] = [
  ['POST', '/api/seller/identity/documents'],
  ['POST', '/api/seller/verification/documents'],
]
const WRITES = [...VISA_WRITES, ...KYC_WRITES]

describe('iOS-app backstops — both gates OFF (the shipped default)', () => {
  it.each(WRITES)('%s %s from the iOS app passes through', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await call(path, method, IOS_APP)).status).not.toBe(403)
  })
})

// ⛔ ios-hide-visa still covers the identity writes too (src/lib/ios-hide-kyc.ts: an env line from before the
// 2026-10-06 split must never reopen them); ios-hide-kyc alone leaves the e-Visa writes alone.
const ON: [string, [string, string][]][] = [
  ['ios-hide-visa', WRITES],
  ['ios-hide-kyc', KYC_WRITES],
]
describe.each(ON)('%s ON', (gate, refused) => {
  it.each(refused)('%s %s from the iOS app is refused', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', gate)
    expect(await call(path, method, IOS_APP)).toEqual({ status: 403, body: { error: 'ios_app_unavailable' } })
  })

  it.each(refused)('%s %s from Android or Safari passes through', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', gate)
    expect((await call(path, method, ANDROID_APP)).status).not.toBe(403)
    expect((await call(path, method, IOS_SAFARI)).status).not.toBe(403)
  })

})

describe('ios-hide-kyc alone (the 2026-10-06 plan)', () => {
  it.each(VISA_WRITES)('%s %s (the e-Visa flow) passes through from the iOS app', async (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    expect((await call(path, method, IOS_APP)).status).not.toBe(403)
  })
})

describe('both gates ON', () => {
  it('reads, the desk admin and unrelated writes from the iOS app pass through', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa,ios-hide-kyc')
    for (const [method, path] of [
      ['GET', '/api/seller/identity/status'],
      ['GET', '/api/visa/applications/abc/result'],
      ['POST', '/api/visa/admin/applications/abc/result'],
      ['POST', '/api/conversations'],
      ['POST', '/api/messages/translate'],
    ]) expect((await call(path, method, IOS_APP)).status, `${method} ${path}`).not.toBe(403)
  })
})
