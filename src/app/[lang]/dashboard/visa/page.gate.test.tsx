import { afterEach, describe, expect, it, vi } from 'vitest'

// ── App Store gate `ios-hide-visa` (D5 = b) on the e-Visa pages that render per request ───────────────
// Off ⇒ unchanged for everyone. On ⇒ only the iOS app's user agent: no e-Visa tab, and no way to the cases
// list or the identity capture by URL.

let ua: string | null = null
vi.mock('next/headers', () => ({ headers: async () => new Headers(ua ? { 'user-agent': ua } : {}) }))
const redirect = vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) })
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))
vi.mock('../account/verify/verify-client', () => ({ VerifyClient: () => null }))
const visaThreads = vi.fn(async () => ({ app1: 'convo1' }))
vi.mock('@/lib/visa/viewer-threads', () => ({ visaThreadsForViewer: () => visaThreads() }))
vi.mock('@/lib/trips/dm-thread', () => ({ getTripAssistanceListingId: async () => 'trip-listing' }))
vi.mock('../services/services-client', () => ({ ServicesClient: () => null, ServicesFallback: () => null }))

import VisaRedirect from './page.svc'
import VerifyPage from '../account/verify/page'
import ServicesPage from '../services/page.svc'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.unstubAllEnvs()
  redirect.mockClear()
  visaThreads.mockClear()
  ua = null
})

const visa = () => VisaRedirect({ searchParams: Promise.resolve({ paid: 'stripe', aid: 'a1' }) })
/** The services page's body, resolved without rendering: <Suspense><ServicesBody/></Suspense> → its element. */
async function servicesProps() {
  const page = ServicesPage() as unknown as { props: { children: { type: () => Promise<{ props: Record<string, unknown> }> } } }
  const body = page.props.children
  return (await body.type()).props
}

describe('gate OFF (the shipped default)', () => {
  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP], ['iOS Safari', IOS_SAFARI]])('%s: /dashboard/visa keeps the e-Visa tab and the payment-return query', async (_, agent) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    ua = agent
    await expect(visa()).rejects.toThrow('NEXT_REDIRECT /dashboard/services?paid=stripe&aid=a1&tab=evisa')
  })

  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP], ['iOS Safari', IOS_SAFARI]])('%s: /dashboard/account/verify renders the capture', async (_, agent) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    ua = agent
    await expect(VerifyPage()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('services: the e-Visa tab and its data are there', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    ua = IOS_APP
    const props = await servicesProps()
    expect(props.hideVisa).toBe(false)
    expect(props.threads).toEqual({ app1: 'convo1' })
    expect(visaThreads).toHaveBeenCalledOnce()
  })
})

describe('gate ON', () => {
  it('the iOS app is sent to Services (Trips) from /dashboard/visa', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    ua = IOS_APP
    await expect(visa()).rejects.toThrow('NEXT_REDIRECT /dashboard/services')
    expect(redirect).toHaveBeenCalledWith('/dashboard/services')
  })

  it('the iOS app is sent to the verification hub from /dashboard/account/verify', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    ua = IOS_APP
    await expect(VerifyPage()).rejects.toThrow('NEXT_REDIRECT /dashboard/verification')
  })

  it('services: the iOS app gets no e-Visa tab, and the visa read is not made', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    ua = IOS_APP
    const props = await servicesProps()
    expect(props.hideVisa).toBe(true)
    expect(props.threads).toEqual({})
    expect(visaThreads).not.toHaveBeenCalled()
  })

  it.each([['Android app', ANDROID_APP], ['iOS Safari', IOS_SAFARI], ['no user agent', null]])('%s is untouched everywhere', async (_, agent) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    ua = agent
    await expect(visa()).rejects.toThrow('NEXT_REDIRECT /dashboard/services?paid=stripe&aid=a1&tab=evisa')
    await expect(VerifyPage()).resolves.toBeTruthy()
    expect((await servicesProps()).hideVisa).toBe(false)
  })
})
