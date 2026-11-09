/**
 * THE SAVED LISTS ON THIS DEVICE, AND THE ONE LOCK THAT EVERY WRITE TO THEM TAKES (saves across devices, owner 2026-11-09).
 *
 * Two lists, two meanings:
 *   · GUEST_KEY `eno:favorites` — what was saved on this device while signed out (today's list, same key, same meaning).
 *     Sign-out never clears it. At sign-in it MOVES into the account (src/lib/saved-sync.ts): each id leaves it once the
 *     server has stored it, so after a sign-out the device holds nothing of the account.
 *   · ACCOUNT_KEY `eno:favorites:acct` — `{ u, ids }`, ONLY a cache of the account's server list (newest first) for one
 *     account. Nothing in it is not on the server, so dropping it loses nothing: sign-out removes it (sign-out-storage.ts),
 *     and so does the provider when auth settles signed out or as another account.
 *
 * ⛔ ONE LOCK, `withSavedLock` — every read-modify-write of either list, and every request to /api/saved-listings, from
 * every tab of this browser (Web Locks; an in-tab promise chain where a browser has none). Three plan reviews found the
 * races it closes: a merge in one tab deleting a save another tab wrote between its read and its write; an add and a
 * remove of one listing reaching the server in the wrong order; a read answering between a write and its acknowledgement.
 * A write that must see the other tabs' latest list reads it from storage INSIDE the lock — never a copy held in memory.
 */

export const GUEST_KEY = 'eno:favorites'
export const ACCOUNT_KEY = 'eno:favorites:acct'
const LOCK_NAME = 'eno-saved-sync'

type LockManagerLike = { request: <T>(name: string, cb: () => T | Promise<T>) => Promise<T> }
let chain: Promise<unknown> = Promise.resolve()

/** Run `fn` holding the browser-wide saved-lists lock; `fn`'s result (or its rejection) is the promise's. */
export function withSavedLock<T>(fn: () => T | Promise<T>): Promise<T> {
  let locks: LockManagerLike | undefined
  try { locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks } catch { locks = undefined }
  if (locks && typeof locks.request === 'function') return locks.request(LOCK_NAME, fn)
  const run = chain.then(() => fn())
  chain = run.then(() => undefined, () => undefined)
  return run
}

/** Listing ids as stored: strings, at most 64 characters, each once, in order. */
function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))]
}

/** The guest list, oldest save first; [] when absent or unreadable. */
export function readGuest(): string[] {
  try { return ids(JSON.parse(localStorage.getItem(GUEST_KEY) || '[]')) } catch { return [] }
}

/** Read-modify-write of the guest list, synchronous — call it inside withSavedLock. Returns what was written. */
export function updateGuest(fn: (ids: string[]) => string[]): string[] {
  const next = fn(readGuest())
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(next)) } catch { /* storage refused: this page is still right */ }
  return next
}

export type AccountCopy = { u: string; ids: string[] }

/** The cached account list, or null. */
export function readCopy(): AccountCopy | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null') as { u?: unknown; ids?: unknown } | null
    return v && typeof v.u === 'string' && v.u ? { u: v.u, ids: ids(v.ids) } : null
  } catch { return null }
}

/** Store (or, with null, remove) the cached account list. */
export function writeCopy(c: AccountCopy | null): void {
  try {
    if (c) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(c))
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch { /* storage refused */ }
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/**
 * The account the session cookie names — the `sub` of the access token inside the readable `sb-…-auth-token` cookie
 * (@supabase/ssr: `base64-` + base64url JSON, split into `.0`, `.1`… past 3,180 characters; cookie-options.ts keeps it
 * readable on purpose) — or null on ANY doubt: no cookie, two sessions' cookies, a format not understood, or (unless
 * `anyExpiry`) a token that expires within a minute. Used for two things only: which cached account list the first paint
 * may show before auth boots (auth loads lazily, on idle or first input), and whether a write that finished is still
 * the signed-in account's before it touches the cache. Never for anything the server decides — the server reads its
 * own cookie.
 */
export function sessionUidFromCookie(cookie: string, nowMs: number, { anyExpiry = false } = {}): string | null {
  try {
    const chunks = new Map<string, Array<[number, string]>>()
    for (const pair of cookie.split(';')) {
      const s = pair.trim()
      const eq = s.indexOf('=')
      if (eq <= 0) continue
      const m = /^(sb-[A-Za-z0-9_-]+-auth-token)(?:\.(\d+))?$/.exec(s.slice(0, eq))
      if (!m) continue
      const list = chunks.get(m[1]!) ?? []
      list.push([m[2] === undefined ? -1 : Number(m[2]), s.slice(eq + 1)])
      chunks.set(m[1]!, list)
    }
    if (chunks.size !== 1) return null
    const parts = [...chunks.values()][0]!.sort((a, b) => a[0] - b[0])
    // A whole cookie AND chunks of one is a session mid-rewrite — not one to trust.
    if (parts.length > 1 && parts[0]![0] === -1) return null
    const raw = parts.map(([, v]) => decodeURIComponent(v)).join('')
    const json = raw.startsWith('base64-') ? fromBase64Url(raw.slice('base64-'.length)) : raw
    const session = JSON.parse(json) as { access_token?: unknown } | unknown[]
    const token = Array.isArray(session) ? session[0] : (session as { access_token?: unknown })?.access_token
    if (typeof token !== 'string') return null
    const payload = JSON.parse(fromBase64Url(token.split('.')[1] ?? '')) as { sub?: unknown; exp?: unknown }
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    if (!anyExpiry && (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs + 60_000)) return null
    return payload.sub
  } catch { return null }
}
