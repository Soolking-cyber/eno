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
 * ✅ THE COMPANY EXISTS. Transcribed from the two certificates the owner supplied on 2026-08-18:
 * the Giấy chứng nhận đăng ký doanh nghiệp and the Thông báo về cơ quan thuế quản lý trực tiếp,
 * both issued by Phòng Đăng ký Kinh doanh, Sở Tài chính TP. Hồ Chí Minh on 14/08/2026.
 *
 * ⚠️ EVERY FIELD IS COPIED, NOT COMPOSED. A legal notice is a quotation of a certificate, so the
 * address keeps the document's own wording and punctuation ("Số 03-05 đường số 7…") rather than a
 * tidied version, and the Vietnamese name keeps its official casing. If a value here disagrees with
 * the certificate, the certificate is right.
 *
 * ⚠️ THE ISSUING AUTHORITY IS SỞ TÀI CHÍNH, NOT SỞ KẾ HOẠCH & ĐẦU TƯ, and that is not a typo to
 * "correct". Vietnam's 2025 reform folded the Ministry of Planning & Investment into the Ministry
 * of Finance, so business registration now sits under Sở Tài chính. Every older template — and
 * every peer's footer printed before the merger — says Sở KH&ĐT. Ours must match the certificate.
 *
 * ⛔ WHAT IS DELIBERATELY NOT IN THIS FILE: the owner's personal identity number and date of birth
 * appear on the certificate and are NOT transcribed here. They are personal data with no place in a
 * public operator notice; the disclosure duty is the legal representative's NAME and title.
 *
 * ⚠️ `registered: true` IS LOAD-BEARING — it removes the "this company is still being registered"
 * paragraph from /regulations, /privacy, /about and /terms. It means the ERC is IN HAND, which it
 * now is. It does NOT mean the MoIT sàn TMĐT registration is done; that is a separate filing, still
 * pending, and PRELAUNCH below is what tracks it.
 */
const ENO_VN: LegalOperator = {
  name: 'Công ty TNHH ENO',
  nameEn: 'ENO Company Limited',
  address: 'Số 03-05 đường số 7, Phường An Khánh, Thành phố Hồ Chí Minh, Việt Nam',
  erc: '0319679107',
  ercIssued: '14/08/2026',
  ercAuthority: 'Phòng Đăng ký Kinh doanh – Sở Tài chính TP. Hồ Chí Minh',
  phone: '0772007921',
  email: 'support@eno.vn',
  privacyEmail: 'support@eno.vn',
  legalRep: 'Trần Văn Chương',
  // The certificate names the same person as owner and as legal representative (Tổng giám đốc), so
  // he is also who answers for content. Split them the day someone else does.
  contentManager: 'Trần Văn Chương',
  registered: true,
}

/**
 * eno.forum's operator — STILL NOT INCORPORATED, and that is why this placeholder survives.
 *
 * ⛔ DO NOT POINT THIS AT `ENO_VN` "because there is only one company". That was true until
 * 2026-08-18 and is the single most tempting wrong edit in this file. Công ty TNHH ENO is the
 * LICENSED Vietnamese sàn TMĐT, and eno.forum exists precisely because that company may not offer
 * visa, itinerary or PayPal services (owner, 2026-07-31). Naming it as eno.forum's operator would
 * put the licensed entity's name, ERC and head office on the site that sells exactly what it is not
 * licensed to sell — the leak the whole edition split exists to prevent, in the one place a
 * regulator is most likely to read.
 *
 * ⚠️ THE FORUM FOOTER NO LONGER PRINTS AN OPERATOR BLOCK AT ALL (owner, 2026-08-17), so today these
 * placeholder values reach only /terms, /privacy and /regulations on eno.forum, where they read as
 * "đang cập nhật". That is honest — no second entity exists yet — and it is a gap to close by
 * incorporating one, never by borrowing this one's identity.
 */
