'use client'

import { BadgeCheck, Coins, Gavel, LockKeyhole, Megaphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'

/**
 * "WHY USE eno" — the borderless icon row from the reference the owner sent (Shopee's quick-link
 * strip: an icon tile, a label under it, in one row, no boxes and no rules).
 *
 * ⚠️ EVERY CLAIM HERE WAS CHECKED AGAINST THE CODE BEFORE IT WAS WRITTEN, and that is a standing
 * requirement rather than a one-off diligence note. eno.vn is registering as a licensed sàn TMĐT,
 * so a homepage bullet is an advertising claim by a licensed operator, and the site currently
 * carries a notice saying it is not officially operating yet. Advertising a capability the product
 * does not have is the one failure mode here that is not merely a UX bug.
 *
 * What was rejected at draft time, so nobody re-adds it:
 *   · "Market price check" — <MarketPrice> only renders when ≥5 comparable listings exist for the
 *     same brand+model+segment. At today's catalogue size it would essentially never appear, so
 *     the bullet would advertise something a visitor cannot see.
 *   · "Bilingual EN/VI" — true, but a visitor learns it from the language toggle in the first
 *     second. A bullet should tell someone something the interface has not already told them.
 *
 * ⚠️ "Trust scores" IS NOT "verified sellers", and the distinction is deliberate. Seller
 * verification is real (Seller.verificationStatus, a 365-day-expiring verifiedIdentityHash), but
 * how MANY sellers hold it varies, and a claim that every seller is verified would be false the
 * moment one is not. The trust score, by contrast, exists for every seller by construction.
 */
type Reason = {
  key: string
  icon: LucideIcon
  titleEn: string
  titleVi: string
  bodyEn: string
  bodyVi: string
}

const REASONS: Reason[] = [
  {
    key: 'free',
    icon: Megaphone,
    titleEn: 'Free to post',
    titleVi: 'Đăng tin miễn phí',
    bodyEn: 'No listing fee, no commission, no paying to get seen.',
    bodyVi: 'Không phí đăng tin, không hoa hồng, không trả tiền để được hiển thị.',
  },
  {
    key: 'trust',
    icon: BadgeCheck,
    titleEn: 'Trust scores you can check',
    titleVi: 'Điểm tin cậy có thể kiểm chứng',
    bodyEn: 'Earned from real trades and resolved reports — not stars anyone can buy.',
    bodyVi: 'Dựa trên giao dịch thật và báo cáo đã xử lý — không phải sao ai cũng mua được.',
  },
  {
    key: 'private',
    icon: LockKeyhole,
    titleEn: 'Your number stays private',
    titleVi: 'Số điện thoại được giữ kín',
    bodyEn: 'Talk in the app first. Share contact details only when you decide to.',
    bodyVi: 'Nhắn tin trong ứng dụng trước. Chỉ chia sẻ liên hệ khi bạn muốn.',
  },
  {
    key: 'currency',
    icon: Coins,
    titleEn: 'Prices in VND and $',
    titleVi: 'Giá bằng đ và $',
    bodyEn: 'Every listing shows both, so you always know what you are paying.',
    bodyVi: 'Mọi tin đăng đều hiện cả hai, để bạn luôn biết mình trả bao nhiêu.',
  },
  {
    key: 'disputes',
    icon: Gavel,
    titleEn: 'Real dispute resolution',
    titleVi: 'Giải quyết tranh chấp thật sự',
    bodyEn: 'Report a problem and a case room opens with both sides and the evidence.',
    bodyVi: 'Báo cáo sự cố và một phòng xử lý mở ra với cả hai bên cùng bằng chứng.',
  },
]

export function WhyEno() {
  const { tr } = useLanguage()

  // ⚠️ aria-label, NOT aria-labelledby. The visible <h2> was removed (owner, 2026-08-05) and an
  // aria-labelledby pointing at the deleted id would leave the section silently unnamed — the
  // failure mode where a landmark exists but announces nothing. The name still has to exist for
  // anyone navigating by landmark, so it moves onto the section itself.
  return (
    <section aria-label={tr(`Why sell and buy on ${SITE_NAME}`, `Vì sao nên mua bán trên ${SITE_NAME}`)} className="border-t border-border pt-8">

      {/* Two up on a phone, three at sm, all five in one row at lg — the reference's single row is
          only honest once there is width for it. ⚠️ The column count TRACKS REASONS.length: it was
          6 until the ward bullet was removed (owner, 2026-08-05), and a stale 6 leaves a visible
          gap at the end of the row. A horizontal scroller was rejected: it hides reasons behind a
          gesture, and the whole point of this block is that all of them are read. */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-5">
        {REASONS.map((r) => {
          const Icon = r.icon
          return (
            <li key={r.key} className="flex flex-col items-center text-center">
              {/* bg-brand-50 is a real token pair — #e8f1fb in light, #17314d in dark — so the tile
                  keeps its contrast in both themes. A hardcoded light tile would go blind at night. */}
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50">
                <Icon aria-hidden className="size-7 text-brand" />
              </span>
              {/* ⚠️ TWO-LINE FLOOR, so the blurbs start on the same baseline across a row. Without it
                  a one-line title ("Đăng tin miễn phí") sits beside a two-line one ("Điểm tin cậy có
                  thể kiểm chứng") and every blurb in the row starts at a different height — most
                  visible in Vietnamese, where two lines is the common case rather than the exception.
                  A floor rather than a fixed height: a three-line title still grows.
                  ⚠️ DROPPED AT lg (`lg:min-h-0`). With five wide columns every title measured a
                  single 19px line, so the 38px floor was pure dead space between title and blurb —
                  the floor only earns its keep at the 2- and 3-column widths where titles wrap. */}
              <span className="mt-3 flex min-h-[2.4rem] items-start justify-center lg:min-h-0 text-sm font-bold leading-snug text-foreground text-balance">
                {tr(r.titleEn, r.titleVi)}
              </span>
              <span className="mt-1 text-xs leading-relaxed text-body text-balance">
                {tr(r.bodyEn, r.bodyVi)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
