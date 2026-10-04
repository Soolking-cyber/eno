/**
 * IS THIS PAGE PART OF "EXPLORE"? — the phone tab bar's current-scope rule (NAV-5, UX3 2026-10-05).
 *
 * Explore used to light only on the exact home path, so on a category page, a listing, a seller or a
 * storefront nothing in the icon-only bar said where the reader was (research R9; Baymard 2025: 95% of
 * sites miss "current scope", and on mobile its absence hurt most for visitors who land directly on a
 * product page). The browse surfaces are the pages you reach by exploring:
 *
 *   /  ·  /c/*  ·  /listings/*  ·  /sellers/*  ·  /s/* (storefronts)  ·  /brands
 *
 * each also under the `/vi` pilot prefix (`/vi`, `/vi/c/…`). Saved, Messages, Account and Post keep their
 * own paths and are never Explore.
 * ⚠️ WHOLE SEGMENTS ONLY: `/s/apple` is a storefront, `/saved` and `/sellersomething` are not.
 * ⚠️ A STATEMENT ABOUT THE SECTION, NOT A LINK TARGET: the Explore tab still links the home root and only
 * an exact home re-tap scrolls to the top (mobile-nav.tsx). The storefront's clean `/<handle>` URL is not
 * matched — a single segment cannot be told from /about or a guide without a lookup, and the one that exists
 * (handle-format.ts `isReservedHandle`, which mirrors the route tree) pulls ~50 KB of guide registries into the
 * chunk every page loads (codex asked for it at the gate; the bytes cost more than the light is worth).
 */
const BROWSE_SECTIONS = ['/c', '/listings', '/sellers', '/s', '/brands'] as const

export function isBrowseSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const path = pathname === '/vi' ? '/' : pathname.startsWith('/vi/') ? pathname.slice(3) : pathname
  // ⛔ A LISTING PAGE, NOT THE SELLER'S OWN FORMS UNDER IT (opus, gate 2026-10-05): `/listings/<id>/edit` is the post
  // wizard — Account work, never Explore — so under /listings only the listing page itself counts.
  if (path.startsWith('/listings/')) return path.split('/').length === 3
  return path === '/' || BROWSE_SECTIONS.some((s) => path === s || path.startsWith(`${s}/`))
}
