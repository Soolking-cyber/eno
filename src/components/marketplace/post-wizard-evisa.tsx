'use client'

import { Stamp } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { FieldControl } from '@/components/ui/field'
import { useLanguage } from '@/context/language-context'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { COMPANY } from '@/lib/site-legal'
import { cn } from '@/lib/utils'
import type { LICENCE_CHECK_SUBCATEGORIES } from '@/lib/taxonomy'
import {
  PROVIDER_LEGAL_NAME, PROVIDER_LICENCE_LIMITS, PROVIDER_LICENCE_NO,
  type ProviderLicence, type ProviderLicenceProblem, type ProviderLicenceReason,
} from '@/lib/provider-licence'
import { Field } from './post-wizard-parts'

/**
 * ⛔ THE LICENCE AISLES IN THE POST WIZARD (owner, 2026-10-14: e-Visa — "Anyone posts, live after check" — and Legal &
 * permits — "Check them too"; taxonomy.ts licenceCheckHold). A listing in either aisle from anyone but eno's own desk is
 * stored unpublished until eno's team has compared the provider's registered business name and licence number — typed
 * by the seller ("seller enters", owner 2026-10-14), shown on the listing — with the copies the provider emails
 * (Quy chế Article 5), and any change of either value or of the aisle sends it back (src/lib/licence-stamp.ts).
 * This module is the wizard's half of that: the note that announces the check BEFORE Publish (LicenceCheckNote), the two
 * fields (ProviderLicenceFields — the same rules as the server, src/lib/provider-licence.ts), and the per-aisle copy the
 * wizard and the success screen reuse (licenceHeldToast, licenceHeldSuccessBody, licenceGuessHint).
 * ⚠️ ENGLISH IN LITERAL tr()/t() PAIRS (scripts/gen-ui-strings.mjs pre-translates only literals, and only up to 400
 * characters — hence the Legal & permits note in two halves); an address or an example number is filled in AFTER
 * translation (fillTemplate), so a machine translation can never mangle it. Typographic ’ only.
 * ⚠️ The Legal & permits copy names no visa: that aisle is work permits, residence cards, legal and tax help.
 */

/** One of the two licence aisles (taxonomy.ts LICENCE_CHECK_SUBCATEGORIES). */
export type LicenceSlot = (typeof LICENCE_CHECK_SUBCATEGORIES)[number]
/** The two provider fields, by their attribute keys. */
export type ProviderLicenceField = ProviderLicenceProblem['field']
/** The wizard's own t(vi, en) — post-wizard.tsx `t`, PostSuccess `t`. */
type T = (vi: string, en: string) => string

/** The e-Visa hint's example: an international travel-service licence's own shape. Never translated. */
const LICENCE_NO_EXAMPLE = '79-123/2019/TCDL-GP LHQT'

/**
 * The check, announced before Publish — id `pw-evisa`, kept from the e-Visa-only note it replaces.
 *   · 'new' — a new post in an aisle, or an edit moving a listing INTO one from outside: the whole rule — who may list,
 *     what to type below, where to send the copies;
 *   · 'resubmit' — an edit of a listing already in an aisle that the save sends back: a move between the aisles, a
 *     changed value, or a row not approved yet (VietKite's grandfathered rows included).
 * An approved edit with unchanged values shows no note at all — only the fields' quiet hint (ProviderLicenceFields).
 */
