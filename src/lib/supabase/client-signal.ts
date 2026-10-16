/**
 * ⛔ "A SUPABASE BROWSER CLIENT EXISTS IN THIS DOCUMENT" — replayable, and free of any Supabase import (speed plan item 7,
 * 2026-10-16).
 *
 * auth-context no longer boots supabase-js on an anonymous visitor's first touch (a 66 KB chunk and 141–388 ms of
 * evaluation at 4× CPU, landing on exactly that touch). Whatever creates the client instead — the sign-in form, the
 * handoff page, any client-side Supabase use — wakes it through this, so a session minted in this document is always
 * heard (auth-context.tsx says which paths mint one).
 *
 * ⚠️ REPLAYABLE, NOT A ONE-SHOT EVENT. A child's mount effect runs BEFORE AuthProvider's (React runs effects child-first),
 * so a `window` event fired then would find no listener — and the client is a singleton, so it never fires again.
 * `onClientCreated` therefore answers at once when the client already exists.
 * ⚠️ auth-context imports THIS module, never `./browser` statically: that would pull the 66 KB chunk into every page's
 * first JavaScript.
 */
let created = false
const listeners = new Set<() => void>()

/** createSupabaseBrowser() calls this once, right after it creates the per-tab client. */
export function noteClientCreated(): void {
  if (created) return
  created = true
  // A copy: a listener (auth-context's init) unsubscribes itself while this loop runs.
  for (const l of [...listeners]) l()
}

/** Runs `cb` once a client exists — at once if one already does. Returns the unsubscribe. */
export function onClientCreated(cb: () => void): () => void {
  if (created) {
    cb()
    return () => {}
  }
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Tests only: the flag is module state, so it would carry from one test into the next. */
export function __resetClientSignalForTests(): void {
  created = false
  listeners.clear()
}
