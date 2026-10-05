/**
 * APP STORE GATE `app-ai-notice` (Guideline 5.1.2(i): say where personal data goes to a third-party AI, and get
 * permission first) — the GOOGLE half. The Microsoft half is chat translation (src/lib/chat-translation-consent.ts);
 * this file is its twin for every feature that sends what a person types, or a photo they choose, to Google — one
 * remembered answer per FEATURE FAMILY, asked once, before that family's first request.
 *
 * Measured 2026-10-05 — every user action that reaches Google AI (src/app/api/ai/*, every getGemini() caller outside
 * admin, every Vertex AI Search caller):
 *
 *   assistant     /messages/ai → POST /api/ai/concierge: the last turns of that chat (Gemini, to understand the
 *                 request and word the reply) and the search words (Vertex AI Search).
 *                 "Not now" WORKS WITHOUT AI: the request carries `ai: false`, and the route answers from its own
 *                 keyword reading of the message and the Postgres search — no Google call.
 *   listing       post wizard "Autofill from photo" → POST /api/ai/classify (the cover photo, Gemini Vision) and
 *                 "Polish with AI" → POST /api/ai/rephrase (the description, Gemini).
 *                 "Not now": unavailable — the seller fills the form in, which is how it works without AI anyway.
 *   photo_search  the camera button and pasting an image into search → POST /api/ai/visual-search (the photo,
 *                 Gemini Vision). "Not now": unavailable; typed search still works.
 *   trip          eno.forum's trip desk: "Build my plan" → /api/itineraries/generate, stay and stop suggestions →
 *                 /api/itineraries/[id]/stays|stops/suggest, and the trip chat's Eno concierge → /api/trips/concierge
 *                 (the trip answers — cities, dates, travellers, budget, interests, notes — and the questions; Gemini).
 *                 "Not now": unavailable; the desk's people still answer in the trip chat. Its words live in
 *                 trip-cards.tsx, which eno.vn's build aliases away (a gate decides what renders, an alias what ships).
 *
 * Handled without a question: typed SEARCH (/api/listings → semanticRank → Vertex AI Search). In the apps with the gate
 * on, the route never sends search words to Google (semantic-rank.ts `noAi`), so there is nothing to ask permission for.
 * Not gated, and why (docs/ios-appstore-release.md §6): the visa desk's AI (passport/portrait check, visa concierge) —
 * the iOS app cannot reach it with `ios-hide-visa` on; publish-time moderation (ai-moderation.ts) and the search index
 * (listing-index.ts) — eno's own processing of a listing someone chose to publish, not a feature they invoke; admin.
 *
 * ⚠️ DEVICE STORAGE, PER ACCOUNT — the chat-translation answer's constraint, for the same reason: there is no
 * server-side preference without a schema change (chat-translation-consent.ts says why). Key
 * `ai:consent:<family>:<profileId>`; a new device, or another account on this one, asks again — the safe direction.
 * Every family is members-only — each route answers 401 to a signed-out caller before Google is called — so a
 * signed-out tap goes to sign-in rather than to the question. When storage is blocked or full the answer is still kept
 * for the rest of the page load, in memory (`memory` below), so nothing asks twice.
 *
 * ⛔ A CLIENT GATE, BY DESIGN — AND THE SERVER DOES NOT PRETEND OTHERWISE (codex, review: "most enforcement is bypassable
 * at the API boundary"). The answer is per account PER DEVICE and lives only on that device, so no route can know it. A
 * header the app sends to say "allowed" would only repeat what the same client already decided — the server could not
 * check it — while every call site that forgot it would silently break a feature in the app; that is theatre, not
 * enforcement. What the server does enforce is what it CAN know: `ai: false` (the assistant's "Not now") switches Gemini
 * and Vertex off for that turn (api/ai/concierge), and typed search from either app never reaches Vertex (api/listings,
 * by user agent). Everything else rests on the call sites, each of which asks before its request and is tested for it;
 * the apps load this site's current code, so there is no stale client to slip past them. A real server-side guarantee
 * needs the server-side preference (a Profile column — the schema change the runbook lists as the follow-up).
 *
 * Off by default: with NEXT_PUBLIC_APP_REVIEW_GATES unset, `aiConsentAskFirst()` is false, so `aiConsentNeeded()` is
 * false before anything is read, `askAiConsent()` answers true at once, no notice is mounted, and every request is
 * byte-for-byte what it was — on the web and in both apps.
 */
import { nativeAppGate } from './app-review-gates'

export const AI_FAMILIES = ['assistant', 'listing', 'photo_search', 'trip'] as const
export type AiFamily = (typeof AI_FAMILIES)[number]

/** 'on' = allowed (in the notice or in Settings); 'off' = "Not now" / turned off; null = not asked yet. */
export type AiConsent = 'on' | 'off' | null

/** What the notice says for one family, already in the reader's language. */
export type AiConsentCopy = {
  /** The question, e.g. "Use Google AI to search by photo?" */
  title: string
  /** Who receives what, and what "Not now" leaves working. */
  body: string
  /** Toast after "Not now". */
  declined: string
  /** Toast when the feature is tapped while the answer is already "off"; null = say nothing (it works without AI). */
  off: string | null
}

/**
 * Client: must the Google AI features ask first? The gate is on AND this is either native app — the same both-apps rule
 * as chat translation (chatTranslationAskFirst): Play's User Data policy asks the same of the same WebView, and the two
 * apps should not differ on what goes to Google. False during SSR.
 */
