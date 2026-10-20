'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectChatLang, foreignTo, threadLanguage } from '@/lib/chat-lang'
import {
  CHAT_TRANSLATION_CONSENT_EVENT,
  chatTranslationAskFirst,
  chatTranslationConsentKey,
  readChatTranslationConsent,
  writeChatTranslationConsent,
  type ChatTranslationConsent,
  type ChatTranslationConsentChange,
} from '@/lib/chat-translation-consent'

// ── Live chat translation (client half) ──────────────────────────────────────────────
//
// Owner ask (2026-07-24): when the buyer's and seller's app languages differ, offer a
// "box to tick" that live-translates the OTHER party's messages into the viewer's own
// language; on a detected mismatch it defaults ON and stays however the user leaves it.
//
// This hook owns the CLIENT contract only. The SERVER endpoint it calls is deliberately
// by-REFERENCE, not by-text (codex plan review): the client sends {conversationId,
// messageIds, target} and the server fetches those rows itself, proves the caller is a
// participant, keeps only INCOMING plain-text messages, and translates them EPHEMERALLY
// (private chat text is never written to the shared translation cache). So this hook
// never sends message CONTENT — only ids — and it fails SAFE: any error (incl. the
// endpoint not existing yet) leaves the original text on screen, chat unaffected.
//
// Cost discipline lives here too: we translate only incoming plain-text bodies, skip
// anything already in the viewer's own script, remember every id we've attempted so a
// poll/realtime re-render never re-requests, and cache by (id + target language) so a
// language switch re-keys instead of serving a stale translation.

type ChatMsg = { id: string; mine: boolean; body: string; kind?: string; pending?: boolean; failed?: boolean; deleted?: boolean }

// `retry`: the server could not translate this one THIS time (see the route) — ask again later, don't bank it.
type TranslateItem = { id: string; text: string; translated: boolean; retry?: boolean }

const MAX_IDS_PER_REQUEST = 50
// The route refuses a request over 5,000 characters (413), and a 4xx is final for every id in it — so three long
// teacher introductions in one batch left the whole backlog untranslated. Pack by characters too, under that cap;
// one message up to the cap itself still goes, alone.
const MAX_CHARS_PER_REQUEST = 4_500
const ROUTE_CHAR_CAP = 5_000

/** Split ids into requests of at most 50 ids and MAX_CHARS_PER_REQUEST characters (one long message rides alone). */
function packBatches(ids: string[], lengthOf: (id: string) => number): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let chars = 0
  for (const id of ids) {
    const len = lengthOf(id)
    if (cur.length && (cur.length >= MAX_IDS_PER_REQUEST || chars + len > MAX_CHARS_PER_REQUEST)) {
      out.push(cur)
      cur = []
      chars = 0
    }
    cur.push(id)
    chars += len
  }
  if (cur.length) out.push(cur)
  return out
}
// Tries per message per mount before it is left as the original. A retry rides the next refetch (the 15s poll,
// realtime, focus), so without a cap it was re-sent — and re-charged against the budget — every 15s for as long as
// the thread stayed open. Two caps: a whole-batch blip (503/429/network — a box restart, a deploy) is worth riding
// out, so 20 (≈5 min of polls); one message marked `retry` — nothing answered it while others translated — gets 4,
// because each try re-runs that line through the model and the paid key (codex, opus, 2026-10-21). A line the box model
// refuses with no paid provider left is not marked `retry` at all: the server answers it as its original, final.
const MAX_TRIES = 4
const MAX_TRANSIENT_TRIES = 20

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable — non-fatal */ }
}

// A plain-text INCOMING message worth translating: not mine, PLAIN TEXT (offer/visa/system
// cards render their own derived copy and must NEVER be translated), has a real body, and
// isn't a still-pending/failed optimistic row.
//
// ⚠️ `kind === 'text'` must be accepted explicitly. `Message.kind` is `@default("text")` in
// the schema and the conversation serializer sends it verbatim, so EVERY real message from
// the API carries kind:'text' — the original `!m.kind` test was true only for optimistic
// client rows, which are always `mine`. That one predicate silently made the whole feature
// a no-op: nothing was ever translatable. Undefined is still allowed for local rows.
function isTranslatable(m: ChatMsg): boolean {
  const plain = !m.kind || m.kind === 'text'
  return !m.mine && plain && !!m.body.trim() && !m.pending && !m.failed && !m.deleted
}

