'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Flag, Loader2, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { cn } from '@/lib/utils'

type Props = { listingId?: string; sellerId?: string; className?: string }

const REASONS: { value: string; vi: string; en: string }[] = [
  { value: 'scam', vi: 'Lừa đảo', en: 'Scam' },
  { value: 'counterfeit', vi: 'Hàng giả / nhái', en: 'Counterfeit / fake goods' },
  { value: 'sold', vi: 'Đã bán / hết hàng', en: 'Already sold / unavailable' },
  { value: 'wrong-info', vi: 'Thông tin sai (giá, ảnh…)', en: 'Wrong info (price, photos…)' },
  { value: 'duplicate', vi: 'Tin trùng lặp', en: 'Duplicate listing' },
  { value: 'offensive', vi: 'Nội dung phản cảm', en: 'Offensive content' },
  { value: 'other', vi: 'Khác', en: 'Other' },
]

export function ReportButton({ listingId, sellerId, className }: Props) {
  const { tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)
  const { openSignIn } = useAuth()

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!reason) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, sellerId, reason, detail: detail.trim() || undefined }),
      })
      // Reporting requires an account — bounce anonymous users to sign-in.
      if (res.status === 401) { setOpen(false); openSignIn(); return }
      if (res.status === 429) { setError(t('Bạn đã báo cáo quá nhiều. Thử lại sau.', 'Too many reports — please try again later.')); return }
      if (!res.ok) throw new Error('failed')
      setDone(true)
    } catch {
      setError(t('Không gửi được. Thử lại.', 'Could not send. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setReason(''); setDetail(''); setDone(false); setError('') }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex items-center gap-1 text-[11px] text-[#94a3b8] hover:text-red-600 transition-colors cursor-pointer', className)}
      >
        <Flag className="h-3 w-3" /> {t('Báo cáo', 'Report')}
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="bg-white rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-[#1a202c]">
              {t('Báo cáo tin đăng', 'Report this listing')}
            </DialogTitle>
          </DialogHeader>

          {done ? (
            <div className="mt-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-[#0a66c2]" />
              <p className="mt-3 text-sm font-semibold text-[#1a202c]">{t('Cảm ơn bạn', 'Thanks for the heads-up')}</p>
              <p className="mt-1 text-sm text-[#64748b]">{t('Đội ngũ eno.vn sẽ xem xét tin này.', 'The eno.vn team will review this listing.')}</p>
              <button onClick={() => { setOpen(false); reset() }} className="mt-4 rounded-xl bg-[#0a66c2] px-6 py-2 text-sm font-bold text-white hover:bg-[#004182] transition-colors cursor-pointer">
                {t('Đóng', 'Close')}
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors cursor-pointer',
                      reason === r.value ? 'border-[#0a66c2] bg-[#e8f1fb] font-semibold text-[#0a66c2]' : 'border-slate-200 text-[#1a202c] hover:bg-slate-50',
                    )}
                  >
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', reason === r.value ? 'border-[#0a66c2]' : 'border-slate-300')}>
                      {reason === r.value && <span className="h-2 w-2 rounded-full bg-[#0a66c2]" />}
                    </span>
                    {t(r.vi, r.en)}
                  </button>
                ))}
              </div>

              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t('Chi tiết (không bắt buộc)', 'Details (optional)')}
                className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
              />

              {error && <p role="alert" className="text-center text-xs font-semibold text-red-600">{error}</p>}

              <button
                onClick={submit}
                disabled={loading || !reason}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] disabled:opacity-40 transition-colors cursor-pointer"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Gửi báo cáo', 'Submit report')}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
