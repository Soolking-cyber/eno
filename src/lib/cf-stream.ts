import 'server-only'

// Server-only Cloudflare Stream API client. Holds the API token; all authenticated calls
// (mint a direct-upload URL, poll processing status, delete) go through here. Playback-URL
// construction is isomorphic and lives in src/lib/stream-url.ts (no token). Every call is
// best-effort and NEVER throws — a CF outage must degrade the upload/GC path, not 500 it.

const ACCOUNT = process.env.CF_ACCOUNT_ID || ''
const TOKEN = process.env.CF_STREAM_API_TOKEN || ''
const SUB = process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_SUBDOMAIN || ''
const API = 'https://api.cloudflare.com/client/v4'

// Marker stamped into every upload's meta so the GC cron only ever deletes videos WE created.
// Without it, an account shared with other Stream content (a manual test upload, another app)
// would see its videos reaped as "unreferenced orphans". GC deletes strictly meta.source ===
// this value.
export const STREAM_META_SOURCE = 'eno-listing'

/** All three must be present for the Stream path to be live. When false, the upload/lifecycle
 *  code falls back to the Supabase direct-upload path — so the whole integration is a no-op
 *  until the owner sets these env vars. */
export function cfStreamConfigured(): boolean {
  return !!(ACCOUNT && TOKEN && SUB)
}

async function cf(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API}/accounts/${ACCOUNT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  })
}

/** Mint a one-time direct-creator-upload URL. The browser POSTs the file straight to
 *  uploadURL (upload.videodelivery.net) — never through our function — so the 4.5MB Vercel
 *  body limit never applies. maxDurationSeconds is CF's own hard duration gate. */
export async function createStreamDirectUpload(maxDurationSeconds: number, creator?: string): Promise<{ uid: string; uploadURL: string } | null> {
  try {
    const res = await cf('/stream/direct_upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // meta.source lets the GC cron distinguish our uploads from any other Stream content in
      // the account; meta.creator binds the asset to its uploader (audit/ownership).
      body: JSON.stringify({
        maxDurationSeconds,
        requireSignedURLs: false,
        meta: { source: STREAM_META_SOURCE, ...(creator ? { creator } : {}) },
      }),
    })
    const j = (await res.json().catch(() => null)) as { success?: boolean; result?: { uid?: string; uploadURL?: string } } | null
    if (!res.ok || !j?.success || !j.result?.uid || !j.result?.uploadURL) {
      console.error('[cf-stream] direct_upload', res.status, JSON.stringify(j?.result ?? j))
      return null
    }
    return { uid: j.result.uid, uploadURL: j.result.uploadURL }
  } catch (e) {
    console.error('[cf-stream] direct_upload', e)
    return null
  }
}

export type StreamStatus = {
  uid: string
  ready: boolean
  state: string // pendingupload | downloading | queued | inprogress | ready | error
  hls: string | null
  thumbnail: string | null
  duration: number // seconds, -1 = unknown
}

/** Poll a video's processing status. Returns null on API error (caller treats as "keep
 *  waiting" — never a hard failure). */
export async function getStreamVideo(uid: string): Promise<StreamStatus | null> {
  try {
    const res = await cf(`/stream/${uid}`, { method: 'GET' })
    const j = (await res.json().catch(() => null)) as {
      success?: boolean
      result?: { readyToStream?: boolean; status?: { state?: string }; playback?: { hls?: string }; thumbnail?: string; duration?: number }
    } | null
    if (!res.ok || !j?.success || !j.result) return null
    const r = j.result
    return {
      uid,
      ready: !!r.readyToStream,
      state: r.status?.state || 'unknown',
      hls: r.playback?.hls || null,
      thumbnail: r.thumbnail || null,
      duration: typeof r.duration === 'number' ? r.duration : -1,
    }
  } catch {
    return null
  }
}

/** Best-effort delete (video replace / listing delete / GC of an orphaned upload). */
export async function deleteStreamVideo(uid: string): Promise<void> {
  try {
    await cf(`/stream/${uid}`, { method: 'DELETE' })
  } catch (e) {
    console.error('[cf-stream] delete', uid, e)
  }
}

/** One page of the account's Stream library (newest first), for the GC cron to reconcile
 *  against Listing.video. Bounded — the cron only needs to find recently-orphaned uploads. */
export async function listStreamVideos(limit = 1000): Promise<Array<{ uid: string; created: string; source: string | null }>> {
  try {
    const res = await cf(`/stream?limit=${limit}`, { method: 'GET' })
    const j = (await res.json().catch(() => null)) as {
      success?: boolean
      result?: Array<{ uid: string; created: string; meta?: { source?: string } }>
    } | null
    if (!res.ok || !j?.success || !Array.isArray(j.result)) return []
    return j.result.map((v) => ({ uid: v.uid, created: v.created, source: v.meta?.source ?? null }))
  } catch (e) {
    console.error('[cf-stream] list', e)
    return []
  }
}