export function aiConsentAskFirst(): boolean {
  return nativeAppGate('app-ai-notice')
}

export const aiConsentKey = (family: AiFamily, userId: string): string => `ai:consent:${family}:${userId}`

/**
 * The signed-in account, mirrored by AiConsentHost (which sits under AuthProvider) so a call site with no auth context
 * of its own — src/lib/visual-search.ts — can ask too. Call sites that hold `user` pass its id instead.
 */
let account: string | null = null
export function setAiConsentAccount(userId: string | null): void {
  account = userId
}

/**
 * ⚠️ EVERY ANSWER GIVEN ON THIS PAGE IS ALSO KEPT HERE, so blocked or full storage (a private window, a full quota) still
 * holds it until the page is left (codex + opus, review: without this, "Allow" was forgotten the instant it was given —
 * search by photo asked twice in a row, and Settings could not move its switch). Storage is read FIRST, because it is the
 * one place another tab's change lands; this is the fallback when storage has nothing or cannot be read.
 */
const memory = new Map<string, 'on' | 'off'>()
/** Tests only: forget this page's answers. */
export function forgetAiConsentMemory(): void {
  memory.clear()
}

export function readAiConsent(family: AiFamily, userId: string | null | undefined = account): AiConsent {
  if (!userId) return null
  const key = aiConsentKey(family, userId)
  try {
    const v = localStorage.getItem(key)
    if (v === 'on' || v === 'off') return v
  } catch {
    /* storage blocked — this page's own answer, if it gave one */
  }
  return memory.get(key) ?? null
}

/** Same-tab change signal (`storage` fires only in OTHER tabs). The value travels in the event — see chat-translation-consent.ts. */
export const AI_CONSENT_EVENT = 'eno:ai-consent'
export type AiConsentChange = { family: AiFamily; userId: string; value: 'on' | 'off' }

export function writeAiConsent(family: AiFamily, userId: string | null | undefined, value: 'on' | 'off'): void {
  if (!userId) return
  const key = aiConsentKey(family, userId)
  memory.set(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage refused the write: the answer holds for this page (memory) and the next visit asks again. An OLDER stored
    // answer must not outvote it — storage is read first — so remove it if that is still allowed.
    try { localStorage.removeItem(key) } catch { /* blocked outright */ }
  }
  try { window.dispatchEvent(new CustomEvent<AiConsentChange>(AI_CONSENT_EVENT, { detail: { family, userId, value } })) } catch { /* no window */ }
}

/**
 * Sync: does this family still need an answer (or has it been refused) before its request? False with the gate off, on
 * the web, and once allowed — so `if (aiConsentNeeded(f) && !(await askAiConsent(f))) return` costs a gate-off build
 * nothing but this call, with no await.
 */
export function aiConsentNeeded(family: AiFamily, userId: string | null | undefined = account): boolean {
  return aiConsentAskFirst() && readAiConsent(family, userId) !== 'on'
}

/** The host's answer: 'on' (Allow), 'off' ("Not now", or already off), null (not answered — Escape — or VOID: the page
 *  or the account changed while it was open, or nothing could be asked). */
type Asker = (family: AiFamily, userId: string, copy: AiConsentCopy | undefined) => Promise<AiConsent>
let asker: Asker | null = null
/** AiConsentHost registers the function that shows the notice; null on unmount. */
export function registerAiConsentAsker(next: Asker | null): void {
  asker = next
}

/**
 * Resolve true when this family may send its request now. With the gate on, in either app: true once allowed; otherwise
 * the host shows the one-time notice (not asked yet) or says the feature is off ('off'), and the answer comes back.
 * ⛔ FAILS CLOSED: no account → sign-in instead (the route would refuse it before Google anyway); no host to show the
 * notice → false. `copy` is required for families whose words cannot live in shared code (trip); the host knows the rest.
 */
export function askAiConsent(family: AiFamily, opts?: { userId?: string | null; copy?: AiConsentCopy }): Promise<boolean> {
  if (!aiConsentAskFirst()) return Promise.resolve(true)
  return askAiConsentAnswer(family, opts).then((answer) => answer === 'on')
}

/**
 * The same question, keeping "Not now" apart from "no answer". For the one family that WORKS without AI (the assistant):
 * 'off' sends its keyword-only request, but null — Escape, or a question voided because the person left the page or the
 * account changed while it was open — must send NOTHING (codex, review: treating every non-yes as "Not now" resumed a
 * voided question under another session). With the gate off it answers 'on' at once.
 */
export function askAiConsentAnswer(family: AiFamily, opts?: { userId?: string | null; copy?: AiConsentCopy }): Promise<AiConsent> {
  if (!aiConsentAskFirst()) return Promise.resolve('on')
  const userId = opts?.userId ?? account
  if (!userId) {
    try { window.dispatchEvent(new CustomEvent('eno:require-signin')) } catch { /* no window */ }
    return Promise.resolve(null)
  }
  if (readAiConsent(family, userId) === 'on') return Promise.resolve('on')
  if (!asker) return Promise.resolve(null)
  return asker(family, userId, opts?.copy)
}

/** For useSyncExternalStore: re-read on a change made here (the event) or in another tab (`storage`). */
export function subscribeAiConsent(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith('ai:consent:')) onChange() }
  window.addEventListener(AI_CONSENT_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(AI_CONSENT_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}
