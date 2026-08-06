import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { videoPathFromUrl } from '@/lib/core/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Nightly GC for the public `listing-videos` bucket (Vercel Cron → vercel.json). Uploads go
// browser→storage BEFORE the listing exists, so an abandoned wizard (or deliberate abuse of
// the signed-URL mint) leaves objects no Listing.video references. Delete anything older
// than 24h that isn't referenced — the age floor guarantees we never race an in-flight
// wizard session. Replace/delete paths evict eagerly (core/listings.ts); this is the backstop.
//
// ⚠️ WS6 MIGRATION — `auth: 'cron'`. One of five byte-identical `bearerOk()` copies, now a single
// timing-safe comparison in `src/lib/api/handler.ts`. All four branches unchanged:
//   · unset CRON_SECRET, or a missing/malformed/wrong Bearer token → `{"error":"forbidden"}` 401
//   · a storage `list()` error → `{"error":"<supabase message>"}` 500
//   · a storage `remove()` error → `{"error":"<supabase message>","orphans":…}` 500
//   · success → `{"ok":true,"referenced":…,"removed":…}` 200
//
// ⚠️ THE TWO 500s KEEP RETURNING A `NextResponse` ON PURPOSE, which is why the import survives.
// Their body is `error.message` — a free-form Supabase string, NOT a member of `ApiErrorCode` —
// so `ApiError`/`apiFail` cannot express it and `throw` would flatten both into
// `{"error":"internal_error"}`, losing the only diagnostic the nightly job emits. `route()`
// passes a returned `Response` straight through, so these two are byte-identical.
//
// ⚠️ ONE ACCEPTED WIRE CHANGE, AS A SHAPE: any unhandled throw in this handler now returns
// `{"error":"internal_error"}` 500 instead of Next's default 500 HTML. The two storage failures
// above are *returns*, not throws, and are unaffected.
export const GET = route({ auth: 'cron' }, async () => {
  // Every video URL any listing references (any status — sold/hidden/held listings keep
  // their clip; only truly unreferenced objects are orphans). videoPathFromUrl never throws
  // (a malformed stored URL must not kill the nightly run — one bad row would otherwise
  // leave the orphan backstop permanently dead).
  const rows = await db.listing.findMany({ where: { video: { not: null } }, select: { video: true } })
  const referenced = new Set(rows.map((r) => videoPathFromUrl(r.video!)).filter((p): p is string => !!p))

  const admin = getSupabaseAdmin()
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const orphans: string[] = []
  // Paginate the flat bucket root; object names embed their mint timestamp, but prefer the
  // storage-reported created_at when present (covers any legacy/odd names).
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const { data, error } = await admin.storage.from(LISTING_VIDEOS_BUCKET).list('', { limit: 1000, offset })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const f of data ?? []) {
      if (!f.name.includes('.')) continue // folder placeholder
      if (referenced.has(f.name)) continue
      const born = f.created_at ? Date.parse(f.created_at) : Number(f.name.split('-')[0]) || 0
      if (born && born < cutoff) orphans.push(f.name)
    }
    if (!data || data.length < 1000) break
  }

  if (orphans.length) {
    const { error } = await admin.storage.from(LISTING_VIDEOS_BUCKET).remove(orphans)
    if (error) return NextResponse.json({ error: error.message, orphans: orphans.length }, { status: 500 })
  }
  return { ok: true, referenced: referenced.size, removed: orphans.length }
})
