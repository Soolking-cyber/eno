import { fold } from './fold'

// Pure @handle rules — client-safe (no db / server-only), shared by the server lib
// (src/lib/handle.ts), the editor UI, the /@name route, and unit tests.

/** Canonical form: starts with a letter, then letters/digits/underscore, 3–30 chars. */
export const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/

// Names that must never be claimable: every top-level route (so /@x can't shadow or
// impersonate an app page) + platform-identity words an impersonator would want.
// Keep lowercase. Route additions should be mirrored here.
const RESERVED = new Set([
  // app routes
  'about', 'account', 'admin', 'api', 'appeal', 'auth', 'brands', 'c', 'dashboard',
  'developers', 'guide', 'help', 'listings', 'messages', 'onboard', 'post', 'privacy',
  'prohibited', 'regulations', 'reports', 'safety', 'saved', 'search', 'sellers',
  'signin', 'signup', 'sitemap', 'terms', 'trust',
  // platform identity / staff impersonation
  'eno', 'enovn', 'eno_vn', 'official', 'support', 'moderator', 'mod', 'staff',
  'team', 'security', 'verify', 'verified', 'system', 'notifications', 'billing',
  'payment', 'payments', 'root', 'www', 'mail', 'info', 'contact', 'login', 'logout',
  'settings', 'user', 'null', 'undefined', 'anonymous',
])

export function isReservedHandle(h: string): boolean {
  return RESERVED.has(h)
}

/** Validate an already-lowercased candidate. Returns an error code or null when OK. */
export function validateHandle(h: string): 'invalid' | 'reserved' | null {
  if (!HANDLE_RE.test(h)) return 'invalid'
  if (isReservedHandle(h)) return 'reserved'
  return null
}

/** "Nguyễn Văn Ánh" → "nguyen_van_anh", "Apple Store" → "apple_store".
 *  Diacritics fold to ASCII; anything non-alphanumeric collapses to single "_".
 *  Guarantees a VALID base (letter-first, ≥3 chars) — pads/prefixes when the
 *  source name can't supply one (e.g. an all-digit or all-emoji name). */
export function slugifyHandle(name: string | null | undefined): string {
  let s = fold(String(name || ''))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 30)
    .replace(/_+$/, '')
  if (!/^[a-z]/.test(s)) s = `u${s}`.slice(0, 30).replace(/_+$/, '')
  while (s.length < 3) s += String(Math.floor(Math.random() * 10))
  return s
}
