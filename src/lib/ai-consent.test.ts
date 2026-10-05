// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_CONSENT_EVENT,
  aiConsentAskFirst,
  aiConsentKey,
  aiConsentNeeded,
  askAiConsent,
  askAiConsentAnswer,
  forgetAiConsentMemory,
  readAiConsent,
  registerAiConsentAsker,
  setAiConsentAccount,
  writeAiConsent,
  type AiConsentChange,
} from './ai-consent'

// ── App Store gate `app-ai-notice`, the Google half: the remembered answers and the ask ─────────

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const ME = '11111111-1111-4111-8111-111111111111'

let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  })
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
  forgetAiConsentMemory()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})
const as = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
const gate = (on: boolean) => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', on ? 'app-ai-notice' : '')

describe('the stored answer', () => {
  it('is per family and per account, under ai:consent:<family>:<profile>', () => {
    writeAiConsent('listing', ME, 'off')
    expect(store.get(aiConsentKey('listing', ME))).toBe('off')
    expect(aiConsentKey('listing', ME)).toBe(`ai:consent:listing:${ME}`)
    expect(readAiConsent('listing', ME)).toBe('off')
    expect(readAiConsent('assistant', ME)).toBeNull()
    expect(readAiConsent('listing', 'someone-else')).toBeNull()
  })
  it('ignores junk and a missing account', () => {
    store.set(aiConsentKey('trip', ME), 'maybe')
    expect(readAiConsent('trip', ME)).toBeNull()
    expect(readAiConsent('trip', null)).toBeNull()
    writeAiConsent('trip', undefined, 'on')
    expect(store.size).toBe(1)
  })
  it('BLOCKED storage: the answer still holds for this page (memory), and nothing asks twice', async () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readAiConsent('trip', ME)).toBeNull()
    expect(() => writeAiConsent('trip', ME, 'on')).not.toThrow()
    expect(readAiConsent('trip', ME)).toBe('on')
    gate(true)
    as(IOS_APP)
    const asker = vi.fn(() => Promise.resolve('off' as const))
    registerAiConsentAsker(asker)
    expect(aiConsentNeeded('trip', ME)).toBe(false)
    expect(await askAiConsent('trip', { userId: ME })).toBe(true)
    expect(asker).not.toHaveBeenCalled()
    writeAiConsent('trip', ME, 'off')
    expect(readAiConsent('trip', ME)).toBe('off')
  })
  it('FULL storage: an older stored answer does not outvote the one just given', () => {
    store.set(aiConsentKey('listing', ME), 'off')
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: (k: string) => { store.delete(k) },
    })
    writeAiConsent('listing', ME, 'on')
    expect(readAiConsent('listing', ME)).toBe('on')
  })
  it('storage is read first: another tab\'s later answer wins over this page\'s memory', () => {
    writeAiConsent('assistant', ME, 'on')
    store.set(aiConsentKey('assistant', ME), 'off') // what a `storage` event from another tab would have written
    expect(readAiConsent('assistant', ME)).toBe('off')
  })
  it('announces a change in this tab, with the value in the event', () => {
    const seen: AiConsentChange[] = []
    const on = (e: Event) => seen.push((e as CustomEvent<AiConsentChange>).detail)
    window.addEventListener(AI_CONSENT_EVENT, on)
    writeAiConsent('photo_search', ME, 'on')
    window.removeEventListener(AI_CONSENT_EVENT, on)
    expect(seen).toEqual([{ family: 'photo_search', userId: ME, value: 'on' }])
  })
})

describe('gate OFF — nothing changes, anywhere', () => {
  it('never asks: not in either app, not on the web, whatever is stored', async () => {
    gate(false)
    const asker = vi.fn(() => Promise.resolve('off' as const))
    registerAiConsentAsker(asker)
    for (const ua of [IOS_APP, ANDROID_APP, DESKTOP]) {
      vi.restoreAllMocks()
      as(ua)
      store.set(aiConsentKey('listing', ME), 'off')
      expect(aiConsentAskFirst()).toBe(false)
      expect(aiConsentNeeded('listing', ME)).toBe(false)
      expect(await askAiConsent('listing', { userId: ME })).toBe(true)
    }
    expect(asker).not.toHaveBeenCalled()
  })
  it('reads nothing: aiConsentNeeded never touches storage', () => {
    gate(false)
    as(IOS_APP)
    const getItem = vi.fn(() => null)
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() })
    expect(aiConsentNeeded('assistant', ME)).toBe(false)
    expect(getItem).not.toHaveBeenCalled()
  })
})

