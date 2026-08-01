import { EDITION, type Edition } from '@/lib/edition'

/**
 * LEGAL IDENTITY OF THIS DEPLOYMENT'S OPERATOR — the single source of truth.
 *
 * Decree 52/2013 Đ.29/Đ.36 requires the operator's name, head-office address, ERC number (with the
 * date and place of issue) and contact channels to be displayed on the site. Everything below is a
 * PLACEHOLDER: no legal entity exists yet, so nothing here may be worded as if one does — the name
 * fields say "registration in progress" on purpose and must keep saying so until the ERC is issued.
 *
 * ⚠️ NEVER HARDCODE A COMPANY NAME, LICENCE NUMBER OR REGISTRATION NUMBER ANYWHERE ELSE. Change it
 * HERE and the footer, /signin, /terms, /privacy and /regulations all follow. A number typed into a
 * page is a legal defect that no lint can see.
 *
 * ⚠️ WHY THIS IS PER-EDITION RATHER THAN ONE GLOBAL COMPANY. One codebase is deployed twice (see
 * src/lib/edition.ts). eno.vn is registering as a licensed sàn TMĐT; eno.forum additionally lists
 * services sold by licensed third-party partners and is expected to end up as a SEPARATE operating
 * entity. A single shared COMPANY constant would print whichever entity is named here on the OTHER
 * site's mandatory operator notice — the same class of leak the edition split exists to prevent,
 * except that this one misstates who is legally responsible rather than merely advertising the
 * wrong thing.
 *
 * Today both editions resolve to the same pending entity, and that is honest because there is only
 * one. When the second entity is incorporated, fill in `OPERATORS.services` and nothing else in the
 * codebase has to change.
 */
export type LegalOperator = {
  /** Legal (Vietnamese) name, exactly as it reads on the ERC once issued. */
  name: string
  /** English rendering of the same legal name — never a different entity. */
  nameEn: string
  /** Registered head-office address (Đ.29 requires the head office, not a mailing address). */
  address: string
  /** ERC = Giấy chứng nhận đăng ký doanh nghiệp — the number. */
  erc: string
  /** ERC date + place of issue ("cấp ngày … tại …"). */
  ercIssued: string
  phone: string
  email: string
  /** Personal-data protection contact (PDPL 91/2025 rights requests). */
  privacyEmail: string
  /**
   * false while the ERC is still pending.
   *
   * ⚠️ IT IS NOT DECORATION. Copy that asserts an existing company ("operated by X, registered under
   * ERC N") is false until this is true. Gate any such wording on it rather than assuming the
   * placeholder strings read as a disclaimer — "đang cập nhật" in a field labelled "ERC no." does
   * not tell a reader that no company exists.
   */
  registered: boolean
}

/** The one value every unissued registration field carries, so a grep finds all of them at once. */
const PENDING = 'đang cập nhật'

/**
 * The single pending Vietnamese entity behind both domains today.
 *
 * ⚠️ Both editions currently point at this. That is a statement of fact, not a shortcut: there is
 * one company being registered, and claiming two would be the invention this file exists to avoid.
 */
const PENDING_VN_ENTITY: LegalOperator = {
  name: 'Công ty TNHH ENO (đang đăng ký thành lập)',
  nameEn: 'ENO Company Limited (registration in progress)',
  address: 'TP. Hồ Chí Minh, Việt Nam (địa chỉ trụ sở đang cập nhật)',
  erc: PENDING,
  ercIssued: PENDING,
  phone: PENDING,
  email: 'support@eno.vn',
  privacyEmail: 'support@eno.vn',
  registered: false,
}

/**
 * Operator identity per edition — THE ONE OBJECT TO EDIT.
 *
 * ⚠️ WHEN THE eno.forum ENTITY EXISTS, replace the `services` spread with its real fields and set
 * `registered: true`. Do not touch `marketplace` while doing it, and do not "simplify" the two
 * back into one constant afterwards — the duplication is the point once the entities differ.
 *
 * ⚠️ AND WHEN THE eno.vn ERC IS ISSUED, `marketplace.registered` flips to true in the same way.
 * Flipping it is what allows pages to state the company as a fact; leave it false until the
 * certificate is in hand, not when the application is filed.
 */
