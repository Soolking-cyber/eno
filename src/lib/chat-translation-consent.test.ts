// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatTranslationConsentKey, readChatTranslationConsent, writeChatTranslationConsent } from './chat-translation-consent'

// ── App Store gate `app-ai-notice` (R8, D14): the remembered answer ─────────
// (The bell no longer asks: it never sends an offer's note to /api/translate at all — src/lib/notification-text.ts.)

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
  vi.unstubAllGlobals()
})

describe('the stored answer', () => {
  it('is per account, under chat-tr:consent2:<profile>', () => {
    writeChatTranslationConsent(ME, 'off')
    expect(store.get(`chat-tr:consent2:${ME}`)).toBe('off')
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
  // 2026-11-13: Google (Gemini on Vertex AI) answers when Microsoft cannot, so the notice names both and asks again.
  it('asks again after an OK given to the Microsoft-only notice, but keeps its "Turn off translation"', () => {
    store.set(`chat-tr:consent:${ME}`, 'on')
    expect(readChatTranslationConsent(ME)).toBeNull()
    store.set(`chat-tr:consent:${ME}`, 'off')
    expect(readChatTranslationConsent(ME)).toBe('off')
    // A new answer wins over the old one either way.
    writeChatTranslationConsent(ME, 'on')
    expect(readChatTranslationConsent(ME)).toBe('on')
  })
})
