'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { detectContentLang } from '@/lib/detect-lang'

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

type ChatMsg = { id: string; mine: boolean; body: string; kind?: string; pending?: boolean; failed?: boolean }

type TranslateItem = { id: string; text: string; translated: boolean }

const MAX_IDS_PER_REQUEST = 50

// Map a supported UI language to the coarse script `detectContentLang` reports, so we can
// cheaply skip a message the counterpart already wrote in the viewer's own script (no API
// call, no cost). Latin-script langs (en/fr/ms/vi-as-plain-latin…) map to null here and
// simply fall through to the server, which is the correct place to make the call for them.
function scriptOf(lang: string): string | null {
  const base = lang.split('-')[0]
  switch (base) {
    case 'ko': return 'ko'
    case 'ja': return 'ja'
    case 'zh': return 'zh'
    case 'ru': return 'ru'
    case 'th': return 'th'
    default: return null
  }
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable — non-fatal */ }
}

// A plain-text INCOMING message worth translating: not mine, no structured `kind`
// (offer/visa/system cards render their own derived copy and must NEVER be translated),
// has a real body, and isn't a still-pending/failed optimistic row.
function isTranslatable(m: ChatMsg): boolean {
  return !m.mine && !m.kind && !!m.body.trim() && !m.pending && !m.failed
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

  // A mismatch requires BOTH languages known and different. myLang is always known; the
  // counterpart's is null until their locale syncs, and we never invent one.
  const available = !!counterpartLang && counterpartLang !== myLang

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
  if (typeof window !== 'undefined' && available && prefKey !== initedKey) {
    setInitedKey(prefKey)
    const stored = safeGet(prefKey)
    setEnabledState(stored ? stored === 'on' : true)
  }

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
    safeSet(prefKey, value ? 'on' : 'off')
  }, [prefKey])

  // id+lang → translated text. State (not a ref) so a landed translation repaints the
  // bubble. attempted/inflight are refs — bookkeeping that must not trigger renders.
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const attemptedRef = useRef<Set<string>>(new Set())
  const inflightRef = useRef<Set<string>>(new Set())
  const cacheKey = useCallback((id: string) => `${id}::${myLang}`, [myLang])
  // Guards setState after UNMOUNT only — never used to discard results on a deps change
  // (a messages append re-runs the effect but the in-flight results are still valid).
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    if (!enabled || !available) return
    // Which incoming plain-text messages still need a translation into myLang?
    const wanted: string[] = []
    for (const m of messages) {
      if (!isTranslatable(m)) continue
      const key = cacheKey(m.id)
      if (attemptedRef.current.has(key) || inflightRef.current.has(key)) continue
      // Already in the viewer's own script — no translation needed, no API call.
      if (scriptOf(myLang) && detectContentLang(m.body) === scriptOf(myLang)) {
        attemptedRef.current.add(key)
        continue
      }
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
      for (let i = 0; i < wanted.length; i += MAX_IDS_PER_REQUEST) {
        if (!mountedRef.current) break
        const batch = wanted.slice(i, i + MAX_IDS_PER_REQUEST)
        let retryable = false
        try {
          const res = await fetch('/api/messages/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId, messageIds: batch, target: myLang }),
          })
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { items?: TranslateItem[] } | null
            if (data?.items && mountedRef.current) {
              const next: Record<string, string> = {}
              for (const it of data.items) {
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
          batch.forEach((id) => {
            const k = cacheKey(id)
            inflightRef.current.delete(k)
            if (!retryable) attemptedRef.current.add(k)
          })
        }
      }
    })()
  }, [enabled, available, messages, myLang, conversationId, cacheKey])

  const translationFor = useCallback(
    (id: string): string | undefined => (enabled && available ? translations[cacheKey(id)] : undefined),
    [enabled, available, translations, cacheKey],
  )

  return { available, enabled, setEnabled, translationFor }
}
