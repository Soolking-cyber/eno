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
   * ⚠️ THE THREE FIELDS BELOW ARE MOCKED UNTIL THE ERC EXISTS (owner, 2026-08-02: "place suggested
   * as mock for now then we fill up"). They were identified by reading what Chợ Tốt and Shopee
   * actually publish — the two licensed Vietnamese marketplaces closest to this one — and every one
   * of them is a legal disclosure we currently omit, not a design flourish.
   *
   * They carry PENDING like the rest, so `grep 'đang cập nhật'` still finds the whole set at once
   * and no field silently ships a plausible-looking invention.
   */
  /** Legal representative — `Người đại diện theo pháp luật`. Chợ Tốt: "Nguyễn Trọng Tấn". */
  legalRep: string
  /**
   * Who ISSUED the ERC and when — Chợ Tốt prints "do Sở KH & ĐT TP.HCM cấp ngày 11/01/2013".
   * We already show the number and the date; the issuing authority was the missing third.
   */
  ercAuthority: string
  /**
   * Person accountable for site content — `Chịu trách nhiệm nội dung` (Chợ Tốt), rendered by Shopee
   * as "Person in charge of information management". Required where a site carries user-generated
   * content, which for us is listings, 1:1 chat AND a forum.
   */
  contentManager: string
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
 * Store listing URLs for the native shells. EMPTY UNTIL THE APPS ARE PUBLISHED, and the footer
 * renders a plainly-labelled "coming soon" chip rather than a link while they are.
 *
 * ⚠️ A PLACEHOLDER MUST NOT BE CLICKABLE. Both Chợ Tốt and Shopee lead their footer with store
 * badges, so the slot is worth reserving — but a badge that 404s costs more trust than a missing
 * badge, and on a marketplace whose whole pitch is trust that trade is a bad one. Filling these two
 * strings is the entire change when the listings go live; nothing else needs touching.
 */
export const APP_STORE_URL = ''
export const PLAY_STORE_URL = ''

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
  legalRep: PENDING,
  ercAuthority: PENDING,
  contentManager: PENDING,
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
 * ⚠️ '1' BECAUSE THERE HAS NEVER BEEN ANOTHER ONE. The site is pre-launch with no real users, so
 * the Terms published today are the first Terms anybody could accept — there is no earlier version
 * to transition from and nobody to transition. Dated version strings ('2026-07', '2026-08') implied
 * a history the account table does not contain.
 *
 * ⚠️ THE FIRST BUMP AFTER REAL USERS EXIST IS NOT A ONE-LINE CHANGE. Decree 52/2013 Đ.38.3 requires
 * a material change to be ANNOUNCED on-platform at least 5 clear days BEFORE it takes effect, and
 * `/regulations` promises exactly that in Vietnamese on the document MoIT reads. Publishing new
 * Terms is not announcing them: an existing user who never visits /terms is told nothing, so
 * binding them off the back of it is not an announcement in any sense a regulator would accept.
 *
 * What that needs, when it is needed: an effective-INSTANT (midnight in Vietnam, compared as a
 * timestamp — Vietnam is UTC+7 with no DST), acceptance stamping the version IN FORCE rather than
 * the newest one, and a site-wide notice during the window. All three existed briefly and were
 * removed here as premature; recover them from git rather than rebuilding from scratch —
 * `git show cc799c24 -- src/lib/site-legal.ts` and `git show d067d756` (the banner, which must stay
 * a CLIENT component: its visibility depends on the clock and it renders on statically prerendered
 * pages).
 */
export const TOS_VERSION = '1'

// True while the site is in pre-launch test operation (before the MoIT sàn TMĐT
// registration at online.gov.vn is confirmed). Drives the always-visible bilingual
// notice. Flip to false on the day the registration is confirmed — and add the
// "Đã đăng ký Bộ Công Thương" badge to the footer at the same time.
//
// ⚠️ OFF FOR ~4 HOURS ON 2026-08-02 AND BACK ON SINCE — worth recording, because the round trip is
// the argument for leaving it alone. It was flipped off on the owner's instruction ("remove this")
// while chasing a Google OAuth brand rejection that blamed the "under construction" wording, then
// restored the same evening ("put the test mode warning back but bolder more visible").
//
// Restoring it is also the legally correct state: the MoIT sàn TMĐT registration is still pending,
// and this banner is the visible statement that eno.vn is in TEST OPERATION rather than trading —
// the mitigation a sàn relies on while unregistered. With it off, the site presented as operating
// normally while showing neither the notice nor a "Đã đăng ký Bộ Công Thương" badge (there is no
// registration number to put in one yet).
//
// ⚠️ IF GOOGLE BRAND VERIFICATION IS RESUBMITTED WHILE THIS IS TRUE, expect the same rejection —
// Google requires an app to be production-ready and reads "not yet officially launched" as the
// opposite. The two requirements genuinely conflict; the resolution is the ERC, not this flag.
// Keep the consent screen in Testing mode until then (owner can add test users).
//
// ⚠️ MARKETPLACE ONLY (owner, 2026-08-02: "only for eno.vn no forum") — one of the rare cases where
// gating IS right, and it is not cosmetic. The notice is a claim about a SPECIFIC operator's
// licensing status: it is eno.vn, the licensed Vietnamese sàn TMĐT, whose MoIT registration is
// pending. eno.forum is a separate operator not making that filing, so showing it there would
// assert something untrue about a company this notice does not describe — the same class of error
// as eno.forum carrying "© eno.vn" or the eno.vn wordmark, both fixed earlier today.
//
// This is the exception the standing "every fix ships to both sites" rule allows for explicitly
// (CLAUDE.md) — the owner specified it. Do not widen it to eno.forum without a reason of the same
// kind: a filing eno.forum itself has pending.
export const PRELAUNCH = EDITION === 'marketplace'
