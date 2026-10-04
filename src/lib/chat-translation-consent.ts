/**
 * APP STORE GATE `app-ai-notice` (plan R8, Guideline 5.1.2(i), decision D14) — the remembered answer
 * to "may chat messages go to Microsoft to be translated?".
 *
 * Live chat translation sends the OTHER person's messages to Microsoft (Azure AI Translator) — the
 * paid provider `translateBatch` asks first for chat (src/lib/translate.ts `payFor`, LATENCY_CRITICAL),
 * with the self-hosted model only as its fallback. Guideline 5.1.2(i) wants explicit permission before
 * personal data goes to a third-party AI, so with the gate on the apps ask ONCE, before the first
 * request, and nothing leaves the device until the answer is OK (src/hooks/use-chat-translation.ts).
 * "Turn off translation" stops every request for that account on that device; Settings → Preferences
 * turns it back on (src/components/marketplace/chat-translation-setting.tsx).
 *
 * ⚠️ DEVICE STORAGE, PER ACCOUNT — AND THAT IS A CONSTRAINT, NOT A PREFERENCE. There is no server-side
 * translation preference to reuse: per-user settings here are Profile boolean columns
 * (`weeklyDigestOptIn`, `dailyReminderOptIn` + /api/profile/*-prefs), so a new one is a schema change —
 * and a Prisma column deployed before its DDL breaks every unscoped Profile read with 42703 (CLAUDE.md,
 * "Migrate the DB BEFORE deploying"). kv_store is UNLOGGED, so it cannot hold a consent record. The key
 * sits beside the per-conversation `chat-tr:<user>:<conversation>` toggles the hook already keeps here,
 * namespaced by the profile id so a shared device never carries one account's answer to another, and —
 * like those — it is not removed on sign-out. A new device asks again, which is the safe direction.
 * ⚠️ So the opt-out is enforced on the CLIENT: the hook is the only caller of POST
 * /api/messages/translate, and with the answer "off" (or no answer yet) it never calls it.
 *
 * Off by default: with NEXT_PUBLIC_APP_REVIEW_GATES unset `chatTranslationAskFirst()` is false, nothing
 * reads or writes the key, and chat translation behaves exactly as before on the web and in both apps.
 */
import { nativeAppGate } from './app-review-gates'

/** 'on' = the person said OK (in the notice or in Settings); 'off' = turned off; null = not asked yet. */
export type ChatTranslationConsent = 'on' | 'off' | null

/** `chat-tr:consent:<profileId>` — never collides with `chat-tr:<profileId>:<conversationId>` (a uuid is never "consent"). */
export const chatTranslationConsentKey = (userId: string): string => `chat-tr:consent:${userId}`

/**
 * Client: must chat translation ask first? The gate is on AND this is either native app. "Both apps",
 * not just iOS: Play's User Data policy and Data-safety form carry the same disclosure duty for the
 * same WebView, and the token follows the file's naming rule (`app-*` = both apps, `ios-*` = iOS only).
 * False during SSR — every caller reads it in client-only code (the thread page's translation strip
 * renders only once the thread has loaded; Settings mounts the row after hydration).
 */
export function chatTranslationAskFirst(): boolean {
  return nativeAppGate('app-ai-notice')
}

export function readChatTranslationConsent(userId: string | null | undefined): ChatTranslationConsent {
  if (!userId) return null
  try {
    const v = localStorage.getItem(chatTranslationConsentKey(userId))
    return v === 'on' || v === 'off' ? v : null
  } catch {
    return null // storage blocked — treated as "not asked yet", so nothing is sent without an answer
  }
}

/** Same-tab change signal — `storage` fires only in OTHER tabs, so a mounted chat would otherwise keep a stale answer. */
export const CHAT_TRANSLATION_CONSENT_EVENT = 'eno:chat-tr-consent'

export function writeChatTranslationConsent(userId: string | null | undefined, value: 'on' | 'off'): void {
  if (!userId) return
  try {
    localStorage.setItem(chatTranslationConsentKey(userId), value)
  } catch {
    /* storage unavailable — the answer still holds for this page's state; the next visit asks again */
  }
  // ⚠️ ANNOUNCED, so every mounted chat follows the new answer at once (codex, review of this change: a thread that had
  // read "on" kept sending after Settings said "off"). The VALUE travels in the event, not via a re-read: with storage
  // blocked a re-read answers null and would wipe the answer the person just gave (caught by the thread-page test).
  try { window.dispatchEvent(new CustomEvent<ChatTranslationConsentChange>(CHAT_TRANSLATION_CONSENT_EVENT, { detail: { userId, value } })) } catch { /* no window */ }
}

export type ChatTranslationConsentChange = { userId: string; value: 'on' | 'off' }
