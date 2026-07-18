'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Upload, Download, FileText, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { containsPhoneNumber } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { parseVnd } from '@/lib/vnd'

type Cat = { slug: string; name: string }
type Raw = { category_slug?: string; title?: string; description?: string; price?: string; district?: string; condition?: string; image_urls?: string }
type ParsedRow = Raw & { _row: number; _error: string | null }

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

  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
    else if (String(r.image_urls || '').split(/[|,\n]/).map((u) => u.trim()).filter(Boolean).length < 3) err = tr('Needs at least 3 photo URLs (different angles)', 'Cần ít nhất 3 URL ảnh (các góc khác nhau)')
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
        const parsed = (res.data || []).filter((r) => Object.values(r).some((v) => String(v ?? '').trim())).map(validate)
        if (parsed.length === 0) { setError(tr('No rows found in this CSV.', 'Không tìm thấy dòng nào trong CSV.')); setRows(null); return }
        setRows(parsed.slice(0, 200))
      },
      error: () => setError(tr('Could not read this file.', 'Không đọc được tệp này.')),
    })
  }

  const downloadTemplate = () => {
    const example = 'electronics,iPhone 13 128GB,Like new with box and charger,9500000,District 1,used-like-new,https://example.com/photo1.jpg|https://example.com/photo2.jpg|https://example.com/photo3.jpg'
    const legend = '# Valid category_slug values: ' + categories.map((c) => c.slug).join(', ')
    const csv = `${COLUMNS.join(',')}\n${example}\n${legend}`
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'eno-bulk-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const valid = rows?.filter((r) => !r._error) ?? []
  const invalid = rows?.filter((r) => r._error) ?? []

  const submit = async () => {
    if (valid.length === 0) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/listings/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: valid.map(({ category_slug, title, description, price, district, condition, image_urls }) => ({ category_slug, title, description, price, district, condition, image_urls })) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error === 'business_only' ? tr('Bulk upload is for business accounts.', 'Tải hàng loạt chỉ dành cho tài khoản doanh nghiệp.') : tr('Upload failed. Try again.', 'Tải lên thất bại. Thử lại.')); return }
      setResult(d); setRows(null)
    } catch { setError(tr('Upload failed. Try again.', 'Tải lên thất bại. Thử lại.')) } finally { setSubmitting(false) }
  }

  return (
    <div>
        <p className="text-sm text-muted-foreground">{tr('Upload many listings at once with a CSV. Download the template, fill it in, then drop it here.', 'Đăng nhiều tin cùng lúc bằng CSV. Tải mẫu, điền vào, rồi thả vào đây.')}</p>

        <Button variant="outline" size="none" onClick={downloadTemplate} className="mt-4 inline-flex items-center gap-2 rounded-xl border-line-strong bg-card px-4 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted hover:text-body cursor-pointer">
          <Download className="h-4 w-4" /> {tr('Download CSV template', 'Tải mẫu CSV')}
        </Button>

        {/* Result */}
        {result ? (
          <div className="mt-6 rounded-2xl bg-card p-5 shadow-pop">
            <CheckCircle2 className="h-8 w-8 text-accent-foreground" />
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
              <Upload className="h-8 w-8 text-ink-4" />
              <p className="mt-2 text-sm font-semibold text-foreground">{fileName || tr('Drop your CSV here, or click to choose', 'Thả CSV vào đây, hoặc bấm để chọn')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{tr('Up to 200 rows', 'Tối đa 200 dòng')}</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            </div>

            {/* Whole-upload failure — belongs to no single input, so it is ANNOUNCED
                (role="alert") rather than wired into some field's aria-describedby. */}
            {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}

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
                    <div key={r._row} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs', r._error ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card')}>
                      <span className="w-6 shrink-0 font-mono text-muted-foreground">{r._row}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.title || <span className="italic text-ink-4">{tr('(no title)', '(không có tiêu đề)')}</span>}</span>
                      <span className="shrink-0 text-muted-foreground">{r.category_slug}</span>
                      {r._error ? (
                        <span className="flex min-w-0 max-w-[55%] shrink items-center gap-1 font-semibold text-destructive"><AlertTriangle className="h-3 w-3 shrink-0" /><span className="truncate">{r._error}</span></span>
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
