import { scopedListingWhere } from '@/lib/edition-scope'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { sendPushToProfile } from '@/lib/push'
import { buildListingWhere, toUrlParams, type SavedSearchParams } from '@/lib/saved-search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_SEARCHES = 5000 // safety cap per run
const CONCURRENCY = 10

// Saved-search alerts (Vercel Cron → vercel.json). Guarded by CRON_SECRET. For each
// notify-on saved search, count listings created since the last alert that match its
// filters; if any, drop one in-app notification (type 'saved_search' → deep-links to
// the results URL) + a Web Push, then advance lastNotifiedAt so matches don't repeat.
//
// ⚠️ WS6 MIGRATION — `auth: 'cron'`. One of five byte-identical `bearerOk()` copies, now a single
// timing-safe comparison in `src/lib/api/handler.ts`. All three branches unchanged:
//   · unset CRON_SECRET, or a missing/malformed/wrong Bearer token → `{"error":"forbidden"}` 401
//   · no notify-on searches → `{"ok":true,"notified":0}` 200 (the early return below; a plain
//     object serialises to the same bytes `NextResponse.json()` produced)
//   · success → `{"ok":true,"searches":…,"notified":…,"pushed":…}` 200
//
// ⚠️ ONE ACCEPTED WIRE CHANGE, AS A SHAPE: any unhandled throw in this handler now returns
// `{"error":"internal_error"}` 500 instead of Next's default 500 HTML. The per-search work is
// already caught inside the fan-out (a single bad search must not kill the run), but the
// `db.savedSearch.findMany` above it is bare.
export const GET = route({ auth: 'cron' }, async () => {
  const runStart = new Date()
  const searches = await db.savedSearch.findMany({
    where: { notify: true },
    orderBy: { lastNotifiedAt: 'asc' },
    take: MAX_SEARCHES,
    select: { id: true, profileId: true, label: true, params: true, lastNotifiedAt: true },
  })
  if (searches.length === 0) return { ok: true, notified: 0 }

  let notified = 0
  let pushed = 0
  for (let i = 0; i < searches.length; i += CONCURRENCY) {
    const batch = searches.slice(i, i + CONCURRENCY)
    const res = await Promise.all(
      batch.map(async (s) => {
        let params: SavedSearchParams
        try { params = JSON.parse(s.params) } catch { return { notified: 0, pushed: 0 } }
        try {
          const matches = await db.listing.count({
            // ⚠️ SCOPED HERE, NOT INSIDE buildListingWhere. That helper is shared with the browse
            // feed, which already carries the scope via andFilters — pushing it in there too would
            // double-apply it and couple two surfaces that should stay independent.
            where: await scopedListingWhere({ AND: [buildListingWhere(params), { createdAt: { gt: s.lastNotifiedAt } }] }),
          })
          if (matches === 0) return { notified: 0, pushed: 0 }
          const title = matches === 1 ? '🔔 New match for your saved search' : `🔔 ${matches} new matches for your saved search`
          const body = `${s.label} — tap to view.`
          const url = `/?${toUrlParams(params)}`
          // Create the notification and advance the cursor atomically so a mid-run crash
          // can't leave the search stuck re-notifying the same matches every run.
          await db.$transaction([
            db.notification.create({ data: { recipientId: s.profileId, type: 'saved_search', title, body, url } }),
            db.savedSearch.update({ where: { id: s.id }, data: { lastNotifiedAt: runStart } }),
          ])
          // Web Push is best-effort — a push failure must not re-trigger the alert.
          let sent = 0
          try { sent = await sendPushToProfile(s.profileId, { title, body, url, tag: `eno-saved-${s.id}` }) }
          catch (e) { console.error('[cron] saved-search push failed for', s.id, e) }
          return { notified: 1, pushed: sent }
        } catch (e) {
          console.error('[cron] saved-search alert failed for', s.id, e)
          return { notified: 0, pushed: 0 }
        }
      }),
    )
    for (const r of res) { notified += r.notified; pushed += r.pushed }
  }

  return { ok: true, searches: searches.length, notified, pushed }
})
