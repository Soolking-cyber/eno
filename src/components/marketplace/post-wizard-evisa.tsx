'use client'

import { Stamp } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { useLanguage } from '@/context/language-context'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { COMPANY } from '@/lib/site-legal'

/**
 * ⛔ AN e-VISA LISTING GOES LIVE AFTER A LICENCE CHECK (owner, 2026-10-14: "Anyone posts, live after check" —
 * taxonomy.ts licenceCheckHold). Shown in the post wizard while the e-Visa subcategory is picked by a poster who is not
 * an official partner, so the hold is announced BEFORE Publish, not discovered after it; the success screen repeats it
 * (PostSuccess `held`). The rule behind it is the /prohibited page's: only a licensed business may list a visa service,
 * and it shows eno its licence before the listing goes live. The address is the edition's operator inbox (COMPANY).
 * ⚠️ ENGLISH IN LITERAL tr() PAIRS (scripts/gen-ui-strings.mjs pre-translates only literals); the address is filled in
 * AFTER translation (fillTemplate), so a machine translation can never mangle it.
 */
export function EVisaLicenceNote() {
  const { tr } = useLanguage()
  return (
    <Alert
      id="pw-evisa"
      role="note"
      tone="info"
      appearance="flat"
      size="md"
      icon={<Stamp className="h-4 w-4" />}
      title={tr('e-Visa listings go live after a licence check', 'Tin e-Visa được hiển thị sau khi kiểm tra giấy phép')}
      className="max-w-xl"
    >
      <p>
        {fillTemplate(
          tr('Only a licensed business may list a visa service. After you publish, send a copy of your licence and business registration to {email}: eno’s team publishes the listing once they have checked it.', 'Chỉ doanh nghiệp có giấy phép mới được đăng dịch vụ visa. Sau khi đăng, hãy gửi bản sao giấy phép và đăng ký kinh doanh tới {email}: đội ngũ eno sẽ hiển thị tin sau khi kiểm tra.'),
          'Only a licensed business may list a visa service. After you publish, send a copy of your licence and business registration to {email}: eno’s team publishes the listing once they have checked it.',
          { email: COMPANY.email },
        )}
      </p>
    </Alert>
  )
}
