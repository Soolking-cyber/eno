import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { db } from '@/lib/db'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { VIDEO_PATH_RE, VIDEO_MAX_BYTES } from '@/lib/core/media'
import { transcodeToMp4 } from '@/lib/core/video-transcode'

export const runtime = 'nodejs'
export const maxDuration = 300 // Vercel Pro ceiling — a ≤60s clip transcodes in well under this

// Third step of the video upload (self-hosted transcode). After the raw clip is verified in the
// bucket (/complete), this downloads it server-side (no Vercel body limit on an outbound fetch),
// re-encodes to a lean, universally-playable H.264 MP4 (fixes HEVC-plays-black; cuts egress),
// uploads the result, deletes the raw, and returns the compressed URL.
//
// Fail policy: for an H.264 source, a transcode failure FALLS OPEN to the raw clip (already
// compatible — never block a publish on a Vercel/ffmpeg hiccup). For an HEVC source, it FAILS
// CLOSED (422) — the raw clip plays black on most Android buyers, so shipping it is worse than
// asking the seller to retry. The `hevc` flag is the client's fourcc probe.
export async function POST(req: NextRequest) {
  try {
    const profileId = await getCurrentProfileId()
    if (!profileId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
    const limit = await rateLimit('upload-video-transcode', profileId, 30, '1 h')
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

    const body = (await req.json().catch(() => ({}))) as { path?: unknown; hevc?: unknown }
    const path = String(body.path || '')
    const hevc = body.hevc === true
    if (!VIDEO_PATH_RE.test(path)) return NextResponse.json({ error: 'bad_path' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const rawUrl = admin.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(path).data.publicUrl

    // OWNERSHIP GATE. The client supplies `path`, and this route DELETES it after transcoding.
    // A listing's video URL is public, so a malicious caller could pass another listing's path
    // and destroy its clip. Refuse any path already referenced by a listing: a legitimate raw
    // upload is transcoded BEFORE its listing is created, so it's referenced by nothing (count
    // 0); a live video is referenced (count > 0) and must never be touched here. Fresh
    // unreferenced paths aren't discoverable (the URL isn't exposed until a listing exists +
    // the name carries 6 random chars), so this both blocks the delete and the arbitrary fetch.
    const referenced = await db.listing.count({ where: { video: rawUrl } })
    if (referenced > 0) return NextResponse.json({ error: 'already_in_use' }, { status: 409 })

    const fallback = () =>
      hevc
        ? NextResponse.json({ error: 'transcode_failed' }, { status: 422 }) // don't ship black-on-Android HEVC
        : NextResponse.json({ url: rawUrl, fallback: true }) // H.264 is already playable

    // STREAM the raw object to a temp file (never the whole ≤50MB clip on the heap — an
    // arrayBuffer() would double-copy it and risk OOM alongside the ffmpeg child). An outbound
    // fetch isn't subject to the function body limit.
    const dir = await mkdtemp(join(tmpdir(), 'xin-'))
    const inPath = join(dir, 'in')
    try {
      const res = await fetch(rawUrl)
      if (!res.ok || !res.body) return fallback()
      await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(inPath))
      const { size } = await stat(inPath)
      if (size === 0 || size > VIDEO_MAX_BYTES) return fallback()

      const out = await transcodeToMp4(inPath)
      if (!out) return fallback()

      const newPath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
      const { error: upErr } = await admin.storage
        .from(LISTING_VIDEOS_BUCKET)
        .upload(newPath, out, { contentType: 'video/mp4', upsert: false, cacheControl: '31536000' })
      if (upErr) { console.error('[transcode] upload', upErr.message); return fallback() }

      // Compressed clip is live — evict the raw source (best-effort; the GC cron is the backstop).
      await admin.storage.from(LISTING_VIDEOS_BUCKET).remove([path]).catch(() => {})

      const url = admin.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(newPath).data.publicUrl
      return NextResponse.json({ url })
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  } catch (e) {
    console.error('[POST /api/upload/video/transcode]', e)
    return NextResponse.json({ error: 'transcode_failed' }, { status: 500 })
  }
}
