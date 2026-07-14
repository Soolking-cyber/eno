'use client'

import Link from 'next/link'
import { ShieldCheck, BadgeCheck, Gavel, Flag, Wallet, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * Slim, tappable trust-safety strip for the listing detail page. Opens a bottom
 * sheet (centered card on desktop) that lists ONLY what eno actually underwrites —
 * screened listings, the evidence-based Trust score, the 72h dispute center,
 * admin-reviewed reports, and safe-payment guidance. No escrow, no returns.
 */
export function ProtectionsRow() {
  const { tr } = useLanguage()

  const items: { icon: React.ReactNode; title: string; body: string }[] = [
    {
      icon: <BadgeCheck className="h-5 w-5 text-accent-foreground" aria-hidden />,
      title: tr('Screened listings', 'Tin đã kiểm duyệt'),
      body: tr(
        'New listings are reviewed before they go live, and we keep removing ones that break our rules.',
        'Tin đăng được kiểm duyệt trước khi hiển thị, và chúng tôi liên tục gỡ những tin vi phạm.',
      ),
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-accent-foreground" aria-hidden />,
      title: tr('Evidence-based Trust score', 'Điểm uy tín dựa trên bằng chứng'),
      body: tr(
        "Every seller's Trust score is computed from real activity — verified reviews, response record and dispute history — not paid badges.",
        'Điểm uy tín của mỗi người bán được tính từ hoạt động thật — đánh giá đã xác minh, lịch sử phản hồi và tranh chấp — không phải huy hiệu trả phí.',
      ),
    },
    {
      icon: <Gavel className="h-5 w-5 text-accent-foreground" aria-hidden />,
      title: tr('Dispute center', 'Trung tâm tranh chấp'),
      body: tr(
        'If something goes wrong, open a dispute. Both sides get a 72-hour window to submit evidence, reviewed privately by our team.',
        'Nếu có vấn đề, hãy mở tranh chấp. Hai bên có 72 giờ để nộp bằng chứng, được đội ngũ của chúng tôi xem xét riêng.',
      ),
    },
    {
      icon: <Flag className="h-5 w-5 text-accent-foreground" aria-hidden />,
      title: tr('Admin-reviewed reports', 'Báo cáo được quản trị viên xử lý'),
      body: tr(
        'Report any listing or chat. A real person reviews every report and acts on the ones that break our policies.',
        'Báo cáo bất kỳ tin đăng hay cuộc trò chuyện nào. Người thật xem mọi báo cáo và xử lý những trường hợp vi phạm.',
      ),
    },
    {
      icon: <Wallet className="h-5 w-5 text-accent-foreground" aria-hidden />,
      title: tr('Never pay in advance', 'Không trả trước'),
      body: tr(
        "eno doesn't hold your money. Meet in a public place, check the item, and only pay once you're happy — never transfer a deposit to strangers.",
        'eno không giữ tiền của bạn. Hãy gặp ở nơi công cộng, kiểm tra món hàng, và chỉ trả khi hài lòng — đừng chuyển cọc cho người lạ.',
      ),
    },
  ]

  return (
    <Dialog>
      <DialogTrigger render={
        <Button
          type="button"
          variant="bare"
          size="none"
          className="flex w-full items-center justify-start gap-2.5 whitespace-normal rounded-xl border border-border bg-tint px-3.5 py-2.5 text-left font-normal transition-colors hover:bg-accent active:scale-100"
        />
      }>
          <ShieldCheck className="h-5 w-5 shrink-0 text-accent-foreground" aria-hidden />
          <span className="min-w-0 flex-1 text-xs leading-snug text-body">
            <span className="font-bold text-foreground">{tr('ENO protects you', 'ENO bảo vệ bạn')}</span>
            {' — '}
            {tr('disputes handled in 72h · listings screened', 'tranh chấp xử lý trong 72 giờ · tin đã kiểm duyệt')}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </DialogTrigger>

      <DialogContent
        className="top-auto bottom-0 left-0 max-h-[85vh] w-full max-w-full translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-2xl p-0 duration-200 motion-reduce:animate-none motion-reduce:transition-none data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl"
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent-foreground" aria-hidden />
            <DialogTitle className="text-lg font-bold text-foreground">
              {tr('How ENO protects you', 'ENO bảo vệ bạn thế nào')}
            </DialogTitle>
          </div>
          <DialogDescription className="mt-1.5 text-sm leading-relaxed text-body">
            {tr(
              'Here is exactly what we do — and what we don’t. eno is a marketplace, not an escrow service.',
              'Đây là những gì chúng tôi làm — và không làm. eno là sàn giao dịch, không phải dịch vụ ký quỹ.',
            )}
          </DialogDescription>
        </div>

        <ul className="space-y-4 px-5 pb-2">
          {items.map((it) => (
            <li key={it.title} className="flex gap-3">
              <span className="mt-0.5 shrink-0">{it.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{it.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-body">{it.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-2 border-t border-border px-5 py-4">
          <DialogClose render={
            <Link
              href="/safety"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand px-5 py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-accent"
            />
          }>
              {tr('Read our safety guide', 'Xem hướng dẫn an toàn')}
              <ChevronRight className="h-4 w-4" aria-hidden />
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