export function LicenceCheckNote({ slot, mode }: { slot: LicenceSlot; mode: 'new' | 'resubmit' }) {
  const { tr } = useLanguage()
  const legal = slot === 'legal-permits'
  const title = legal
    ? tr('Legal & permits listings go live after a licence check', 'Tin Giấy tờ & pháp lý được hiển thị sau khi kiểm tra giấy phép')
    : tr('e-Visa listings go live after a licence check', 'Tin e-Visa được hiển thị sau khi kiểm tra giấy phép')
  const email = { email: COMPANY.email }
  const body = mode === 'resubmit'
    ? tr('Saving sends this listing back for eno’s licence check: it stays unpublished until the team has checked the details below.', 'Khi lưu, tin này sẽ được gửi lại để eno kiểm tra giấy phép: tin sẽ tạm ẩn cho đến khi đội ngũ kiểm tra xong thông tin bên dưới.')
    : legal
      // Two halves: the whole sentence runs past the 400 characters the catalogue harvest takes (see the header).
      ? `${tr('Only a licensed business may list work-permit, residence-card, legal and tax services. Enter the business’s registered name and its licence or registration number below, exactly as on the licence: both are shown on your listing.', 'Chỉ doanh nghiệp có giấy phép mới được đăng dịch vụ giấy phép lao động, thẻ tạm trú, pháp lý và thuế. Hãy nhập tên doanh nghiệp đã đăng ký và số giấy phép hoặc số đăng ký ở bên dưới, đúng như trên giấy phép: cả hai sẽ hiển thị trên tin đăng của bạn.')} ${fillTemplate(
        tr('After you publish, send a copy of the licence or registration and the business registration to {email}. eno’s team checks them against what you entered and publishes the listing.', 'Sau khi đăng, hãy gửi bản sao giấy phép hoặc giấy đăng ký và giấy chứng nhận đăng ký doanh nghiệp tới {email}. Đội ngũ eno sẽ đối chiếu với thông tin bạn đã nhập rồi hiển thị tin.'),
        'After you publish, send a copy of the licence or registration and the business registration to {email}. eno’s team checks them against what you entered and publishes the listing.',
        email,
      )}`
      : fillTemplate(
        tr('Only a licensed business may list a visa service. Enter the business’s registered name and its licence number below, exactly as on the licence: both are shown on your listing. After you publish, send a copy of the licence and the business registration to {email}. eno’s team checks them against what you entered and publishes the listing.', 'Chỉ doanh nghiệp có giấy phép mới được đăng dịch vụ visa. Hãy nhập tên doanh nghiệp đã đăng ký và số giấy phép ở bên dưới, đúng như trên giấy phép: cả hai sẽ hiển thị trên tin đăng của bạn. Sau khi đăng, hãy gửi bản sao giấy phép và giấy chứng nhận đăng ký doanh nghiệp tới {email}. Đội ngũ eno sẽ đối chiếu với thông tin bạn đã nhập rồi hiển thị tin.'),
        'Only a licensed business may list a visa service. Enter the business’s registered name and its licence number below, exactly as on the licence: both are shown on your listing. After you publish, send a copy of the licence and the business registration to {email}. eno’s team checks them against what you entered and publishes the listing.',
        email,
      )
  return (
    <Alert id="pw-evisa" role="note" tone="info" appearance="flat" size="md" icon={<Stamp className="h-4 w-4" />} title={title} className="max-w-xl">
      <p>{body}</p>
    </Alert>
  )
}

/**
 * Why a value cannot be accepted, per field and per reason (provider-licence.ts providerLicenceProblems — the server's
 * own rules, so the form and a refusal never disagree). Literal pairs, one per case; a limit or an example is filled in
 * after translation.
 */
function problemCopy(field: ProviderLicenceField, reason: ProviderLicenceReason, slot: LicenceSlot, tr: (en: string, vi: string) => string): string {
  const legal = slot === 'legal-permits'
  if (reason === 'too_long') {
    const max = String(field === PROVIDER_LEGAL_NAME ? PROVIDER_LICENCE_LIMITS.legalName : PROVIDER_LICENCE_LIMITS.licenceNo)
    return fillTemplate(tr('Shorten it to {max} characters at most.', 'Hãy rút gọn còn tối đa {max} ký tự.'), 'Shorten it to {max} characters at most.', { max })
  }
  if (field === PROVIDER_LEGAL_NAME) {
    switch (reason) {
      case 'missing': return tr('Add the registered business name.', 'Hãy nhập tên doanh nghiệp đã đăng ký.')
      case 'no_letter': return tr('Enter the name in letters, as on the licence.', 'Hãy nhập tên bằng chữ, đúng như trên giấy phép.')
      case 'personal_id': return tr('Remove the long number: a registered name holds no ID or phone number.', 'Hãy bỏ dãy số dài: tên doanh nghiệp không chứa số giấy tờ tùy thân hay số điện thoại.')
      case 'contact': return tr('Remove the phone number, email or web address from the name.', 'Hãy bỏ số điện thoại, email hoặc địa chỉ web khỏi tên.')
      default: return tr('The name has a word that isn’t allowed.', 'Tên có từ ngữ không được phép.')
    }
  }
  switch (reason) {
    case 'missing':
      return legal ? tr('Add the licence or registration number.', 'Hãy nhập số giấy phép hoặc số đăng ký.') : tr('Add the licence number.', 'Hãy nhập số giấy phép.')
    case 'format':
      return legal
        ? tr('Enter the number exactly as on the licence or registration, or the 10-digit enterprise code without spaces or dots. Only letters, digits, spaces and . / - are accepted.', 'Hãy nhập số đúng như trên giấy phép hoặc giấy đăng ký, hoặc mã số doanh nghiệp 10 chữ số không có dấu cách hay dấu chấm. Chỉ dùng chữ, số, dấu cách và . / -')
        : fillTemplate(
          tr('Enter the number exactly as on the licence, letters included, e.g. {example}. Only letters, digits, spaces and . / - are accepted.', 'Hãy nhập số đúng như trên giấy phép, kể cả phần chữ, ví dụ {example}. Chỉ dùng chữ, số, dấu cách và . / -'),
          'Enter the number exactly as on the licence, letters included, e.g. {example}. Only letters, digits, spaces and . / - are accepted.',
          { example: LICENCE_NO_EXAMPLE },
        )
    case 'no_digit': return tr('A licence number has digits: enter it as on the licence.', 'Số giấy phép phải có chữ số: hãy nhập đúng như trên giấy phép.')
    case 'personal_id': return tr('That looks like a personal ID number. Enter the business’s number instead.', 'Đây có vẻ là số giấy tờ tùy thân cá nhân. Hãy nhập số của doanh nghiệp.')
    case 'contact': return tr('Remove the phone number, email or link from the number.', 'Hãy bỏ số điện thoại, email hoặc đường link khỏi số giấy phép.')
    default: return tr('This has a word that isn’t allowed.', 'Có từ ngữ không được phép.')
  }
}