export const OPERATORS: Record<Edition, LegalOperator> = {
  marketplace: { ...PENDING_VN_ENTITY },
  services: { ...PENDING_VN_ENTITY },
}

/**
 * The operator of THIS build. Kept under the historical name `COMPANY` because /privacy, /terms,
 * /regulations, /signin and the footer all import it — the value became edition-aware, the import
 * did not have to change.
 */
export const COMPANY: LegalOperator = OPERATORS[EDITION]

/** Convenience for copy that may only assert an existing company once the ERC is issued. */
export const OPERATOR_REGISTERED = COMPANY.registered

/**
 * HOW THE TWO SITES RELATE — the disclosed-affiliation statement, for the disclosure page and both
 * footers.
 *
 * ⚠️ THE ONE THING THIS MAY NOT SAY IS "UNRELATED". eno.vn and eno.forum are built from one
 * codebase, share a brand and (today) a pending operator, and cross-link. Claiming independence
 * would be false, and a false disclosure is worse than none. The honest and legally useful framing
 * is the opposite: disclose the relationship, and be precise about what each site is answerable
 * for.
 *
 * ⚠️ IT ALSO MAY NOT NAME A SERVICE. This constant ships in BOTH bundles, including the licensed
 * marketplace's, so it stays at the level of "services offered on its own domain". Naming any
 * specific service here would put that vocabulary into eno.vn's artifact — see
 * src/lib/edition-services-copy.ts for why a runtime gate would not save you.
 *
 * EN is the authored text and VI is a curated legal pass; render with tr(AFFILIATION.en,
 * AFFILIATION.vi) rather than sending legal copy through the machine translation layer.
 */
export const AFFILIATION = {
  en:
    'eno.vn and eno.forum are related websites in the same ENO brand family. They are not the same service: each site publishes its own operator details, terms and legal notices, and each is responsible only for the services offered on its own domain. Where a service on either site is provided by a licensed third-party partner, that partner is identified on the page offering it and is the provider of record for that service, with the site acting as an intermediary platform.',
  vi:
    'eno.vn và eno.forum là hai website liên kết, cùng thuộc nhóm thương hiệu ENO. Đây không phải là cùng một dịch vụ: mỗi website công bố thông tin đơn vị vận hành, điều khoản và thông báo pháp lý riêng, và chỉ chịu trách nhiệm đối với các dịch vụ được cung cấp trên tên miền của mình. Trường hợp một dịch vụ trên website do đối tác thứ ba có giấy phép cung cấp, đối tác đó được nêu rõ tại trang cung cấp dịch vụ và là bên chịu trách nhiệm cung cấp dịch vụ; website chỉ đóng vai trò nền tảng trung gian.',
  /** One line, for a footer row where the full paragraph does not fit. */
  shortEn:
    'eno.vn and eno.forum are related sites in the same brand family; each is responsible only for the services on its own domain.',
  shortVi:
    'eno.vn và eno.forum là hai website liên kết cùng nhóm thương hiệu; mỗi website chỉ chịu trách nhiệm đối với dịch vụ trên tên miền của mình.',
}

/**
 * The version stamped onto Profile.tosVersion at acceptance (E-Transactions Law: keep a record of
 * WHAT was accepted and WHEN, not just that something was).
 *
 * ⚠️ BUMPING THIS STARTS A CLOCK, IT DOES NOT END ONE. Decree 52/2013 Đ.38.3 requires material
 * changes to the Terms/Operating Regulations to be ANNOUNCED ON-PLATFORM AT LEAST 5 DAYS BEFORE
 * they take effect. So the order is: publish the notice → wait 5 days → let the new version take
 * effect. Shipping a bumped version the same day it is announced is the violation, and it is
 * invisible in the diff — the constant looks identical either way.
 *
 * Bumped 2026-08 for the materially rewritten Terms, Regulations and Privacy Policy (platform vs.
 * provider-of-record responsibilities, the affiliation disclosure above, and applicant-document
 * handling).
 */