export function useChatTranslation(opts: {
  conversationId: string
  /** The viewer's own profile id — namespaces the on/off preference so a shared device
   *  can't leak one account's choice to another. */
  userId: string | undefined
  /** The viewer's UI language — the translation TARGET. */
  myLang: string
  /** The counterpart's persisted app language (thread.counterpart.locale), or null when
   *  we don't yet know it (a user who has never synced a locale). Null ⇒ no mismatch
   *  claim, so the toggle stays hidden rather than guessing. */
  counterpartLang: string | null | undefined
  messages: ChatMsg[]
}) {
  const { conversationId, userId, myLang, counterpartLang, messages } = opts

  // ⛔ THE MESSAGES DECIDE, NOT ONLY THE STORED LANGUAGE. The strip used to need the counterpart's STORED app
  // language to differ from mine — and that value is often wrong or missing: an account used in English still had
  // 'vi' stored (its language was saved per browser, not per account), every unowned desk (support, rentals) has
  // none, and an account that never synced has none. Then the strip never showed, so nothing was ever translated
  // (owner test, 2026-10-20). Now an incoming line that READS as another language (src/lib/chat-lang.ts — the same
  // detector the server uses) counts too; the stored language still counts on its own.
  // ⚠️ THREAD-LEVEL, NOT ONE LINE: a Vietnamese landlord's 'Thanks' in a Vietnamese thread must not turn it into a
  // translation thread — most of their lines must read as foreign, and there must be enough of them (writesForeign).
  // ⚠️ AND A STALE STORED LANGUAGE NO LONGER RAISES IT ALONE: when their lines clearly read as MY language, a stored
  // value that says otherwise is out of date — no strip, and in the apps no notice for a translation that would never
  // be sent.
  const declared = !!counterpartLang && counterpartLang !== myLang
  const { foreignIds, theirs } = useMemo(() => {
    const ids = new Set<string>()
    const bodies: string[] = []
    for (const m of messages) {
      if (!isTranslatable(m)) continue
      bodies.push(m.body)
      if (foreignTo(detectChatLang(m.body).lang, myLang)) ids.add(m.id)
    }
    return { foreignIds: ids, theirs: threadLanguage(bodies, myLang) }
  }, [messages, myLang])
  // Stored language differs → yes, unless their lines clearly read as mine (stale). Stored language is mine → only
  // strong evidence overrides it. Nothing stored (an unowned desk, an account that never saved one) → one foreign line.
  const mismatch = declared ? !theirs.mine : counterpartLang ? theirs.foreign : theirs.some

  /**
   * ⚠️ APP STORE GATE `app-ai-notice` (plan R8, Guideline 5.1.2(i), D14) — src/lib/chat-translation-consent.ts.
   * Off (the default) ⇒ `askFirst` is false, `consent` is never read, and every line below behaves
   * exactly as it did before the gate existed. On, inside either app: the FIRST time a translation
   * would apply, nothing is requested until the person answers the notice (`needsNotice`); "OK"
   * lets requests go, "Turn off translation" makes the feature unavailable for this account on this
   * device — no strip, no request — until Settings → Preferences turns it back on.
   * ⚠️ THE GATE IS ON THE REQUEST, NOT ON THE RENDER. Hiding a translation that was still fetched would
   * already have sent the text to Microsoft; the fetch effect below refuses to run while
   * `awaitingConsent`, and this hook is the only caller of POST /api/messages/translate.
   */
  const askFirst = chatTranslationAskFirst()
  const [consent, setConsent] = useState<ChatTranslationConsent>(null)
  const available = mismatch && !(askFirst && consent === 'off')
  const awaitingConsent = askFirst && available && consent !== 'on'

  const prefKey = `chat-tr:${userId ?? 'anon'}:${conversationId}`
  const [enabled, setEnabledState] = useState(false)
  // Re-initialize `enabled` synchronously when the conversation/user (prefKey) changes, via
  // React's sanctioned "adjust state during render" pattern — NOT an effect. ThreadPage does
  // not remount when navigating A→B (same [id] segment), and an init EFFECT lags one render:
  // on A(ON)→B(stored OFF) the fetch effect would fire once with A's stale enabled=true for B
  // before the effect corrected it, issuing unwanted requests (codex confirm-pass). Resetting
  // in render commits the correct pref on the SAME render prefKey changed, so no stale-state
  // request is ever issued. Default ON on a fresh mismatch (owner: "box ticked"); a stored
  // per-conversation choice wins. A late-resolving userId simply re-keys once known.
  // `typeof window` gate keeps the SERVER render deterministic (never reads localStorage, so
  // no server-default-ON vs hydrated-OFF mismatch); the real init runs on the client, where
  // the toggle actually renders (it's gated on `thread`, which is null during SSR anyway).
  const [initedKey, setInitedKey] = useState<string | null>(null)
  // `mismatch`, not `available`: with the gate on, `available` itself depends on the consent read here.
  // The consent is re-read on the same render as the toggle, so a stale answer from another account
  // never decides a request (prefKey carries the profile id).
  if (typeof window !== 'undefined' && mismatch && prefKey !== initedKey) {
    setInitedKey(prefKey)
    const stored = safeGet(prefKey)
    setEnabledState(stored ? stored === 'on' : true)
    if (askFirst) setConsent(readChatTranslationConsent(userId))
  }

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
    safeSet(prefKey, value ? 'on' : 'off')
  }, [prefKey])

  /** The notice's answer — 'on' (OK) or 'off' (Turn off translation). Only rendered with the gate on. */
  const answerNotice = useCallback((value: 'on' | 'off') => {
    setConsent(value)
    writeChatTranslationConsent(userId, value)
  }, [userId])

  // The answer can change while this thread is mounted — Settings, another thread, another tab — and the change must
  // stop (or allow) requests here at once. Gate off ⇒ no listener at all.
  useEffect(() => {
    if (!askFirst || !userId) return
    // Same tab: the value rides in the event (a re-read would answer null with storage blocked). Other tabs: `storage`.
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ChatTranslationConsentChange>).detail
      if (d?.userId === userId) setConsent(d.value)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === chatTranslationConsentKey(userId)) setConsent(readChatTranslationConsent(userId))
    }
    window.addEventListener(CHAT_TRANSLATION_CONSENT_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHAT_TRANSLATION_CONSENT_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [askFirst, userId])

  // id+lang → translated text. State (not a ref) so a landed translation repaints the
  // bubble. attempted/inflight are refs — bookkeeping that must not trigger renders.
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const attemptedRef = useRef<Set<string>>(new Set())
  const inflightRef = useRef<Set<string>>(new Set())
  const triesRef = useRef<Map<string, number>>(new Map())
  const cacheKey = useCallback((id: string) => `${id}::${myLang}`, [myLang])
  // Guards setState after UNMOUNT only — never used to discard results on a deps change
  // (a messages append re-runs the effect but the in-flight results are still valid).
  // ⚠️ SET TRUE IN THE EFFECT, NOT ONLY AT INIT: React re-runs effects after a cleanup without remounting — StrictMode
  // does it on purpose, and a thread kept alive by Next's back/forward state cache does it on every return — and a
  // cleanup-only effect left this false for good, so every later batch broke out before sending anything.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    // `awaitingConsent` — the app-ai-notice gate: no answer yet ⇒ no request (see the note above).
    if (!enabled || !available || awaitingConsent) return
    // Which incoming plain-text messages still need a translation into myLang?
    const wanted: string[] = []
    for (const m of messages) {
      if (!isTranslatable(m)) continue
      const key = cacheKey(m.id)
      if (attemptedRef.current.has(key) || inflightRef.current.has(key)) continue
      // Only a line that reads as another language is asked about: one in my language, a greeting both of us know,
      // or one too short to call would come back unchanged from the server anyway.
      if (!foreignIds.has(m.id)) continue
      // Longer than one request may carry: the route would refuse it whole, every time. Left as written.
      if (m.body.length > ROUTE_CHAR_CAP) { attemptedRef.current.add(key); continue }
      wanted.push(m.id)
    }
    if (!wanted.length) return
    wanted.forEach((id) => inflightRef.current.add(cacheKey(id)))

    // NO per-effect "cancelled" flag. A messages append (poll/realtime) re-runs this effect,
    // but the in-flight request's results are STILL VALID for their ids — discarding them and
    // yet marking the ids attempted was a real bug that permanently skipped translation for
    // anything in flight when a message arrived (codex). Each chunk completes and stores;
    // mountedRef guards setState after unmount; the whole backlog is processed in <=50-id
    // chunks so an initial batch over 50 isn't stranded.
    void (async () => {
      const bodyLength = new Map(messages.map((m) => [m.id, m.body.length]))
      const batches = packBatches(wanted, (id) => bodyLength.get(id) ?? 0)
      for (const [n, batch] of batches.entries()) {
        if (!mountedRef.current) {
          // Hidden or gone: release what was not sent, so a return to the thread asks for it again.
          for (const rest of batches.slice(n)) for (const id of rest) inflightRef.current.delete(cacheKey(id))
          break
        }
        let retryable = false
        const retryIds = new Set<string>()
        try {
          const res = await fetch('/api/messages/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // v: 2 — this client honours per-message `retry` (an older tab would bank those ids as done).
            body: JSON.stringify({ conversationId, messageIds: batch, target: myLang, v: 2 }),
          })
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { items?: TranslateItem[] } | null
            if (data?.items && mountedRef.current) {
              const next: Record<string, string> = {}
              for (const it of data.items) {
                if (it.retry) { retryIds.add(it.id); continue }
                const original = messages.find((m) => m.id === it.id)?.body
                // Store only a REAL translation — a degraded passthrough (translated:false or
                // unchanged text) is left as the original so we never label source a translation.
                if (it.translated && it.text && it.text !== original) next[cacheKey(it.id)] = it.text
              }
              if (Object.keys(next).length) setTranslations((prev) => ({ ...prev, ...next }))
            }
          } else if (res.status === 429 || res.status >= 500) {
            // Transient (rate limit / server) — leave the ids un-attempted so a later append
            // retries. A 404 (endpoint absent) or other 4xx is deterministic → mark attempted.
            retryable = true
          }
        } catch {
          retryable = true // network error — fail safe (originals remain), retry on a later append
        } finally {
          // An answer that landed while the thread was hidden (or gone) was not shown: leave its ids free, so coming
          // back asks again rather than banking them as done.
          const shown = mountedRef.current
          batch.forEach((id) => {
            const k = cacheKey(id)
            inflightRef.current.delete(k)
            if (!shown) return
            if (!retryable && !retryIds.has(id)) { attemptedRef.current.add(k); return }
            const tries = (triesRef.current.get(k) ?? 0) + 1
            triesRef.current.set(k, tries)
            if (tries >= (retryable ? MAX_TRANSIENT_TRIES : MAX_TRIES)) attemptedRef.current.add(k)
          })
        }
      }
    })()
  }, [enabled, available, awaitingConsent, messages, foreignIds, myLang, conversationId, cacheKey])

  // A message recalled AFTER it was translated keeps no translation: the bubble is a tombstone now.
  const deletedIds = useMemo(() => new Set(messages.filter((m) => m.deleted).map((m) => m.id)), [messages])
  const translationFor = useCallback(
    (id: string): string | undefined =>
      enabled && available && !awaitingConsent && !deletedIds.has(id) ? translations[cacheKey(id)] : undefined,
    [enabled, available, awaitingConsent, translations, cacheKey, deletedIds],
  )

  // The one-time notice shows where the strip would be, and only while a translation WOULD apply: a
  // conversation the person already unticked asks nothing until they tick it again, and a thread with no
  // incoming message yet has nothing to translate, so it asks nothing yet either (opus, review of this change).
  const needsNotice = awaitingConsent && enabled && messages.some(isTranslatable)
  // The "Translate messages" strip. Before permission it would show a TICKED box for a translation that has not been
  // allowed, so while awaiting an answer it shows only for a thread the person had unticked (ticking it then asks);
  // otherwise the notice — or, in a thread with nothing incoming yet, nothing — stands in its place (codex, review of
  // this change). Gate off ⇒ `awaitingConsent` is false and this is `available`, as before.
  const showToggle = available && !(awaitingConsent && enabled)

  return { available, enabled, setEnabled, translationFor, needsNotice, answerNotice, showToggle }
}
