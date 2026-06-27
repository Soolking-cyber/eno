'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { X, ArrowRight } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

/** Quick Help sheet opened from the floating "?" button — a fast hub to the Help
 *  Center, reporting, and feedback (bottom-sheet on mobile, centered card on desktop). */
export function HelpPopover({ onClose }: { onClose: () => void }) {
  const { tr } = useLanguage()

  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Help', 'Trợ giúp')} className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden onClick={onClose} />
      <div className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-card shadow-overlay animate-in fade-in slide-in-from-bottom-4 duration-200 sm:max-w-md sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <span className="text-base font-bold text-foreground">{tr('Help', 'Trợ giúp')}</span>
          <button type="button" onClick={onClose} aria-label={tr('Close', 'Đóng')} className="flex h-8 w-8 items-center justify-center rounded-full text-body transition-colors hover:bg-muted cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-7 px-5 py-5">
          {/* Help center */}
          <section>
            <h2 className="text-lg font-bold text-foreground">{tr('How can we help you?', 'Chúng tôi có thể giúp gì?')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-body">
              {tr('Find answers about buying, selling and your account — or contact us for more help.', 'Tìm câu trả lời về mua, bán và tài khoản — hoặc liên hệ để được hỗ trợ thêm.')}
            </p>
            <Link href="/help" onClick={onClose} className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#0a66c2] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
              {tr('Visit Help Center', 'Đến Trung tâm trợ giúp')}
            </Link>
          </section>

          {/* Report */}
          <section>
            <h2 className="text-base font-bold text-foreground">{tr('Report content', 'Báo cáo nội dung')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-body">
              {tr('If a listing breaks our policies or the law, report it so we can keep eno.vn safe for everyone.', 'Nếu một tin đăng vi phạm chính sách hoặc pháp luật, hãy báo cáo để chúng tôi giữ eno.vn an toàn cho mọi người.')}
            </p>
            <Link href="/safety" onClick={onClose} className="mt-3 flex w-full items-center justify-center rounded-xl border border-[#0a66c2] px-5 py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-accent">
              {tr('How to report a listing', 'Cách báo cáo tin đăng')}
            </Link>
          </section>

          {/* Feedback */}
          <section>
            <h2 className="text-base font-bold text-foreground">{tr('Let us know', 'Cho chúng tôi biết')}</h2>
            <div className="mt-2.5 space-y-3">
              <a href="mailto:support@eno.forum?subject=Feedback" className="flex items-center gap-1.5 text-sm font-bold text-accent-foreground hover:underline">
                {tr('Send feedback', 'Gửi phản hồi')} <ArrowRight className="h-4 w-4" />
              </a>
              <a href="mailto:support@eno.forum?subject=Technical%20problem" className="flex items-center gap-1.5 text-sm font-bold text-accent-foreground hover:underline">
                {tr('Report a technical problem', 'Báo lỗi kỹ thuật')} <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
