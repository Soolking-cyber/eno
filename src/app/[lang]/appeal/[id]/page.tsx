'use client'

import { useState } from 'react'
import { EnoLoader } from '@/components/ui/eno-loader'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { uploadInBatches } from '@/lib/upload-client'
import { compressImageFile } from '@/lib/normalize-image'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ImagePlus, CheckCircle2, ShieldCheck } from "@/components/ui/icons"
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { Button } from '@/components/ui/button'
import { CloseButton } from '@/components/ui/close-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Appeal a moderation decision — reached from the "Action taken on your content"
// notification. The reported party explains + attaches proof; it re-opens their case
// for review. Bilingual (EN/VI).
export default function AppealPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const t = (en: string, vi: string) => tr(en, vi)

  const [note, setNote] = useState('')
  const [files, setFiles] = useState<{ url: string; file: File }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const addFiles = async (list: FileList | null) => {
    if (!list) return
    const arr = Array.from(list).slice(0, 6 - files.length)
    const next = await Promise.all(arr.map(async (f) => ({ url: URL.createObjectURL(f), file: await compressImageFile(f) })))
    setFiles((p) => [...p, ...next].slice(0, 6))
  }
  const removeFile = (i: number) => setFiles((p) => p.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (note.trim().length < 5) { setError(t('Please explain your appeal.', 'Vui lòng giải thích lý do khiếu nại của bạn.')); return }
    setSubmitting(true); setError('')
    try {
      const urls = files.length ? await uploadInBatches(files.map((f) => f.file)) : []
      const res = await fetch('/api/report/appeal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: id, note: note.trim(), images: urls }) })
      if (!res.ok) {
        const code = (await res.json().catch(() => null))?.error
        setError(code === 'forbidden' ? t('This appeal isn’t available on your account.', 'Khiếu nại này không khả dụng trên tài khoản của bạn.')
          : code === 'rate_limited' ? t('Too many attempts — try again later.', 'Quá nhiều lần thử — vui lòng thử lại sau.')
          : t('Could not submit — please try again.', 'Không gửi được — vui lòng thử lại.'))
        return
      }
      setDone(true)
    } catch { setError(t('Could not submit — please try again.', 'Không gửi được — vui lòng thử lại.')) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 px-3 py-10 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex justify-center py-20"><EnoLoader /></div>
        ) : !user ? (
          <div className="rounded-2xl bg-popover p-8 text-center shadow-pop">
            {/* §0b: appealing an eno moderation decision is a first-party trust moment —
                the seal replaces lucide ShieldQuestion. Display stroke at 40px (§2);
                muted line, the brand-100 chief carries the signature. */}
            <ShieldCheck strokeWidth={STROKE_DISPLAY} className="mx-auto h-10 w-10 text-ink-4" />
            <p className="mt-3 text-sm text-muted-foreground">{t('Sign in to appeal a decision on your account.', 'Đăng nhập để khiếu nại quyết định trên tài khoản của bạn.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        ) : done ? (
          <div className="rounded-2xl bg-popover p-8 text-center shadow-pop">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" strokeWidth={STROKE_DISPLAY} />
            <h1 className="mt-3 text-lg font-bold text-foreground">{t('Appeal submitted', 'Đã gửi khiếu nại')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('The eno.vn team will review your appeal and the proof you sent. You’ll hear back via your notifications.', 'Đội ngũ eno.vn sẽ xem xét khiếu nại và bằng chứng của bạn. Bạn sẽ nhận phản hồi qua thông báo.')}</p>
            <Button asChild variant="cta" size="none"><Link href="/" className="mt-5 px-6 py-2">{t('Back to eno.vn', 'Về eno.vn')}</Link></Button>
          </div>
        ) : (
          <div className="rounded-2xl bg-popover p-6 shadow-pop">
            <h1 className="text-lg font-bold text-foreground">{t('Appeal this decision', 'Khiếu nại quyết định này')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('Tell us why you think this was a mistake and attach proof (screenshots, photos). We’ll re-review your case.', 'Hãy cho chúng tôi biết vì sao bạn cho rằng đây là nhầm lẫn và đính kèm bằng chứng (ảnh chụp màn hình, ảnh). Chúng tôi sẽ xem xét lại.')}</p>

            <Label htmlFor="note" className="mt-5 block text-xs font-semibold text-body">{t('Your explanation', 'Giải thích của bạn')}</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} placeholder={t('Explain what happened…', 'Giải thích điều đã xảy ra…')} className="mt-1 min-h-0 resize-none" />

            <Label className="mt-4 block text-xs font-semibold text-body">{t('Proof (optional)', 'Bằng chứng (không bắt buộc)')}</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl bg-tint">
                  <img src={f.url} alt="" className="h-full w-full object-cover" />
                  {/* CloseButton, mirroring the sibling /reports/[id] tile exactly — the two
                      supplement pages are one pattern and must stay byte-identical here.
                      ⚠️ THE POST WIZARD'S PHOTO-TILE REMOVE, NOT A HAND-SIZED ONE (D-CLOSE, 2026-09-29): this
                      was a 29px ✕ (26px of ring) on a 20px black plate, so the ring hung past the plate on
                      every side. `2xs` + `overlay` is the measured pair — 24px plate, 18px mark. */}
                  <CloseButton size="2xs" variant="overlay" tapTarget={false} onClick={() => removeFile(i)} label={t('Remove', 'Xóa')} className="absolute right-1 top-1" />
                </div>
              ))}
              {files.length < 6 && (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 hover:bg-muted">
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-3xs font-semibold">{t('Add', 'Thêm')}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                </label>
              )}
            </div>

            {error && <p role="alert" className="mt-3 text-center text-xs font-semibold text-destructive">{error}</p>}

            <Button variant="cta" size="none" onClick={submit} loading={submitting} disabled={note.trim().length < 5} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer">
              {t('Submit appeal', 'Gửi khiếu nại')}
            </Button>
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
