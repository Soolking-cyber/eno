// Client half of the Google browser-escape handoff. Server half: src/lib/auth/handoff.ts.
//
// ⚠️ A SEPARATE FILE BECAUSE THE SERVER HALF IS `server-only`. Importing these constants from there
// would drag node:crypto and Prisma into the sign-in bundle.

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
