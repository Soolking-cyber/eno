// Cross-site navigation to eno.forum. SCOPE (owner one-dashboard spec, 2026-07-18): EXPLICIT
// handoffs only, never core navigation. The callers today (measured 2026-10-06) are exactly two,
// and NEITHER renders in the native apps: the footer's forum links (`html.native #app-footer` is
// display:none) and the help center's "visit the forum" button (`native-app-hidden`). Core
// dashboard navigation (the rail in dashboard-nav.tsx and the home's service cards) is fully
// internal and must never route through here. A plain same-tab cross-domain hop: sessions are
// per-origin cookies, so the reader arrives on the forum as whoever they are THERE.
//
// ⛔ IN THE NATIVE APPS THIS LEAVES THE APP, AND THAT IS THE POINT (owner, 2026-10-06: "ship both
// with eno.vn"). Both apps render eno.vn and eno.forum is not in capacitor.config.ts
// `allowNavigation`, so Capacitor hands this navigation to the SYSTEM browser and the WebView stays
// where it was. The licensed company's app must not render the forum (it carries the e-Visa and
// itinerary services), so never route this through the in-app browser sheet (@capacitor/browser).
// ⚠️ THE NATIVE "SSO HANDOFF" THAT LIVED HERE IS GONE, AND IT WAS ALREADY DEAD. It sent the app to
// `${FORUM_URL}/auth/bridge?next=…`, a route only the DORMANT apps/forum tree ever had: the live
// forum (this repo's services build) answers it 404 (measured 2026-10-06), so an in-app tap landed
// on "page not found". Its minting endpoint, /api/auth/forum-handoff, was deleted with it.
// ⚠️ Default must be the CANONICAL forum host (www). Both forum hosts answer 200 with no redirect
// (measured 2026-10-06), so the apex is a second live origin, not an alias.
export const FORUM_URL = (process.env.NEXT_PUBLIC_FORUM_URL || 'https://www.eno.forum')
  // Env may still carry the apex form; pin canonical here.
  .replace(/^https:\/\/eno\.forum(?=\/|$)/, 'https://www.eno.forum')

export function goToForum(path: string): void {
  // Defense in depth: a caller-supplied path without a leading slash would concatenate into a
  // different HOST (FORUM_URL + 'evil.com'). Every current caller passes app paths, but pin it.
  if (!path.startsWith('/')) path = `/${path}`
  window.location.assign(FORUM_URL + path)
}
