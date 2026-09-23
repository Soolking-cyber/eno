import 'server-only'
import { after } from 'next/server'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { reindexListing } from '@/lib/listing-index'
import { logError } from '@/lib/log'

/**
 * Above this many ids, purge the whole /listings/[id] route once instead of path by path — the same
 * cap the partner-stock and affiliate-price crons use.
 */
export const REVALIDATE_CAP = 3000

/**
 * A listing's PUBLIC state changed (taken down, held, published, deleted): drop its cached page and
 * re-sync AI search, so what the world sees follows the database.
 *
 * ⛔ EVERY PATH THAT CHANGES WHETHER A LISTING IS PUBLIC CALLS THIS, AND THREE DID NOT. The listing
 * page is ISR with a 30-day window (listings/[id]/page.tsx: "real edits/status/sold/moderation
 * revalidate ON-DEMAND"), so a takedown that skips the purge keeps serving the page — content, price,
 * Product JSON-LD — for up to a month. Found in the 2026-09-23 audit: the admin bulk tool (hide /
 * delete / unverify purged only "/"), and the AI-moderation and image-provenance auto-holds (no purge
 * at all, and the edit path had just re-rendered the page with the prohibited content before the
 * hold landed). (Audit findings #2, #18, #25.)
 *
 * Works with or without a request scope (routes, after(), cron, scripts): each purge is tried on its
 * own — `continue`, not `break`, so one failure cannot leave the rest stale — and the reindex runs in
 * after() when there is one. reindexListing upserts a still-public row and deletes anything else,
 * so the same call serves a takedown and a publish.
 */
export function refreshListingSurfaces(ids: string[], op = 'listingSurfaces', opts: { home?: boolean } = {}): void {
  if (!ids.length) return
  // ⚠️ A failed purge is LOGGED ONCE, not swallowed: outside a request scope every call throws, and a
  // takedown whose purge silently did nothing is exactly the bug this helper exists to end.
  let logged = false
  const purge = (path: string, type?: 'layout') => {
    try { if (type) revalidatePublicPath(path, type); else revalidatePublicPath(path) } catch (e) {
      if (!logged) { logged = true; logError(e, { op: `${op}.purge`, path }) }
    }
  }
  // 'layout', not 'page': the PDP sits in a route group, so its page tag is `…/[id]/(pdp)/page` and a
  // 'page' pattern purge matches nothing (listings/[id]/(pdp)/layout.tsx).
  if (ids.length > REVALIDATE_CAP) purge('/listings/[id]', 'layout')
  else for (const id of ids) purge(`/listings/${id}`)
  // The home page's ISR HTML (6h) carries listings in its first-paint rails — an auto-held listing
  // must not stay there either.
  if (opts.home) purge('/')
  const reindex = async () => {
    for (const id of ids) await reindexListing(id).catch((e) => logError(e, { op: `${op}.reindex`, listingId: id }))
  }
  try { after(reindex) } catch { void reindex() }
}