/**
 * THE PROVIDER'S TWO VALUES — on EVERY in-aisle form (a new post, an edit, an approved edit too), never only inside the
 * note (Opus #8a: an in-aisle edit showed no note, so it could never fix or change them). The wizard keeps the values in
 * its `attrs` under the two attribute keys and passes the reasons it has decided to show (touched or attempted).
 * ⚠️ THE IDS ARE ON THE CONTROLS (`pw-providerLegalName`, `pw-providerLicenceNo`), on FieldControl AND the input
 * (ui/field explains both): post-wizard.tsx scrollToField focuses only an input it finds by `pw-<key>`, and the
 * 'provider' step and a refusal jump to the field at fault.
 * `approvedHint`: an approved listing being edited — the quiet line that says a change sends it back.
 */
export function ProviderLicenceFields({ slot, values, errors, onChange, onBlur, approvedHint = false }: {
  slot: LicenceSlot
  values: ProviderLicence
  errors: Partial<Record<ProviderLicenceField, ProviderLicenceReason>>
  onChange: (field: ProviderLicenceField, value: string) => void
  onBlur: (field: ProviderLicenceField) => void
  approvedHint?: boolean
}) {
  const { tr } = useLanguage()
  const legal = slot === 'legal-permits'
  const nameReason = errors[PROVIDER_LEGAL_NAME]
  const numberReason = errors[PROVIDER_LICENCE_NO]
  const numberHint = legal
    ? tr('Exactly as on the licence or registration, or the 10-digit enterprise code. Never a personal ID number. Shown on your listing.', 'Đúng như trên giấy phép hoặc giấy đăng ký, hoặc mã số doanh nghiệp 10 chữ số. Không nhập số giấy tờ tùy thân cá nhân. Hiển thị trên tin đăng của bạn.')
    : fillTemplate(
      tr('Exactly as on the licence, e.g. {example}. Shown on your listing.', 'Đúng như trên giấy phép, ví dụ {example}. Hiển thị trên tin đăng của bạn.'),
      'Exactly as on the licence, e.g. {example}. Shown on your listing.',
      { example: LICENCE_NO_EXAMPLE },
    )
  return (
    <div className="space-y-3">
      <Field
        label={tr('Registered business name', 'Tên doanh nghiệp đã đăng ký')}
        hint={tr('Exactly as on the licence. Shown on your listing.', 'Đúng như trên giấy phép. Hiển thị trên tin đăng của bạn.')}
        error={nameReason ? problemCopy(PROVIDER_LEGAL_NAME, nameReason, slot, tr) : undefined}
        className="max-w-md"
      >
        <FieldControl
          id="pw-providerLegalName"
          render={
            <Input
              id="pw-providerLegalName"
              value={values.legalName}
              maxLength={PROVIDER_LICENCE_LIMITS.legalName}
              autoComplete="organization"
              onChange={(e) => onChange(PROVIDER_LEGAL_NAME, e.target.value)}
              onBlur={() => onBlur(PROVIDER_LEGAL_NAME)}
              aria-required
              className={cn('max-w-md', nameReason && 'ring-2 ring-destructive/60')}
            />
          }
        />
      </Field>
      <Field
        label={legal ? tr('Licence or registration number', 'Số giấy phép hoặc số đăng ký') : tr('Licence number', 'Số giấy phép')}
        hint={numberHint}
        error={numberReason ? problemCopy(PROVIDER_LICENCE_NO, numberReason, slot, tr) : undefined}
        className="max-w-md"
      >
        <FieldControl
          id="pw-providerLicenceNo"
          render={
            <Input
              id="pw-providerLicenceNo"
              value={values.licenceNo}
              maxLength={PROVIDER_LICENCE_LIMITS.licenceNo}
              // A licence number is a code: no autofill guess, no spell-check underline, never machine-translated.
              autoComplete="off"
              spellCheck={false}
              translate="no"
              onChange={(e) => onChange(PROVIDER_LICENCE_NO, e.target.value)}
              onBlur={() => onBlur(PROVIDER_LICENCE_NO)}
              aria-required
              className={cn('max-w-md', numberReason && 'ring-2 ring-destructive/60')}
            />
          }
        />
      </Field>
      {approvedHint && (
        <p className="max-w-md text-xs text-muted-foreground">
          {tr('Changing either sends the listing back for eno’s licence check.', 'Thay đổi một trong hai mục này sẽ gửi tin về lại để eno kiểm tra giấy phép.')}
        </p>
      )}
    </div>
  )
}

