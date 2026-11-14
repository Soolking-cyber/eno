'use client'

import { useLanguage } from '@/context/language-context'
import { SECTION_TITLE } from '@/components/marketplace/section-title'
import { cn } from '@/lib/utils'
import { IS_SERVICES } from '@/lib/edition'
import { SHEET_HEAD_GAP, SHEET_ROWS } from '@/lib/rental-sheet'
import { GOODS_SECTION_TITLE } from '@/lib/goods-sheet'

/** The goods counsel panel's rows below md: inline "Label: value", no rules, 14px; the value left, ink and bold. */
const PANEL_ROWS = 'max-md:mt-2 max-md:divide-y-0 max-md:[&>div]:justify-start max-md:[&>div]:gap-1 max-md:[&>div]:py-0 max-md:[&_dd]:text-left max-md:[&_dd]:font-bold'
import type { SellerInfoProps, SourceAction } from '@/lib/seller-info'

export type { SellerInfoProps }

/**
 * "Thông tin người bán / Seller information" — WHO IS SELLING, on the PDP and the storefront
 * (Decree 248, Art 18.1.c: the platform displays the seller's name and address; owner decision 2026-10-01).
 *
 * Two shapes, never both:
 *   · `business` — a seller whose account type is business: the legal name, registered address and tax
 *     code they gave in their business profile, each row only when present. "As provided by the seller"
 *     is printed under it because that is what the rows are: typed by the seller (src/lib/core/seller.ts
 *     updateSeller, PATCH /api/profile). A verified business additionally wears its own badge elsewhere.
 *     ⛔ BUILT ONLY BY buildSellerInfo (src/lib/seller-info.ts), WHICH KEEPS IT OFF until the owner and
 *     counsel switch it on — identities stored so far were typed under a "never shown" notice. A `person`
 *     holder (not a business registration number) arrives with no address and no tax code.
 *   · `source` — a LINKED storefront (no owner, not a partner, listings that link out —
 *     src/lib/linked-seller.ts): there is no seller identity to show, so it names the SOURCE instead.
 *     eno.vn is not the seller of a linked listing; the source site is where the reader contacts or buys.
 *
 * ⛔ WHAT IT NEVER SHOWS: a phone number (contact goes through chat — src/lib/contact.ts), and an ID
 * number (`Seller.idNumber`, a CCCD for a person or an ERC number). Neither is a prop, so neither can be
 * passed by mistake.
 * ⚠️ PROPS ARE PLAIN STRINGS picked on the server from the raw row — the serialized seller deliberately
 * carries none of the identity columns, and this component must not become the reason it starts to.
 */
