// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The global `?siwa_test=` switch (Sign in with Apple plan §7.1): it follows the search params (the Android tester
 * arrives by a client-side navigation), and providers.tsx mounts it only while `web-test` is in the flag.
 */
const h = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => h.params }))

const { SiwaTestFlag } = await import('./siwa-test-flag')

const hasCookie = () => document.cookie.split(';').some((c) => c.trim() === 'eno-siwa-test=1')
afterEach(() => {
  vi.unstubAllEnvs()
  document.cookie = 'eno-siwa-test=; Path=/; Max-Age=0'
})

describe('SiwaTestFlag', () => {
  it('sets the tester cookie on ?siwa_test=1 and clears it on ?siwa_test=0, following client navigations', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web-test')
    h.params = new URLSearchParams('siwa_test=1')
    const { rerender } = render(<SiwaTestFlag />)
    expect(hasCookie()).toBe(true)
    h.params = new URLSearchParams('siwa_test=0')
    rerender(<SiwaTestFlag />)
    expect(hasCookie()).toBe(false)
  })
  it('writes nothing without `web-test` in the flag, or without the parameter', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    h.params = new URLSearchParams('siwa_test=1')
    render(<SiwaTestFlag />)
    expect(hasCookie()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web-test')
    h.params = new URLSearchParams('q=x')
    render(<SiwaTestFlag />)
    expect(hasCookie()).toBe(false)
  })
  it('providers.tsx mounts it only while `web-test` is in the flag, inside a Suspense boundary', () => {
    const src = readFileSync('src/app/[lang]/providers.tsx', 'utf8')
    expect(src).toContain("{appleSignInTokens().has('web-test') && <Suspense fallback={null}><SiwaTestFlag /></Suspense>}")
  })
})
