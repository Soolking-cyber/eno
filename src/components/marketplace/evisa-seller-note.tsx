'use client'

import { Info } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { SITE_NAME } from '@/lib/edition'

/**
 * ⛔ WHO WE ARE NOT, ON EVERY e-VISA LISTING THAT IS NOT eno's OWN DESK (owner, 2026-10-14: the e-Visa subcategory is
 * open to every poster on both editions, live after a licence check — taxonomy.ts licenceCheckHold). The desk's page
 * keeps its own disclosure (VisaDisclosure / VisaPartnerNote, the isVisaProduct branch of the listing page), so this
 * renders only where that one does not — never twice. It names the seller, says the site is the marketplace and not a
 * government agency, and links the official portal, where anyone can apply themselves.
 * ⚠️ EDITION-INDEPENDENT ON PURPOSE. VisaPartnerNote (visa-start.tsx) says "eno.vn" in its copy and is stubbed out of the
 * marketplace build, and NOT_GOVERNMENT (visa-provider.ts) credits the desk's provider — neither fits an ordinary
 * seller on both sites. The portal is its own constant: the forum's vietnam-evisa links are off-limits to shared code
 * (edition-lint Rule C). The site and the seller are filled in AFTER translation (fillTemplate).
 * ⚠️ No amounts: sources disagree on a 2026 revision of the government fee (checked 2026-10-14).
 */
const OFFICIAL_PORTAL = { url: 'https://evisa.gov.vn', host: 'evisa.gov.vn' } as const

export function EVisaSellerNote({ seller, className = '' }: { seller: string; className?: string }) {
  const { tr } = useLanguage()
  const text = fillTemplate(
    tr('This e-Visa service is sold and handled by {seller}. {site} is the marketplace — not a government agency — and does not decide visa applications. Sellers charge a service fee on top of the government fee. You can always apply yourself on the official portal:', 'Dịch vụ e-Visa này do {seller} bán và xử lý. {site} là sàn giao dịch — không phải cơ quan nhà nước — và không quyết định kết quả hồ sơ thị thực. Người bán thu phí dịch vụ ngoài lệ phí nhà nước. Bạn luôn có thể tự nộp hồ sơ trên cổng thông tin chính thức:'),
    'This e-Visa service is sold and handled by {seller}. {site} is the marketplace — not a government agency — and does not decide visa applications. Sellers charge a service fee on top of the government fee. You can always apply yourself on the official portal:',
    { seller, site: SITE_NAME },
  )
  return (
    <aside className={`flex max-w-3xl items-start gap-3 rounded-xl bg-tint p-4 ${className}`}>
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
      <p className="min-w-0 text-sm leading-relaxed text-body">
        {text}{' '}
        <a href={OFFICIAL_PORTAL.url} target="_blank" rel="noreferrer" className="font-semibold text-accent-foreground underline underline-offset-2">{OFFICIAL_PORTAL.host}</a>
      </p>
    </aside>
  )
}
