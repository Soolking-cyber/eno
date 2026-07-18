// Cross-site navigation to eno.forum. WEB: a plain same-tab cross-domain hop (sessions are
// per-origin cookies — the forum mints its own). NATIVE (the one Capacitor app): route
// through the forum's /auth/bridge, which nonce-binds this browser and bounces through
// eno.vn's minting endpoint so the forum origin gets its own session without re-login
// (see src/app/api/auth/forum-handoff/route.ts for the full three-hop diagram). Signed-out
// or failed handoffs land on the forum as a guest — the tap always goes somewhere.
// ⚠️ Default must be the CANONICAL forum host (www): the handoff redirect chain carries a
// single-use token, and an apex→www hop would drag it through extra edge logs.
export const FORUM_URL = (process.env.NEXT_PUBLIC_FORUM_URL || 'https://www.eno.forum')
  // Env may still carry the apex form; the apex 308s to www, so pin canonical here.
  .replace(/^https:\/\/eno\.forum(?=\/|$)/, 'https://www.eno.forum')

export function goToForum(path: string): void {
  // Defense in depth: a caller-supplied path without a leading slash would concatenate into a
  // different HOST (FORUM_URL + 'evil.com'). Every current caller passes app paths, but pin it.
  if (!path.startsWith('/')) path = `/${path}`
  const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  if (!isNative) {
    window.location.assign(FORUM_URL + path)
    return
  }
  window.location.assign(`${FORUM_URL}/auth/bridge?next=${encodeURIComponent(path)}`)
}
