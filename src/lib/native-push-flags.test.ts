import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativePushEnabled } from './native-push-flags'

afterEach(() => vi.unstubAllEnvs())

describe('nativePushEnabled — one switch per platform (plan R12)', () => {
  it('is off on every platform while both flags are unset (today)', () => {
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_IOS', '')
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_ANDROID', '')
    expect(nativePushEnabled('ios')).toBe(false)
    expect(nativePushEnabled('android')).toBe(false)
    expect(nativePushEnabled('web')).toBe(false)
    expect(nativePushEnabled(undefined)).toBe(false)
  })

  it('turning iOS on leaves Android off — the case a shared flag got wrong', () => {
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_IOS', '1')
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_ANDROID', '')
    expect(nativePushEnabled('ios')).toBe(true)
    expect(nativePushEnabled('android')).toBe(false)
  })

  it('turning Android on leaves iOS off', () => {
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_IOS', '')
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_ANDROID', '1')
    expect(nativePushEnabled('ios')).toBe(false)
    expect(nativePushEnabled('android')).toBe(true)
  })

  it('no longer reads the retired shared flag', () => {
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH', '1')
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_IOS', '')
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_ANDROID', '')
    expect(nativePushEnabled('ios')).toBe(false)
    expect(nativePushEnabled('android')).toBe(false)
  })

  it('only the exact string "1" switches it on', () => {
    vi.stubEnv('NEXT_PUBLIC_NATIVE_PUSH_IOS', 'true')
    expect(nativePushEnabled('ios')).toBe(false)
  })
})
