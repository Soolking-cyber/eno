'use client'

import Link from 'next/link'
import { ShieldCheck } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { VEHICLE_RENTAL_SUBCATS } from '@/lib/rental-places'

/** The vehicle-hire slugs whose driver needs a licence (a bicycle or an e-bike does not). */
const LICENSED_VEHICLE_HIRE = ['car-rental', 'motorbike-rental']

// Above-the-fold scam inoculation on the listing page — deposit-link fraud is the
// #1 marketplace scam, so the warning must be read BEFORE the buyer contacts the
// seller, not buried in the footer note. Copy is category-aware: vehicles get the
// papers/chassis check, property & rentals get the visit-before-deposit rule.
export function SafetyStrip({ categorySlug, subcategorySlug = null, action, protections, className, variant }: { categorySlug: string; /**
   * The listing's subcategory. Only VEHICLE HIRE inside `rentals` reads it (2026-10-01): a car or a
   * motorbike is not a home, so the housing lines ("meet the landlord or agent", "hold a place") are
   * swapped for vehicle ones, and a car or motorbike adds the driving-licence line.
   */ subcategorySlug?: string | null; action?: React.ReactNode; /** The reports-and-disputes row (ProtectionsRow), folded in as the quiet second line — see the note at its render. */ protections?: React.ReactNode; className?: string; /**
   * ⛔ A VARIANT, FOR LISTINGS WHERE THE CATEGORY COPY WOULD BE A FALSE PROMISE. The default advice
   * below is written for an eno seller you meet: "Meet, inspect, then pay". On a PARTNER affiliate
   * listing there is nobody to meet, eno holds no money and runs no dispute for it, so that line —
   * and the reports-and-disputes second line beside it, which describes eno's own report process and
   * paying an eno seller directly — would tell the buyer they have recourse they do not have. The
   * block is not suppressed, because the safety advice is the half that can stop someone losing
   * money; the wording is replaced with one that is true here.
   *
   * ⚠️ A VARIANT RATHER THAN A `line` STRING PROP, AND THAT IS THE POINT. This is a client component
   * that translates its own copy through tr(). A string handed in from the server page cannot be
   * translated — the first draft did exactly that and Vietnamese readers would have got the English
   * sentence, on the one line of the page that exists to prevent someone losing money.
   */ variant?: 'affiliate' | 'affiliate-purchase' | 'affiliate-rental' | 'affiliate-job' }) {
  const { tr } = useLanguage()
  // Vehicle hire inside the one rentals category (taxonomy.ts: vehicle hire is the tail of its list).
  const vehicleHire = categorySlug === 'rentals' && !!subcategorySlug && VEHICLE_RENTAL_SUBCATS.includes(subcategorySlug)
  const licensedVehicle = vehicleHire && LICENSED_VEHICLE_HIRE.includes(subcategorySlug!)

  // ⚠️ "partner tickets" IS WRONG ON A PHONE. The affiliate line was written for VinWonders and
  // then inherited by an imported electronics catalogue, where it told a reader buying a laptop
  // that we take no deposit "for partner tickets". Same split as the CTA: you book a park, you buy
  // a laptop.
  // A JOB is applied for on the original posting. The loss mode there is the "pay a fee to get the
  // job" scam (training fees, uniform deposits), so that is what this line warns about.
  const line = variant === 'affiliate-job'
    ? tr(
        "Apply only on the original posting — eno.vn doesn't handle applications and never charges a fee. Never pay money to get a job.",
        'Chỉ ứng tuyển trên tin tuyển dụng gốc — eno.vn không xử lý hồ sơ và không bao giờ thu phí. Đừng bao giờ trả tiền để có việc làm.',
      )
    // AN IMPORTED RENTAL (a reference to an ad on another listing site) is neither a purchase nor a
    // ticket: "Buy only on the shop's own website" told a tenant they were buying the flat.
    // ⛔ NOT "THE PARTNER'S OWN WEBSITE", AND NOT "RENT THROUGH" IT (SEO wave B, P3; copy sheet CS-2
    // P3-1, owner-approved 2026-09-30). The portals are not partners — no code or contract records one
    // (import-sellers.ts: reference listings) — and a tenant rents from a landlord, not through a
    // classifieds site. The advice that stops a loss is to see the place and meet the person first.
    // "eno", not "eno.vn": this strip renders on both editions, and "eno.vn" on eno.forum named the
    // other site. True as written: eno holds no money for any listing (Terms, "we hold no escrow").
    // ⚠️ AN IMPORTED VEHICLE-HIRE ROW (Mioto, BonbonCar, the bike shops — scripts/import-vehicle-rentals.ts) IS
    // ALSO `affiliate-rental` (listingType 'rent' + an outbound link), and the housing line below told a
    // driver to "meet the landlord or agent". Same promise about money, vehicle-shaped advice. "eno", not
    // "eno.vn", and no "partner", for the same reasons as the rental line.
    // ⛔ NOT "BOOK ONLY ON THE RENTAL WEBSITE … BEFORE YOU PAY" (2026-10-01). Both halves were false for some
    // source: Mioto and BonbonCar are booked AND PAID on the platform ("book and pay on Mioto" / "on
    // bonboncar.vn" — vehicle-rental-listing.ts, the description each import writes), so "check before you pay"
    // did not match how they work; and the bike shops are booked with the shop itself ("book with the shop"),
    // not necessarily on a website. What holds for every source: book through the platform or
    // the shop, and check the vehicle and its papers when it is handed over.
    : variant === 'affiliate-rental' && vehicleHire
    ? tr(
        'Book through the rental platform or the shop itself, and check the vehicle and its papers at handover. eno never takes payment or a deposit for these listings and cannot refund one.',
        'Đặt thuê qua nền tảng cho thuê hoặc trực tiếp với cửa hàng, và kiểm tra xe cùng giấy tờ xe khi nhận xe. eno không bao giờ nhận thanh toán hay tiền cọc cho các tin này và không thể hoàn tiền.',
      )
    : variant === 'affiliate-rental'
    ? tr(
        'See the place and meet the landlord or agent before you pay anything. eno never takes rent or a deposit for these listings and cannot refund one.',
        'Hãy đến xem nhà và gặp chủ nhà hoặc môi giới trước khi trả bất kỳ khoản tiền nào. eno không bao giờ nhận tiền thuê hay tiền cọc cho các tin này và không thể hoàn tiền.',
      )
    : variant === 'affiliate-purchase'
    ? tr(
        "Buy only on the shop's own website — eno.vn never takes payment for these items, and cannot refund or return one.",
        'Chỉ mua trên website chính thức của cửa hàng — eno.vn không nhận thanh toán cho các sản phẩm này, và không thể hoàn tiền hay đổi trả.',
      )
    // ⛔ NOT "THE PARTNER'S OWN WEBSITE" / "PARTNER TICKETS" (2026-10-01). Since that day "partner" means a
    // company with a signed agreement (partner-badge.tsx), and the ticket sellers behind these rows hold none —
    // VinWonders lost the badge (scripts/seed-vinwonders.ts). Each row's CTA says "Book on <seller>"; this line
    // names the operator generically. "eno", not "eno.vn", for the same both-editions reason as the rental line.
    : variant === 'affiliate'
    ? tr(
        "Book only on the operator's own website — eno never takes payment or a deposit for these tickets, and cannot refund one.",
        'Chỉ đặt vé trên website chính thức của nhà cung cấp — eno không bao giờ nhận thanh toán hay tiền cọc cho các vé này, và không thể hoàn tiền.',
      )
    :
    // A seller's OWN vehicle-hire listing gets the vehicles line, not the "hold a place" housing one.
    categorySlug === 'vehicles' || vehicleHire
      ? tr(
          'Check the papers match the chassis before paying — and never pay a deposit through a link.',
          'Kiểm tra giấy tờ trùng số khung, số máy trước khi trả tiền — và đừng bao giờ đặt cọc qua đường link.',
        )
      : categorySlug === 'property' || categorySlug === 'rentals'
        ? tr(
            'Visit in person before paying any deposit — never wire money to hold a place.',
            'Đến xem tận nơi trước khi đặt cọc — đừng bao giờ chuyển khoản để giữ chỗ.',
          )
        : tr(
            'Never send a deposit through a link — eno.vn never asks for one. Meet, inspect, then pay.',
            'Đừng bao giờ chuyển tiền cọc qua đường link — eno.vn không bao giờ yêu cầu đặt cọc. Gặp trực tiếp, kiểm tra hàng rồi mới trả tiền.',
          )

  return (
    // ⚠️ THE INK IS THE POINT — this strip carries the one sentence that can stop a buyer losing
    // money on a marketplace where deposit-link fraud is THE loss mode, and it once rendered as
    // decoration: at `bg-warning/10` with neutral `text-foreground` it read as a tinted note, and
    // on the PDP it sat directly beneath the protections panel (now the reports-and-disputes row) —
    // same rounded shape, same padding, near-identical value — so the informational box and the scam
    // warning formed one grey blob. A design review flagged it as carrying less visual weight than the price.
    //
    // ⚠️ IT USED TO ANSWER THAT WITH A LEFT RULE, AND THE RULE IS NOW GONE (owner, 2026-08-13:
    // "remove accent line on left, look all across the app if any section have it remove").
    // What holds the hierarchy without it: the `bg-warning/10` tint, the amber shield glyph, and the first
    // line's own `font-semibold text-warning` ink. The warning still speaks in the warning's voice,
    // it just no longer wears a bar. If this ever reads as a grey note again, the fix is ink and
    // weight — do not put the rule back.
    // ⚠️ `--warning` is amber-800 (#92400e) in light and amber-400 in dark, both chosen for
    // contrast as TEXT (see the token note in globals.css) — so this is safe as ink, which is
    // exactly why the token exists rather than a raw amber.
    <div className={cn('flex items-start gap-2.5 rounded-xl bg-warning/10 px-3 py-2.5 text-xs leading-relaxed', className)}>
      {/* ⚠️ SOLAR, NOT THE HAND-DRAWN SEAL (owner, 2026-08-13: "old icon make sure all icons are
          solar"). This mount used to re-draw the eno seal inline — SEAL_CHIEF + SEAL_OUTLINE +
          SEAL_CHECK stroked by hand — purely so the chief could take the strip's amber ink instead
          of <EnoSeal>'s fixed fill-brand-100. That is three hand-maintained paths, a strokeLinejoin
          that had already shipped mitered here while every other seal was round, and a glyph that
          drifts from the icon set the rest of the app draws from.
          `shield-check` is the same idea in the shared vocabulary: it takes `currentColor`, so the
          amber comes for free, and it gains the outline/bold weights every other icon has. */}
      <ShieldCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      {/* ⚠️ THE RHYTHM CARRIES THE HIERARCHY. At `space-y-0.5` the three lines — warning,
          protections, actions — sat at the same distance from each other as the words within
          them, so the block read as a pile of links rather than one statement with a footnote.
          `space-y-1.5` separates them enough to be read in order, which is the whole reason
          they are stacked in this order in the first place. */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* `text-warning`, not `text-foreground` — see the note on the container. A warning
            printed in body ink is a sentence; printed in its own ink it is a warning. */}
        <p className="font-semibold text-warning">{line}</p>
        {/* ⚠️ THE DRIVING-LICENCE LINE — cars and motorbikes only (2026-10-01). Quiet second line: the money
            warning above stays the loudest thing in the strip.
            ⛔ SELF-DRIVE, NOT "RENTING". `car-rental` also holds hire WITH a driver (taxonomy.ts: its keywords
            include 'with driver' and 'thuê xe có tài'), where the hirer needs no licence at all — "renting a
            car needs a licence" was false on those listings. The claim is about the person who DRIVES. */}
        {licensedVehicle && (
          <p data-vehicle-licence-line="" className="text-body">
            {tr(
              'Driving a hired car or motorbike yourself needs a valid licence for it — an owner may not hand a vehicle to someone without one.',
              'Tự lái ô tô hoặc xe máy thuê cần có giấy phép lái xe hợp lệ, đúng hạng xe — chủ xe không được giao xe cho người không có giấy phép lái xe.',
            )}
          </p>
        )}
        {/* ⚠️ The reports-and-disputes row MOVED IN HERE, and the ORDER is the whole design (owner,
            2026-08-11: combine these two). They were two adjacent blocks — a neutral
            protections panel at order-7 and this warning at order-9 — saying related things
            in two boxes. Merging them is right, but the direction matters: this strip carries
            the one sentence that can stop someone losing money, and a design review already
            found it reading as LESS weighty than the panel above it. So the warning keeps the
            container, the ink and the top line; protections becomes the quiet second line
            inside it, still tappable, still opening the same dialog.
            It also drops a duplicate seal — one mark per block, and this block already has it.
            The result is one thing that says "here is the risk, and here is what we do about
            it", which is the sentence the two boxes were circling separately. */}
        {protections}
        {/* Guide link left, Report right (user-picked 2026-07-14) — the old
            standalone tips|report footer was a duplicate of this same link. */}
        {/* Guide left, Report right (user-picked 2026-07-14). `-mb-1` pulls the row back into
            the block: Report is a `tap-44` control, so its 44px hit area otherwise pushed a
            visible gap below the strip that looked like stray padding.
            ⚠️ `mt-0.5`, NOT THE `-mt-1` HALF OF THE OLD `-my-1`. Both controls on this row carry a
            44px hit area on a 20px line — 12px of overhang each way — and with the top pulled in,
            that overhang covered the bottom ~5px of the reports-and-disputes row above (measured with
            an elementFromPoint grid: its bottom band hit-tested to Guide and Report). 6px more room
            clears it, so each of the three controls owns its full 44px. */}
        <div className="-mb-1 mt-0.5 flex items-center justify-between gap-3">
          <Link href="/safety" className="relative tap-44 font-semibold text-accent-foreground hover:underline active:opacity-60">
            {tr('Safe trading guide', 'Cẩm nang giao dịch an toàn')}
          </Link>
          {action}
        </div>
      </div>
    </div>
  )
}
