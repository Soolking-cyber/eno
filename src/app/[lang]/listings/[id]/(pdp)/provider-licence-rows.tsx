import { Bilingual } from '@/components/marketplace/bilingual'
import type { ProviderLicence } from '@/lib/provider-licence'

/**
 * ⛔ THE PROVIDER'S LICENCE, PRINTED ON A LICENCE-AISLE LISTING (owner, 2026-10-14: e-Visa and Legal & permits; "seller
 * enters"). A listing in either aisle carries the provider's registered business name and licence (or, in Legal &
 * permits, registration) number — typed by the seller, compared by eno's team with the copies the provider emailed
 * (Quy chế Article 5) before the listing went live, and re-checked on any change (src/lib/licence-stamp.ts). The page
 * shows both, as the FIRST rows of its Details table (page.tsx), so a buyer reads who holds the licence before anything
 * else about the service.
 * ⚠️ THE VALUES ARE PRINTED EXACTLY AS STORED: a name and a number are identifiers, never copy. So no <Tr> and no
 * FacetValue (machine translation would "translate" a company name and could mangle a licence number), no
 * `first-letter:uppercase`, and `translate="no"` on the cell, which keeps browser translation off them as well. The
 * LABELS are authored pairs (<Bilingual>), so a Vietnamese reader gets curated Vietnamese.
 * ⚠️ The Legal & permits labels name no visa — that aisle is work permits, residence cards, legal and tax help.
 * Same row markup as the table's other rows, so the dividers and the floating mark's `data-fab-avoid` carry over.
 */
export function ProviderLicenceRows({ subcategorySlug, values }: { subcategorySlug: string | null; values: ProviderLicence }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 py-2.5">
        <dt className="text-muted-foreground"><Bilingual en="Licensed provider" vi="Đơn vị cung cấp được cấp phép" /></dt>
        <dd data-fab-avoid translate="no" className="text-right font-medium text-foreground">{values.legalName}</dd>
      </div>
      <div className="flex items-start justify-between gap-4 py-2.5">
        <dt className="text-muted-foreground">
          {subcategorySlug === 'legal-permits'
            ? <Bilingual en="Licence / registration no." vi="Số giấy phép / đăng ký" />
            : <Bilingual en="Licence no." vi="Số giấy phép" />}
        </dt>
        <dd data-fab-avoid translate="no" className="text-right font-medium text-foreground">{values.licenceNo}</dd>
      </div>
    </>
  )
}