const PENDING_SERVICES_ENTITY: LegalOperator = {
  name: 'Đơn vị vận hành đang đăng ký thành lập',
  nameEn: 'Operating entity — registration in progress',
  address: PENDING,
  erc: PENDING,
  ercIssued: PENDING,
  phone: PENDING,
  email: 'support@eno.forum',
  privacyEmail: 'support@eno.forum',
  legalRep: PENDING,
  ercAuthority: PENDING,
  contentManager: PENDING,
  registered: false,
}

/**
 * Operator identity per edition — THE ONE OBJECT TO EDIT.
 *
 * ✅ eno.vn's ERC IS ISSUED (14/08/2026) and `marketplace` now carries the real entity. The note
 * that used to sit here telling the next person to flip `marketplace.registered` when the
 * certificate arrived has been removed rather than left to rot — it is done.
 *
 * ⚠️ WHEN THE eno.forum ENTITY EXISTS, replace `services` with its real fields and set
 * `registered: true`. Do not touch `marketplace` while doing it, and do not collapse the two back
 * into one constant — from 2026-08-18 they describe genuinely different legal persons, which is the
 * whole reason this map is keyed by edition.
 */
export const OPERATORS: Record<Edition, LegalOperator> = {
  marketplace: { ...ENO_VN },
  /**
   * ⚠️ THE CONTACT ADDRESSES ARE ALREADY PER-DOMAIN EVEN THOUGH THE ENTITY IS NOT (owner,
   * 2026-08-17: "all references should be eno.forum same for support email"). A visitor on
   * eno.forum was given `support@eno.vn` to write to, which is the marketplace's mailbox on the
   * marketplace's domain — it reads as the wrong company answering, and it is the single contact
   * detail a reader is most likely to act on.
   *
   * ⛔ `support@eno.forum` MUST ACTUALLY RECEIVE MAIL BEFORE THIS SHIPS. eno.forum's MX records
   * point at mx1/mx2.privateemail.com (measured 2026-08-17), so the domain CAN take delivery —
   * but MX records prove a mail HOST exists, not that this MAILBOX does, and an SMTP RCPT probe
   * could not settle it (outbound :25 is blocked from here). Verify by sending to it, not by
   * re-reading DNS.
   *
   * ⚠️ AND THE BLAST RADIUS IS WIDER THAN THE FOOTER — a reviewer refuted the first version of
   * this change on exactly that point, correctly. These two fields are not decoration: on the
   * services edition they now appear in BINDING published commitments, each with a deadline
   * attached —
   *   /regulations  "mọi liên hệ xin gửi về …", plus the 3 / 15 / 30-working-day complaint SLA
   *   /privacy      the PDPL data-controller contact, "acknowledged within 2 working days"
   *   /terms        where account-deletion and Terms questions are to be sent
   *   /about, /safety, /signin
   * So an unprovisioned mailbox here does not merely lose a support email; it silently voids
   * promises the site publishes to a regulator's audience.
   *
   * ⚠️ WHY BOTH FIELDS MOVE TOGETHER RATHER THAN JUST THE SUPPORT ONE. Splitting them — footer on
   * eno.forum, privacy requests on eno.vn — was the obvious hedge and it is worse: a data subject
   * reading one page and writing to the address on another is exactly the confusion the PDPL
   * contact exists to remove, and it puts two addresses for one operator on one site. One domain,
   * one inbox, or neither.
   *
   * ⛔ AND THE NAME/ERC/ADDRESS STAY UNFILLED ON PURPOSE — this note USED to say "there is still
   * only one company, and inventing a second would be the exact fabrication this file forbids".
   * Half of that changed on 2026-08-18: a company now exists. The conclusion did not. Công ty TNHH
   * ENO is the LICENSED sàn TMĐT that may not offer visa, itinerary or PayPal, so borrowing its
   * identity for the site that sells them would be worse than a blank field, not better.
   */
  services: { ...PENDING_SERVICES_ENTITY },
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