export const TOS_VERSION = '2026-08'

/** The version that was in force before {@link TOS_VERSION} takes effect. */
export const TOS_PREVIOUS_VERSION = '2026-07'

/**
 * The day {@link TOS_VERSION} actually takes effect — the end of the Đ.38.3 clock the bump starts.
 *
 * ⚠️ THIS EXISTS BECAUSE THE REGULATIONS PAGE PROMISES IT, IN VIETNAMESE, ON THE DOCUMENT MoIT
 * READS: "mọi sửa đổi được công bố trên sàn ít nhất 5 ngày trước ngày có hiệu lực". Until this
 * constant existed there was no mechanism behind that sentence — a bumped `TOS_VERSION` was in
 * force the moment it deployed, so the first act of publishing the promise would have broken it.
 * A commitment a reader can check must be a value the code can honour, not a paragraph.
 *
 * ISO date, compared against the request's clock. Set at least 5 CLEAR days after the deploy that
 * publishes the announcement — not 5 days after the constant was edited, which is a different and
 * always-earlier day.
 *
 * WHEN CHANGING THE TERMS AGAIN: move TOS_VERSION → TOS_PREVIOUS_VERSION, set the new TOS_VERSION,
 * set this to publication + ≥5 days. Do not backdate it to "now" to make a diff look tidy; the
 * whole point is that the gap is real.
 */
export const TOS_EFFECTIVE_FROM = '2026-08-07'

/**
 * The version legally in force right now — the one to stamp on an acceptance, and the one whose
 * text binds a user today.
 *
 * A NEW user accepting during the notice window is accepting the version that is in force at that
 * moment, and the record has to say so: `Profile.tosVersion` is evidence of what a specific person
 * agreed to on a specific day (E-Transactions Law), so stamping a version that has not taken effect
 * would make the record say something untrue and would quietly moot the notice period for everyone
 * who signed up inside it.
 *
 * Reads the clock on every call rather than caching at module load: a long-lived server instance
 * that started before the effective date would otherwise serve the old version forever.
 */
export function tosVersionInForce(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10) >= TOS_EFFECTIVE_FROM ? TOS_VERSION : TOS_PREVIOUS_VERSION
}

/** True while the new version is published-but-not-yet-binding, so pages can say which is which. */
export function tosInNoticeWindow(now: Date = new Date()): boolean {
  return tosVersionInForce(now) !== TOS_VERSION
}

/**
 * The notice a reader sees during the window, AUTHORED in both languages.
 *
 * ⚠️ NOT `<Tr text={…}/>`, for the same reason as AFFILIATION: that sends the sentence to the
 * machine-translation layer, and this sentence's whole job is to say which version legally binds
 * today. A mistranslation of that is a legal defect, not a typo. Render with
 * `<Bilingual en={TOS_NOTICE.en} vi={TOS_NOTICE.vi} />`.
 *
 * It is a getter rather than a frozen constant because it interpolates the three constants above —
 * writing the dates out by hand is how a notice ends up disagreeing with the version it describes.
 */
export const TOS_NOTICE = {
  get en() {
    return `Version ${TOS_VERSION} was published on 1 August 2026 and takes effect on ${TOS_EFFECTIVE_FROM}. Until then, version ${TOS_PREVIOUS_VERSION} remains in force.`
  },
  get vi() {
    return `Phiên bản ${TOS_VERSION} được công bố ngày 01/08/2026 và có hiệu lực từ ngày ${TOS_EFFECTIVE_FROM}. Trước ngày đó, phiên bản ${TOS_PREVIOUS_VERSION} vẫn là phiên bản đang có hiệu lực.`
  },
}

// True while the site is in pre-launch test operation (before the MoIT sàn TMĐT
// registration at online.gov.vn is confirmed). Drives the always-visible bilingual
// notice. Flip to false on the day the registration is confirmed — and add the
// "Đã đăng ký Bộ Công Thương" badge to the footer at the same time.
export const PRELAUNCH = true
