import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit, kv } from '@/lib/ratelimit'
import { db } from '@/lib/db'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { VIDEO_PATH_RE, VIDEO_MAX_BYTES } from '@/lib/core/media'
import { transcodeToMp4 } from '@/lib/core/video-transcode'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const maxDuration = 300 // Vercel Pro ceiling — a ≤60s clip transcodes in well under this

// Third step of the video upload (self-hosted transcode). After the raw clip is verified in the
// bucket (/complete), this downloads it server-side, re-encodes to a lean, universally-playable
// H.264 MP4 (fixes HEVC-plays-black; cuts egress), uploads the result, deletes the raw, and
// exposes the compressed URL.
//
// SUBMIT-THEN-POLL (GCP migration, 2026-07-19): the synchronous form ran to ~210s, which any
// ~100s proxy budget (Cloudflare's orange cloud at cutover) would sever mid-flight. POST
// CLAIMS the job (kv NX lease), runs the encode via after() — the Cloud Run service keeps
// CPU allocated post-response, and Vercel honors maxDuration — and returns 202
// {status:'running'}; the client polls GET ?path= until done/failed. If the claim write
// itself errors it falls back to the old synchronous form, and the client handles both shapes.
//
// Fail policy (computed server-side into the job's final state): for an H.264 source, a failure
// FALLS OPEN to the raw clip (already compatible — never block a publish on an ffmpeg hiccup).
// For an HEVC source it FAILS CLOSED — the raw clip plays black on most Android buyers, so we
// surface a retry instead. The `hevc` flag is the client's fourcc probe.

type JobState =
  | { state: 'running'; startedAt: number; token?: string }
  | { state: 'done'; url: string; fallback?: boolean }
  | { state: 'failed' }

const jobKey = (path: string) => `xc:${path}`
const CLAIM_TTL_S = 360 // > the 210s encode wall + upload margin; a crashed job frees in ≤6min
const DONE_TTL_S = 7200

// `persist` (async mode only) durably records the final state BEFORE the raw source is
// deleted: if the state write fails or the container dies right after the delete, a
// re-submit would re-fetch an already-deleted path and the seller's clip would be lost
// with no usable replacement (external review, 2026-07-19). Raw kept on persist failure —
// the GC cron sweeps it later; a resubmit then simply re-encodes.
async function runTranscode(path: string, hevc: boolean, persist?: (s: JobState) => Promise<boolean>): Promise<JobState> {
  const admin = getSupabaseAdmin()
  const rawUrl = admin.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(path).data.publicUrl
  // H.264 falls open to the raw playable clip; HEVC fails closed (see header comment).
  const fallback = (): JobState => (hevc ? { state: 'failed' } : { state: 'done', url: rawUrl, fallback: true })

  // STREAM the raw object to a temp file (never the whole ≤50MB clip on the heap — an
  // arrayBuffer() would double-copy it and risk OOM alongside the ffmpeg child).
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

    const done: JobState = { state: 'done', url: admin.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(newPath).data.publicUrl }
    // State durability BEFORE the destructive step (see persist doc above). Sync mode
    // (no persist) responds in the same request, so deletion can proceed directly.
    const recorded = persist ? await persist(done) : true
    if (recorded) {
      // Compressed clip is live — evict the raw source (best-effort; the GC cron is the backstop).
      // ⚠️ CHECK THE RETURNED `error`, DO NOT `.catch()` IT. supabase-js does not reject on an API
      // failure: StorageFileApi.handleOperation catches internally and returns `{ data: null, error }`
      // unless `shouldThrowOnError` is set (verified in
      // node_modules/@supabase/storage-js/dist/index.mjs). So a `.catch()` here is DEAD CODE for the
      // realistic failure — a permissions or bucket error — and an earlier version of this line had
      // exactly that, which is worse than the bare swallow it replaced because it looks handled.
      const { error: rmErr } = await admin.storage.from(LISTING_VIDEOS_BUCKET).remove([path])
      if (rmErr) logError(rmErr, { op: 'transcode.evictRawSource', bucket: LISTING_VIDEOS_BUCKET })
    }
    return done
  } catch (e) {
    console.error('[transcode] job', e)
    return fallback()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((e) => logError(e, { op: 'transcode.rm' }))
  }
}

