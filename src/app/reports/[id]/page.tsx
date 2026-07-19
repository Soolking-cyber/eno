'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { uploadInBatches } from '@/lib/upload-client'
import { compressImageFile } from '@/lib/normalize-image'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Loader2, ImagePlus, CheckCircle2, X, MessageSquareWarning } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Add details to a report YOU filed — reached from the moderation team's "could you
// share more detail" notification. Mirror of the target-side /appeal/[id] page; the
// supplement appends to the report so reviewers (and the admin AI review) see it
// alongside the original complaint.
export default function ReportSupplementPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const t = (en: string, vi: string) => tr(en, vi)

  const [text, setText] = useState('')
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
    if (text.trim().length < 3 && files.length === 0) {
      setError(t('Add a few words or a screenshot.', 'Hãy thêm vài dòng hoặc ảnh chụp màn hình.'))
      return
    }
    setSubmitting(true); setError('')
    try {
      const urls = files.length ? await uploadInBatches(files.map((f) => f.file)) : []
      const res = await fetch(`/api/reports/${id}/supplement`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), images: urls }),
      })
      if (!res.ok) {
        const code = (await res.json().catch(() => null))?.error
        setError(code === 'forbidden' ? t('This report isn’t on your account.', 'Báo cáo này không thuộc tài khoản của bạn.')
          : code === 'already_resolved' ? t('This report was already reviewed and closed — thank you!', 'Báo cáo này đã được xem xét và xử lý — cảm ơn bạn!')
          : code === 'rate_limited' ? t('Too many attempts — try again later.', 'Quá nhiều lần thử — vui lòng thử lại sau.')
          : t('Could not submit — please try again.', 'Không gửi được — vui lòng thử lại.'))
        return
      }
      setDone(true)
    } catch { setError(t('Could not submit — please try again.', 'Không gửi được — vui lòng thử lại.')) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 px-3 py-10 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-accent-foreground" /></div>
        ) : !user ? (
          <div className="rounded-2xl bg-card p-8 text-center shadow-pop">
            <MessageSquareWarning className="mx-auto h-10 w-10 text-ink-4" />
            <p className="mt-3 text-sm text-muted-foreground">{t('Sign in to add details to your report.', 'Đăng nhập để bổ sung chi tiết cho báo cáo của bạn.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        ) : done ? (
          <div className="rounded-2xl bg-card p-8 text-center shadow-pop">
            <CheckCircle2 className="mx-auto h-12 w-12 text-accent-foreground" />
            <h1 className="mt-3 text-lg font-bold text-foreground">{t('Details added — thank you', 'Đã bổ sung — cảm ơn bạn')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('Your update went straight to the review team. You’ll hear back via your notifications.', 'Thông tin bổ sung đã được gửi thẳng đến đội xem xét. Bạn sẽ nhận phản hồi qua thông báo.')}</p>
            <Button asChild variant="cta" size="none"><a href="/" className="mt-5 px-6 py-2">{t('Back to eno.vn', 'Về eno.vn')}</a></Button>
          </div>
        ) : (
          <div className="rounded-2xl bg-card p-6 shadow-pop">
            <h1 className="text-lg font-bold text-foreground">{t('Add details to your report', 'Bổ sung chi tiết cho báo cáo')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('Screenshots or the exact messages help us review faster and get it right. Everything you add goes straight to the case.', 'Ảnh chụp màn hình hoặc tin nhắn cụ thể giúp chúng tôi xử lý nhanh và chính xác hơn. Mọi thông tin bạn thêm sẽ vào thẳng hồ sơ.')}</p>

            <Label htmlFor="detail" className="mt-5 block text-xs font-semibold text-body">{t('What happened', 'Điều đã xảy ra')}</Label>
            <Textarea id="detail" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder={t('The more specific, the better…', 'Càng cụ thể càng tốt…')} className="mt-1 min-h-0 resize-none" />

            <Label className="mt-4 block text-xs font-semibold text-body">{t('Screenshots / photos (optional)', 'Ảnh chụp màn hình / ảnh (không bắt buộc)')}</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl bg-tint">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="" className="h-full w-full object-cover" />
                  <IconButton size="xs" tapTarget={false} onClick={() => removeFile(i)} aria-label={t('Remove', 'Xóa')} className="absolute right-0.5 top-0.5 size-5 bg-black/60 text-white"><X className="h-3 w-3" /></IconButton>
                </div>
              ))}
              {files.length < 6 && (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 hover:bg-muted">
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-3xs font-semibold">{t('Add', 'Thêm')}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
                </label>
              )}
            </div>

            {error && <p role="alert" className="mt-3 text-center text-xs font-semibold text-destructive">{error}</p>}

            <Button variant="cta" size="none" onClick={submit} disabled={submitting || (text.trim().length < 3 && files.length === 0)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {t('Send to the review team', 'Gửi cho đội xem xét')}
            </Button>
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