/** The toast after an edit the server holds (updateListingCore `held`): saved, and live again once checked — per aisle. */
export function licenceHeldToast(slot: LicenceSlot, t: T): string {
  return slot === 'legal-permits'
    ? t('Đã lưu. Tin Giấy tờ & pháp lý được hiển thị sau khi đội ngũ eno kiểm tra giấy phép của nhà cung cấp.', 'Saved. Legal & permits listings go live after eno’s team has checked the provider’s licence.')
    : t('Đã lưu. Tin e-Visa được hiển thị sau khi đội ngũ eno kiểm tra giấy phép của nhà cung cấp.', 'Saved. e-Visa listings go live after eno’s team has checked the provider’s licence.')
}

/** An edit that moved a listing OUT of the two aisles before eno had checked it (core/listings.ts updateListingCore —
 *  `held` on a non-aisle form, commit gate 2026-10-14): it is off the site until eno's team publishes it, and "goes live
 *  after the licence check" would no longer be true of it. */
export function licenceMovedOutToast(t: T): string {
  return t('Đã lưu. Tin tạm ẩn cho đến khi đội ngũ eno xem xét lại.', 'Saved. It’s off the site until eno’s team has reviewed it.')
}

/** The success screen's body for a new listing held for the check (PostSuccess `held`) — per aisle, the address filled
 *  in after translation. */
export function licenceHeldSuccessBody(slot: LicenceSlot, t: T): string {
  return slot === 'legal-permits'
    ? fillTemplate(
      t('Tin Giấy tờ & pháp lý được hiển thị sau khi đội ngũ eno kiểm tra giấy phép của nhà cung cấp. Hãy gửi bản sao giấy phép hoặc giấy đăng ký và giấy chứng nhận đăng ký doanh nghiệp tới {email}: tin sẽ hiển thị ngay khi được kiểm tra.', 'Legal & permits listings go live after eno’s team has checked the provider’s licence. Send a copy of the licence or registration and the business registration to {email}: your listing goes live as soon as it is checked.'),
      'Legal & permits listings go live after eno’s team has checked the provider’s licence. Send a copy of the licence or registration and the business registration to {email}: your listing goes live as soon as it is checked.',
      { email: COMPANY.email },
    )
    : fillTemplate(
      t('Tin e-Visa được hiển thị sau khi đội ngũ eno kiểm tra giấy phép của nhà cung cấp. Hãy gửi bản sao giấy phép và đăng ký kinh doanh tới {email}: tin sẽ hiển thị ngay khi được kiểm tra.', 'e-Visa listings go live after eno’s team has checked the provider’s licence. Send a copy of your licence and business registration to {email}: your listing goes live as soon as it is checked.'),
      'e-Visa listings go live after eno’s team has checked the provider’s licence. Send a copy of your licence and business registration to {email}: your listing goes live as soon as it is checked.',
      { email: COMPANY.email },
    )
}

/**
 * Under the subcategory chips when a Services post with no subcategory reads as one of the aisles by its words (R3, plan
 * review 2026-10-14: the server treats such a guess as a pick and asks for the licence values — post-wizard.tsx
 * `licenceGuess`). The seller picks: never the form for them (Opus #7 — a guess is not a pick).
 */
export function licenceGuessHint(slot: LicenceSlot, t: T): string {
  return slot === 'legal-permits'
    ? t('Hãy chọn danh mục con. Nếu đây là dịch vụ giấy phép lao động, thẻ tạm trú, pháp lý hoặc thuế, hãy chọn Giấy tờ & pháp lý và nhập thông tin giấy phép của nhà cung cấp.', 'Pick a subcategory. If this is a work-permit, residence-card, legal or tax service, pick Legal & permits and add the provider’s licence details.')
    : t('Hãy chọn danh mục con. Nếu đây là dịch vụ visa, hãy chọn e-Visa và nhập thông tin giấy phép của nhà cung cấp.', 'Pick a subcategory. If this is a visa service, pick e-Visa and add the provider’s licence details.')
}