const respond = (job: JobState) =>
  job.state === 'running'
    ? NextResponse.json({ status: 'running' }, { status: 202 })
    : job.state === 'failed'
      ? NextResponse.json({ error: 'transcode_failed' }, { status: 422 })
      : NextResponse.json({ url: job.url, ...(job.fallback ? { fallback: true } : {}) })

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

    // OWNERSHIP GATE. The client supplies `path`, and the job DELETES it after transcoding.
    // A listing's video URL is public, so a malicious caller could pass another listing's path
    // and destroy its clip. Refuse any path already referenced by a listing: a legitimate raw
    // upload is transcoded BEFORE its listing is created, so it's referenced by nothing (count
    // 0); a live video is referenced (count > 0) and must never be touched here. Fresh
    // unreferenced paths aren't discoverable (the URL isn't exposed until a listing exists +
    // the name carries 6 random chars), so this both blocks the delete and the arbitrary fetch.
    const referenced = await db.listing.count({ where: { video: rawUrl } })
    if (referenced > 0) return NextResponse.json({ error: 'already_in_use' }, { status: 409 })

    // Claim the job. NX means a double-submit (retry, double-tap) attaches to the running
    // job instead of racing a second encode against the same source. The token FENCES the
    // worker: if the lease somehow expires mid-job and a successor claims, the stale worker
    // sees a token mismatch and neither writes state nor deletes the raw (external review).
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const claim: JobState = { state: 'running', startedAt: Date.now(), token }
    let won: unknown
    try {
      won = await kv.set(jobKey(path), JSON.stringify(claim), { nx: true, ex: CLAIM_TTL_S })
    } catch (e) {
      // A kv outage must not lose the old fail-open behavior — run synchronously instead.
      console.error('[transcode] claim', e)
      return respond(await runTranscode(path, hevc))
    }
    if (won !== 'OK') {
      const existing = await kv.get<string | JobState>(jobKey(path))
      if (existing) return respond(typeof existing === 'string' ? (JSON.parse(existing) as JobState) : existing)
      // Claim raced its own expiry — extremely narrow; ask the client to retry.
      return NextResponse.json({ error: 'retry' }, { status: 503 })
    }

    after(async () => {
      const persist = async (s: JobState) => {
        try {
          // Fence: only the claim holder may write. (GET→SET is a narrow window, but the
          // hazard it guards — a lease lost DURING a ≤300s job under a 360s TTL — needs
          // minutes-scale drift, so best-effort fencing is proportionate here.)
          const cur = await kv.get<string | JobState>(jobKey(path))
          const curJob = cur == null ? null : typeof cur === 'string' ? (JSON.parse(cur) as JobState) : cur
          if (curJob && curJob.state === 'running' && curJob.token !== token) return false
          await kv.set(jobKey(path), JSON.stringify(s), { ex: DONE_TTL_S })
          return true
        } catch (e) { console.error('[transcode] state write', e); return false }
      }
      const final = await runTranscode(path, hevc, persist)
      // Success already persisted pre-delete (idempotent re-write); this records the
      // failure/fallback outcomes, which have no destructive step to order against.
      await persist(final)
    })
    return respond(claim)
  } catch (e) {
    console.error('[POST /api/upload/video/transcode]', e)
    return NextResponse.json({ error: 'transcode_failed' }, { status: 500 })
  }
}

// Poll a submitted job. Same auth as POST; 'unknown' (404) covers an expired/never-claimed
// key — the claim TTL outlives any legitimate poll window, so the client treats it as failed.
export async function GET(req: NextRequest) {
  const profileId = await getCurrentProfileId()
  if (!profileId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // A full poll window is ≤80 requests (3s × 4min); 600/h covers several clips per hour.
  const limit = await rateLimit('upload-video-transcode-poll', profileId, 600, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const path = new URL(req.url).searchParams.get('path') || ''
  if (!VIDEO_PATH_RE.test(path)) return NextResponse.json({ error: 'bad_path' }, { status: 400 })
  const raw = await kv.get<string | JobState>(jobKey(path)).catch(() => null)
  if (!raw) return NextResponse.json({ error: 'unknown' }, { status: 404 })
  const job = typeof raw === 'string' ? (JSON.parse(raw) as JobState) : raw
  return job.state === 'running'
    ? NextResponse.json({ status: 'running' })
    : job.state === 'failed'
      ? NextResponse.json({ status: 'failed' })
      : NextResponse.json({ status: 'done', url: job.url, ...(job.fallback ? { fallback: true } : {}) })
}
