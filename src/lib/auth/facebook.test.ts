import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "Is Continue with Facebook on?" is GoTrue's own settings (sb.eno.vn /auth/v1/settings), read by the server: an answer
// for 10 minutes, a failure only 60 s — and a failure reads as OFF, logged, never as a quiet stand-in.
vi.mock('server-only', () => ({}))
const warn = vi.fn()
vi.mock('@/lib/log', () => ({ logWarn: (...a: unknown[]) => warn(...a) }))

const { facebookSignInEnabled, resetFacebookProbeForTests } = await import('./facebook')
let answers: Array<() => Promise<Response>> = []
const fetchMock = vi.fn((_u: string, _i?: RequestInit) => (answers.shift() ?? (() => Promise.reject(new Error('no answer'))))())
const settings = (external: Record<string, boolean>) => () => Promise.resolve(new Response(JSON.stringify({ external }), { status: 200 }))

beforeEach(() => {
  resetFacebookProbeForTests()
  answers = []
  fetchMock.mockClear(); warn.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn/')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('facebookSignInEnabled', () => {
  it('on when GoTrue says facebook: true — asked with the public key, and kept for 10 minutes', async () => {
    vi.useFakeTimers()
    answers = [settings({ email: true, facebook: true })]
    expect(await facebookSignInEnabled()).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.eno.vn/auth/v1/settings')
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).apikey).toBe('sb_publishable_x')
    vi.advanceTimersByTime(9 * 60_000)
    expect(await facebookSignInEnabled()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    answers = [settings({ facebook: false })]
    vi.advanceTimersByTime(2 * 60_000)
    expect(await facebookSignInEnabled()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('off when GoTrue does not list it', async () => {
    answers = [settings({ google: true, apple: true })]
    expect(await facebookSignInEnabled()).toBe(false)
  })

  it('⛔ a refused or failed probe is OFF, logged, and asked again after 60 s — not 10 minutes', async () => {
    vi.useFakeTimers()
    answers = [() => Promise.resolve(new Response('{}', { status: 401 }))]
    expect(await facebookSignInEnabled()).toBe(false)
    expect(warn).toHaveBeenCalledWith('[facebook] settings probe refused', { status: 401 })
    vi.advanceTimersByTime(61_000)
    answers = [() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))]
    expect(await facebookSignInEnabled()).toBe(false)
    expect(warn).toHaveBeenCalledWith('[facebook] settings probe failed', { name: 'TimeoutError' })
    vi.advanceTimersByTime(61_000)
    answers = [settings({ facebook: true })]
    expect(await facebookSignInEnabled()).toBe(true)
  })

  it('one request for callers that arrive together', async () => {
    answers = [settings({ facebook: true })]
    expect(await Promise.all([facebookSignInEnabled(), facebookSignInEnabled(), facebookSignInEnabled()])).toEqual([true, true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('no Supabase env (a build, a test): off, and nothing is fetched', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    expect(await facebookSignInEnabled()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
