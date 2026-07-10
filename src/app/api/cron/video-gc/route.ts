import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { videoPathFromUrl } from '@/lib/core/media'
import { streamUidFromUrl } from '@/lib/stream-url'
import { cfStreamConfigured, listStreamVideos, deleteStreamVideo, STREAM_META_SOURCE } from '@/lib/cf-stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function bearerOk(header: string | null, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Nightly GC for the public `listing-videos` bucket (Vercel Cron → vercel.json). Uploads go
// browser→storage BEFORE the listing exists, so an abandoned wizard (or deliberate abuse of
// the signed-URL mint) leaves objects no Listing.video references. Delete anything older
// than 24h that isn't referenced — the age floor guarantees we never race an in-flight
// wizard session. Replace/delete paths evict eagerly (core/listings.ts); this is the backstop.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !bearerOk(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  // Every video URL any listing references (any status — sold/hidden/held listings keep
  // their clip; only truly unreferenced objects are orphans). videoPathFromUrl never throws
  // (a malformed stored URL must not kill the nightly run — one bad row would otherwise
  // leave the orphan backstop permanently dead).
  const rows = await db.listing.findMany({ where: { video: { not: null } }, select: { video: true } })
  const referenced = new Set(rows.map((r) => videoPathFromUrl(r.video!)).filter((p): p is string => !!p))

  const cutoffTs = Date.now() - 24 * 60 * 60 * 1000

  // Cloudflare Stream orphans: direct-upload assets exist BEFORE the listing does, so an
  // abandoned wizard leaves a Stream video no listing references (and CF bills for stored
  // minutes). Same 24h age floor. Only delete videos WE created (meta.source) — an account
  // shared with other Stream content must not have its videos reaped. Best-effort; a CF hiccup
  // must not fail the whole cron, and the Supabase pass below still runs. Bounded per run
  // (batched, capped) so a large first-run backlog can't exhaust the 60s budget and starve the
  // Supabase pass — the remainder is caught on the next nightly run. NOTE: listStreamVideos is
  // a single newest-1000 page; at >~1000 uploads/day this can miss the oldest orphans (a latent
  // cost leak, not a correctness bug — paginate if Stream volume ever gets that high).
  let streamRemoved = 0
  if (cfStreamConfigured()) {
    const refUids = new Set(rows.map((r) => streamUidFromUrl(r.video!)).filter((u): u is string => !!u))
    const vids = await listStreamVideos()
    const orphanUids = vids
      .filter((v) => v.source === STREAM_META_SOURCE && !refUids.has(v.uid))
      .filter((v) => { const born = Date.parse(v.created); return born && born < cutoffTs })
      .map((v) => v.uid)
      .slice(0, 300) // per-run cap → stays inside maxDuration
    for (let i = 0; i < orphanUids.length; i += 10) {
      await Promise.all(orphanUids.slice(i, i + 10).map((uid) => deleteStreamVideo(uid)))
    }
    streamRemoved = orphanUids.length
  }

  const admin = getSupabaseAdmin()
  const cutoff = cutoffTs
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
  return NextResponse.json({ ok: true, referenced: referenced.size, removed: orphans.length, streamRemoved })
}
