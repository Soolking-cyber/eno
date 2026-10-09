import { dropIntent } from '@/lib/pending-intent'
/**
 * What sign-out removes from THIS DEVICE, so the next person on a shared phone or laptop does not
 * open the previous account's inbox, AI chat or half-written drafts.
 *
 * ⛔ THE KEYS ARE LITERALS HERE, AND A TEST HOLDS EACH ONE TO ITS OWNER'S SOURCE. sign-out used to
 * remove `eno-convos` and `eno-thr:*` while chat-context.tsx had moved its caches to `eno-convos-v2`
 * and `eno-thr2:*` — so every sign-out left the inbox and every opened thread behind, and nothing
 * failed. Several owners are pages or components that a lib must not import (the AI chat page, the
 * teacher form), so the names cannot be imported; sign-out-storage.test.ts reads each owner's file
 * and fails when a key here no longer appears there.
 *
 * ⚠️ NOT EVERYTHING ON THE DEVICE IS PER-ACCOUNT. Theme, language, currency, the consent answer,
 * recent searches, favourites and the install-hint counters belong to the device or the visitor and
 * stay. /privacy's on-device table says which is which.
 */

/** Exact localStorage keys. */
export const SIGN_OUT_LOCAL_KEYS: readonly string[] = [
  'eno-convos-v2', //          inbox cache — src/context/chat-context.tsx CONVOS_KEY
  'eno-convos', //             the pre-v2 inbox cache, still on devices that never reopened the inbox
  'eno-saved-cache', //        saved-listings cache — src/context/favorites-context.tsx SAVED_KEY
  'eno-account', //            legacy account cache
  'eno-dashboard', //          seller dashboard cache — src/hooks/use-dashboard.ts CACHE_KEY
  'eno-notifs', //             notifications cache — src/context/notifications-context.tsx
  'eno-listing-draft', //      the unpublished /post draft text — src/components/marketplace/post-wizard.tsx
  'eno:ai_chat_v1', //         the eno AI conversation — src/app/[lang]/messages/ai/page.tsx STORE_KEY
  'eno.teacherDraft.v1', //    the teacher-profile draft — src/components/teachers/teacher-form.tsx DRAFT_KEY
]

/** localStorage key PREFIXES (every key that starts with one goes). */
export const SIGN_OUT_LOCAL_PREFIXES: readonly string[] = [
  'eno-thr2:', //              per-thread caches — src/context/chat-context.tsx THREAD_PREFIX
  'eno-thr:', //               the pre-v2 thread caches
  'eno:rental-check', //       availability basket + its request draft — src/lib/rental-check/store.ts
]

/**
 * Exact sessionStorage keys. The composer hand-off: the message (or offer) a signed-in buyer was
 * sending, parked for /messages/pending — which RE-STASHES it when the send fails, so it can outlive
 * the attempt and would otherwise greet the next person to sign in on this tab.
 */
export const SIGN_OUT_SESSION_KEYS: readonly string[] = [
  'eno-compose', //            src/lib/quick-contact.ts COMPOSE_KEY
  // A guest's action waiting to be finished after sign-in (UX3 J5) — spent on use; a leftover must not
  // greet the next person to sign in on this tab.
  'eno:pending-intent', //     src/lib/pending-intent.ts INTENT_KEY
  // ⛔ The teacher-profile draft (name, phone, bio) moved to THIS TAB's sessionStorage (teacher-form.tsx DRAFT_KEY,
  // 2026-10-08) while this list still only cleared its old localStorage copy (kept above for devices that hold one):
  // the next person to open /teachers/join in the tab within its 15 minutes got the previous person's details back.
  'eno.teacherDraft.v1', //    src/components/teachers/teacher-form.tsx DRAFT_KEY
]

/** sessionStorage key PREFIXES (the basket's first-add hint). */
export const SIGN_OUT_SESSION_PREFIXES: readonly string[] = [
  'eno:rental-check', //       HINT_KEY — src/lib/rental-check/store.ts
]

function keysOf(store: Storage): string[] {
  // ⚠️ length/key(i), NOT Object.keys(store): Object.keys only lists stored keys on a real Storage,
  // and returns the method names on any wrapper or stub — the loop works on both.
  const out: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k !== null) out.push(k)
  }
  return out
}

function clearFrom(store: Storage | undefined, exact: readonly string[], prefixes: readonly string[]): void {
  if (!store) return
  try {
    for (const k of exact) store.removeItem(k)
    for (const k of keysOf(store)) if (prefixes.some((p) => k.startsWith(p))) store.removeItem(k)
  } catch { /* storage blocked — nothing was kept there either */ }
}

/** Remove every per-account key above. Never throws. */
export function clearAccountDeviceStorage(local?: Storage, session?: Storage): void {
  // ⛔ AND THE PENDING ACTION'S MEMORY COPY (codex, gate 2026-10-05): once a write to sessionStorage has failed,
  // pending-intent.ts keeps the action in memory and reads that instead — removing the key below would leave
  // it for whoever signs in next on this page. dropIntent clears both.
  dropIntent()
  let ls = local
  let ss = session
  try { ls ??= typeof localStorage === 'undefined' ? undefined : localStorage } catch { ls = undefined }
  try { ss ??= typeof sessionStorage === 'undefined' ? undefined : sessionStorage } catch { ss = undefined }
  clearFrom(ls, SIGN_OUT_LOCAL_KEYS, SIGN_OUT_LOCAL_PREFIXES)
  clearFrom(ss, SIGN_OUT_SESSION_KEYS, SIGN_OUT_SESSION_PREFIXES)
}
