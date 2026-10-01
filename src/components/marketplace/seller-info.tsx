'use client'

import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { IS_SERVICES } from '@/lib/edition'
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
export function SellerInfo({ info, variant = 'pdp', className }: { info: SellerInfoProps; variant?: 'pdp' | 'storefront'; className?: string }) {
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

  return (
    <section aria-labelledby={`seller-info-${variant}`} data-seller-info={info.kind} className={cn('space-y-2', className)}>
      {/* The PDP's section treatment (text-lg font-semibold, as "Description" / "Details"); the storefront's
          own `h-section`, as its "Reviews" / "Listings by" heads. */}
      <h2 id={`seller-info-${variant}`} className={variant === 'storefront' ? 'h-section text-foreground' : 'text-lg font-semibold text-foreground'}>
        {tr('Seller information', 'Thông tin người bán')}
      </h2>
      {/* The Details table's row grammar: hairline dividers, muted label, strong value. */}
      <dl className="divide-y divide-border text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
            {/* Names and addresses are shown as written — never machine-translated (a name translated is a
                different name). `[overflow-wrap:anywhere]` so a long unbroken address cannot widen the row. */}
            <dd data-fab-avoid className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{r.value}</dd>
          </div>
        ))}
      </dl>
      {info.kind === 'business' && (
        <p className="text-xs text-muted-foreground">{tr('As provided by the seller.', 'Theo thông tin người bán cung cấp.')}</p>
      )}
      {/* ⚠️ LITERAL PAIRS BEHIND THE EDITION — the block renders on both sites, and gen-ui-strings
          harvests literals only, so `${SITE_NAME}` cannot go inside the copy. True by construction: a
          linked listing's PDP replaces chat with the outbound button (page.tsx, the affiliateUrl branch).
          ⚠️ THE VERB FOLLOWS THE LISTING TYPE (`info.action`, sourceActionFor): a linked JOB is applied for
          and a linked RENTAL (home or vehicle) is contacted or booked — "buy" on those was simply wrong. */}
      {info.kind === 'source' && <p className="text-xs text-muted-foreground">{sourceCaption(info.action, tr)}</p>}
    </section>
  )
}

/** The caption under a linked shop's "Source" row — one written-out pair per edition × verb (harvester). */
function sourceCaption(action: SourceAction, tr: (en: string, vi: string) => string): string {
  if (IS_SERVICES) {
    switch (action) {
      case 'apply': return tr('eno.forum is not the employer — you apply on the source website.', 'eno.forum không phải là nhà tuyển dụng — bạn ứng tuyển trên website gốc.')
      case 'rent': return tr('eno.forum does not rent this out — you contact or book on the source website.', 'eno.forum không phải là bên cho thuê — bạn liên hệ hoặc đặt thuê trên website gốc.')
      case 'buy': return tr('eno.forum is not the seller here — you contact or buy on the source website.', 'eno.forum không phải là người bán — bạn liên hệ hoặc mua trên website gốc.')
      default: return tr('eno.forum is not the seller here — each listing links to its source website, and you continue there.', 'eno.forum không phải là người bán — mỗi tin đăng dẫn link về website gốc, bạn tiếp tục tại đó.')
    }
  }
  switch (action) {
    case 'apply': return tr('eno.vn is not the employer — you apply on the source website.', 'eno.vn không phải là nhà tuyển dụng — bạn ứng tuyển trên website gốc.')
    case 'rent': return tr('eno.vn does not rent this out — you contact or book on the source website.', 'eno.vn không phải là bên cho thuê — bạn liên hệ hoặc đặt thuê trên website gốc.')
    case 'buy': return tr('eno.vn is not the seller here — you contact or buy on the source website.', 'eno.vn không phải là người bán — bạn liên hệ hoặc mua trên website gốc.')
    default: return tr('eno.vn is not the seller here — each listing links to its source website, and you continue there.', 'eno.vn không phải là người bán — mỗi tin đăng dẫn link về website gốc, bạn tiếp tục tại đó.')
  }
}
