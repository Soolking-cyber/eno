// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * The Telegram chat and the WhatsApp Business line on /contact (owner, 2026-11-27: "link telegram chat and whatsap business
 * line 0772007921 in eno.vn footer app"). The apps hide the footer, so this row is where an app user finds them: same row
 * as the email chip, plain new-window anchors (in the app the system opens WhatsApp / Telegram), in both languages.
 */

vi.setConfig({ testTimeout: 60_000 })
// The page chrome and a client island that read auth; nothing here is about them.
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/support-chat-chip', () => ({ SupportChatChip: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderContact(lang: 'en' | 'vi') {
  vi.resetModules()
  // A stored choice, so the provider's mount-time reconcile keeps `lang` (jsdom reports en-US).
  const store = new Map<string, string>([['lang', lang]])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  })
  const { default: ContactPage } = await import('./page')
  const { LanguageProvider } = await import('@/context/language-context')
  return render(<LanguageProvider initialLang={lang} initialViDict={{}}><ContactPage /></LanguageProvider>).container
}

describe('/contact — the chat lines', () => {
  for (const lang of ['en', 'vi'] as const) {
    it(`${lang}: links the Telegram chat and the WhatsApp line beside the email chip`, async () => {
      const container = await renderContact(lang)
      const mail = container.querySelector('a[href^="mailto:"]')
      expect(mail).not.toBeNull()
      for (const [href, text] of [['https://t.me/eno_vn', 'Telegram'], ['https://wa.me/84772007921', 'WhatsApp']] as const) {
        const a = container.querySelector(`a[href="${href}"]`)
        expect(a, href).not.toBeNull()
        expect(a?.textContent, href).toBe(text)
        expect(a?.getAttribute('target'), href).toBe('_blank')
        expect(a?.getAttribute('rel'), href).toBe('noopener noreferrer')
        expect(a?.parentElement, href).toBe(mail?.parentElement)
      }
    })
  }
})
