'use client'

// The PostWizard's media machinery (photos + optional video): state, add/remove/
// reorder handlers, blob-URL lifecycle, and the submit-time upload + transcode
// resolvers. Moved out of post-wizard.tsx VERBATIM (no behaviour change) so the
// wizard file keeps only the wizard state machine and composition. Everything here
// closes over this hook's own state exactly as it did inline; the only new surface
// is the explicit `edit`/`t` params and the returned bundle. `uploadPhotos` /
// `resolveVideoUrl` throw the same error codes ('upload' / 'video' / 'video_hevc')
// that the wizard's submit catch maps to user-facing copy.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { compressVideo, videoCompressionSupported } from '@/lib/video-compress'
import { compressImageFile } from '@/lib/normalize-image'
import { uploadInBatches } from '@/lib/upload-client'
import { usePointerReorder } from '@/hooks/use-pointer-reorder'

export type PostMedia = ReturnType<typeof usePostMedia>

export function usePostMedia({
  edit,
  t,
}: {
  // Structural subset of ListingEditData (post-wizard.tsx) — typed locally so this
  // hook stays import-acyclic with the wizard.
  edit?: { images?: string[]; video?: string | null }
  t: (vi: string, en: string) => string
}) {
  // In edit mode, existing images seed as URL-only entries (no File); new uploads add a
  // File. Submit uploads only the File ones and keeps the URL ones (preserving order).
  const [photos, setPhotos] = useState<{ url: string; file?: File }[]>(() => edit?.images?.map((url) => ({ url })) ?? [])
  // Optional single video: url-only in edit mode (already hosted); a new pick carries a File
  // + a blob: preview URL. ≤60s (duration-gated client-side) — autoplays on hover + in the feed.
  const [video, setVideo] = useState<{ url: string; file?: File; hevc?: boolean } | null>(() => (edit?.video ? { url: edit.video } : null))
  const [videoBusy, setVideoBusy] = useState(false)

  const [converting, setConverting] = useState(false)
  // Drag-to-reorder photos (touch + mouse) — index 0 is the cover.
  const movePhoto = (from: number, to: number) =>
    setPhotos((arr) => {
      if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
      const next = [...arr]
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  const { bind: bindPhoto, dragging: draggingPhoto } = usePointerReorder(movePhoto)

  // Every blob: URL the wizard mints, revoked in one mount-scoped cleanup so an
  // abandoned wizard doesn't leak photo/video object URLs for the session's
  // lifetime. Mid-session revokes (video replace/remove) stay where they are —
  // double-revoking is a harmless no-op.
  const blobUrls = useRef<Set<string>>(new Set())
  const trackBlobUrl = (url: string) => { blobUrls.current.add(url); return url }
  useEffect(() => {
    const urls = blobUrls.current
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)) }
  }, [])

  const addPhotos = async (files: FileList | File[] | null) => {
    if (!files) return
    // Accept images incl. HEIC/HEIF (which lack an image/* type on some browsers).
    // The slice is only a coarse pre-bound (don't compress 20 picks) — the REAL cap
    // lives inside the functional updater below, because `photos.length` here is a
    // render-closure value that goes stale across the async compress awaits.
    const incoming = Array.from(files)
      .filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
      .slice(0, Math.max(0, 6 - photos.length))
    if (!incoming.length) return
    setConverting(true)
    try {
      for (const f of incoming) {
        try {
          // HEIC (iPhone) → JPEG + downscale/recompress in-browser so it previews,
          // uploads small (no 413 on big phone photos), and AI-reads cleanly.
          const norm = await compressImageFile(f)
          const url = trackBlobUrl(URL.createObjectURL(norm))
          setPhotos((p) => {
            if (p.length >= 6) { URL.revokeObjectURL(url); return p }
            return [...p, { url, file: norm }]
          })
        } catch {
          toast.error(t('Không đọc được ảnh này.', "Couldn't read that photo."))
        }
      }
    } finally {
      setConverting(false)
    }
  }

  // Optional listing clip. Validate type + size + DURATION (≤60s, read from metadata) + CODEC
  // on the client so the seller gets an instant, specific rejection; the server re-checks
  // magic bytes and the bucket re-checks type/size at upload.
  // Two caps since 2026-07-18 (the iOS "video error"): a 60s iPhone HEVC clip is 60–400MB,
  // but 50MB is the Supabase PROJECT-WIDE upload ceiling (probed; owner-raisable only in
  // the dashboard). So SELECT accepts up to 200MB and anything over the 50MB upload
  // ceiling is COMPRESSED in-browser (src/lib/video-compress.ts) down to fit before
  // upload. VIDEO_UPLOAD_MAX_BYTES mirrors the server's VIDEO_MAX_BYTES (core/media.ts,
  // server-only — keep in lockstep) and the bucket limit (scripts/setup-storage.mjs).
  const VIDEO_MAX_MB = 200
  const VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
  // HEVC (H.265) detector: iPhones capture .mov/.mp4 in High-Efficiency HEVC by default, which
  // mid-range Android Chrome (the majority buyer here) often can't decode — the clip would play
  // as a black box for most of the audience and the seller would never know. The `hvc1`/`hev1`
  // codec fourcc lives in the moov box, which sits at the START (faststart) or END of the file —
  // scan both edges. H.264 (`avc1`) passes. Heuristic by design: a false negative just means the
  // clip uploads as-is; the sniff costs two 2MB slices, no full read.
  // ⚠️ ALWAYS slice — never pass the whole File. Blob.slice caps the read at EDGE bytes even
  // when WKWebView misreports f.size (a real iOS quirk); the old `size ≤ 4MB → whole file`
  // branch materialized a multi-hundred-MB ArrayBuffer on exactly those picks and jetsam
  // killed the app. For small files the two slices simply overlap — harmless double scan.
  const hasHevcTrack = async (f: File): Promise<boolean> => {
    const EDGE = 2 * 1024 * 1024
    const edges = [f.slice(0, EDGE), f.slice(Math.max(0, f.size - EDGE))]
    for (const part of edges) {
      const arr = new Uint8Array(await part.arrayBuffer())
      for (let i = 0; i < arr.length - 3; i++) {
        // 'hvc1' = 104, 118, 99, 49
        // 'hev1' = 104, 101, 118, 49
        if (arr[i] === 104) {
          if (arr[i+1] === 118 && arr[i+2] === 99 && arr[i+3] === 49) return true
          if (arr[i+1] === 101 && arr[i+2] === 118 && arr[i+3] === 49) return true
        }
      }
    }
    return false
  }
  const addVideo = async (files: FileList | null) => {
    if (videoBusy) return // one probe/compress at a time — a second pick mid-flight races setVideo
    const f = files?.[0]
    if (!f) return
    // MIME check with an extension fallback: some iOS picker paths hand over files with an
    // EMPTY type — the name is then the only signal, and rejecting outright loses the clip.
    const typeOk = /^video\/(mp4|webm|quicktime|x-m4v)$/.test(f.type) || (!f.type && /\.(mp4|webm|mov|m4v)$/i.test(f.name))
    if (!typeOk) { toast.error(t('Chỉ nhận video MP4, WebM hoặc MOV.', 'Only MP4, WebM or MOV videos.')); return }
    if (f.size > VIDEO_MAX_MB * 1024 * 1024) { toast.error(t(`Video quá lớn (tối đa ${VIDEO_MAX_MB}MB).`, `Video is too large (${VIDEO_MAX_MB}MB max).`)); return }
    setVideoBusy(true)
    const url = trackBlobUrl(URL.createObjectURL(f))
    try {
      const dur = await new Promise<number>((resolve) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => resolve(v.duration)
        v.onerror = () => resolve(NaN)
        // Metadata that never arrives (WKWebView blob hiccup) must not hang the tile on
        // "Checking…" forever — time out to NaN and surface the honest can't-read error.
        window.setTimeout(() => resolve(NaN), 10_000)
        v.src = url
      })
      // 61s tolerance for rounding; Infinity/NaN = unreadable metadata → reject (can't verify ≤60s).
      if (!Number.isFinite(dur) || dur > 61) {
        URL.revokeObjectURL(url)
        toast.error(Number.isFinite(dur)
          ? t('Video phải dài tối đa 60 giây.', 'Video must be 60 seconds or less.')
          : t('Không đọc được video này — hãy thử video khác.', 'Could not read this video — please try another one.'))
        return
      }
      // Over the 50MB upload ceiling → compress in-browser (realtime; progress toast).
      // The output is H.264 MP4 (Safari/iOS) or VP8/9 WebM (Chromium) — never HEVC, so
      // the compressed path skips the codec probe entirely.
      if (f.size > VIDEO_UPLOAD_MAX_BYTES) {
        const toastId = 'video-compress'
        if (!videoCompressionSupported()) {
          URL.revokeObjectURL(url)
          toast.error(t('Video quá lớn để tải lên từ thiết bị này (tối đa 50MB).', 'This video is too large to upload from this device (50MB max).'))
          return
        }
        try {
          let lastShown = -1
          toast.loading(t('Đang nén video… 0%', 'Compressing video… 0%'), { id: toastId })
          const compressed = await compressVideo(f, {
            targetBytes: VIDEO_UPLOAD_MAX_BYTES,
            onProgress: (fraction) => {
              const percent = Math.floor(fraction * 100)
              if (percent > lastShown) {
                lastShown = percent
                toast.loading(t(`Đang nén video… ${percent}%`, `Compressing video… ${percent}%`), { id: toastId })
              }
            },
          })
          URL.revokeObjectURL(url)
          const compressedUrl = trackBlobUrl(URL.createObjectURL(compressed))
          setVideo((prev) => { if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url); return { url: compressedUrl, file: compressed, hevc: false } })
          toast.success(t(`Video đã được nén còn ${Math.round(compressed.size / 1024 / 1024)}MB.`, `Video compressed to ${Math.round(compressed.size / 1024 / 1024)}MB.`), { id: toastId })
        } catch {
          URL.revokeObjectURL(url)
          toast.error(t('Không thể nén video này — hãy thử video ngắn hơn hoặc chất lượng thấp hơn.', 'Could not compress this video — try a shorter or lower-quality clip.'), { id: toastId })
        }
        return
      }
      // HEVC is no longer rejected: the server transcodes it to H.264 at publish (fixing the
      // Android-black-video problem). Record the fourcc probe so submit can fail CLOSED if that
      // transcode doesn't succeed (rather than ship a raw HEVC clip that plays black).
      const hevc = await hasHevcTrack(f).catch(() => false)
      setVideo((prev) => { if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url); return { url, file: f, hevc } })
    } finally {
      setVideoBusy(false)
    }
  }
  const removeVideo = () => setVideo((prev) => { if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url); return null })

  // Upload only NEW photos (those with a File); keep already-hosted URLs (edit mode)
  // in their original order so the cover + sequence are preserved.
  const uploadPhotos = async (): Promise<string[]> => {
    const toUpload = photos.filter((p) => p.file)
    const uploaded = toUpload.length ? await uploadInBatches(toUpload.map((p) => p.file!)) : []
    if (uploaded.length < toUpload.length) throw new Error('upload')
    let ui = 0
    return photos.map((p) => (p.file ? uploaded[ui++] : p.url))
  }

  // Upload a newly-picked clip; keep an already-hosted one (edit). null clears it (removed).
  // DIRECT browser→storage: a Vercel function can't proxy the bytes (bodies over ~4.5MB are
  // rejected before the route runs; real clips are 10–50MB). Four steps: mint a signed upload
  // URL (auth + enforcement + type/size gates), PUT the file straight to Supabase, /complete
  // verifies the landed object's magic bytes, then /transcode re-encodes it to a lean H.264
  // MP4 (fixes HEVC-plays-black on Android + cuts egress) and returns the compressed URL.
  const resolveVideoUrl = async (): Promise<string | null> => {
    let videoUrl: string | null = null
    if (video?.file) {
      const sig = await fetch('/api/upload/video/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: video.file.type, size: video.file.size }),
      })
      if (!sig.ok) throw new Error('video')
      const { path, token } = (await sig.json()) as { path: string; token: string }
      const { error: upErr } = await createSupabaseBrowser()
        .storage.from('listing-videos')
        .uploadToSignedUrl(path, token, video.file, { contentType: video.file.type, cacheControl: '31536000' })
      if (upErr) throw new Error('video')
      const done = await fetch('/api/upload/video/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!done.ok) throw new Error('video')

      // Transcode — submit-then-poll: POST claims the job and returns 202 while the encode
      // runs server-side (a synchronous ~210s response would be severed by Cloudflare's
      // ~100s proxy budget once eno.vn fronts Cloud Run); we then poll GET ?path= every 3s.
      // Semantics preserved server-side: H.264 falls open to the raw clip ({fallback});
      // HEVC fails closed (422 / status:'failed') — a raw HEVC clip plays black on most
      // Android buyers, so we surface a retry rather than publish a broken video.
      const xc = await fetch('/api/upload/video/transcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, hevc: video.hevc === true }),
      })
      if (xc.status === 422) throw new Error('video_hevc')
      if (!xc.ok && xc.status !== 202) throw new Error('video')
      let xj = (await xc.json()) as { url?: string; status?: string }
      if (!xj.url && xj.status === 'running') {
        // 330s: covers the 210s encode wall + download/upload margins, under the 360s claim.
        const deadline = Date.now() + 330_000
        while (Date.now() < deadline && !xj.url) {
          await new Promise((r) => setTimeout(r, 3000))
          try {
            const st = await fetch(`/api/upload/video/transcode?path=${encodeURIComponent(path)}`, {
              signal: AbortSignal.timeout(10_000),
            })
            if (!st.ok) {
              if (st.status === 404) throw new Error(video.hevc ? 'video_hevc' : 'video') // job lost
              continue // transient (429/5xx) — keep polling until the deadline
            }
            const sj = (await st.json()) as { status?: string; url?: string }
            if (sj.status === 'failed') throw new Error(video.hevc ? 'video_hevc' : 'video')
            if (sj.status === 'done' && sj.url) xj = sj
          } catch (err) {
            if (err instanceof Error && (err.message === 'video' || err.message === 'video_hevc')) throw err
            // network blip / poll timeout — keep polling until the deadline
          }
        }
      }
      videoUrl = xj.url ?? null
      if (!videoUrl) throw new Error('video')
    } else if (video && !video.url.startsWith('blob:')) {
      videoUrl = video.url
    }
    return videoUrl
  }

  return {
    photos,
    setPhotos,
    addPhotos,
    movePhoto,
    bindPhoto,
    draggingPhoto,
    converting,
    video,
    videoBusy,
    addVideo,
    removeVideo,
    uploadPhotos,
    resolveVideoUrl,
  }
}
