'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Upload, Download, FileText, Loader2, Check, CheckCircle2, AlertTriangle } from '@/components/ui/icons'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { useLanguage } from '@/context/language-context'
import { containsPhoneNumber } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { parseVnd } from '@/lib/vnd'
import { readZipMedia, resolveRowMedia, mediaTokens, isFilename, type ZipMedia } from '@/lib/bulk-media'
import { uploadInBatches } from '@/lib/upload-client'

type Cat = { slug: string; name: string }
type Raw = { category_slug?: string; title?: string; description?: string; price?: string; district?: string; condition?: string; image_urls?: string }
/** `_images` / `_video` are the ZIP files this row resolved to — uploaded at submit, not at parse. */
type ParsedRow = Raw & { _row: number; _error: string | null; _images?: File[]; _video?: File | null }

const COLUMNS = ['category_slug', 'title', 'description', 'price', 'district', 'condition', 'image_urls']

/** Bulk CSV upload (business tier) — the account-panel section (the panel IS the
 *  dashboard, so bulk lives inside it too; /dashboard/bulk redirects here).
 *  Download a template → drop a CSV → validated preview with per-row errors →
 *  import only the valid rows. Mirrors the server re-validation in
 *  /api/listings/bulk so the preview matches reality. */
export function BulkUploadPanel({ onDone }: { onDone?: () => void }) {
  const { tr, lang } = useLanguage()
  const [categories, setCategories] = useState<Cat[]>([])
  useEffect(() => {
    let off = false
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => { if (!off && d.categories) setCategories(d.categories.map((c: { slug: string; name: string; nameVi: string }) => ({ slug: c.slug, name: lang === 'vi' ? c.nameVi : c.name }))) })
      .catch(() => {})
    return () => { off = true }
  }, [lang])
  const slugSet = useMemo(() => new Set(categories.map((c) => c.slug)), [categories])
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  /**
   * ⛔ THE PARSED CSV IS RAW; THE VALIDATED ROWS ARE DERIVED. Validation now depends on the ZIP, and
   * the two files arrive in either order — so storing validated rows meant a seller who dropped the
   * CSV first saw "attach the ZIP" errors that never cleared when they did.
   */
  const [rawRows, setRawRows] = useState<Raw[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /**
   * ⛔ THE ZIP IS OPTIONAL AND ADDITIVE. `image_urls` has always held remote URLs the server
   * re-hosts; a seller with a working URL sheet must not have to rezip anything. A row may mix the
   * two, which is exactly what someone migrating looks like. See src/lib/bulk-media.ts.
   */
  const [zip, setZip] = useState<ZipMedia | null>(null)
  const [zipName, setZipName] = useState('')
  /** Which media file is going up, so a 200-row import is not a frozen button. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ created: number; failed: number; results: { row: number; id?: string; error?: string }[] } | null>(null)
  const [error, setError] = useState('')

  const validate = (r: Raw, i: number): ParsedRow => {
    const slug = (r.category_slug || '').trim()
    const title = (r.title || '').trim()
    // parseVnd (audit P2): Vietnamese sellers write dot-thousands — '9.500' means
    // 9,500 đ. The old parse kept the dot, read 9.5, and silently created a listing
    // a thousand times cheaper. VND has no decimals: digits-only is always right.
    const priceNum = parseVnd((r.price || '').toString())
    let err: string | null = null
    if (!slug || !slugSet.has(slug)) err = tr(`Unknown category "${slug}"`, `Danh mục không hợp lệ "${slug}"`)
    else if (title.length < 3) err = tr('Title too short', 'Tiêu đề quá ngắn')
    else if (!Number.isFinite(priceNum) || priceNum < 0) err = tr('Invalid price', 'Giá không hợp lệ')
    else if (containsPhoneNumber(title) || containsPhoneNumber(r.description || '')) err = tr('Phone number not allowed', 'Không được ghi số điện thoại')
    else {
      /**
       * ⛔ A FILENAME THAT IS NOT IN THE ZIP IS A ROW ERROR, NOT A SILENT SHORT LISTING. Counting
       * tokens was enough while they were all URLs the server would fetch; with filenames a typo
       * would have passed validation here and produced a listing with two photos instead of three,
       * which the seller only discovers by looking at 200 of them.
       *
       * ⚠️ PHOTOS ARE COUNTED, THE CLIP IS NOT. The three-angle minimum is about photographs; a
       * video does not substitute for one, so a row with two photos and a clip still fails.
       */
      const tokens = mediaTokens(r.image_urls)
      const { images, video, missing } = resolveRowMedia(r.image_urls, zip)
      const urlCount = tokens.filter((t) => !isFilename(t)).length
      const photoCount = urlCount + images.length
      if (missing.length) {
        err = zip
          ? tr(`Not in the ZIP: ${missing.slice(0, 3).join(', ')}`, `Không có trong ZIP: ${missing.slice(0, 3).join(', ')}`)
          : tr('This row names files — attach the ZIP that contains them', 'Dòng này ghi tên tệp — hãy đính kèm ZIP chứa chúng')
      } else if (photoCount < 3) {
        err = tr('Needs at least 3 photos (different angles)', 'Cần ít nhất 3 ảnh (các góc khác nhau)')
      }
      if (!err) return { ...r, price: String(priceNum || ''), _row: i + 1, _error: null, _images: images, _video: video }
    }
    return { ...r, price: String(priceNum || ''), _row: i + 1, _error: err }
  }

  const onFile = (file: File) => {
    setError(''); setResult(null)
    setFileName(file.name)
    Papa.parse<Raw>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => {
        const parsed = (res.data || []).filter((r) => Object.values(r).some((v) => String(v ?? '').trim()))
        if (parsed.length === 0) { setError(tr('No rows found in this CSV.', 'Không tìm thấy dòng nào trong CSV.')); setRawRows(null); return }
        setRawRows(parsed.slice(0, 200))
      },
      error: () => setError(tr('Could not read this file.', 'Không đọc được tệp này.')),
    })
  }

  const onZip = async (file: File) => {
    setError(''); setResult(null)
    /**
     * ⛔ BOUNDED BEFORE IT IS READ. `unzipSync` inflates every entry at once, so peak heap is about
     * the archive plus its expanded contents — a reviewer put 200 rows of phone photos near 1.8GB,
     * which kills the tab on mobile Safari and freezes a desktop for seconds. 300MB compressed is
     * comfortably more than 200 rows of web-sized photos and small enough to stay safe; a seller
     * over it gets a clear instruction rather than a dead tab.
     *
     * ⚠️ THE ARCHIVE, NOT THE PHOTOS, IS WHAT NEEDS RESIZING at that point — 200MB of ZIP is
     * usually 200 unresized phone originals, every one of which the server would downscale anyway.
     */
    const ZIP_MAX_BYTES = 300 * 1024 * 1024
    if (file.size > ZIP_MAX_BYTES) {
      setError(tr('That ZIP is over 300MB. Split it, or resize the photos first.', 'ZIP đó lớn hơn 300MB. Hãy chia nhỏ, hoặc giảm kích thước ảnh trước.'))
      setZip(null); setZipName(''); return
    }
    try {
      const media = readZipMedia(new Uint8Array(await file.arrayBuffer()))
      if (media.files.size === 0) {
        setError(tr('No photos or videos found in that ZIP.', 'Không tìm thấy ảnh hoặc video trong ZIP đó.'))
        setZip(null); setZipName(''); return
      }
      setZip(media); setZipName(file.name)
    } catch {
      // fflate throws on a corrupt archive, and on a .rar or .7z renamed to .zip — which is the
      // likeliest way this fails for a seller, so the copy names it.
      setError(tr('Could not read that ZIP. Make sure it is a .zip, not .rar or .7z.', 'Không đọc được ZIP. Hãy chắc chắn đó là .zip, không phải .rar hay .7z.'))
      setZip(null); setZipName('')
    }
  }

  /**
   * Upload one row's ZIP media and return the URLs to send.
   *
   * ⛔ THROUGH `/api/upload`, THE SAME PATH A SINGLE LISTING USES — so a bulk photo gets the same
   * type check, the same downscale, the same eno watermark and the same perceptual hash as one
   * posted by hand. Anything else would have meant a second, parallel media pipeline whose
   * differences only show up months later on somebody's storefront.
   */
  const uploadRowMedia = async (row: ParsedRow): Promise<{ image_urls: string; video_url?: string; warning?: string }> => {
    const kept = mediaTokens(row.image_urls).filter((t) => !isFilename(t))
    const hosted = row._images?.length ? await uploadInBatches(row._images) : []
    let video_url: string | undefined
    if (row._video) {
      const { uploadListingVideo, hasHevcTrack, VIDEO_UPLOAD_MAX_BYTES } = await import('@/lib/video-upload-client')
      /**
       * ⛔ THE SAME TWO GATES THE PICKER APPLIES, BECAUSE BULK HAS NO PICKER. A reviewer caught that
       * detection lived in the wizard's file input, so bulk was telling the server "H.264" for
       * every clip — and the transcode route falls OPEN for H.264, which would have published
       * iPhone HEVC clips that play as a black box for the mid-range Android majority.
       *
       * ⚠️ AND NO IN-BROWSER COMPRESSION HERE, DELIBERATELY. The wizard re-encodes an oversized
       * clip down to the 50MB ceiling; doing that for 200 rows would take hours on the main thread.
       * An oversized clip is skipped with a reason instead, and the listing is created with its
       * photos — losing a clip must not cost the seller the row.
       */
      /**
       * ⛔ A VIDEO PROBLEM IS A WARNING, NOT A ROW FAILURE — photos and text are still a good
       * listing. Throwing here dropped the whole row, which contradicted this function's own
       * comment and bulk.ts's ("a bad clip must not cost the seller the row"); a reviewer caught
       * the contradiction. The listing is created and the reason appears in the results list.
       */
      if (row._video.size > VIDEO_UPLOAD_MAX_BYTES) {
        return { image_urls: [...kept, ...hosted].join('|'), warning: tr('Video over 50MB — listed without it', 'Video trên 50MB — đã đăng mà không có video') }
      }
      if (await hasHevcTrack(row._video).catch(() => false)) {
        return { image_urls: [...kept, ...hosted].join('|'), warning: tr('Video is HEVC — re-export as H.264', 'Video là HEVC — hãy xuất lại H.264') }
      }
      try {
      /**
       * ⚠️ A SHORTER DEADLINE THAN THE WIZARD'S 330s, AND ONE ROW'S CLIP MUST NEVER HOLD UP THE
       * IMPORT. A single listing can afford to wait out a slow encode because a person is watching
       * it; a 200-row import cannot — 200 x 330s is fifteen hours. 90s covers the ordinary H.264
       * case (which falls open to the raw clip server-side anyway).
       */
        video_url = (await uploadListingVideo(row._video, { deadlineMs: 90_000 })) ?? undefined
      } catch {
        // Any failure in the clip pipeline — same rule: keep the listing, name the loss.
      }
      // ⛔ A TIMEOUT IS REPORTED, NOT SWALLOWED. `uploadListingVideo` answers null when the encode
      // outlives the deadline; creating the listing silently without its clip is the "comment says
      // reported, code does not" gap a reviewer named.
      if (!video_url) {
        return { image_urls: [...kept, ...hosted].join('|'), warning: tr('Video could not be processed — listed without it', 'Không xử lý được video — đã đăng mà không có video') }
      }
    }
    return { image_urls: [...kept, ...hosted].join('|'), ...(video_url ? { video_url } : {}) }
  }

  const downloadTemplate = () => {
    /**
     * ⚠️ THE TEMPLATE TEACHES THE ZIP FORMAT, because nothing else does. A seller who downloads this
     * gets one row using FILENAMES and one using URLs, so the two ways to fill `image_urls` are
     * visible side by side rather than described in a paragraph they will not read.
     */
    const zipRow = 'electronics,iPhone 13 128GB,Like new with box and charger,9500000,District 1,used-like-new,iphone13-front.jpg|iphone13-back.jpg|iphone13-box.jpg|iphone13-demo.mp4'
    const urlRow = 'electronics,Galaxy S23,Boxed with charger,8900000,District 3,used-like-new,https://example.com/photo1.jpg|https://example.com/photo2.jpg|https://example.com/photo3.jpg'
    const legend = [
      '# image_urls: either FILENAMES from the ZIP you attach, or http(s) URLs. Mix freely.',
      '# Filenames match on the name only, so folders inside the ZIP are fine. Case does not matter.',
      '# At least 3 PHOTOS per row (a video does not count). One video per row, optional.',
      '# Photos: jpg png webp avif heic. Video: mp4 mov m4v webm (H.264 — HEVC is rejected).',
      '# Valid category_slug values: ' + categories.map((c) => c.slug).join(', '),
    ].join('\n')
    const csv = `${COLUMNS.join(',')}\n${zipRow}\n${urlRow}\n${legend}`
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'eno-bulk-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Re-validated whenever the CSV, the ZIP or the category list changes — see the note on rawRows.
  const rows = useMemo(() => rawRows?.map(validate) ?? null, [rawRows, zip, slugSet])
  const valid = rows?.filter((r) => !r._error) ?? []
  const invalid = rows?.filter((r) => r._error) ?? []

  const submit = async () => {
    if (valid.length === 0) return
    setSubmitting(true); setError('')
    /**
     * ⛔ HOISTED SO `finally` CAN ALWAYS TRIM. These lived inside the try, so a THROWN fetch — a
     * dropped connection mid-import, the common failure — skipped the trimming entirely: every row
     * stayed in the preview including the ones already created, and retrying re-posted them. Only
     * the `!res.ok` path was handled. Three reviewers found the same hole.
     */
    const results: { row: number; id?: string; error?: string }[] = []
    let created = 0
    let stopped = false
    try {
      /**
       * ⛔ MEDIA GOES UP FIRST, ROW BY ROW, AND ONLY THEN THE IMPORT. The bulk endpoint takes JSON
       * with hosted URLs — exactly as it always has — so nothing about its contract changes; the
       * ZIP is resolved entirely on this side. Sequential on purpose: `uploadInBatches` already
       * parallelises within a row, and firing 200 rows at once would hit the upload limiter and
       * turn a slow import into a failed one.
       *
       * ⚠️ A ROW WHOSE MEDIA FAILS IS DROPPED FROM THE IMPORT, NOT SILENTLY SHORTENED. Sending it
       * anyway would create a listing with two photos where the seller specified three, which the
       * publish gate then holds — a confusing half-success across 200 rows. It is reported instead.
       */
      const warnings: { row: number; error: string }[] = []
      const mediaFailures: { row: number; error: string }[] = []
      const withMedia = valid.filter((r) => r._images?.length || r._video)
      setProgress({ done: 0, total: withMedia.length })

      /**
       * ⛔ MEDIA THEN IMPORT, IN CHUNKS — NOT EVERYTHING THEN ONE POST. Uploading all 200 rows'
       * media before creating a single listing meant a closed tab, an expired session or one proxy
       * timeout on the final POST left hundreds of orphaned objects in the bucket and ZERO
       * listings, and a retry re-uploaded the lot straight into the perceptual-hash duplicate
       * guard. A reviewer named it; chunking means progress is durable — whatever finished, stays.
       */
      const CHUNK = 20
      for (let i = 0; i < valid.length; i += CHUNK) {
        const slice = valid.slice(i, i + CHUNK)
        const prepared: { row: ParsedRow; body: { image_urls: string; video_url?: string; warning?: string } }[] = []
        for (const row of slice) {
          try {
            const body = await uploadRowMedia(row)
            if (body.warning) warnings.push({ row: row._row, error: body.warning })
            prepared.push({ row, body })
          } catch {
            // Only a PHOTO failure lands here — uploadRowMedia turns clip problems into warnings.
            mediaFailures.push({ row: row._row, error: tr('Photo upload failed', 'Tải ảnh thất bại') })
          }
          if (row._images?.length || row._video) setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
        }
        if (prepared.length === 0) continue
        const res = await fetch('/api/listings/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: prepared.map(({ row, body }) => ({
            category_slug: row.category_slug, title: row.title, description: row.description,
            price: row.price, district: row.district, condition: row.condition,
            image_urls: body.image_urls, ...(body.video_url ? { video_url: body.video_url } : {}),
          })) }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(d.error === 'business_only'
            ? tr('Bulk upload is for business accounts.', 'Tải hàng loạt chỉ dành cho tài khoản doanh nghiệp.')
            : created > 0
              // ⚠️ SAY WHAT SURVIVED. Chunking means a late failure is partial, and "try again" on
              // its own would send the seller to re-import rows that already exist.
              ? tr(`Stopped after ${created} listings — the rest were not imported.`, `Đã dừng sau ${created} tin — phần còn lại chưa được nhập.`)
              : tr('Upload failed. Try again.', 'Tải lên thất bại. Thử lại.'))
          stopped = true
          break
        }
        created += d.created ?? 0
        /**
         * ⛔ THE SERVER'S `row` IS ITS INDEX WITHIN THIS POST, SO IT MUST BE MAPPED BACK. It counts
         * 1..20 in every chunk, so ten chunks produced ten "Row 3"s and a seller could not tell
         * which listing failed. An earlier comment here claimed the numbers "stay meaningful across
         * chunks" — they do not, and two reviewers caught the contradiction. `prepared` is in the
         * same order the rows were sent, so its `_row` is the CSV line.
         */
        for (const r of d.results ?? []) {
          const csvRow = prepared[(r.row ?? 0) - 1]?.row._row ?? r.row
          results.push({ ...r, row: csvRow })
        }
      }

      /**
       * ⛔ A WARNING IS NOT A FAILURE. Warnings mean "the listing WAS created, without its clip", so
       * counting them in `failed` told a seller that 12 rows had failed when all 12 are live — a
       * reviewer caught it. They still appear in the list, because the seller should know a clip is
       * missing; they just are not counted as losses.
       */
      setResult({
        created,
        failed: results.filter((r) => r.error).length + mediaFailures.length,
        results: [...results, ...mediaFailures, ...warnings],
      })
    } catch {
      stopped = true
      setError(created > 0
        ? tr(`Stopped after ${created} listings — the rest were not imported.`, `Đã dừng sau ${created} tin — phần còn lại chưa được nhập.`)
        : tr('Upload failed. Try again.', 'Tải lên thất bại. Thử lại.'))
    } finally {
      /**
       * ⛔ THE TRIM RUNS ON EVERY EXIT PATH, WHICH IS WHY IT IS IN `finally`. Keeping the preview is
       * right — the seller needs it to retry — but keeping ALL of it re-posts rows already created,
       * straight into the perceptual-hash duplicate guard. Trim to what did not make it, so the
       * button means "import the rest". A clean run clears it entirely.
       */
      if (stopped) {
        const done = new Set(results.filter((r) => r.id).map((r) => r.row))
        setRawRows((prev) => prev?.filter((_, i) => !done.has(i + 1)) ?? null)
      } else {
        setRawRows(null)
      }
      setSubmitting(false); setProgress(null)
    }
  }

  return (
    <div>
        <p className="text-sm text-muted-foreground">{tr('Upload many listings at once with a CSV. Download the template, fill it in, then drop it here.', 'Đăng nhiều tin cùng lúc bằng CSV. Tải mẫu, điền vào, rồi thả vào đây.')}</p>

        <Button variant="outline" size="none" onClick={downloadTemplate} className="mt-4 inline-flex items-center gap-2 rounded-xl border-line-strong bg-card px-4 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted hover:text-body cursor-pointer">
          <Download className="h-4 w-4" /> {tr('Download CSV template', 'Tải mẫu CSV')}
        </Button>

        {/* Result */}
        {result ? (
          <div className="mt-6 rounded-2xl bg-popover p-5 shadow-pop">
            {/* EmptyState's chrome coin (§6): display-stroke glyph on the brand-50 disc —
                the bare h-8 stroke-2 CheckCircle2 read rubber-stamped and off-ladder. */}
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
              <Check className="h-8 w-8 text-brand" strokeWidth={STROKE_DISPLAY} />
            </span>
            <p className="mt-2 text-sm font-bold text-foreground">{tr('Import complete', 'Hoàn tất')}</p>
            {/* role=status: the outcome is the answer to the action just taken — spoken, not only shown. */}<p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">{result.created} {tr('listings created', 'tin đã tạo')}{result.failed > 0 ? `, ${result.failed} ${tr('failed', 'lỗi')}` : ''}.</p>
            {result.failed > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-destructive">
                {result.results.filter((r) => r.error).map((r) => <li key={r.row}>{tr('Row', 'Dòng')} {r.row}: {r.error}</li>)}
              </ul>
            )}
            <div className="mt-4 flex gap-2">
              {onDone && (
                <Button variant="cta" size="none" onClick={onDone} className="px-5 py-2 cursor-pointer">{tr('View listings', 'Xem tin đăng')}</Button>
              )}
              <Button variant="outline" size="none" onClick={() => { setResult(null); setFileName('') }} className="rounded-xl border-line-strong bg-card px-5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-body transition-colors cursor-pointer">{tr('Upload more', 'Tải thêm')}</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Dropzone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
              className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-strong bg-card py-10 text-center transition-colors hover:border-brand/40"
            >
              {/* Same coin as ui/empty-state (§6): the dropzone is an empty state you can drop
                  onto, so it sits its glyph on the brand disc at the display stroke. */}
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <Upload className="h-8 w-8 text-brand" strokeWidth={STROKE_DISPLAY} />
              </span>
              <p className="mt-2 text-sm font-semibold text-foreground">{fileName || tr('Drop your CSV here, or click to choose', 'Thả CSV vào đây, hoặc bấm để chọn')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{tr('Up to 200 rows', 'Tối đa 200 dòng')}</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            </div>

            {/*
              ⛔ A SECOND, SEPARATE DROPZONE — NOT ONE THAT TAKES BOTH. A single input would have to
              guess what each dropped file is, and the failure mode is a seller dropping two CSVs, or
              two ZIPs, and being told nothing. Two labelled targets say what the import expects.

              ⚠️ OPTIONAL, and the copy says so: `image_urls` still accepts http(s) URLs, so a seller
              whose sheet already carries them does not need a ZIP at all.
            */}
            <div
              onClick={() => zipRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onZip(f) }}
              className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-strong bg-card py-6 text-center transition-colors hover:border-brand/40"
            >
              <FileText className="h-6 w-6 text-ink-4" />
              <p className="mt-2 text-sm font-semibold text-foreground">
                {zipName || tr('Photos & videos ZIP (optional)', 'ZIP ảnh & video (tuỳ chọn)')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {zip
                  ? tr(`${zip.files.size} files ready`, `${zip.files.size} tệp sẵn sàng`)
                  : tr('Name files in the CSV exactly as they appear in the ZIP', 'Ghi tên tệp trong CSV đúng như trong ZIP')}
              </p>
              <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onZip(f) }} />
            </div>
            {/* Entries the ZIP carried that we will not upload — a seller should see a typo rather
                than wonder why a photo never appeared. Capped: a stray folder can hold hundreds. */}
            {zip && zip.skipped.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {tr('Ignored in ZIP:', 'Bỏ qua trong ZIP:')} {zip.skipped.slice(0, 5).join(', ')}
                {zip.skipped.length > 5 ? ` +${zip.skipped.length - 5}` : ''}
              </p>
            )}

            {/* Whole-upload failure — belongs to no single input, so it is ANNOUNCED
                (role="alert") rather than wired into some field's aria-describedby. */}
            {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
            {/* role=status: a 200-row import spends most of its time here, so the count is spoken. */}
            {progress && progress.total > 0 && (
              <p role="status" aria-live="polite" className="mt-3 text-sm text-body">
                {tr('Uploading media', 'Đang tải media')} {progress.done}/{progress.total}…
              </p>
            )}

            {/* Preview */}
            {rows && (
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  {/* The per-row errors below are a LIST, not 200 alerts — announcing each
                      would bury the user. The SUMMARY is the live region: it speaks the
                      one thing that matters ("42 ready, 3 with errors") when a CSV is
                      parsed or replaced, and the rows stay silent for reading on demand. */}
                  <p role="status" aria-live="polite" className="text-sm font-semibold text-foreground">
                    <span className="text-accent-foreground">{valid.length} {tr('ready', 'hợp lệ')}</span>
                    {invalid.length > 0 && <span className="text-destructive">, {invalid.length} {tr('with errors', 'có lỗi')}</span>}
                  </p>
                  <Button variant="cta" size="none" onClick={submit} disabled={submitting || valid.length === 0} className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm disabled:opacity-40 transition-colors cursor-pointer">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} {tr('Import', 'Nhập')} {valid.length > 0 ? valid.length : ''}
                  </Button>
                </div>
                <div className="mt-3 space-y-1.5">
                  {rows.map((r) => (
                    <div key={r._row} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs', r._error ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-tint')}>
                      <span className="w-6 shrink-0 font-mono text-muted-foreground">{r._row}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.title || <span className="italic text-ink-4">{tr('(no title)', '(không có tiêu đề)')}</span>}</span>
                      <span className="shrink-0 text-muted-foreground">{r.category_slug}</span>
                      {/* One size for both verdicts (§4 dense-meta step) — h-3 vs h-3.5 in the
                          same column read as two different hands. */}
                      {r._error ? (
                        <span className="flex min-w-0 max-w-[55%] shrink items-center gap-1 font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{r._error}</span></span>
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{tr('Only valid rows are imported. Images are fetched and re-hosted on import; listings with no usable image are held for review.', 'Chỉ nhập các dòng hợp lệ. Ảnh được tải và lưu lại khi nhập; tin không có ảnh hợp lệ sẽ được giữ để duyệt.')}</p>
              </div>
            )}
          </>
        )}
    </div>
  )
}
