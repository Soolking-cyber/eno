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
import { compressVideo, videoCompressionSupported } from '@/lib/video-compress'
import { hasHevcTrack, VIDEO_UPLOAD_MAX_BYTES } from '@/lib/video-upload-client'
import { compressImageFile } from '@/lib/normalize-image'
import { centerCropSquare } from '@/lib/square-crop'
import { uploadInBatches } from '@/lib/upload-client'
import { usePointerReorder } from '@/hooks/use-pointer-reorder'

export type PostMedia = ReturnType<typeof usePostMedia>

/** The most photos a listing holds — the pick, the draft restore and the ✕'s Undo all stop here. */
const MAX_PHOTOS = 6

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
  // `file` is what gets uploaded (square by default). `original` is the un-cropped, ≤1600
  // natural-aspect source kept per NEW photo so the seller can reframe the square or "keep full"
  // non-lossily (owner: "square by default, keep-full option"). `square` = is `file` a 1:1 crop.
  // Edit-mode seeds (URL-only, already hosted) have no File/original → not re-croppable.
  const [photos, setPhotos] = useState<{ url: string; file?: File; original?: File; square?: boolean }[]>(() => edit?.images?.map((url) => ({ url })) ?? [])
  // Optional single video: url-only in edit mode (already hosted); a new pick carries a File
  // + a blob: preview URL. ≤60s (duration-gated client-side) — autoplays on the listing card + in the feed.
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
          // uploads small (no 413 on big phone photos), and AI-reads cleanly. `norm` is the
          // un-cropped source; the platform format is 1:1, so we default `file` to a centered
          // square crop of it (owner: "square by default") while keeping `norm` for reframe/full.
          const norm = await compressImageFile(f)
          const squareFile = await centerCropSquare(norm)
          const url = trackBlobUrl(URL.createObjectURL(squareFile))
          setPhotos((p) => {
            if (p.length >= MAX_PHOTOS) { URL.revokeObjectURL(url); return p }
            // centerCropSquare returns `norm` ITSELF if it couldn't crop → the flag must reflect
            // reality (an un-cropped photo mustn't claim to be square) (codex).
            return [...p, { url, file: squareFile, original: norm, square: squareFile !== norm }]
          })
        } catch {
          toast.error(t('Không đọc được ảnh này.', "Couldn't read that photo."))
        }
      }
    } finally {
      setConverting(false)
    }
  }

  // Reframe photo `index` to the square the seller chose (a 1:1 File), or fall back to the full
  // non-square `original`. Both are non-lossy — `original` is retained. No-op unless the photo has
  // an `original` (edit-mode hosted images are excluded). Guard on the render value + create the
  // blob url OUTSIDE the state updater: updaters must be side-effect-free (React can replay them),
  // and the crop dialog is MODAL so no tile can be removed/reordered while it's open. The previous
  // url is left for the unmount cleanup, exactly like addPhotos (codex: no side effects in updaters).
  const setPhotoFile = (index: number, file: File, square: boolean) => {
    if (!photos[index]?.original) return
    const url = trackBlobUrl(URL.createObjectURL(file))
    setPhotos((p) => p.map((ph, i) => (i === index && ph.original ? { ...ph, url, file, square } : ph)))
  }
  // The dialog's cropToSquare returns the SAME `original` on failure → `file !== original` is the
  // honest "did it actually crop" flag.
  const applySquareCrop = (index: number, file: File) => setPhotoFile(index, file, file !== photos[index]?.original)
  const keepFullPhoto = (index: number) => {
    const original = photos[index]?.original
    if (original) setPhotoFile(index, original, false)
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
  // HEVC detector + the upload ceiling now live in lib/video-upload-client.ts, shared with bulk
  // import — see the note there on why bulk needs the same rule.
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
  /**
   * Remove one photo, with Undo (Emil-skills audit, missing confirmations: the ✕ dropped a photo — and revoked its
   * blob, so it could not even be shown again — with no way back). The blob is NOT revoked here: every blob this hook
   * makes is tracked and revoked on unmount, so a removed photo can be put back until the form goes. Undo puts it back
   * where it was (or at the end, if the list moved) unless the form is full again.
   */
  const removedSeq = useRef(0)
  const photosNow = useRef(photos)
  useEffect(() => { photosNow.current = photos })
  const removePhoto = (index: number) => {
    const removed = photos[index]
    if (!removed) return
    // What came after it, in order, at the moment it went: Undo puts it back before the first of those still there
    // (or last). Two removals undone in either order land as they were; an absolute index did not — undoing the
    // first of two put it after the second (review, 2026-10-07).
    const after = photos.slice(index + 1)
    // By identity, not by index: a crop landing between this render and the update could have put a different
    // object in that slot (review, 2026-10-07).
    setPhotos((arr) => arr.filter((p) => p !== removed))
    let restored = false
    // ⚠️ ITS OWN TOAST PER REMOVAL: one fixed id let a second ✕ replace the first one's toast, and the first photo
    // then had no way back (review, 2026-10-07).
    const id = `pw-photo-undo:${++removedSeq.current}`
    // Its blob is let go once the Undo is gone unused — kept until then, so Undo can show it again; the unmount
    // sweep still covers the rest.
    const release = () => { if (!restored && !photosNow.current.includes(removed) && removed.url.startsWith('blob:')) URL.revokeObjectURL(removed.url) }
    toast(t('Đã xóa ảnh', 'Photo removed'), {
      id,
      duration: 6000,
      onAutoClose: release,
      onDismiss: release,
      action: {
        label: t('Hoàn tác', 'Undo'),
        onClick: () => {
          // Restored only if it can be (a form back at the cap, or a photo already there, is not). Refused, its blob
          // is let go HERE: sonner closes a toast after its action without calling onDismiss (index.mjs, the action
          // button's onClick → deleteToast), so nothing later would.
          const now = photosNow.current
          if (now.length >= MAX_PHOTOS || now.includes(removed)) { release(); return }
          restored = true
          setPhotos((arr) => {
            if (arr.length >= MAX_PHOTOS || arr.includes(removed)) return arr
            const at = arr.findIndex((p) => after.includes(p))
            return at < 0 ? [...arr, removed] : [...arr.slice(0, at), removed, ...arr.slice(at)]
          })
        },
      },
    })
  }
  const removeVideo = () => setVideo((prev) => { if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url); return null })

  // Photos brought back from the IndexedDB draft (src/lib/post-draft-photos.ts) after a reload or
  // the Google sign-in redirect. ⚠️ NEVER OVER PHOTOS ALREADY HERE: the read is async, and a seller
  // who added a photo while it was in flight has started a new set — merging the two would put
  // photos they did not pick back into the listing. The blob URLs are minted OUTSIDE the updater
  // (updaters must stay side-effect-free, see setPhotoFile) and tracked, so a set that loses the race
  // is revoked with everything else at unmount.
  const restorePhotos = (items: { file: File; original?: File; square?: boolean }[]) => {
    const restored = items.slice(0, MAX_PHOTOS).map((it) => ({ url: trackBlobUrl(URL.createObjectURL(it.file)), file: it.file, original: it.original, square: it.square }))
    setPhotos((p) => (p.length ? p : restored))
  }

  // Upload only NEW photos (those with a File); keep already-hosted URLs (edit mode)
  // in their original order so the cover + sequence are preserved.
  // ⛔ A PHOTO UPLOADS ONCE. Each File's hosted URL is kept the moment its batch lands (`hosted`), so a Publish
  // retried after a failure — the video, a refused word, a dropped connection mid-way — sends only the photos not
  // up yet; the video is kept the same way (resolveVideoUrl). It used to upload everything again (Emil-skills
  // audit, publish). Keyed by the File itself: a re-crop makes a new File and so a new upload. An upload is not tied
  // to an account (the form is a guest flow until Publish), so a URL kept across a sign-in publishes exactly what
  // re-uploading the same File would. Nothing sweeps unused uploads today (the "GC backstop" core/listings.ts names
  // does not exist yet), so a kept URL stays valid for the page's life — revisit this if one is ever added.
  // `onProgress(done, total)` counts the NEW photos, already-hosted ones included in `done`.
  const hosted = useRef(new WeakMap<File, string>())
  const uploadPhotos = async (onProgress?: (done: number, total: number) => void): Promise<string[]> => {
    const fresh = photos.filter((p) => p.file)
    const pending = fresh.filter((p) => !hosted.current.has(p.file!))
    let done = fresh.length - pending.length
    if (fresh.length) onProgress?.(done, fresh.length)
    if (pending.length) {
      await uploadInBatches(pending.map((p) => p.file!), (files, urls) => {
        files.forEach((f, i) => { if (urls[i]) hosted.current.set(f, urls[i]) })
        done += files.length
        onProgress?.(done, fresh.length)
      })
    }
    if (fresh.some((p) => !hosted.current.has(p.file!))) throw new Error('upload')
    return photos.map((p) => (p.file ? hosted.current.get(p.file)! : p.url))
  }

  // Upload a newly-picked clip; keep an already-hosted one (edit). null clears it (removed).
  // DIRECT browser→storage: a Vercel function can't proxy the bytes (bodies over ~4.5MB are
  // rejected before the route runs; real clips are 10–50MB). Four steps: mint a signed upload
  // URL (auth + enforcement + type/size gates), PUT the file straight to Supabase, /complete
  // verifies the landed object's magic bytes, then /transcode re-encodes it to a lean H.264
  // MP4 (fixes HEVC-plays-black on Android + cuts egress) and returns the compressed URL.
  const resolveVideoUrl = async (): Promise<string | null> => {
    // ⛔ THE SEQUENCE LIVES IN `lib/video-upload-client.ts` NOW, shared with bulk import — sign,
    // upload to the signed URL, complete, transcode-and-poll, including the HEVC-fails-closed rule
    // and the 330s deadline. It throws the same 'video' / 'video_hevc' codes this wizard's submit
    // catch already maps to copy, so nothing here changes shape.
    if (video?.file) {
      // Kept like the photos (`hosted`): a save refused AFTER the video went up — a phone already taken, a banned
      // word the server caught — used to upload and transcode it again on the retry, up to 5.5 minutes for nothing.
      const kept = hosted.current.get(video.file)
      if (kept) return kept
      const { uploadListingVideo } = await import('@/lib/video-upload-client')
      const url = await uploadListingVideo(video.file, { hevc: video.hevc === true })
      if (!url) throw new Error('video')
      hosted.current.set(video.file, url)
      return url
    }
    if (video && !video.url.startsWith('blob:')) return video.url
    return null
  }

  return {
    photos,
    setPhotos,
    addPhotos,
    restorePhotos,
    applySquareCrop,
    keepFullPhoto,
    movePhoto,
    bindPhoto,
    draggingPhoto,
    converting,
    video,
    videoBusy,
    addVideo,
    removeVideo,
    removePhoto,
    uploadPhotos,
    resolveVideoUrl,
  }
}
