// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatTextTranslationAllowed, chatTranslationConsentKey, readChatTranslationConsent, writeChatTranslationConsent } from './chat-translation-consent'

// ── App Store gate `app-ai-notice` (R8, D14): the remembered answer, and the check other surfaces use ─────────
// chatTextTranslationAllowed is what the notification bell asks before machine-translating an offer's note.

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
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
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const as = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)

describe('the stored answer', () => {
  it('is per account, under chat-tr:consent:<profile>', () => {
    writeChatTranslationConsent(ME, 'off')
    expect(store.get(chatTranslationConsentKey(ME))).toBe('off')
    expect(readChatTranslationConsent(ME)).toBe('off')
    expect(readChatTranslationConsent('someone-else')).toBeNull()
  })
  it('ignores junk and a missing account', () => {
    store.set(chatTranslationConsentKey(ME), 'maybe')
    expect(readChatTranslationConsent(ME)).toBeNull()
    expect(readChatTranslationConsent(undefined)).toBeNull()
    writeChatTranslationConsent(undefined, 'on')
    expect(store.size).toBe(1)
  })
})

describe('chatTextTranslationAllowed', () => {
  it('gate OFF: always allowed — nothing changes, in the app or on the web', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(IOS_APP)
    store.set(chatTranslationConsentKey(ME), 'off')
    expect(chatTextTranslationAllowed(ME)).toBe(true)
  })
  it('gate ON, on the web: allowed', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(DESKTOP)
    expect(chatTextTranslationAllowed(ME)).toBe(true)
  })
  it('gate ON, in the app: only after OK', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(IOS_APP)
    expect(chatTextTranslationAllowed(ME)).toBe(false)
    store.set(chatTranslationConsentKey(ME), 'off')
    expect(chatTextTranslationAllowed(ME)).toBe(false)
    store.set(chatTranslationConsentKey(ME), 'on')
    expect(chatTextTranslationAllowed(ME)).toBe(true)
    expect(chatTextTranslationAllowed(undefined)).toBe(false)
  })
})