export function SellerInfo({ info, variant = 'pdp', className, sheet = false, panel = false, labelId, sourceLine }: { info: SellerInfoProps; variant?: 'pdp' | 'storefront'; className?: string; /** The heading's id, where a page renders a second copy (a linked job's phone panel, `md:hidden`): ids stay unique. */ labelId?: string; /** The rental sheet's rows and 16px heading step below md (owner-approved 2026-11-14, cook r05 "rental-c"; src/lib/rental-sheet.ts) — the same rows as Costs and Details there. */ sheet?: boolean; /**
   * ⛔ THE GOODS SHEET'S COUNSEL, BELOW md (owner-approved 2026-11-14, cook r06 "item"; src/lib/goods-sheet.ts). Quieter than
   * the table: the heading in the sub-section role, 8px over the lines, each row inline as "Source: <shop>" (label muted with its
   * colon, value ink and bold), the caption 14px in body ink, 4px apart. ⛔ NO LONGER A TINT PANEL (owner-approved 2026-11-15
   * (build 7), cook r07 "item"; it reverses r06's "the top half of one tint panel the safety advice closes"): an ordinary
   * section on the 12px text edge — the page passes no box. Every class is `max-md:`; from md the block is the table it was.
   */ panel?: boolean; /**
   * ⛔ THE GOODS SHEET'S SOURCE LINE IN PLACE OF THE "Source" ROW, BELOW md (owner-approved 2026-11-15 (build 7), cook r07 "item"):
   * the pinned tier's own line ("Source: <shop>'s website · original page", ImportProvenance `look="counsel"`) said once, here,
   * right under the heading — the page passes it only on a linked shop whose row names the same shop, so the row is hidden
   * below md (it says the same, shorter; no word is lost) and the line takes its place. The caller makes it `md:hidden`; from
   * md the row and its table are as they were. Only the `source` shape reads it.
   */ sourceLine?: React.ReactNode }) {
  const { tr } = useLanguage()
  const rows: { key: string; label: string; value: string }[] = []
  if (info.kind === 'business') {
    // A person is not a "business name" — their legal name is their name.
    // ⚠️ "Registered name", NOT "Business name", for the `company` holder (2026-10-01): `holder` is read off
    // the ID number's digit count (sellerIdentityHolder), and a business ACCOUNT can be an individual —
    // `legalName` is "full legal name (individual) or registered company name" (schema.prisma, Seller).
    // "Tên đăng ký" is true of a company and of a household business alike; "Tên doanh nghiệp" is not.
    const nameLabel = info.holder === 'company' ? tr('Registered name', 'Tên đăng ký') : tr('Name', 'Họ và tên')
    if (info.legalName?.trim()) rows.push({ key: 'name', label: nameLabel, value: info.legalName.trim() })
    if (info.legalAddress?.trim()) rows.push({ key: 'address', label: tr('Address', 'Địa chỉ'), value: info.legalAddress.trim() })
    if (info.taxCode?.trim()) rows.push({ key: 'tax', label: tr('Tax code', 'Mã số thuế'), value: info.taxCode.trim() })
  } else if (info.source.trim()) {
    rows.push({ key: 'source', label: tr('Source', 'Nguồn'), value: info.source.trim() })
  }
  // Nothing to say → render nothing (a heading over an empty list would itself be a claim).
  if (rows.length === 0) return null
  // The goods sheet's source line takes the one "Source" row's place below md (`sourceLine`): a linked shop's section only.
  const lineForRow = info.kind === 'source' && sourceLine != null

  return (
    <section aria-labelledby={labelId ?? `seller-info-${variant}`} data-seller-info={info.kind} className={cn('space-y-2', sheet && SHEET_HEAD_GAP, panel && 'max-md:space-y-1', className)}>
      {/* The PDP's section treatment (SECTION_TITLE, as "Description" / "Details" since 2026-11-09 — it was left at text-lg
          between them, pre-deploy review); the storefront's own `h-section`, as its "Reviews" / "Listings by" heads. */}
      <h2 id={labelId ?? `seller-info-${variant}`} className={variant === 'storefront' ? 'h-section text-foreground' : panel ? cn(GOODS_SECTION_TITLE, 'max-md:mb-2') : SECTION_TITLE}>
        {tr('Seller information', 'Thông tin người bán')}
      </h2>
      {/* The goods sheet's source line, in place of the row below md (`sourceLine`, the prop's note). */}
      {lineForRow && sourceLine}
      {/* The Details table's row grammar: hairline dividers, muted label, strong value. */}
      <dl className={cn('divide-y divide-border text-sm', sheet && SHEET_ROWS, panel && PANEL_ROWS, lineForRow && 'max-md:hidden')}>
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4 py-2.5">
            {/* The panel's inline row: the colon is the label's own, below md only. */}
            <dt className="shrink-0 text-muted-foreground">{r.label}{panel && <span className="md:hidden">:</span>}</dt>
            {/* Names and addresses are shown as written — never machine-translated (a name translated is a
                different name). `[overflow-wrap:anywhere]` so a long unbroken address cannot widen the row. */}
            <dd data-fab-avoid className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{r.value}</dd>
          </div>
        ))}
      </dl>
      {info.kind === 'business' && (
        <p className="text-xs text-muted-foreground lg:text-sm lg:text-body">{tr('As provided by the seller.', 'Theo thông tin người bán cung cấp.')}</p>
      )}
      {/* ⚠️ LITERAL PAIRS BEHIND THE EDITION — the block renders on both sites, and gen-ui-strings
          harvests literals only, so `${SITE_NAME}` cannot go inside the copy. True by construction: a
          linked listing's PDP replaces chat with the outbound button (page.tsx, the affiliateUrl branch).
          ⚠️ THE VERB FOLLOWS THE LISTING TYPE (`info.action`, sourceActionFor): a linked JOB is applied for
          and a linked RENTAL (home or vehicle) is contacted or booked — "buy" on those was simply wrong.
          2026-11-07 audit: both captions 14px in body ink from lg, as the rows above them; at 12px in the quietest grey "eno.vn is
          not the employer" read as fine print on a desktop. */}
      {info.kind === 'source' && <p className={cn('text-xs text-muted-foreground lg:text-sm lg:text-body', panel && 'max-md:text-sm max-md:text-body')}>{sourceCaption(info.action, tr)}</p>}
    </section>
  )
}

/** The caption under a linked shop's "Source" row — one written-out pair per edition × verb (harvester). The buy and default
 *  captions join their clauses with '; ' since 2026-11-14 (owner-approved, cook r06 "item": no em dashes in UI copy; the words
 *  are unchanged); the job and rental captions are their pages' to change. */
function sourceCaption(action: SourceAction, tr: (en: string, vi: string) => string): string {
  if (IS_SERVICES) {
    switch (action) {
      case 'apply': return tr('eno.forum is not the employer — you apply on the source website.', 'eno.forum không phải là nhà tuyển dụng — bạn ứng tuyển trên website gốc.')
      case 'rent': return tr('eno.forum does not rent this out — you contact or book on the source website.', 'eno.forum không phải là bên cho thuê — bạn liên hệ hoặc đặt thuê trên website gốc.')
      case 'buy': return tr('eno.forum is not the seller here; you contact or buy on the source website.', 'eno.forum không phải là người bán; bạn liên hệ hoặc mua trên website gốc.')
      default: return tr('eno.forum is not the seller here; each listing links to its source website, and you continue there.', 'eno.forum không phải là người bán; mỗi tin đăng dẫn link về website gốc, bạn tiếp tục tại đó.')
    }
  }
  switch (action) {
    case 'apply': return tr('eno.vn is not the employer — you apply on the source website.', 'eno.vn không phải là nhà tuyển dụng — bạn ứng tuyển trên website gốc.')
    case 'rent': return tr('eno.vn does not rent this out — you contact or book on the source website.', 'eno.vn không phải là bên cho thuê — bạn liên hệ hoặc đặt thuê trên website gốc.')
    case 'buy': return tr('eno.vn is not the seller here; you contact or buy on the source website.', 'eno.vn không phải là người bán; bạn liên hệ hoặc mua trên website gốc.')
    default: return tr('eno.vn is not the seller here; each listing links to its source website, and you continue there.', 'eno.vn không phải là người bán; mỗi tin đăng dẫn link về website gốc, bạn tiếp tục tại đó.')
  }
}
