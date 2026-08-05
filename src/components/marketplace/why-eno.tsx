'use client'

import { BadgeCheck, Coins, Gavel, LockKeyhole, MapPin, Megaphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'

/**
 * "WHY USE eno" — the borderless icon row from the reference the owner sent (Shopee's quick-link
 * strip: an icon tile, a label under it, six across, no boxes and no rules).
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
    key: 'near',
    icon: MapPin,
    titleEn: 'Search down to your ward',
    titleVi: 'Tìm đến tận phường của bạn',
    bodyEn: 'Filter by province and ward, not just by city.',
    bodyVi: 'Lọc theo tỉnh và phường, không chỉ theo thành phố.',
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

  return (
    <section aria-labelledby="why-eno" className="border-t border-border pt-8">
      {/* A single hairline and vertical rhythm — the canon's section idiom (§3b). No panel, no fill:
          the strip is content on the page canvas, exactly like the reference's white row. */}
      <h2 id="why-eno" className="text-center text-lg font-extrabold tracking-tight text-foreground">
        {tr(`Why sell and buy on ${SITE_NAME}`, `Vì sao nên mua bán trên ${SITE_NAME}`)}
      </h2>

      {/* Two up on a phone, three at sm, all six in one row at lg — the reference's single row is
          only honest once there is width for it. A horizontal scroller was rejected: it hides
          reasons behind a gesture, and the whole point of this block is that all of them are read. */}
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-6">
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
                  A floor rather than a fixed height: a three-line title still grows. */}
              <span className="mt-3 flex min-h-[2.4rem] items-start justify-center text-sm font-bold leading-snug text-foreground text-balance">
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
