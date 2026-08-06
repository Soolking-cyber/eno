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
}

const REASONS: Reason[] = [
  {
    key: 'free',
    icon: Megaphone,
    titleEn: 'Free to post',
    titleVi: 'Đăng tin miễn phí',
  },
  {
    key: 'trust',
    icon: BadgeCheck,
    titleEn: 'Trust scores you can check',
    titleVi: 'Điểm tin cậy có thể kiểm chứng',
  },
  {
    key: 'private',
    icon: LockKeyhole,
    titleEn: 'Your number stays private',
    titleVi: 'Số điện thoại được giữ kín',
  },
  {
    key: 'currency',
    icon: Coins,
    // 'Đ', not 'VND' and not 'đ' (owner, 2026-08-05, twice: "use Đ instead of vnd", then "capital D").
    // ⚠️ This is DELIBERATELY the one place the capital is used, and it does NOT match the prices.
    // src/lib/vnd.ts renders lowercase ("12.000.000 đ") and canon §7 pins that — do not "fix" the
    // formatter to agree with this line. Standing alone as a label, the capital reads as the currency;
    // inside a price, lowercase is the Vietnamese convention. Both titles carry it so the bullet is
    // the same in either language.
    titleEn: 'Prices in Đ and $',
    titleVi: 'Giá bằng Đ và $',
  },
  {
    key: 'disputes',
    icon: Gavel,
    titleEn: 'Real dispute resolution',
    titleVi: 'Giải quyết tranh chấp thật sự',
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
              {/* The blurb under each title was removed (owner, 2026-08-05) — icon + title only.
                  The two-line min-height floor went with it: its entire job was making the BLURBS
                  start on the same baseline when titles wrapped to different heights. With nothing
                  below the title, a floor only pads short titles with dead space. */}
              <span className="mt-3 text-sm font-bold leading-snug text-foreground text-balance">
                {tr(r.titleEn, r.titleVi)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