describe('gate ON', () => {
  it('on the web: never asks', async () => {
    gate(true)
    as(DESKTOP)
    expect(aiConsentNeeded('photo_search', ME)).toBe(false)
    expect(await askAiConsent('photo_search', { userId: ME })).toBe(true)
  })

  it('in either app: needed until allowed — then asks no more', async () => {
    gate(true)
    for (const ua of [IOS_APP, ANDROID_APP]) {
      vi.restoreAllMocks()
      as(ua)
      store.clear()
      expect(aiConsentNeeded('assistant', ME)).toBe(true)
      store.set(aiConsentKey('assistant', ME), 'off')
      expect(aiConsentNeeded('assistant', ME)).toBe(true)
      store.set(aiConsentKey('assistant', ME), 'on')
      expect(aiConsentNeeded('assistant', ME)).toBe(false)
      const asker = vi.fn(() => Promise.resolve('off' as const))
      registerAiConsentAsker(asker)
      expect(await askAiConsent('assistant', { userId: ME })).toBe(true)
      expect(asker).not.toHaveBeenCalled()
    }
  })

  it('not asked yet: the host asks, and its answer is the answer', async () => {
    gate(true)
    as(IOS_APP)
    const asker = vi.fn((_f: string, _u: string) => Promise.resolve('on' as const))
    registerAiConsentAsker(asker)
    expect(await askAiConsent('listing', { userId: ME })).toBe(true)
    expect(asker).toHaveBeenCalledWith('listing', ME, undefined)
  })

  it('uses the account the host mirrors when the call site has none (visual-search.ts)', async () => {
    gate(true)
    as(IOS_APP)
    setAiConsentAccount(ME)
    const asker = vi.fn(() => Promise.resolve('off' as const))
    registerAiConsentAsker(asker)
    expect(aiConsentNeeded('photo_search')).toBe(true)
    expect(await askAiConsent('photo_search')).toBe(false)
    expect(asker).toHaveBeenCalledWith('photo_search', ME, undefined)
  })

  it('askAiConsentAnswer keeps "no answer" apart from "Not now" (the assistant sends nothing on null)', async () => {
    gate(true)
    as(IOS_APP)
    registerAiConsentAsker(vi.fn(async () => null))
    expect(await askAiConsentAnswer('assistant', { userId: ME })).toBeNull()
    expect(await askAiConsent('assistant', { userId: ME })).toBe(false)
    registerAiConsentAsker(vi.fn(async () => 'off' as const))
    expect(await askAiConsentAnswer('assistant', { userId: ME })).toBe('off')
    registerAiConsentAsker(null)
    expect(await askAiConsentAnswer('assistant', { userId: ME })).toBeNull() // no host: nothing can be asked
    expect(await askAiConsentAnswer('assistant')).toBeNull() // signed out
    gate(false)
    expect(await askAiConsentAnswer('assistant', { userId: ME })).toBe('on')
  })

  it('FAILS CLOSED: signed out ⇒ sign-in, not the question; no host ⇒ no', async () => {
    gate(true)
    as(IOS_APP)
    const signIn = vi.fn()
    window.addEventListener('eno:require-signin', signIn)
    const asker = vi.fn(() => Promise.resolve('on' as const))
    registerAiConsentAsker(asker)
    expect(await askAiConsent('photo_search')).toBe(false)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(asker).not.toHaveBeenCalled()
    window.removeEventListener('eno:require-signin', signIn)

    registerAiConsentAsker(null)
    expect(await askAiConsent('photo_search', { userId: ME })).toBe(false)
  })
})
