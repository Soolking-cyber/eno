// Client half of the Google browser-escape handoff. Server half: src/lib/auth/handoff.ts.
//
// ⚠️ A SEPARATE FILE BECAUSE THE SERVER HALF IS `server-only`. Importing these constants from there
// would drag node:crypto and Prisma into the sign-in bundle.

import { isInAppHost, type InAppHost } from '@/lib/in-app-browser'

/** Where the app remembers where the visitor was heading, across an OS kill of the webview. */
export const HANDOFF_NEXT_KEY = 'eno:handoff:next'
export const PAIR_LEN = 6

/**
 * A claim nonce, generated in the app.
 *
 * ⚠️ `crypto.getRandomValues`, never Math.random — this names the row that will hold an
 * authorization code. 32 bytes base64url ⇒ 43 chars, inside the server's 40–90 window.
 */
export function handoffNonce(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Must match normalizePair() on the server, or a correctly-typed code is rejected. */
export function normalizePairInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2')
    .replace(/G/g, '6').replace(/I/g, '1').replace(/O/g, '0')
}

/**
 * WHERE THE VISITOR STARTED THE HAND-OFF (UX3 J2, 2026-10-05) — the app whose built-in browser it was
 * (in-app-browser.ts `inAppHost`), or `pwa` for a home-screen app. It rides the escape URL and the OAuth
 * callback as `via=` so the REAL browser's screens (handoff-confirm/-launch) can say "go back to Zalo"
 * instead of "go back to the eno app", which a Facebook or Zalo visitor was never in.
 * ⛔ AN ALLOW-LISTED WORD, NEVER TEXT: anything else reads as unknown and the screens use neutral copy —
 * a crafted link cannot put words on the page.
 */
export type HandoffVia = InAppHost | 'pwa'
export function parseHandoffVia(v: unknown): HandoffVia | null {
  if (v === 'pwa') return 'pwa'
  return isInAppHost(v) ? v : null
}
