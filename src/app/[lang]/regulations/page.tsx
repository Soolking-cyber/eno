/**
 * ⚠️ NOT FULLY STATIC — see the long note in src/app/[lang]/terms/page.tsx.
 *
 * This page renders TOS_VERSION and promises, in Vietnamese, that amendments are announced at least
 * 5 days before taking effect. A build-time-frozen copy of that promise is the one thing worse than
 * not making it. It is also the page src/lib/edition.ts cites as having baked "PayPal" and "e-Visa"
 * into on-disk HTML that no runtime gate could reach.
 */
export const revalidate = 3600

import type { Metadata } from 'next'
import { Fragment } from 'react'
import { withShare } from '@/lib/site-identity'
import { IS_MARKETPLACE, IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { linkifyLegal } from '@/components/marketplace/legal-linkify'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED, PRELAUNCH, REGULATIONS_PREVIOUS_VERSION, REGULATIONS_VERSION } from '@/lib/site-legal'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { LEGAL_BASIS } from '@/lib/compliance/legal-basis'
import { RENTAL_CHECK_MAX_ITEMS } from '@/lib/rental-check/shared'
import { FEED_DIVERSITY_WINDOW } from '@/lib/feed-diversity'
import { REGULATIONS_AMENDED, REGULATIONS_AMENDMENT } from '@/lib/compliance/legal-amendment'
import { V1, V1_PATHS, V1_SUPERSEDED, V2, V2_PATHS, V2_SUPERSEDED, archivedPath } from '@/lib/compliance/legal-archive'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * QUY CHẾ HOẠT ĐỘNG — the operating regulations of the sàn giao dịch thương mại điện tử.
 *
 * This is the document MoIT reads at platform registration, so it is written to be COMPLETE against
 * Luật Thương mại điện tử 122/2025/QH15 Điều 11 and its implementing Nghị định 248/2026/NĐ-CP
 * Chương II (Điều 4–11: operator identity, privacy, rights and duties, complaint handling with
 * per-issue deadlines, fee policy, display-priority criteria) plus Điều 25.3 (amendments re-filed
 * with MoIT within 20 working days once registered). ⚠️ IT USED TO CITE NĐ 52/2013 + NĐ 85/2021 —
 * both ceased to have effect on 01/07/2026 (NĐ 248 Điều 52.3). Law and decree numbers come from
 * LEGAL_BASIS (src/lib/compliance/legal-basis.ts), the single source the takedown notices use too.
 *
 * ⚠️ AMENDED TWICE IN 2026-10 — Article 17 is the change log, and every amendment adds a dated entry there.
 * Version 2 (01/10/2026, with the Terms) and version 3 (a Quy chế-only amendment of Article 14) were both
 * owner-decided exceptions (`immediate`): published and in force the same day, no notice window, no
 * announcement. The dates come from src/lib/compliance/legal-amendment.ts — version 3's from
 * REGULATIONS_AMENDMENT (META directly, its Article 17 entry through legal-archive.ts V2_SUPERSEDED),
 * version 2's from legal-archive.ts V1_SUPERSEDED (literals since the Terms' own version 3 re-used
 * LEGAL_AMENDMENT on 2026-10-07 — a Terms-only amendment that changed nothing here) — and the version numbers
 * from REGULATIONS_VERSION / REGULATIONS_PREVIOUS_VERSION (site-legal.ts), never TOS_VERSION: the Terms
 * count their own versions.
 * By default `published` = the real deploy day and in force ≥ 6 calendar days later, because the 5-day
 * notice (Article 15) does not count the publication day; Article 15 still promises that notice for
 * every future amendment.
 *
 * ⛔ SHIPS ONLY WITH W-C AND THE PARTNER DB FLIP. Article 3 (the “Cửa hàng liên kết” label, and the
 * badge meaning a signed agreement), Article 8 and Article 14 (commission links labelled “Quảng cáo”
 * with a note) describe what W-C's Ad marker / commission note / Linked-shop chip, the
 * set-official-partner.mjs DB flip and importers that stop badging new storefronts (see Article 3's
 * note) make true. Deployed without them, those sentences are false.
 *
 * ⚠️ VIETNAMESE IS THE AUTHORITATIVE TEXT AND IS RENDERED UNCONDITIONALLY. Both languages are part
 * of the published document, not alternatives to each other — the filed version is the Vietnamese
 * one, and a reviewer who lands here with an English UI preference must still see it. That is why
 * the body copy below is a pair of fixed literals per paragraph rather than `<Tr text="…">`:
 *
 *   · `<Tr>` renders ONE language at a time. On an English session the Vietnamese would not be on
 *     the page at all, which is the one thing this document cannot afford.
 *   · For `vi` it would fall back to MACHINE TRANSLATION of the English source (there is no curated
 *     entry in vi-overrides for any of this), i.e. the legally operative text of a filed instrument
 *     would be generated at runtime by an MT provider. src/lib/site-legal.ts and
 *     src/lib/visa-provider.ts both say the same thing about their own constants: render the curated
 *     pair, do not send legal copy through the translation layer.
 *
 * The `<Tr>` mechanism still governs this page's CHROME — ContentPage translates the eyebrow, the
 * h1 and the left-rail labels — so the i18n contract is intact where it applies. The eslint i18n
 * gate (react/jsx-no-literals) is satisfied because no copy is typed into JSX: every string is a
 * field on ARTICLES below and reaches the markup as an expression.
 *
 * ⚠️ THIS PAGE RENDERS ON BOTH EDITIONS AND MUST STAY CORRECT ON BOTH (see src/lib/edition.ts).
 * eno.vn is the licensed marketplace and may not so much as mention the e-visa service, so:
 *   · every self-reference uses SITE_NAME, never a hardcoded "eno.vn" — otherwise eno.forum
 *     publishes an operating regulation naming the licensed company as its operator;
 *   · the only services-specific copy is PROVIDER_OF_RECORD, gated on IS_SERVICES *and* imported
 *     from a module next.config.ts aliases to a stub on a marketplace build. The gate stops the
 *     render; only the alias keeps the partner's name out of eno.vn's artifact.
 *
 * ⚠️ WHAT WAS DELIBERATELY REMOVED, 2026-08: the old §7 named PayPal/Stripe and described an
 * "assisted e-Visa application service" sold by eno itself. A licensed marketplace's own compliance
 * text must not describe a payment function it does not have, and eno does not sell visa services at
 * all — a licensed third party does, with the platform as intermediary. Do not reintroduce either.
 *
 * ⚠️ NO COMPANY NAME, ERC OR LICENCE NUMBER IS TYPED HERE. They come from COMPANY (site-legal.ts)
 * and VISA_PROVIDER (visa-provider.ts).
 *
 * ⚠️ THIS NOTE USED TO SAY BOTH WERE "placeholders until the documents exist". Half of that is now
 * false and the correction matters, because the two editions differ for the first time:
 *   · eno.vn — Công ty TNHH ENO is INCORPORATED (ERC 0319679107, 14/08/2026). Every field is real,
 *     OPERATOR_REGISTERED is true, and the "still being registered" paragraph no longer renders.
 *   · eno.forum — its operator is still not incorporated, so the placeholders and that paragraph
 *     remain. It deliberately does NOT borrow the licensed company's identity (see site-legal.ts).
 *
 * ⚠️ AND THE COMPANY BEING REGISTERED IS NOT THE PLATFORM BEING REGISTERED. The ERC makes the
 * company exist; the sàn TMĐT filing with Bộ Công Thương is a SEPARATE, still-pending step tracked
 * by PRELAUNCH. They were welded into one paragraph behind one gate until 2026-08-18, which meant
 * the ERC arriving silently deleted the MoIT disclosure from the document MoIT reads. One fact,
 * one gate — keep it that way.
 */

const S = SITE_NAME
/** Law 122/2025 and its implementing Decree 248/2026 — typed once, in legal-basis.ts. */
const LAW = LEGAL_BASIS.ecommerceLaw
const ND248 = LEGAL_BASIS.identityDecree

type Para = { vi: string; en: string }
type Article = {
  id: string
  /** Left-rail label. English on purpose: it is navigation chrome and goes through <Tr>. */
  rail: string
  titleVi: string
  titleEn: string
  body: Para[]
  /** A table rendered after body[tableAfter] (Article 12's per-issue deadlines). */
  table?: { tableAfter: number; head: Para[]; rows: Para[][] }
  links?: { href: string; label: string }[]
}

const INTRO: Para = {
  vi: `Quy chế này mô tả cách sàn giao dịch thương mại điện tử ${S} được tổ chức và vận hành: phạm vi hoạt động, quyền và nghĩa vụ của đơn vị vận hành, của người bán và của người mua, quy trình đăng tin và giao dịch, cách rà soát và xử lý vi phạm, cách tiếp nhận khiếu nại và tranh chấp, cách bảo vệ dữ liệu cá nhân, và tiêu chí sắp xếp hiển thị tin đăng. Đây là văn bản bắt buộc công bố theo Điều 11 ${LAW.vi} và Chương II ${ND248.vi} quy định chi tiết Luật này, và là một phần của thoả thuận giữa ${S} và người sử dụng.`,
  en: `These Regulations describe how the ${S} e-commerce trading platform is organised and operated: the scope of its activity, the rights and duties of the operator, of sellers and of buyers, the listing and transaction process, how content is reviewed and breaches are dealt with, how complaints and disputes are handled, how personal data is protected, and the criteria by which listings are sorted and displayed. Publishing this document is mandatory under Article 11 of the ${LAW.en} and Chapter II of ${ND248.en}, which implements that Law, and it forms part of the agreement between ${S} and its users.`,
}

// ⚠️ THE VERSION IN FORCE IS ALWAYS PUBLISHED, AND THIS LINE SAYS WHERE (2026-10-01 review). Article 15
// promises "Bản Quy chế đang áp dụng luôn được đăng tại /regulations kèm số phiên bản".
// · IMMEDIATE amendment (both 2026-10 amendments — owner: in force the day it is published, no notice): the
//   text below IS the version in force, from that one date; the previous version is archived at
//   /regulations/v<N>.
// · An amendment WITH a notice window: until REGULATIONS_AMENDED.inForce the version in force is
//   REGULATIONS_PREVIOUS_VERSION, archived at /regulations/v<N> (src/lib/compliance/legal-archive.ts) — kept
//   for the next amendment, worded to stay true after its in-force date too.
// The authoritative-language and future-amendment-notice sentences are the same in both.
// ⚠️ REGULATIONS_*, NOT TOS_* (2026-10-05): version 3 amended the Quy chế alone, so its number and dates are
// the Quy chế's own; TOS_VERSION is the Terms' (it reads '3' since the Terms' own, Terms-only version 3 of
// 2026-10-07 — the same number, a different amendment).
const META: Para = REGULATIONS_AMENDMENT.immediate
  ? {
      vi: `Phiên bản ${REGULATIONS_VERSION}, có hiệu lực từ ngày ${REGULATIONS_AMENDED.inForceVi} (xem Điều 17). Phiên bản trước được lưu tại ${archivedPath('regulations', REGULATIONS_PREVIOUS_VERSION)}. Bản tiếng Việt là bản có giá trị pháp lý; bản tiếng Anh là bản dịch tham khảo. Mọi sửa đổi được công bố trên sàn ít nhất 5 ngày trước ngày có hiệu lực.`,
      en: `Version ${REGULATIONS_VERSION}, in force from ${REGULATIONS_AMENDED.inForceEn} (see Article 17). The previous version is archived at ${archivedPath('regulations', REGULATIONS_PREVIOUS_VERSION)}. The Vietnamese text is the authoritative one; the English is a translation provided for convenience. Any amendment is announced on the platform at least 5 days before it takes effect.`,
    }
  : {
      vi: `Phiên bản ${REGULATIONS_VERSION}, sửa đổi công bố ngày ${REGULATIONS_AMENDED.publishedVi}, có hiệu lực từ ngày ${REGULATIONS_AMENDED.inForceVi} (xem Điều 17); trước ngày đó, phiên bản ${REGULATIONS_PREVIOUS_VERSION} vẫn là bản đang áp dụng và được đăng tại ${archivedPath('regulations', REGULATIONS_PREVIOUS_VERSION)}. Bản tiếng Việt là bản có giá trị pháp lý; bản tiếng Anh là bản dịch tham khảo. Mọi sửa đổi được công bố trên sàn ít nhất 5 ngày trước ngày có hiệu lực.`,
      en: `Version ${REGULATIONS_VERSION}, amended on ${REGULATIONS_AMENDED.publishedEn} with effect from ${REGULATIONS_AMENDED.inForceEn} (see Article 17); until then version ${REGULATIONS_PREVIOUS_VERSION} remains in force, and it is published at ${archivedPath('regulations', REGULATIONS_PREVIOUS_VERSION)}. The Vietnamese text is the authoritative one; the English is a translation provided for convenience. Any amendment is announced on the platform at least 5 days before it takes effect.`,
    }

/**
 * ARTICLE 4's REGISTRATION DUTY — PER EDITION, the same licensing defect the Article 2 note below calls
 * "REAL" (2026-10-01 review). eno.vn is the edition registering with Bộ Công Thương as an intermediary
 * e-commerce platform; eno.forum is the one that will NEVER make that filing, so its Quy chế may not
 * state the duty to make it. v1 said "đăng ký, thông báo website với Bộ Công Thương" on BOTH editions;
 * eno.forum now gets a neutral duty (whatever the law requires, with the competent authority), and its
 * Article 17 entry records that change instead of the eno.vn one. ⚖️ Counsel to confirm the forum wording.
 */
const REGISTRATION_DUTY: Para = IS_MARKETPLACE
  ? {
      vi: 'đăng ký nền tảng thương mại điện tử trung gian với Bộ Công Thương theo quy định',
      en: 'register the platform with the Ministry of Industry and Trade as an intermediary e-commerce platform as required',
    }
  : {
      vi: 'thực hiện các thủ tục đăng ký, thông báo với cơ quan nhà nước có thẩm quyền mà pháp luật yêu cầu đối với hoạt động của website',
      en: 'complete whatever registration or notification the law requires of the website’s activity with the competent state authorities',
    }

/**
 * ARTICLE 17's ENTRY FOR THE OCTOBER 2026 AMENDMENT (version 2) — one item per substantive edit, numbered
 * here. ⛔ FROZEN SINCE IT WAS PUBLISHED: Article 17 is append-only, so a later amendment gets its own list
 * (CHANGES_V3 below) and never edits this one.
 *
 * ⚠️ EVERY EDIT TO THE TEXT IN FORCE BELONGS IN THIS LIST, including the quiet ones: a change log that
 * omits an edit tells the reader (and MoIT) that the omitted text did not change. The first draft
 * missed four — Article 2's MoIT wording, Article 4's registration duty, Article 10 narrowing the
 * pre-display screening to seller-posted listings, and Article 15's effect clause.
 *
 * ⚠️ PER EDITION, BECAUSE ARTICLES 2, 4 AND 15 ARE. The ERC-authority clause only renders once the
 * operator is registered (eno.forum's operator is not — site-legal.ts), the MoIT test-operation
 * paragraph only on eno.vn under PRELAUNCH, and the MoIT registration duty (Article 4) and re-filing
 * paragraph (Article 15) only on eno.vn (REGISTRATION_DUTY). Claiming an edit on a build that did not
 * get it would put a false statement in the change log of a filed document, so every item takes the
 * same gate as the text it describes.
 */
const CHANGES_V2: Para[] = [
  {
    vi: `cập nhật căn cứ pháp lý tại phần mở đầu và Điều 1 theo ${LAW.vi} và ${ND248.vi}, thay cho Nghị định 52/2013/NĐ-CP và Nghị định 85/2021/NĐ-CP đã hết hiệu lực từ ngày 01/07/2026, và xác định sàn là nền tảng thương mại điện tử trung gian tại Điều 1`,
    en: `update the legal basis in the preamble and Article 1 to the ${LAW.en} and ${ND248.en}, replacing Decree 52/2013/ND-CP and Decree 85/2021/ND-CP, which ceased to have effect on 1 July 2026, and describe the platform in Article 1 as an intermediary e-commerce platform`,
  },
  OPERATOR_REGISTERED
    ? {
        vi: 'bổ sung người đại diện theo pháp luật và cơ quan cấp Giấy chứng nhận đăng ký doanh nghiệp tại Điều 2',
        en: 'add the legal representative and the authority that issued the enterprise registration certificate to Article 2',
      }
    : {
        vi: 'bổ sung mục người đại diện theo pháp luật tại Điều 2',
        en: 'add a legal-representative entry to Article 2',
      },
  ...(IS_MARKETPLACE && PRELAUNCH
    ? [
        {
          vi: 'gọi đúng thủ tục đang thực hiện với Bộ Công Thương tại Điều 2 là đăng ký nền tảng thương mại điện tử trung gian, thay cho “đăng ký website cung cấp dịch vụ thương mại điện tử”',
          en: 'describe the registration in progress with the Ministry of Industry and Trade, in Article 2, as that of an intermediary e-commerce platform rather than of a “website providing e-commerce services”',
        },
      ]
    : []),
  IS_MARKETPLACE
    ? {
        vi: 'nêu nghĩa vụ của đơn vị vận hành tại Điều 4 là đăng ký nền tảng thương mại điện tử trung gian với Bộ Công Thương, thay cho “đăng ký, thông báo website với Bộ Công Thương”',
        en: 'state the operator’s duty in Article 4 as registering the platform with the Ministry of Industry and Trade as an intermediary e-commerce platform, in place of “registering or notifying the website”',
      }
    : {
        vi: 'nêu nghĩa vụ đăng ký, thông báo của đơn vị vận hành tại Điều 4 là các thủ tục với cơ quan nhà nước có thẩm quyền mà pháp luật yêu cầu đối với hoạt động của website, thay cho “đăng ký, thông báo website với Bộ Công Thương”',
        en: 'state the operator’s registration duty in Article 4 as whatever registration or notification the law requires of the website’s activity with the competent state authorities, in place of “registering or notifying the website with the Ministry of Industry and Trade”',
      },
  {
    vi: 'bổ sung quy định về tin đăng liên kết, Đối tác chính thức và Cửa hàng liên kết tại các Điều 1, 3, 7, 10, 11 và 12',
    en: 'add rules on linked listings, Official partners and Linked shops to Articles 1, 3, 7, 10, 11 and 12',
  },
  {
    vi: 'giới hạn việc rà soát tự động trước khi hiển thị tại Điều 10 vào tin do người bán đăng trên sàn (trước đây ghi là mọi tin đăng); mọi tin đăng, kể cả tin đăng liên kết, vẫn được rà soát lại khi có báo cáo',
    en: 'limit the automated screening before display, in Article 10, to listings posted by sellers on the platform (it previously said every listing); every listing, linked listings included, is still re-reviewed when reported',
  },
  {
    vi: 'công khai việc đơn vị vận hành có thể nhận hoa hồng từ một số đối tác và cửa hàng liên kết, bổ sung cách tính theo từng loại phí và thời điểm áp dụng vào nội dung phải công bố về phí đối với người bán, và quy định biểu phí phải được công bố ít nhất 20 ngày trước ngày áp dụng thay vì 5 ngày, tại Điều 8',
    en: 'disclose that the operator may earn a commission from some partners and linked shops, add how each type of fee is calculated and when it applies to what must be published about fees for sellers, and require fees to be published at least 20 days before they apply instead of 5, in Article 8',
  },
  {
    vi: 'bổ sung bảng thời hạn phản hồi ban đầu và thời hạn giải quyết cho từng loại việc tại Điều 12',
    en: 'add a table of first-response and resolution deadlines for each kind of issue to Article 12',
  },
  {
    vi: 'bổ sung các tiêu chí hiển thị tại Điều 14: ưu tiên tin khớp tiêu đề khi tìm kiếm, cách sắp xếp khi tìm theo thương hiệu, xếp xen kẽ theo người bán cùng vị trí dùng chung của eSIM và tin tuyển dụng, danh sách tin đăng trên trang hướng dẫn, mục “Dành cho bạn” và mục “Đã xem gần đây”, tin nổi bật và hoa hồng, đồng thời đính chính rằng tỷ trọng các tiêu chí được công bố tại /legal/ranking',
    en: 'add display criteria to Article 14 — title-match-first search, the ordering of a brand search, interleaving by seller with shared seats for eSIM and job-board listings, the listing panels on guide pages, the “For You” and “Recently viewed” rails, featured listings and commission — and correct the statement about weights, which are published at /legal/ranking',
  },
  IS_MARKETPLACE
    ? {
        vi: 'bổ sung tại Điều 15 việc thực hiện thủ tục sửa đổi, bổ sung đăng ký với Bộ Công Thương sau mỗi lần thay đổi, và quy định mỗi lần sửa đổi, bổ sung có hiệu lực từ ngày ghi tại Điều 17 và thay thế nội dung tương ứng của các phiên bản trước đó (trước đây ghi là Quy chế thay thế các phiên bản trước đó kể từ ngày công bố)',
        en: 'add to Article 15 the re-filing of each change with the Ministry of Industry and Trade, and provide that each amendment takes effect on the date recorded in Article 17 and replaces the corresponding text of earlier versions (it previously said the Regulations replace earlier versions from the day they are published)',
      }
    : {
        vi: 'quy định tại Điều 15 mỗi lần sửa đổi, bổ sung có hiệu lực từ ngày ghi tại Điều 17 và thay thế nội dung tương ứng của các phiên bản trước đó (trước đây ghi là Quy chế thay thế các phiên bản trước đó kể từ ngày công bố)',
        en: 'provide in Article 15 that each amendment takes effect on the date recorded in Article 17 and replaces the corresponding text of earlier versions (it previously said the Regulations replace earlier versions from the day they are published)',
      },
  {
    vi: 'bổ sung Điều 17 này để ghi lại lịch sử sửa đổi, bổ sung, và thống nhất cách gọi “điểm uy tín” (trước đây là “điểm tín nhiệm”) trong toàn văn bản tiếng Việt',
    en: 'add this Article 17 to record the change history, and use one Vietnamese term for the trust score, “điểm uy tín” (previously “điểm tín nhiệm”), throughout the Vietnamese text',
  },
]

/**
 * ARTICLE 17's ENTRY FOR VERSION 3 — the Quy chế-only amendment of Article 14 (UX program 2's search and feed
 * ranking; dates: REGULATIONS_AMENDMENT). Same rule as CHANGES_V2: one item per substantive edit, and the
 * quiet ones too. Article 14 is the same on both editions, so no item takes an edition gate.
 * ⚠️ Every item restates WHAT THE TEXT NOW SAYS and, for an amended sentence, what it said before — a reader
 * of the log should not need the archive (/regulations/v2) to know what changed.
 */
const CHANGES_V3: Para[] = [
  {
    vi: 'sửa đổi đoạn về tìm kiếm bằng từ khoá tại Điều 14: kết quả được xếp theo hai nhóm — trước hết là các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã hoặc thương hiệu của chính tin đó, hoặc trong tên của mục mà tin được đăng, sau đó là các tin cần đến danh mục của tin mới khớp được một trong các từ khoá — mỗi nhóm theo điểm tìm kiếm với tỷ trọng không thay đổi, và các tin bằng điểm nhau chỉ được xếp xen kẽ trong cùng một nhóm (trước đây ghi là các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã, thương hiệu hoặc danh mục của chính tin đó được xếp trước, như một nhóm)',
    en: 'amend the keyword-search paragraph of Article 14: results are ordered in two groups — first the listings whose own title, model or brand, or the name of the aisle they are listed in, contains every search word, then the listings that need their category to match one of the words — each group by the search score, whose weights are unchanged, with listings of equal score interleaved within a group only (it previously put the listings containing every search word in their own title, model, brand or category first, as one group)',
  },
  {
    vi: 'bổ sung tại Điều 14 quy định về các từ chỉ tình trạng hàng hoá, như “cũ”, “đồ cũ”, “đã qua sử dụng”, “second hand” hoặc “used”: các từ này không được dùng để tìm trong nội dung tin đăng và không lọc kết quả theo tình trạng, và một tìm kiếm chỉ gồm những từ này hiển thị các món hàng đang được đăng bán',
    en: 'add to Article 14 the rule on words that describe condition, such as “cũ”, “đồ cũ”, “đã qua sử dụng”, “second hand” or “used”: they are not looked for in listing text and do not filter results by condition, and a search made only of such words shows the items for sale',
  },
  {
    vi: 'bổ sung tại Điều 14 vị trí dùng chung của tin cho thuê xe dẫn từ các nền tảng và cửa hàng cho thuê xe trong lượt xếp xen kẽ theo người bán, vị trí riêng của từng nền tảng, cửa hàng khi người sử dụng mở một mục cho thuê xe, và việc tin tuyển dụng, tin cho thuê xe do thành viên tự đăng trên sàn vẫn giữ vị trí riêng của người đăng',
    en: 'add to Article 14 a shared seat in the seller rotation for vehicle rentals linked from rental platforms and shops, each platform’s or shop’s own seat again when the user opens a vehicle-rental aisle, and that job postings and vehicle rentals members post on the platform themselves keep their poster’s own seat',
  },
  {
    vi: 'bổ sung tại Điều 14 quy định về trang chủ: theo thứ tự mặc định, khi có đủ tin, ít nhất hai trong bốn vị trí đầu tiên và ít nhất bốn trong mười hai vị trí đầu tiên là đồ đã qua sử dụng đang được đăng bán',
    en: 'add to Article 14 the home-page rule: in the default order, where enough such listings exist, at least two of the first four positions and at least four of the first twelve are second-hand goods for sale',
  },
]

const numbered = (changes: Para[], lang: 'vi' | 'en') => changes.map((c, i) => `(${i + 1}) ${c[lang]}`).join('; ')

const ARTICLES: Article[] = [
  {
    id: 'scope',
    rail: '1. Scope & general principles',
    titleVi: 'Điều 1. Phạm vi điều chỉnh và nguyên tắc chung',
    titleEn: 'Article 1. Scope and general principles',
    body: [
      {
        vi: `Quy chế này điều chỉnh việc tổ chức và vận hành website ${S} — một sàn giao dịch thương mại điện tử, là nền tảng thương mại điện tử trung gian theo pháp luật Việt Nam — và áp dụng cho toàn bộ thành viên đã đăng ký, người bán, người mua và khách truy cập. Quy chế được xây dựng trên cơ sở ${LAW.vi}, ${ND248.vi} quy định chi tiết một số điều của Luật Thương mại điện tử, Luật Bảo vệ quyền lợi người tiêu dùng 19/2023/QH15 và Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15.`,
        en: `These Regulations govern the organisation and operation of ${S}, an e-commerce trading platform — an intermediary e-commerce platform under Vietnamese law — and apply to every registered member, seller, buyer and visitor. They are issued under the ${LAW.en}, ${ND248.en} implementing that Law, the Law on Protection of Consumer Rights 19/2023/QH15 and the Law on Personal Data Protection 91/2025/QH15.`,
      },
      {
        // ⚠️ "SELLERS POST THEIR OWN LISTINGS" ALONE WAS FALSE OF MOST OF THE SHELF (2026-10-01): the
        // linked listings eno imports (src/lib/site-facts.ts counts them) are posted by nobody here.
        vi: `${S} là sàn trung gian. Tin đăng trên sàn gồm tin do người bán tự đăng — người bán tự chịu trách nhiệm về tin đăng của mình — và tin đăng liên kết do đơn vị vận hành đưa về từ trang nguồn theo Điều 3. Người mua và người bán liên hệ, thương lượng và hoàn tất giao dịch trực tiếp với nhau, trên sàn hoặc trên trang nguồn. Đơn vị vận hành sàn không phải là một bên của bất kỳ giao dịch nào giữa người mua và người bán.`,
        en: `${S} is an intermediary platform. Its listings are either posted by sellers themselves — each seller being responsible for its own listings — or linked listings that the operator brings in from a source site under Article 3. Buyers and sellers contact each other, negotiate and complete the transaction directly, on the platform or on the source site. The platform operator is not a party to any transaction between a buyer and a seller.`,
      },
      {
        vi: `Người sử dụng phải từ đủ 18 tuổi trở lên, cung cấp thông tin trung thực và tuân thủ pháp luật Việt Nam cùng Quy chế này. Việc đăng ký tài khoản hoặc tiếp tục sử dụng ${S} được hiểu là người sử dụng đã đọc, hiểu và chấp nhận Quy chế.`,
        en: `Users must be at least 18 years old, give truthful information, and comply with Vietnamese law and these Regulations. Registering an account or continuing to use ${S} means the user has read, understood and accepted them.`,
      },
    ],
  },
  {
    id: 'operator',
    rail: '2. Platform operator',
    titleVi: 'Điều 2. Đơn vị vận hành sàn',
    titleEn: 'Article 2. The platform operator',
    body: [
      {
        // ND 248/2026 Điều 4: name, head office, LEGAL REPRESENTATIVE, and the ERC's number, date AND
        // place of issue — the same four fields the marketplace footer prints (footer.tsx operator block).
        // ⚠️ The issuer/date clause only once registered: on eno.forum every field is the PENDING
        // placeholder, and "số: đang cập nhật do đang cập nhật cấp ngày đang cập nhật" reads as nonsense.
        vi: `Đơn vị vận hành: ${COMPANY.name}. Trụ sở: ${COMPANY.address}. Người đại diện theo pháp luật: ${COMPANY.legalRep}. Giấy chứng nhận đăng ký doanh nghiệp số: ${OPERATOR_REGISTERED ? `${COMPANY.erc} do ${COMPANY.ercAuthority} cấp ngày ${COMPANY.ercIssued}` : COMPANY.erc}. Điện thoại: ${COMPANY.phone}. Email: ${COMPANY.email}.`,
        en: `Operator: ${COMPANY.nameEn}. Head office: ${COMPANY.address}. Legal representative: ${COMPANY.legalRep}. Enterprise registration certificate no.: ${OPERATOR_REGISTERED ? `${COMPANY.erc}, issued by ${COMPANY.ercAuthority} on ${COMPANY.ercIssued}` : COMPANY.erc}. Phone: ${COMPANY.phone}. Email: ${COMPANY.email}.`,
      },
      // The placeholder fields above read as blanks, not as a statement that no company exists yet.
      // This paragraph says it in words, and disappears on its own the day the ERC is issued.
      //
      // ⛔ THE MoIT SENTENCE WAS CUT OUT OF THIS PARAGRAPH — REVIEWER-CAUGHT, AND IT WAS A REAL
      // LICENSING DEFECT rather than a tidy-up. It used to end "…và sàn chỉ hoạt động chính thức
      // sau khi hoàn tất thủ tục đăng ký với Bộ Công Thương", welded to the entity fact behind one
      // gate. This paragraph renders whenever the operator is unincorporated — which, from
      // 2026-08-18, means it renders ONLY on eno.forum. So the services edition was publishing, in
      // its own operating regulations, that it will trade once its sàn TMĐT registration with Bộ
      // Công Thương completes. eno.forum is the site that will NEVER make that filing; it exists
      // precisely to sit outside that licence. One gate, one fact: the entity half stays here, the
      // MoIT half lives in the PRELAUNCH-gated paragraph below and reaches eno.vn only.
      ...(OPERATOR_REGISTERED
        ? []
        : [
            {
              vi: `Tại thời điểm công bố Quy chế này, pháp nhân vận hành đang trong quá trình đăng ký thành lập và website đang ở giai đoạn vận hành thử nghiệm trước khi ra mắt chính thức. Các trường thông tin đăng ký chưa được điền ở trên sẽ được cập nhật đầy đủ ngay khi giấy chứng nhận đăng ký doanh nghiệp được cấp. Trong giai đoạn này, mọi liên hệ xin gửi về ${COMPANY.email}.`,
              en: `At the time these Regulations are published, the operating entity is still being registered and the site is in pre-launch test operation. The registration fields left blank above will be completed as soon as the enterprise registration certificate is issued. Until then, please use ${COMPANY.email} for all contact.`,
            },
          ]),
      /**
       * ⛔ THE MoIT SENTENCE HAD TO BE RESCUED FROM THE PARAGRAPH ABOVE, AND MISSING THIS WOULD HAVE
       * BEEN THE REAL DEFECT IN "the company is registered now". That paragraph carried TWO
       * different facts welded together — the ENTITY was being incorporated, and the SÀN TMĐT
       * registration with Bộ Công Thương was outstanding — behind ONE gate, `OPERATOR_REGISTERED`.
       * The ERC arriving on 14/08/2026 flips that gate, which silently deleted the MoIT disclosure
       * from the document MoIT itself reads, while that filing is still pending.
       *
       * ⚠️ THEY ARE TWO SEPARATE FILINGS AND ONLY ONE IS DONE. An enterprise registration
       * certificate makes the company exist; registering the platform at online.gov.vn is what
       * lets it trade as a sàn. `PRELAUNCH` is the flag that tracks the second one, so this
       * paragraph is gated on that and nothing else — it now disappears on the right day rather
       * than on the day the company was born.
       */
      // ⚠️ `IS_MARKETPLACE &&` IS REDUNDANT TODAY AND STAYS ANYWAY — belt and braces, the pattern
      // this repo already applies to the services copy (a gate decides what renders, an alias
      // decides what ships; keep BOTH). `PRELAUNCH` is defined as `EDITION === 'marketplace'`, so
      // this paragraph already could not reach eno.forum — measured on a clean forum build: zero
      // occurrences. But ALL THREE reviewers read this line as a licensing leak, every one of them
      // because the gate's edition-scoping is invisible HERE and lives in another file. A gate a
      // reader cannot verify at the call site is one someone eventually widens: the day PRELAUNCH
      // is redefined to cover both editions, this sàn TMĐT claim would silently appear on the one
      // site that will never make that filing. Naming the edition costs nothing and makes the
      // intent local.
      ...(IS_MARKETPLACE && PRELAUNCH
        ? [
            {
              vi: `Sàn đang trong giai đoạn vận hành thử nghiệm: thủ tục đăng ký nền tảng thương mại điện tử trung gian với Bộ Công Thương đang được thực hiện và chưa hoàn tất. Sàn chỉ hoạt động chính thức sau khi thủ tục này hoàn tất, và Quy chế này sẽ được cập nhật kèm số đăng ký ngay khi được cấp.`,
              en: `The platform is in pre-launch test operation: its registration with the Ministry of Industry and Trade as an intermediary e-commerce platform is in progress and not yet complete. The platform will trade officially only once that registration is finished, and these Regulations will be updated with the registration number as soon as it is issued.`,
            },
          ]
        : []),
      {
        vi: `Địa chỉ liên hệ trên đây đồng thời là đầu mối tiếp nhận yêu cầu của người sử dụng và của cơ quan nhà nước có thẩm quyền (quản lý thị trường, thuế, công an). Yêu cầu gỡ bỏ nội dung vi phạm của cơ quan nhà nước có thẩm quyền được thực hiện trong vòng 24 giờ kể từ khi nhận được yêu cầu.`,
        en: `The contact details above are also the designated point of contact for users and for competent state authorities (market surveillance, tax, public security). A lawful request from a competent authority to remove infringing content is actioned within 24 hours of receipt.`,
      },
      { vi: AFFILIATION.vi, en: AFFILIATION.en },
    ],
  },
  {
    id: 'activity',
    rail: '3. What the platform does',
    titleVi: 'Điều 3. Phạm vi hoạt động của sàn',
    titleEn: 'Article 3. Scope of the platform’s activity',
    body: [
      {
        vi: `${S} cung cấp môi trường để tổ chức, cá nhân đăng tin rao bán hoặc cho thuê hàng hoá, dịch vụ, và để người mua tìm kiếm tin đăng rồi liên hệ trực tiếp với người bán qua kênh nhắn tin trên sàn, hoặc trên trang nguồn đối với tin đăng liên kết. Các nhóm ngành hàng chính gồm nhà ở, việc làm, xe cộ, đồ đã qua sử dụng và dịch vụ dành cho người nước ngoài đang sinh sống tại Việt Nam.`,
        en: `${S} provides an environment where organisations and individuals post listings offering goods and services for sale or rent, and where buyers search those listings and contact sellers directly through the platform’s messaging — or, for a linked listing, on its source site. The main categories are housing, jobs, vehicles, secondhand goods and services for foreigners living in Vietnam.`,
      },
      {
        vi: `Sàn KHÔNG có chức năng đặt hàng trực tuyến và KHÔNG có chức năng thanh toán trực tuyến giữa người mua và người bán. Sàn không giữ tiền ký quỹ (tạm giữ) của bất kỳ bên nào, không nhận đặt cọc thay người bán, không vận chuyển và không giao nhận hàng hoá. Giá hiển thị trên tin đăng là giá chào bán do người bán tự công bố; việc chốt giá, thanh toán và bàn giao do hai bên tự thoả thuận và tự thực hiện ngoài sàn — với tin đăng liên kết, việc đặt hàng và thanh toán (nếu có) diễn ra trên trang nguồn.`,
        en: `The platform has NO online ordering function and NO online payment function between buyer and seller. It holds no escrow for anyone, takes no deposit on a seller’s behalf, and does not ship or deliver goods. A listed price is the seller’s own published asking price; agreeing the price, paying and handing over are arranged and carried out by the two parties themselves, off the platform — for a linked listing, any ordering and payment happen on the source site.`,
      },
      {
        // ⛔ THE CANONICAL LINKED-LISTINGS REGIME (2026-10-01) — /terms#linked says the same in other
        // words. Each clause is a code fact: the CTA names the source (affiliate-booking.tsx CtaLabel,
        // the storefront being named after the source, src/lib/import-sellers.ts), the shop row reads
        // "not vetted by eno.vn" (pdp-shop-link.tsx), and there is no checkout.
        // ⚠️ "TAKES THE USER TO THE SOURCE SITE", NOT "OPENS THE ORIGINAL POSTING": not every button lands
        // on the item — SuperSports' links land on the shop (scripts/import-supersports.ts, mintLinks), and
        // some affiliate campaigns need a second step to reach the product (AffiliateProductStep in
        // affiliate-booking.tsx).
        vi: `Tin đăng liên kết. Ngoài tin do người bán đăng, sàn hiển thị tin đăng liên kết: bản sao để tham khảo của tin đã đăng trên một website khác — trang rao vặt, trang bất động sản, trang tuyển dụng hoặc danh mục sản phẩm trực tuyến của một cửa hàng (sau đây gọi là “trang nguồn”) — do đơn vị vận hành đưa về sàn. Mỗi tin đăng liên kết ghi rõ trang nguồn và có nút đưa người mua sang trang nguồn. Đối với tin đăng liên kết, đơn vị vận hành không phải người bán, chưa thẩm định hàng hoá, người bán hay mức giá, và không nhận thanh toán; người mua liên hệ, ứng tuyển hoặc mua hàng trên trang nguồn theo điều kiện của trang đó.`,
        en: `Linked listings. Besides the listings sellers post, the platform shows linked listings: copies, for reference, of listings published on another website — a classifieds or property portal, a job board, or a shop’s online catalogue (the “source site”) — which the operator brings onto the platform. Every linked listing names its source site and has a button that takes the user to the source site. For a linked listing the operator is not the seller, has not vetted the goods, the seller or the price, and takes no payment; the buyer contacts the seller, applies or buys on the source site, under that site’s own terms.`,
      },
      {
        // Owner decision 2026-10-01: the badge = a SIGNED agreement. Set by eno only — no seller-facing
        // write path (schema.prisma's note on Seller.officialPartner) — and a partner shares no phone
        // number (phoneForSeller, src/lib/contact.ts). ⛔ NOT "ONLY THROUGH set-official-partner.mjs":
        // import-partners.ts, import-accesstrade.ts, import-supersports.ts and seed-vinwonders.ts create
        // storefronts with officialPartner:true, set-import-partners.mjs grants it in bulk and
        // set-partner-avatar.ts --official sets it. Until those stop, the next import re-badges a shop
        // that signed nothing and this clause is false — a ship blocker for the main thread / W-C.
        vi: `Đối tác chính thức và Cửa hàng liên kết. Huy hiệu “Đối tác chính thức” chỉ dành cho công ty đã ký thoả thuận hợp tác với đơn vị vận hành; huy hiệu do đơn vị vận hành cấp và thu hồi, người bán không thể tự gán cho mình. Đối tác chính thức chỉ trao đổi với người mua qua kênh nhắn tin trên sàn. Gian hàng có danh mục sản phẩm được hiển thị trên sàn mà chưa ký thoả thuận như vậy được gắn nhãn “Cửa hàng liên kết”. Cả hai nhãn đều không phải là sự bảo đảm của sàn đối với hàng hoá, dịch vụ.`,
        en: `Official partners and Linked shops. The “Official partner” badge is reserved for a company that has signed a cooperation agreement with the operator; the operator grants and withdraws it, and no seller can give it to itself. An official partner deals with buyers only through the platform’s messaging. A storefront whose catalogue is shown on the platform without such an agreement is labelled “Linked shop”. Neither label is a guarantee by the platform of any goods or service.`,
      },
      {
        vi: `Kênh nhắn tin giữa người mua và người bán là kênh trao đổi riêng tư 1:1 về một tin đăng cụ thể, không phải kênh đăng tải nội dung ra công chúng.`,
        en: `Messaging between a buyer and a seller is a private one-to-one channel about a specific listing, not a channel for posting content to the public.`,
      },
    ],
  },
  {
    id: 'operator-duties',
    rail: '4. Operator’s rights & duties',
    titleVi: 'Điều 4. Quyền và nghĩa vụ của đơn vị vận hành sàn',
    titleEn: 'Article 4. Rights and duties of the platform operator',
    body: [
      {
        vi: `Đơn vị vận hành có nghĩa vụ: xây dựng và công bố công khai Quy chế này; ${REGISTRATION_DUTY.vi}; bảo đảm sàn vận hành ổn định và an toàn; yêu cầu, tiếp nhận và lưu giữ thông tin của người bán theo quy định; rà soát tin đăng và loại bỏ nội dung vi phạm; công bố công khai tiêu chí sắp xếp và hiển thị tin đăng; tiếp nhận, xử lý và phản hồi khiếu nại theo thời hạn đã công bố; bảo vệ dữ liệu cá nhân của người sử dụng; lưu trữ hồ sơ, chứng từ liên quan đến hoạt động của sàn theo thời hạn pháp luật yêu cầu (tối thiểu 3 năm); và cung cấp thông tin, phối hợp với cơ quan nhà nước có thẩm quyền khi được yêu cầu, bao gồm việc báo cáo thông tin người bán cho cơ quan thuế theo quy định.`,
        en: `The operator must: draw up and publish these Regulations; ${REGISTRATION_DUTY.en}; keep the platform running stably and securely; require, receive and retain seller information as required; review listings and remove infringing content; publish the criteria by which listings are sorted and displayed; receive, handle and answer complaints within the published deadlines; protect users’ personal data; retain records relating to the platform’s operation for the period the law requires (at least 3 years); and provide information to and cooperate with competent state authorities on request, including reporting seller information to the tax authority as required.`,
      },
      {
        vi: `Đơn vị vận hành có quyền: yêu cầu người bán bổ sung và chứng minh thông tin, giấy tờ theo quy định; từ chối đăng, tạm ẩn hoặc gỡ bỏ tin đăng vi phạm pháp luật hoặc Quy chế này; cảnh báo, hạn chế tính năng, tạm khoá hoặc chấm dứt tài khoản vi phạm; điều chỉnh danh mục, tính năng và tiêu chí hiển thị của sàn; và ban hành các chính sách chi tiết hoá Quy chế này, với điều kiện các chính sách đó không trái Quy chế và được công bố công khai.`,
        en: `The operator may: require sellers to supply and evidence information and documents; refuse, hide or remove a listing that breaches the law or these Regulations; warn, restrict, suspend or terminate an account in breach; change the platform’s categories, features and display criteria; and issue further policies implementing these Regulations, provided they do not conflict with them and are published.`,
      },
    ],
  },
  {
    id: 'sellers',
    rail: '5. Sellers’ rights & duties',
    titleVi: 'Điều 5. Quyền và nghĩa vụ của người bán',
    titleEn: 'Article 5. Rights and duties of sellers',
    body: [
      {
        vi: `Người bán được đăng tin, quản lý gian hàng, nhận liên hệ từ người mua, thương lượng giá và được khiếu nại đối với biện pháp xử lý áp dụng cho mình theo Điều 12.`,
        en: `Sellers may post listings, manage their storefront, receive enquiries from buyers, negotiate on price, and appeal any enforcement measure applied to them under Article 12.`,
      },
      {
        vi: `Người bán đăng ký tài khoản bằng số điện thoại hoặc email đã xác minh và phải cung cấp thông tin đầy đủ, chính xác theo quy định: họ tên hoặc tên tổ chức, địa chỉ, số căn cước công dân hoặc số giấy chứng nhận đăng ký doanh nghiệp, mã số thuế (nếu có), điện thoại và email. Người bán là tổ chức, doanh nghiệp phải hiển thị tên đăng ký kinh doanh trên gian hàng. Thông tin người bán được cung cấp cho người mua khi có yêu cầu hợp lý và cho cơ quan nhà nước có thẩm quyền theo quy định. Việc xác thực danh tính qua hệ thống định danh điện tử quốc gia (VNeID) được áp dụng theo lộ trình của Luật Thương mại điện tử 122/2025/QH15.`,
        en: `Sellers register with a verified phone number or email and must provide complete, accurate information as required: full name or organisation name, address, citizen ID number or enterprise registration number, tax code (if any), phone and email. Business sellers display their registered business name on their storefront. Seller information is provided to buyers on reasonable request and to competent state authorities as required. Identity verification through Vietnam’s national electronic identification system (VNeID) is applied on the timeline set by the Law on E-commerce 122/2025/QH15.`,
      },
      {
        vi: `Người bán chịu trách nhiệm hoàn toàn về tin đăng của mình: mô tả trung thực, dùng ảnh thật của chính hàng hoá hoặc dịch vụ đang rao, niêm yết giá bằng đồng Việt Nam đã bao gồm thuế và bán đúng giá đã niêm yết, cập nhật hoặc gỡ tin ngay khi đã bán hoặc không còn cung cấp, trả lời người mua trung thực và giữ thông tin liên hệ của tài khoản luôn chính xác. Người bán không được chèn số điện thoại, tài khoản mạng xã hội hay thông tin liên hệ khác vào tiêu đề, mô tả hoặc ảnh của tin đăng: việc rà soát, lưu vết bằng chứng và giải quyết khiếu nại phụ thuộc vào việc liên hệ đầu tiên diễn ra trong kênh nhắn tin của sàn.`,
        en: `Sellers are fully responsible for their listings: describe honestly, use real photographs of the actual goods or service offered, list prices in Vietnamese dong inclusive of tax and honour the price listed, update or remove a listing as soon as the item is sold or no longer available, answer buyers truthfully and keep the account’s contact details accurate. Sellers must not put phone numbers, social-media handles or other contact details into a listing’s title, description or images: moderation, evidence and complaint handling all depend on first contact happening in the platform’s messaging.`,
      },
      {
        vi: `Người bán chỉ được đăng những hàng hoá, dịch vụ mà mình có quyền kinh doanh hợp pháp. Đối với hàng hoá, dịch vụ thuộc danh mục ngành, nghề đầu tư kinh doanh có điều kiện, người bán phải đáp ứng đủ điều kiện kinh doanh, phải có giấy phép hoặc giấy chứng nhận đủ điều kiện tương ứng còn hiệu lực, phải cung cấp bản sao các giấy tờ đó cho đơn vị vận hành trước khi tin đăng được duyệt, và phải thông báo ngay khi giấy tờ hết hiệu lực, bị thu hồi hoặc thay đổi. Đơn vị vận hành đối chiếu giấy tờ với nội dung tin đăng, lưu giữ bản sao trong hồ sơ, và công bố công khai tên pháp nhân cung cấp dịch vụ cùng số giấy phép tương ứng ngay tại trang giới thiệu dịch vụ đó. Tin đăng thuộc nhóm kinh doanh có điều kiện mà chưa nộp đủ giấy tờ hợp lệ sẽ không được duyệt hoặc bị gỡ bỏ.`,
        en: `Sellers may list only goods and services they are lawfully entitled to trade. For goods and services in a conditional business sector, the seller must meet the applicable business conditions, must hold the corresponding licence or certificate of eligibility in force, must supply copies of those documents to the operator before the listing is approved, and must notify the operator immediately if they expire, are revoked or change. The operator checks the documents against the listing, keeps copies on file, and publicly displays the name of the legal entity providing the service together with its licence number on the page offering that service. A conditional-business listing without complete, valid documents is not approved, or is taken down.`,
      },
      // SERVICES EDITION ONLY. The partner-of-record disclosure is the concrete case of the
      // conditional-service rule above. The strings come from the aliased module — the marketplace
      // build resolves it to an empty stub, so the partner is neither rendered nor shipped there.
      ...(IS_SERVICES ? [{ vi: PROVIDER_OF_RECORD.vi, en: PROVIDER_OF_RECORD.en }] : []),
      {
        vi: `Người bán không được: đăng hàng hoá, dịch vụ thuộc danh mục cấm tại Điều 9; đăng tin trùng lặp, tin ảo hoặc tin không còn hiệu lực; dùng giá mồi; can thiệp, mua bán hoặc thao túng đánh giá và điểm uy tín; mạo danh cá nhân, tổ chức khác; sử dụng ảnh của người khác như ảnh hàng hoá của mình; hoặc sử dụng sàn cho bất kỳ hành vi lừa đảo, chiếm đoạt tài sản nào.`,
        en: `Sellers must not: list anything prohibited under Article 9; post duplicate, fake or expired listings; use bait pricing; interfere with, buy or manipulate reviews and trust scores; impersonate another person or organisation; pass off someone else’s photographs as their own goods; or use the platform for fraud or misappropriation of any kind.`,
      },
    ],
  },
  {
    id: 'buyers',
    rail: '6. Buyers’ rights & duties',
    titleVi: 'Điều 6. Quyền và nghĩa vụ của người mua',
    titleEn: 'Article 6. Rights and duties of buyers',
    body: [
      {
        vi: `Người mua được tìm kiếm, xem tin đăng và liên hệ người bán miễn phí; được yêu cầu người bán cung cấp thông tin về hàng hoá, dịch vụ và về chính người bán trước khi giao dịch; được đánh giá người bán sau khi giao dịch hoàn tất; và được báo cáo tin đăng, người bán hoặc cuộc trò chuyện có dấu hiệu vi phạm.`,
        en: `Buyers may search, view listings and contact sellers free of charge; may ask a seller for information about the goods or service and about the seller before dealing; may review a seller after a completed transaction; and may report a listing, a seller or a conversation that appears to breach the rules.`,
      },
      {
        vi: `Người mua có nghĩa vụ cung cấp thông tin trung thực khi liên hệ, tự kiểm tra hàng hoá, dịch vụ và tư cách của người bán trước khi thanh toán, tuân thủ pháp luật và Quy chế này, không quấy rối người bán, không đăng đánh giá sai sự thật, và không sử dụng thông tin liên hệ có được trên sàn cho mục đích khác như quảng cáo hay thu thập dữ liệu.`,
        en: `Buyers must give truthful information when making contact, check the goods or service and the seller before paying, comply with the law and these Regulations, not harass sellers, not post untrue reviews, and not use contact details obtained on the platform for other purposes such as advertising or data collection.`,
      },
      {
        vi: `Vì việc thanh toán và bàn giao diễn ra ngoài sàn, người mua nên gặp mặt tại nơi công cộng, kiểm tra kỹ hàng hoá trước khi trả tiền, giữ lại tin nhắn và chứng từ, và không chuyển tiền đặt cọc cho người chưa được xác minh. Hướng dẫn giao dịch an toàn được công bố tại /safety.`,
        en: `Because payment and handover happen off the platform, buyers should meet in a public place, inspect the goods carefully before paying, keep messages and receipts, and not send a deposit to an unverified person. Safe-dealing guidance is published at /safety.`,
      },
    ],
  },
  {
    id: 'process',
    rail: '7. Listing & transaction process',
    titleVi: 'Điều 7. Quy trình đăng tin và giao dịch',
    titleEn: 'Article 7. The listing and transaction process',
    body: [
      {
        vi: `Bước 1 — Đăng ký: người bán tạo tài khoản và xác minh số điện thoại hoặc email. Bước 2 — Đăng tin: người bán nhập tiêu đề, mô tả, danh mục, khu vực, giá bằng đồng Việt Nam và ảnh thật (số lượng ảnh tối thiểu theo từng danh mục); hàng hoá, dịch vụ kinh doanh có điều kiện phải nộp giấy tờ theo Điều 5. Bước 3 — Rà soát: tin đăng đi qua bộ kiểm tra tự động (từ khoá hàng cấm, nội dung vi phạm, tin trùng lặp, thông tin liên hệ chèn trong nội dung, yêu cầu về ảnh) trước khi hiển thị; tin có dấu hiệu rủi ro được chuyển sang rà soát thủ công và có thể bị tạm giữ cho đến khi xử lý xong.`,
        en: `Step 1 — Registration: the seller creates an account and verifies a phone number or email. Step 2 — Posting: the seller enters a title, description, category, area, a price in Vietnamese dong and real photographs (each category has a minimum photo count); conditional goods and services must also supply the documents required by Article 5. Step 3 — Review: the listing passes automated checks (prohibited-keyword filter, infringing content, duplicates, contact details embedded in the text, photo requirements) before it appears; listings showing risk signals go to manual review and may be held until that review is complete.`,
      },
      {
        vi: `Bước 4 — Liên hệ: người mua tìm thấy tin đăng qua tìm kiếm hoặc duyệt danh mục và liên hệ người bán qua kênh nhắn tin trên sàn; nếu người bán cho phép thương lượng, người mua có thể gửi đề nghị giá. Bước 5 — Chốt giao dịch: hai bên tự thoả thuận giá cuối cùng, phương thức thanh toán, thời điểm và địa điểm bàn giao, và tự thực hiện giao dịch ngoài sàn. Bước 6 — Sau giao dịch: người bán đánh dấu tin đã bán; người mua có thể đánh giá người bán; mọi vướng mắc được xử lý theo Điều 12.`,
        en: `Step 4 — Contact: the buyer finds the listing by searching or browsing and contacts the seller through the platform’s messaging; where the seller has allowed negotiation, the buyer may send an offer. Step 5 — Closing: the two parties agree the final price, the payment method and the time and place of handover between themselves, and carry the transaction out off the platform. Step 6 — Afterwards: the seller marks the listing sold; the buyer may review the seller; anything that goes wrong is handled under Article 12.`,
      },
      {
        vi: `Sàn không phát sinh đơn hàng, không xác nhận đơn hàng, không xuất hoá đơn thay người bán và không xử lý thanh toán giữa người mua và người bán ở bất kỳ bước nào. Nghĩa vụ về hoá đơn, chứng từ và thuế phát sinh từ giao dịch thuộc về người bán.`,
        en: `The platform creates no order, confirms no order, issues no invoice on a seller’s behalf and processes no payment between buyer and seller at any step. Invoicing, documentation and any tax arising from a transaction are the seller’s responsibility.`,
      },
      {
        // The free rental check: POST /api/rental-check, signed-in, ≤ RENTAL_CHECK_MAX_ITEMS, answered
        // in the requester's /messages thread (src/lib/rental-check/shared.ts header).
        vi: `Tin đăng liên kết không được tạo theo các bước trên: đơn vị vận hành đưa tin từ trang nguồn về sàn, kèm tên trang nguồn và nút đưa người mua sang trang nguồn; người mua liên hệ, ứng tuyển hoặc mua hàng trên trang nguồn. Đối với tin cho thuê, kể cả tin đăng liên kết, người sử dụng đã đăng nhập có thể nhờ đơn vị vận hành kiểm tra tình trạng còn trống của tối đa ${RENTAL_CHECK_MAX_ITEMS} tin mỗi lần, miễn phí; câu trả lời được gửi trong mục tin nhắn của người sử dụng. Việc hỗ trợ này không khiến đơn vị vận hành trở thành bên cho thuê, bên môi giới hay một bên của hợp đồng thuê.`,
        en: `Linked listings are not created through the steps above: the operator brings them in from the source site, with the source site’s name and a button that takes the user to the source site, and the buyer contacts the seller, applies or buys on the source site. For rentals, linked ones included, a signed-in user may ask the operator to check whether up to ${RENTAL_CHECK_MAX_ITEMS} of them are still available, free of charge; the answer arrives in the user’s messages. That help does not make the operator the landlord, the agent or a party to the tenancy.`,
      },
    ],
  },
  {
    id: 'fees',
    rail: '8. Fees & payment',
    titleVi: 'Điều 8. Phí dịch vụ và thanh toán',
    titleEn: 'Article 8. Fees and payment',
    body: [
      {
        vi: `Việc đăng tin, duyệt tin và liên hệ người bán trên ${S} hiện miễn phí. Đơn vị vận hành không thu tiền của người mua cho các giao dịch trên sàn, không thanh toán hộ và không giữ tiền của bất kỳ bên nào.`,
        en: `Posting, browsing and contacting sellers on ${S} are currently free. The operator collects no money from buyers for transactions on the platform, makes no payment on anyone’s behalf and holds no one’s money.`,
      },
      {
        // ⚠️ 20 DAYS, NOT 5 (2026-10-01): NĐ 248/2026 Điều 8.2 — a change to seller fees is published at
        // least 20 days before it applies. That clause is worded for platforms with online ordering,
        // which this one has not; the stricter period is adopted anyway.
        vi: `Nếu sau này có dịch vụ thu phí dành cho người bán — ví dụ gói đăng tin hoặc vị trí hiển thị ưu tiên — biểu phí, cách tính từng loại phí, thời điểm áp dụng và phương thức thanh toán sẽ được công bố bằng đồng Việt Nam ít nhất 20 ngày trước ngày áp dụng, và mọi vị trí hiển thị có trả phí đều được gắn nhãn rõ ràng ngay tại vị trí đó.`,
        en: `If paid services for sellers are introduced later — for example posting packages or promoted placement — the price list, how each fee is calculated, when it applies and how it is paid will be published in Vietnamese dong at least 20 days before they apply, and any paid placement will be clearly labelled where it appears.`,
      },
      {
        vi: `Trường hợp một dịch vụ trên sàn do bên thứ ba có giấy phép cung cấp, khoản mà đơn vị vận hành nhận được là hoa hồng theo hợp đồng với bên cung cấp đó. Người mua thanh toán trực tiếp cho bên cung cấp dịch vụ theo phương thức do bên đó công bố, không thanh toán cho sàn.`,
        en: `Where a service on the platform is provided by a licensed third party, what the operator receives is a commission under its contract with that provider. The buyer pays the provider directly, by the method the provider publishes, not the platform.`,
      },
      {
        vi: `Đơn vị vận hành có thể nhận hoa hồng từ một số đối tác và cửa hàng liên kết khi người mua mua hàng qua đường dẫn trên sàn. Khoản hoa hồng này không do người mua trả và không làm thay đổi giá người mua phải trả; các đường dẫn có thể mang lại hoa hồng được gắn nhãn “Quảng cáo” kèm ghi chú về việc này.`,
        en: `The operator may earn a commission from some partners and linked shops when a buyer purchases through a link on the platform. The buyer does not pay that commission, and it does not change the price the buyer pays; links that can earn it are labelled “Ad” with a note saying so.`,
      },
    ],
  },
  {
    id: 'prohibited',
    rail: '9. Prohibited goods & services',
    titleVi: 'Điều 9. Hàng hoá, dịch vụ không được đăng trên sàn',
    titleEn: 'Article 9. Goods and services that may not be listed',
    body: [
      {
        vi: `Danh mục đầy đủ hàng hoá, dịch vụ không được đăng trên ${S} được công bố tại /prohibited và là một phần không tách rời của Quy chế này. Danh mục bao gồm mọi hàng hoá, dịch vụ mà pháp luật Việt Nam cấm kinh doanh hoặc cấm quảng cáo — vũ khí, vật liệu nổ, công cụ hỗ trợ; ma tuý và chất gây nghiện; thuốc chữa bệnh và thiết bị y tế không phép; rượu, thuốc lá và thuốc lá điện tử; động vật hoang dã và sản phẩm từ động vật hoang dã; hàng giả, hàng nhái, hàng xâm phạm quyền sở hữu trí tuệ, hàng nhập lậu, hàng không rõ nguồn gốc; tiền tệ, giấy tờ tuỳ thân và tài liệu của cơ quan nhà nước; dữ liệu cá nhân; nội dung khiêu dâm, đồi truỵ; dịch vụ tài chính, cho vay không có giấy phép — cùng các nhóm bị cấm theo chính sách riêng của sàn.`,
        en: `The full list of goods and services that may not be listed on ${S} is published at /prohibited and forms an inseparable part of these Regulations. It covers everything Vietnamese law bans from trading or advertising — weapons, explosives and support tools; narcotics and addictive substances; unlicensed medicines and medical devices; alcohol, tobacco and e-cigarettes; wildlife and wildlife products; counterfeits, imitations, goods infringing intellectual property, smuggled goods and goods of unknown origin; currency, identity papers and state authority documents; personal data; pornographic and obscene material; unlicensed financial and lending services — plus the categories banned by the platform’s own policy.`,
      },
      {
        vi: `Hàng hoá, dịch vụ thuộc ngành, nghề kinh doanh có điều kiện chỉ được đăng khi người bán đáp ứng đủ điều kiện và đã nộp giấy tờ hợp lệ theo Điều 5. Tin đăng vi phạm Điều này bị gỡ bỏ; tài khoản vi phạm bị xử lý theo Điều 10.`,
        en: `Goods and services in a conditional business sector may be listed only where the seller meets the conditions and has supplied valid documents under Article 5. A listing that breaches this Article is removed, and the account is dealt with under Article 10.`,
      },
    ],
  },
  {
    id: 'moderation',
    rail: '10. Moderation & enforcement',
    titleVi: 'Điều 10. Rà soát nội dung, gỡ bỏ và biện pháp xử lý vi phạm',
    titleEn: 'Article 10. Content review, takedown and enforcement',
    body: [
      {
        vi: `Mọi tin do người bán đăng trên sàn đều được rà soát tự động trước khi hiển thị, và mọi tin đăng — kể cả tin đăng liên kết — được rà soát lại khi có báo cáo. Đơn vị vận hành sử dụng bộ lọc từ khoá hàng cấm, kiểm tra ảnh trùng và ảnh lấy từ nguồn khác, phát hiện tin trùng lặp và kiểm tra nội dung bằng công cụ tự động, kết hợp rà soát thủ công đối với các trường hợp có dấu hiệu rủi ro. Người sử dụng có thể báo cáo tin đăng, người bán hoặc cuộc trò chuyện bằng nút Báo cáo hiển thị trên từng bề mặt.`,
        en: `Every listing a seller posts on the platform is screened automatically before it appears, and every listing — linked listings included — is re-reviewed whenever it is reported. The operator uses a prohibited-keyword filter, duplicate- and stolen-image checks, duplicate-listing detection and automated content checks, together with manual review for anything showing risk signals. Users can report a listing, a seller or a conversation with the Report control shown on each surface.`,
      },
      {
        vi: `Khi phát hiện hoặc nhận được phản ánh về hành vi kinh doanh vi phạm pháp luật trên sàn, đơn vị vận hành gỡ bỏ hoặc tạm ẩn nội dung liên quan, thông báo cho người đăng kèm lý do, và phối hợp với cơ quan nhà nước có thẩm quyền. Đối với yêu cầu của cơ quan nhà nước có thẩm quyền, nội dung được gỡ bỏ trong vòng 24 giờ kể từ khi nhận được yêu cầu, và thông tin về người bán vi phạm được cung cấp cho cơ quan có thẩm quyền theo quy định.`,
        en: `Where the operator detects, or is told about, unlawful trading on the platform, it removes or hides the content concerned, notifies the person who posted it with the reason, and cooperates with the competent state authority. Content identified by a competent authority is removed within 24 hours of the request, and information about the infringing seller is provided to that authority as required.`,
      },
      {
        vi: `Chủ thể quyền sở hữu trí tuệ có thể yêu cầu xử lý tin đăng xâm phạm qua nút Báo cáo trên tin đăng hoặc qua email của đơn vị vận hành, kèm tài liệu chứng minh quyền. Yêu cầu có căn cứ dẫn đến gỡ tin và trừ điểm uy tín của người bán; tài khoản tái phạm bị chấm dứt.`,
        en: `Intellectual-property rights holders can ask for an infringing listing to be dealt with through the Report control on the listing or by emailing the operator, with evidence of their rights. A substantiated request leads to removal and a trust-score penalty for the seller; repeat infringers have their accounts terminated.`,
      },
      {
        vi: `Biện pháp xử lý được áp dụng theo mức độ nghiêm trọng và số lần tái phạm, theo thứ tự tăng dần: nhắc nhở; gỡ tin đăng; trừ điểm uy tín; hạn chế tính năng (đăng tin, nhắn tin); tạm khoá tài khoản; chấm dứt tài khoản vĩnh viễn. Người bị áp dụng biện pháp xử lý được thông báo lý do và có quyền khiếu nại một lần kèm bằng chứng theo Điều 12. Cách tính điểm uy tín và bảng trừ điểm được công bố tại /trust.`,
        en: `Enforcement is graduated by severity and repetition: a warning; removal of the listing; a trust-score penalty; feature restrictions (posting, messaging); account suspension; permanent termination. Anyone subject to a measure is told why and may appeal once, with evidence, under Article 12. How the trust score is calculated, and the penalty table, are published at /trust.`,
      },
    ],
  },
  {
    id: 'liability',
    rail: '11. Limits of the platform’s liability',
    titleVi: 'Điều 11. Giới hạn trách nhiệm của đơn vị vận hành sàn',
    titleEn: 'Article 11. Limits of the operator’s liability',
    body: [
      {
        vi: `Đơn vị vận hành không phải người bán, không phải người mua và không phải trung gian thanh toán trong các giao dịch trên sàn. Đơn vị vận hành không chịu trách nhiệm về chất lượng, số lượng, nguồn gốc, tính hợp pháp của hàng hoá, dịch vụ do người bán cung cấp, cũng như về việc giao nhận và việc thực hiện nghĩa vụ của các bên trong giao dịch. Đơn vị vận hành không phải cơ quan nhà nước và không bảo đảm kết quả của bất kỳ dịch vụ nào do người bán hoặc bên thứ ba cung cấp. Huy hiệu xác minh và điểm uy tín là thông tin tham khảo được tính từ dữ liệu hoạt động, không phải sự bảo lãnh, chứng nhận chất lượng hay cam kết của sàn về một giao dịch cụ thể.`,
        en: `The operator is not the seller, not the buyer and not a payment intermediary in transactions on the platform. It is not responsible for the quality, quantity, origin or legality of the goods and services sellers offer, nor for handover or for either party performing its obligations. The operator is not a state authority and does not guarantee the outcome of any service provided by a seller or by a third party. Verification badges and trust scores are indicative information computed from activity data — not a guarantee, a quality certification, or any commitment by the platform about a particular transaction.`,
      },
      {
        vi: `Đối với tin đăng liên kết, đơn vị vận hành chỉ hiển thị bản sao để tham khảo và đường dẫn sang trang nguồn: đơn vị vận hành không phải người bán, không phải trang nguồn, không bảo đảm tin còn hiệu lực hay chính xác, và giao dịch được thực hiện trên trang nguồn theo điều kiện của trang đó. Khi phát hiện hoặc nhận được báo cáo về tin đăng liên kết vi phạm pháp luật hoặc Quy chế này, đơn vị vận hành gỡ tin đó khỏi sàn.`,
        en: `For a linked listing the operator shows only a reference copy and a link to the source site: it is neither the seller nor the source site, it does not guarantee that the listing is still current or accurate, and the transaction takes place on the source site under that site’s terms. When the operator finds, or is told of, a linked listing that breaches the law or these Regulations, it takes that listing off the platform.`,
      },
      {
        vi: `Giới hạn trách nhiệm nêu trên không loại trừ trách nhiệm của đơn vị vận hành theo quy định pháp luật, bao gồm nghĩa vụ rà soát và gỡ bỏ nội dung vi phạm khi biết hoặc buộc phải biết, nghĩa vụ cung cấp thông tin cho cơ quan nhà nước có thẩm quyền, nghĩa vụ bảo vệ dữ liệu cá nhân, và các quyền mà pháp luật bảo vệ quyền lợi người tiêu dùng dành cho người mua.`,
        en: `These limits do not exclude the operator’s obligations under the law, including the duty to review and remove infringing content once it knows or ought to know of it, the duty to provide information to competent state authorities, the duty to protect personal data, and the rights that consumer-protection law gives buyers.`,
      },
    ],
  },
  {
    id: 'complaints',
    rail: '12. Complaints & disputes',
    titleVi: 'Điều 12. Tiếp nhận và giải quyết khiếu nại, tranh chấp',
    titleEn: 'Article 12. Complaints and dispute resolution',
    body: [
      {
        vi: `Người sử dụng gửi phản ánh, khiếu nại qua nút Báo cáo hiển thị trên tin đăng, trên trang người bán và trong cuộc trò chuyện, hoặc qua email ${COMPANY.email}. Thời hạn chung được công bố: xác nhận đã tiếp nhận trong vòng 3 ngày làm việc; trả lời kết quả xử lý trong vòng 15 ngày làm việc kể từ ngày tiếp nhận; trường hợp phức tạp cần xác minh thêm, thời hạn có thể kéo dài nhưng không quá 30 ngày làm việc và người khiếu nại được thông báo lý do kéo dài. Thời hạn phản hồi ban đầu và thời hạn giải quyết cho từng loại việc thường gặp được nêu trong bảng dưới đây. Đơn vị vận hành không thu phí đối với việc tiếp nhận và giải quyết khiếu nại.`,
        en: `Users submit reports and complaints through the Report control shown on listings, on seller pages and in conversations, or by emailing ${COMPANY.email}. The general published deadlines are: acknowledgement within 3 working days; an answer with the outcome within 15 working days of receipt; and, where the matter is complex and needs further verification, the deadline may be extended to no more than 30 working days, with the reason for the extension given to the complainant. The first-response and resolution deadlines for each common kind of issue are set out in the table below. The operator charges nothing for receiving or handling a complaint.`,
      },
      {
        vi: `Quy trình xử lý: (1) tiếp nhận và phân loại khiếu nại; (2) yêu cầu người khiếu nại bổ sung bằng chứng nếu cần; (3) chuyển nội dung khiếu nại cho bên bị khiếu nại và yêu cầu phản hồi trong vòng 7 ngày làm việc; (4) đối chiếu bằng chứng của hai bên; (5) kết luận khiếu nại là có căn cứ hoặc không có căn cứ và áp dụng biện pháp xử lý theo Điều 10; (6) thông báo kết quả cho người khiếu nại. Bên bị áp dụng biện pháp xử lý được khiếu nại lại một lần kèm bằng chứng mới. Danh tính của người báo cáo không được tiết lộ cho bên bị báo cáo.`,
        en: `The procedure is: (1) receive and classify the complaint; (2) ask the complainant for further evidence if needed; (3) put the complaint to the party complained of and require a response within 7 working days; (4) weigh both sides’ evidence; (5) conclude the complaint substantiated or unsubstantiated and apply any measure under Article 10; (6) notify the complainant of the outcome. A party subject to a measure may appeal once, with new evidence. The identity of the person who reported is never disclosed to the party reported.`,
      },
      {
        vi: `Tranh chấp phát sinh từ giao dịch giữa người mua và người bán trước hết do hai bên tự thương lượng. Đơn vị vận hành hỗ trợ bằng cách mở phòng xử lý tranh chấp trên sàn khi cần, cung cấp cho các bên và cho cơ quan có thẩm quyền các dữ liệu liên quan trong phạm vi pháp luật cho phép (nội dung tin nhắn, tin đăng, lịch sử thay đổi giá), và khuyến khích các bên hoà giải. Nếu không tự giải quyết được, các bên có quyền yêu cầu hoà giải, khiếu nại đến cơ quan hoặc tổ chức bảo vệ quyền lợi người tiêu dùng, hoặc khởi kiện tại Toà án có thẩm quyền của Việt Nam. Người tiêu dùng giữ nguyên mọi quyền mà pháp luật Việt Nam dành cho mình.`,
        en: `A dispute arising from a transaction between a buyer and a seller is first for the two parties to settle between themselves. The operator assists by opening a dispute room on the platform where appropriate, by giving the parties and the competent authorities the relevant data the law permits it to share (message content, the listing, price-change history), and by encouraging settlement. If the parties cannot settle, they may seek mediation, complain to a consumer-protection authority or organisation, or bring the matter before the competent Vietnamese court. Consumers keep every right Vietnamese law gives them.`,
      },
      {
        vi: `Khiếu nại về hàng hoá, giá hoặc người bán của một tin đăng liên kết thuộc về trang nguồn và người bán tại đó. Đơn vị vận hành tiếp nhận báo cáo về tin đăng liên kết vi phạm pháp luật hoặc Quy chế này và xử lý theo thời hạn tại bảng nêu trên.`,
        en: `A complaint about the goods, the price or the seller of a linked listing belongs with the source site and its seller. The operator receives reports that a linked listing breaches the law or these Regulations and deals with them within the deadlines in the table above.`,
      },
    ],
    /**
     * ⚖️ NĐ 248/2026 Điều 7.3: "thời hạn cụ thể phản hồi ban đầu và thời hạn dự kiến giải quyết cho
     * từng loại vấn đề phổ biến". ⚠️ NO NEW CLOCK IS INVENTED HERE — every cell is one the document
     * already promised: 3 / 15 / ≤30 working days (paragraph 1 of this Article), 2 working days to
     * acknowledge a data request (Article 13), 24 hours for a competent authority (Article 2, Article 10;
     * NĐ 248 Điều 17.1(c)).
     */
    table: {
      tableAfter: 0,
      head: [
        { vi: 'Loại việc', en: 'Kind of issue' },
        { vi: 'Phản hồi ban đầu', en: 'First response' },
        { vi: 'Thời hạn giải quyết', en: 'Resolution' },
      ],
      rows: [
        ...(
          [
            { vi: 'Tin đăng vi phạm (hàng hoá, dịch vụ hoặc nội dung bị cấm)', en: 'A prohibited listing (banned goods, services or content)' },
            { vi: 'Khiếu nại xâm phạm quyền sở hữu trí tuệ', en: 'Intellectual-property claim' },
            { vi: 'Báo cáo lừa đảo, gian lận', en: 'Scam or fraud report' },
            { vi: 'Khiếu nại về biện pháp xử lý tài khoản', en: 'Appeal against an account sanction' },
          ] as Para[]
        ).map((issue) => [
          issue,
          { vi: '3 ngày làm việc', en: '3 working days' },
          { vi: '15 ngày làm việc; tối đa 30 ngày làm việc nếu phức tạp', en: '15 working days; at most 30 working days if complex' },
        ]),
        [
          { vi: 'Yêu cầu liên quan đến dữ liệu cá nhân', en: 'Personal-data request' },
          { vi: '2 ngày làm việc', en: '2 working days' },
          { vi: 'Theo thời hạn của pháp luật về bảo vệ dữ liệu cá nhân, nêu tại /privacy', en: 'Within the statutory period, set out at /privacy' },
        ],
        [
          { vi: 'Yêu cầu của cơ quan nhà nước có thẩm quyền', en: 'Request from a competent state authority' },
          { vi: 'Trong 24 giờ', en: 'Within 24 hours' },
          { vi: 'Gỡ bỏ nội dung trong 24 giờ kể từ khi nhận được yêu cầu', en: 'Content removed within 24 hours of receipt' },
        ],
      ],
    },
  },
  {
    id: 'privacy',
    rail: '13. Personal data & security',
    titleVi: 'Điều 13. Bảo vệ dữ liệu cá nhân và an toàn thông tin',
    titleEn: 'Article 13. Personal data protection and information security',
    body: [
      {
        vi: `Việc thu thập, sử dụng, lưu trữ và chuyển giao dữ liệu cá nhân được thực hiện theo Chính sách bảo vệ dữ liệu cá nhân công bố tại /privacy — một phần không tách rời của Quy chế này — và theo Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15. Đơn vị vận hành chỉ thu thập dữ liệu cần thiết cho mục đích đã thông báo, xin sự đồng ý của chủ thể dữ liệu trong các trường hợp pháp luật yêu cầu, và không bán dữ liệu cá nhân của người sử dụng.`,
        en: `Collecting, using, storing and transferring personal data is governed by the Personal Data Protection Policy published at /privacy — an inseparable part of these Regulations — and by the Law on Personal Data Protection 91/2025/QH15. The operator collects only the data needed for the purposes it has notified, obtains the data subject’s consent where the law requires it, and does not sell users’ personal data.`,
      },
      {
        vi: `Chủ thể dữ liệu có quyền truy cập, chỉnh sửa, rút lại sự đồng ý, yêu cầu xoá dữ liệu và yêu cầu ngừng xử lý dữ liệu của mình. Yêu cầu gửi về ${COMPANY.privacyEmail} được xác nhận trong vòng 2 ngày làm việc và được xử lý trong thời hạn pháp luật quy định. Tài khoản có thể được xoá theo yêu cầu, trừ phần dữ liệu mà pháp luật buộc phải lưu giữ.`,
        en: `Data subjects may access and correct their data, withdraw consent, ask for erasure and ask for processing to stop. Requests sent to ${COMPANY.privacyEmail} are acknowledged within 2 working days and handled within the period the law prescribes. An account can be deleted on request, except for data the law requires to be retained.`,
      },
      {
        vi: `Đơn vị vận hành áp dụng các biện pháp kỹ thuật và tổ chức để bảo vệ hệ thống và dữ liệu, gồm mã hoá dữ liệu trên đường truyền, kiểm soát truy cập theo vai trò đối với công cụ quản trị, giới hạn tần suất truy cập nhằm chống lạm dụng, và sao lưu định kỳ. Hồ sơ, chứng từ liên quan đến hoạt động của sàn được lưu trữ tối thiểu 3 năm kể từ ngày phát sinh theo quy định.`,
        en: `The operator applies technical and organisational measures to protect its systems and data, including encryption of data in transit, role-based access control for administrative tools, rate limiting against abuse, and regular backups. Records relating to the platform’s operation are retained for at least 3 years from the date they arise, as required.`,
      },
    ],
  },
  {
    id: 'ranking',
    rail: '14. How listings are ranked',
    titleVi: 'Điều 14. Tiêu chí sắp xếp và hiển thị tin đăng',
    titleEn: 'Article 14. Criteria for sorting and displaying listings',
    body: [
      {
        vi: `Thực hiện nghĩa vụ công bố công khai tiêu chí phân loại và hiển thị, đơn vị vận hành công bố các tiêu chí sau. Thứ tự hiển thị mặc định khi duyệt danh mục được xác định bởi ba nhóm tiêu chí, xếp theo mức độ ảnh hưởng giảm dần: (1) điểm uy tín của người bán, tính từ dữ liệu hoạt động đã xác minh gồm xác minh số điện thoại và danh tính, lịch sử bán hàng, đánh giá của người mua, tỷ lệ và tốc độ phản hồi, cùng số vi phạm đã được xác nhận; (2) mức độ quan tâm của người mua đối với tin đăng, gồm lượt xem và số lượt liên hệ; (3) tính mới, trong đó tin đăng hoặc tin vừa được cập nhật gần đây được ưu tiên hơn.`,
        en: `In discharge of the duty to publish its classification and display criteria, the operator discloses the following. The default ordering when browsing a category is determined by three groups of criteria, in decreasing order of influence: (1) the seller’s trust score, computed from verified activity data — phone and identity verification, selling history, buyer reviews, response rate and speed, and confirmed violations; (2) how much buyer interest the listing has attracted, namely views and contacts; (3) recency, where newer or recently updated listings rank higher.`,
      },
      {
        // ⚖️ EVERY PARAGRAPH BELOW IS A CODE FACT (2026-10-01, NĐ 248/2026 Điều 11; version 3, 2026-10-05):
        //   seller round-robin + shared seats — src/lib/feed-diversity.ts (FEED_DIVERSITY_WINDOW,
        //     SHARED_SEAT_SUBCATEGORIES ['esim'] — keyed by AISLE, SHARED_SEAT_SELLERS 'job-boards' and
        //     'vehicle-rentals' — keyed by the import's own SELLER ids, so a member's own job post or vehicle
        //     rental keeps its own seat; sharedSeatsFor: off inside any aisle and inside Jobs; diversifyRail);
        //   the two-tier keyword order — src/app/api/listings/keyword-rank.ts (header, steps 1–4: the 'title'
        //     tier before the 'aside' tier, text-relevance.ts MatchClass; searchScore weights unchanged; exact
        //     ties dealt out by seller + model and never across a tier);
        //   condition words — src/lib/search-synonyms.ts CONDITION_PHRASES / splitConditionWords → feed-query.ts:
        //     dropped from the text, filter NOTHING; a query of only those words gets the sale scope;
        //   the home feed's second-hand floor (≥2 of the first 4, ≥4 of the first 12, when enough exist) — the
        //     UX program 2 home-feed package, implemented in parallel with this amendment: ⛔ this text and
        //     /legal/ranking state it, so neither may deploy without that code;
        //   brand search surfacing the browsed category — feed-query.ts `priorityCategory`, applied as a stable
        //     sort of each returned PAGE (api/listings/route.ts, `ordered`), never across pages;
        //   price-ascending SEO rails — src/components/marketplace/seo-listing-rail.tsx `orderBy`;
        //   For You — for-you-rail.tsx + src/lib/reco-signals.ts + /api/recommendations (signals only
        //     change WHICH rows, never their order; no signal → the same trending rail for everyone);
        //     it renders on the home discovery view AND as the `recovery` rail under a sparse search
        //     (listings-explorer.tsx, `totalCount < 8`);
        //   Recently viewed — recently-viewed-rail.tsx, gated on the SAME personalizationAllowed(), on the
        //     home discovery view (listings-explorer.tsx) and every PDP ((pdp)/page.tsx); ids from
        //     localStorage eno:viewed_ids, newest first, order kept by idsFastPath (feed-query.ts);
        //   featured — set only by the admin listings route ('feature'), never by a payment path;
        //   commission is no input to rankScore — browseRankScore() in src/lib/ranking-formula.ts.
        // ⚠️ THE PERSONALISATION SENTENCES NAME THE SWITCH, NOT ITS DEFAULT. Before Consent v2 an undecided
        // visitor has it on (consent.ts personalizationAllowed); after it (W-A) it is off until chosen.
        // "Only while it is on" is true of both; the default itself is /privacy's to state.
        // ⚠️ NO "NONE IS FEATURED TODAY" AND NO PROMISED "Featured" LABEL: the first is a database fact
        // one admin click falsifies, and nothing renders the second. Only the rule is stated.
        // ⚠️ VERSION 3 (2026-10-05) REWROTE THIS PARAGRAPH — two groups instead of one, and seller interleaving
        // only inside a group; the version-2 wording is in /regulations/v2 and in Article 17's newest entry.
        vi: `Khi người sử dụng tìm kiếm bằng từ khoá và giữ cách sắp xếp mặc định, kết quả được xếp theo hai nhóm. Nhóm thứ nhất gồm các tin có đủ mọi từ khoá trong tiêu đề, mẫu mã hoặc thương hiệu của chính tin đó, hoặc trong tên của mục mà tin được đăng; nhóm thứ hai gồm các tin cần đến danh mục của tin mới khớp được một trong các từ khoá. Trong mỗi nhóm, tin được xếp theo điểm tìm kiếm kết hợp mức độ phù hợp với từ khoá, điểm uy tín của người bán và độ mới, với tỷ trọng công bố tại /legal/ranking — việc chia nhóm không làm thay đổi tỷ trọng này; các tin bằng điểm nhau được xếp xen kẽ theo người bán và mẫu sản phẩm, chỉ trong phạm vi cùng một nhóm. Các tin chỉ khớp ở phần khác, như phần mô tả, được xếp sau theo thứ tự mặc định. Khi người sử dụng tìm theo một thương hiệu trong lúc đang xem một danh mục, trong mỗi trang kết quả được tải, tin của thương hiệu đó thuộc danh mục đang xem được đưa lên trước các tin còn lại của trang; việc này không chuyển tin từ trang kết quả này sang trang kết quả khác.`,
        en: `When a user searches by keyword and keeps the default ordering, results are ordered in two groups. The first group is the listings whose own title, model or brand, or the name of the aisle they are listed in, contains every search word; the second is the listings that need their category to match one of the words. Within each group, listings are ordered by a search score combining relevance to the query, seller trust and recency, with the weights published at /legal/ranking — the grouping does not change those weights; listings with equal scores are interleaved by seller and by product model, within the same group only. Listings that match only elsewhere, such as in the description, follow in the default order. When a user searches for a brand while browsing a category, within each page of results as it loads, that brand’s listings in the category being browsed are moved ahead of the rest of that page; no listing is moved from one page of results to another.`,
      },
      {
        // Version 3 (2026-10-05). The list is search-synonyms.ts CONDITION_PHRASES ("such as" — it holds a few
        // spellings more); "shows the items for sale" is the sale scope feed-query.ts gives such a query.
        vi: `Các từ chỉ tình trạng hàng hoá, như “second hand”, “used”, “cũ”, “đồ cũ” hoặc “đã qua sử dụng”, không được dùng để tìm trong nội dung tin đăng và không lọc kết quả theo tình trạng. Khi từ khoá chỉ gồm những từ này, kết quả là các món hàng đang được đăng bán. Tình trạng hoặc loại tin do người sử dụng tự chọn trong bộ lọc vẫn được áp dụng như bình thường.`,
        en: `Words that describe condition, such as “second hand”, “used”, “cũ”, “đồ cũ” or “đã qua sử dụng”, are not looked for in the listing text and do not filter results by condition. A search made only of such words shows the items for sale. A condition or listing type the user picks in the filters applies as usual.`,
      },
      {
        vi: `Người sử dụng có thể tự chọn cách sắp xếp khác — mới nhất, giá tăng dần, giá giảm dần — và có thể lọc theo danh mục, khu vực, khoảng giá cùng các thuộc tính khác; khi người sử dụng đã chọn, lựa chọn đó được ưu tiên áp dụng thay cho thứ tự mặc định.`,
        en: `Users can choose a different ordering themselves — newest, price ascending, price descending — and can filter by category, area, price range and other attributes; where the user has chosen, that choice is applied instead of the default ordering.`,
      },
      {
        // ⚠️ VERSION 3 (2026-10-05) ADDED THE VEHICLE-RENTAL SEAT AND THE MEMBERS' OWN SEAT. "Members' own job
        // posts and vehicle rentals", NOT "members' own listings" at large: the eSIM seat is keyed by AISLE
        // (SHARED_SEAT_SUBCATEGORIES), so a member's own eSIM listing shares it — only the two seller-keyed
        // seats (SHARED_SEAT_SELLERS) leave a member's post its own seat.
        vi: `Đa dạng người bán. Ở trang chủ và khi duyệt một danh mục theo thứ tự mặc định, ${FEED_DIVERSITY_WINDOW} vị trí đầu tiên được xếp xen kẽ theo người bán: tin có điểm cao nhất của mỗi người bán trước, rồi đến tin thứ hai của mỗi người bán, và cứ thế tiếp tục; trong mỗi lượt, thứ tự theo điểm được giữ nguyên và không tin nào bị ẩn. Để một danh mục do nhiều gian hàng cung cấp không chiếm hết trang đầu, ba nhóm tin dùng chung vị trí trong lượt xen kẽ đó: các gói eSIM của mọi nhà mạng dùng chung một vị trí; tin tuyển dụng dẫn từ các trang tuyển dụng dùng chung một vị trí; tin cho thuê xe dẫn từ các nền tảng và cửa hàng cho thuê xe dùng chung một vị trí. Tin tuyển dụng và tin cho thuê xe do thành viên tự đăng trên sàn vẫn giữ vị trí riêng của người đăng. Khi người sử dụng mở riêng mục eSIM, danh mục Việc làm hoặc một mục cho thuê xe, mỗi nhà mạng, mỗi trang tuyển dụng, mỗi nền tảng hoặc cửa hàng cho thuê xe lại có vị trí riêng. Khi có đủ tin, các mục tin đề xuất cũng giới hạn số tin của mỗi người bán và bỏ qua tin trùng mẫu sản phẩm hoặc trùng ảnh bìa.`,
        en: `Seller diversity. On the home page and when browsing a category in the default order, the first ${FEED_DIVERSITY_WINDOW} positions are interleaved by seller: each seller’s highest-scoring listing first, then each seller’s second, and so on; within each round the score order is kept and no listing is hidden. So that a category supplied by many storefronts cannot fill the first page, three groups share seats in that rotation: eSIM plans from every carrier share one seat; job postings linked from job boards share one; and vehicle rentals linked from rental platforms and shops share one. Job postings and vehicle rentals that members post on the platform themselves keep their poster’s own seat. When the user opens the eSIM aisle, the Jobs category or a vehicle-rental aisle itself, each carrier, each job board and each rental platform or shop has its own seat again. Where enough listings exist, recommendation rails likewise limit how many listings each seller gets and skip listings that repeat a product model or a cover photo.`,
      },
      {
        // Version 3 (2026-10-05) — the home-feed package's second-hand floor; see the code-fact note above.
        vi: `Ở trang chủ, theo thứ tự mặc định, khi có đủ tin, ít nhất hai trong bốn vị trí đầu tiên và ít nhất bốn trong mười hai vị trí đầu tiên là đồ đã qua sử dụng đang được đăng bán.`,
        en: `On the home page, in the default order, where enough such listings exist, at least two of the first four positions and at least four of the first twelve are second-hand goods for sale.`,
      },
      {
        vi: `Trang hướng dẫn và trang giới thiệu theo chủ đề. Danh sách tin đăng trên các trang này lấy tin trực tiếp từ sàn: danh sách dành cho một loại sản phẩm hoặc một mẫu cụ thể được xếp theo giá từ thấp đến cao; danh sách dành cho cả một danh mục được xếp tin nổi bật trước, rồi đến tin mới nhất; danh sách gồm nhiều loại nhà ở ưu tiên tin có từ ba ảnh trở lên.`,
        en: `Guides and topic pages. The listing panels on these pages are drawn live from the platform: a panel for one product type or one model is sorted by price, lowest first; a panel for a whole category shows featured listings first, then the newest; a panel spanning several kinds of home puts listings with three or more photos first.`,
      },
      {
        vi: `Mục “Dành cho bạn” và mục “Đã xem gần đây”. Mục “Dành cho bạn” xuất hiện ở trang chủ và bên dưới kết quả tìm kiếm hoặc lọc khi chỉ có ít kết quả. Mục này chỉ được cá nhân hoá khi tuỳ chọn cá nhân hoá trong phần cài đặt cookie đang bật: khi đó, các từ khoá đã tìm gần đây cùng các danh mục, thương hiệu đã xem — được lưu trên thiết bị của người sử dụng và chỉ được gửi kèm yêu cầu tải mục này — được dùng để chọn tin cho mục. Khi tuỳ chọn này tắt, mục hiển thị các tin đang được quan tâm nhiều, giống nhau với mọi người. Nếu người sử dụng đến sàn qua một đường dẫn hoặc quảng cáo có kèm từ khoá, từ khoá đó có thể được dùng cho chính lượt truy cập ấy mà không được lưu lại. Cũng chỉ khi tuỳ chọn cá nhân hoá đang bật, mục “Đã xem gần đây” ở trang chủ và trang tin đăng hiển thị các tin người sử dụng đã mở trên thiết bị này, tin mở gần nhất xếp trước; danh sách đó cũng được lưu trên thiết bị và chỉ được gửi kèm yêu cầu tải mục này. Người sử dụng có thể bật hoặc tắt cá nhân hoá bất cứ lúc nào qua liên kết “Cài đặt cookie” ở chân trang, xoá từng từ khoá gần đây trong ô tìm kiếm, hoặc xoá dữ liệu trang web trong trình duyệt. Cá nhân hoá chỉ quyết định tin nào xuất hiện trong hai mục này; thứ tự trong mục “Dành cho bạn” vẫn theo các tiêu chí tại Điều này, và kết quả duyệt danh mục, kết quả tìm kiếm không thay đổi theo người xem.`,
        en: `The “For You” and “Recently viewed” rails. The “For You” rail appears on the home page and below a search or filter that finds only a few listings. It is personalised only while personalisation is switched on in the cookie settings: then the user’s recent searches and the categories and brands they viewed — stored on the user’s own device and sent only with the request that loads this rail — are used to choose its listings. With personalisation off, the rail shows the listings currently drawing the most interest, the same for everyone. If the user arrives through a link or an advertisement that carries search words, those words may be used for that visit only and are not stored. Likewise only while personalisation is on, a “Recently viewed” rail on the home page and on listing pages shows the listings the user opened on this device, most recent first; that list, too, is stored on the device and sent only with the request that loads the rail. The user can switch personalisation on or off at any time through the “Cookie settings” link in the footer, remove recent searches one by one in the search box, or clear the site’s data in the browser. Personalisation decides only which listings appear in these two rails; the order within “For You” follows the criteria in this Article, and category browsing and search results do not change with the viewer.`,
      },
      {
        vi: `Tin nổi bật, quảng cáo và hoa hồng. Vị trí “Tin nổi bật” do đơn vị vận hành chỉ định, không được bán và không nhận thanh toán; tin nổi bật được cộng một mức điểm cố định đã công bố tại /legal/ranking. Hiện không có vị trí hiển thị nào được bán hay trả phí để nâng thứ hạng; nếu sau này có, vị trí đó được gắn nhãn “Quảng cáo” hoặc “Tin ưu tiên” ngay tại chỗ hiển thị. Một số tin đăng liên kết và đường dẫn của đối tác có thể mang lại hoa hồng cho đơn vị vận hành khi người mua mua hàng qua đó; các tin, đường dẫn này được gắn nhãn “Quảng cáo” kèm ghi chú về hoa hồng, và việc một tin có thể mang lại hoa hồng hay không không phải là tiêu chí xếp hạng.`,
        en: `Featured listings, advertising and commission. “Featured” placement is assigned by the operator; it is not sold and no payment is taken for it, and a featured listing receives a fixed score boost published at /legal/ranking. No display position is currently sold, and no one can pay to rank higher; if that changes, such positions are labelled “Advertisement” or “Promoted” where they appear. Some linked listings and partner links can earn the operator a commission when a buyer purchases through them; those listings and links are labelled “Ad” with a commission note, and whether a listing can earn a commission is not a ranking criterion.`,
      },
      {
        // ⚠️ THIS SAID THE WEIGHTS WERE "NOT PUBLISHED, SO RANKING CANNOT BE GAMED" while /legal/ranking
        // published them — computed from RANK (src/lib/compliance/ranking-disclosure.ts). Corrected.
        vi: `Tỷ trọng của từng tiêu chí được công bố tại /legal/ranking và được tính trực tiếp từ công thức đang vận hành; cách tính điểm uy tín của người bán được công bố chi tiết tại /trust.`,
        en: `The weight of each criterion is published at /legal/ranking, computed directly from the formula in use; how a seller’s trust score is calculated is published in detail at /trust.`,
      },
    ],
  },
  {
    id: 'amendments',
    rail: '15. Amendments & governing law',
    titleVi: 'Điều 15. Sửa đổi Quy chế, luật áp dụng và hiệu lực',
    titleEn: 'Article 15. Amendments, governing law and effect',
    body: [
      {
        vi: `Đơn vị vận hành có quyền sửa đổi, bổ sung Quy chế này khi pháp luật hoặc sản phẩm thay đổi. Mọi sửa đổi được công bố công khai trên sàn ít nhất 5 ngày trước ngày có hiệu lực, kèm thông báo tới người sử dụng đã đăng ký tài khoản. Bản Quy chế đang áp dụng luôn được đăng tại /regulations kèm số phiên bản.`,
        en: `The operator may amend these Regulations when the law or the product changes. Every amendment is published on the platform at least 5 days before it takes effect, together with a notice to registered users. The version in force is always published at /regulations with its version number.`,
      },
      // NĐ 248/2026 Điều 25.3(đ)/(e): an intermediary platform re-files within 20 WORKING days of a change
      // to its published operating/transaction conditions or its service-contract terms. Not "before":
      // the decree counts from the day of the change. Applies once MoIT has confirmed the registration
      // (still pending — PRELAUNCH in site-legal.ts), hence the conditional wording.
      // ⛔ eno.vn ONLY — the Article 2 licensing defect again (see REGISTRATION_DUTY). eno.forum will never
      // hold that registration, so it has nothing to re-file; v1 never said this there, so no log line.
      ...(IS_MARKETPLACE
        ? [
            {
              vi: `Sau khi sàn được Bộ Công Thương xác nhận đăng ký, mọi thay đổi nội dung công khai về điều kiện hoạt động, điều kiện giao dịch trên sàn — bao gồm Quy chế này — được đơn vị vận hành thực hiện thủ tục sửa đổi, bổ sung đăng ký với Bộ Công Thương trong thời hạn 20 ngày làm việc kể từ ngày thay đổi, theo khoản 3 Điều 25 ${ND248.vi}.`,
              en: `Once the platform’s registration has been confirmed by the Ministry of Industry and Trade, every change to its published operating and transaction conditions — these Regulations included — is filed with the Ministry as an amendment to that registration within 20 working days of the change, as Article 25(3) of ${ND248.en} requires.`,
            },
          ]
        : []),
      {
        vi: `Người sử dụng tiếp tục sử dụng ${S} sau ngày bản sửa đổi có hiệu lực được coi là chấp nhận bản sửa đổi đó. Người không đồng ý có quyền ngừng sử dụng dịch vụ và yêu cầu xoá tài khoản.`,
        en: `A user who continues to use ${S} after an amended version takes effect is taken to have accepted it. A user who does not agree may stop using the service and ask for their account to be deleted.`,
      },
      {
        vi: `Quy chế này được điều chỉnh bởi pháp luật Việt Nam. Trường hợp có khác biệt giữa bản tiếng Việt và bản dịch tiếng Anh, bản tiếng Việt có giá trị áp dụng. Nếu bất kỳ điều khoản nào của Quy chế bị coi là vô hiệu, các điều khoản còn lại vẫn giữ nguyên hiệu lực. Quy chế có hiệu lực kể từ ngày được công bố trên ${S}; mỗi lần sửa đổi, bổ sung có hiệu lực từ ngày ghi tại Điều 17 và thay thế nội dung tương ứng của các phiên bản trước đó.`,
        en: `These Regulations are governed by the law of Vietnam. If the Vietnamese text and the English translation differ, the Vietnamese text prevails. If any provision is held invalid, the remaining provisions stay in force. These Regulations take effect on the day they are published on ${S}; each amendment takes effect on the date recorded in Article 17 and replaces the corresponding text of earlier versions.`,
      },
    ],
  },
  {
    id: 'documents',
    rail: '16. Related documents',
    titleVi: 'Điều 16. Các văn bản kèm theo',
    titleEn: 'Article 16. Documents published alongside these Regulations',
    body: [
      {
        vi: `Các văn bản sau được công bố trên ${S} và là một phần không tách rời của Quy chế này: Điều khoản dịch vụ, Chính sách bảo vệ dữ liệu cá nhân, Danh mục hàng hoá và dịch vụ cấm đăng, cách tính điểm uy tín, và Hướng dẫn giao dịch an toàn. Trường hợp có mâu thuẫn giữa một văn bản kèm theo và Quy chế này, Quy chế này được áp dụng.`,
        en: `The following documents are published on ${S} and form an inseparable part of these Regulations: the Terms of Service, the Personal Data Protection Policy, the list of prohibited goods and services, how the trust score is calculated, and the safe-dealing guidance. Where a document conflicts with these Regulations, these Regulations prevail.`,
      },
    ],
    links: [
      { href: '/terms', label: 'Điều khoản dịch vụ / Terms of Service' },
      { href: '/privacy', label: 'Bảo vệ dữ liệu cá nhân / Privacy Policy' },
      { href: '/prohibited', label: 'Hàng hoá, dịch vụ cấm đăng / Prohibited items' },
      { href: '/trust', label: 'Điểm uy tín / Trust score' },
      { href: '/safety', label: 'Giao dịch an toàn / Safe dealing' },
    ],
  },
  {
    // ⚠️ APPEND-ONLY. One dated entry per amendment, newest last; never rewrite an old entry. Dates are
    // typed, not computed, so nothing here can drift in prerendered HTML.
    // The 2026-10 entry was re-dated ON ITS OWN PUBLICATION DAY (owner, 2026-10-01: in force at once, no
    // announcement — LEGAL_AMENDMENT.immediate): it first said "published 01/10, in force 07/10; until then
    // version 1 applies". One date now, because it was published and took effect the same day.
    // ⚠️ ITS DATE NOW COMES FROM V1_SUPERSEDED (legal-archive.ts) — a literal 01/10/2026 since LEGAL_AMENDMENT
    // moved on to the Terms' version 3 (2026-10-07), so this entry can never take a later amendment's date.
    // Its words are unchanged.
    // VERSION 3's entry (2026-10-05) is the second — immediate like version 2, so it has one date too. Dated
    // through V2_SUPERSEDED for the same reason: REGULATIONS_AMENDMENT's dates today, a literal once a
    // version 4 re-uses that record (legal-archive.test.ts).
    id: 'changelog',
    rail: '17. Change history',
    titleVi: 'Điều 17. Lịch sử sửa đổi, bổ sung',
    titleEn: 'Article 17. Change history',
    body: [
      {
        vi: `Sửa đổi, bổ sung được công bố và có hiệu lực từ ngày ${V1_SUPERSEDED.inForceVi}; nội dung trước sửa đổi (phiên bản ${V1}) được lưu tại ${V1_PATHS.regulations}. Nội dung sửa đổi, bổ sung gồm: ${numbered(CHANGES_V2, 'vi')}.`,
        en: `Amendments published on and in force from ${V1_SUPERSEDED.inForceEn}; the previous text (version ${V1}) is archived at ${V1_PATHS.regulations}. They: ${numbered(CHANGES_V2, 'en')}.`,
      },
      {
        vi: `Sửa đổi, bổ sung được công bố và có hiệu lực từ ngày ${V2_SUPERSEDED.inForceVi}; nội dung trước sửa đổi (phiên bản ${V2}) được lưu tại ${V2_PATHS.regulations}. Nội dung sửa đổi, bổ sung gồm: ${numbered(CHANGES_V3, 'vi')}.`,
        en: `Amendments published on and in force from ${V2_SUPERSEDED.inForceEn}; the previous text (version ${V2}) is archived at ${V2_PATHS.regulations}. They: ${numbered(CHANGES_V3, 'en')}.`,
      },
    ],
  },
]

export const metadata: Metadata = withShare({
  title: `Quy chế hoạt động | Operating Regulations | ${SITE_NAME}`,
  description: `Quy chế hoạt động sàn giao dịch thương mại điện tử ${SITE_NAME}: phạm vi hoạt động, quyền và nghĩa vụ của các bên, quy trình đăng tin, rà soát nội dung, khiếu nại và tiêu chí hiển thị. Operating regulations of the ${SITE_NAME} e-commerce platform.`,
  alternates: { canonical: '/regulations' },
})

/**
 * Article 12's per-issue deadlines. ⚠️ BOTH LANGUAGES IN EVERY CELL, Vietnamese first — the same
 * invariant as the paragraphs: a reader with an English UI still sees the governing text. A real
 * <table> (ui/table) so the rows read as rows to a screen reader and to a regulator's copy-paste;
 * `whitespace-normal` because the primitive's cells default to nowrap, which would push a phone into
 * sideways scrolling on every row.
 */
function DeadlineTable({ head, rows }: { head: Para[]; rows: Para[][] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h.en} scope="col" className="h-auto py-2 align-bottom whitespace-normal">
              <span className="block text-sm font-semibold text-foreground" lang="vi">{h.vi}</span>
              <span className="block text-xs font-normal text-ink-4" lang="en">{h.en}</span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r[0].en}>
            {r.map((c, j) => (
              <TableCell key={j} className="py-2.5 align-top whitespace-normal">
                <span className={j === 0 ? 'block text-sm font-medium text-foreground' : 'block text-sm text-body'} lang="vi">{linkifyLegal(c.vi)}</span>
                <span className="block text-xs text-ink-4" lang="en">{linkifyLegal(c.en)}</span>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ⚠️ ContentPage renders `intro` INSIDE a <p>, so only phrasing content may be passed to it —
// <span className="block">, never a <div> or a nested <p>. `meta` is a sibling of the <h1> and has
// no such constraint.
export default function RegulationsPage() {
  return (
    <ContentPage
      title="Quy chế hoạt động (Operating Regulations)"
      meta={
        <div className="mt-3 max-w-[70ch] space-y-1">
          {/* Linkified: META names where the previous version is published (/regulations/v2 since
              version 3 — the version in force during a notice window, if an amendment has one), and
              Article 15 promises the version in force is always one step away. */}
          <p className="text-sm text-ink-4" lang="vi">{linkifyLegal(META.vi)}</p>
          <p className="text-sm text-ink-4" lang="en">{linkifyLegal(META.en)}</p>
        </div>
      }
      intro={
        <>
          <span className="block" lang="vi">{INTRO.vi}</span>
          <span className="mt-3 block text-sm text-ink-4" lang="en">{INTRO.en}</span>
        </>
      }
      sections={ARTICLES.map((a) => ({ id: a.id, label: a.rail }))}
    >
      {/**
        * ⚠️ SIDE BY SIDE FROM xl, INTERLEAVED BELOW IT — AND BOTH LANGUAGES ALWAYS IN THE DOM (C-LEGAL-UX).
        * Each Vietnamese paragraph and its English translation are one grid row from 1280px, so the
        * document is half as tall on a desktop (15,216px at 1440, measured 2026-09-29) while the
        * invariant above still holds: nothing is hidden, and the Vietnamese comes first in source
        * order, so it is what a screen reader and a phone read first. NOT ui/tabs: Base UI's panels
        * unmount (or hide) the inactive language, and "a reviewer with an English UI must still see the
        * Vietnamese" is exactly what that would break. xl rather than lg: beside the 210px rail two
        * columns at 1024px are ~330px each — 40-character lines of legal text.
        * 4fr : 3fr, not halves: the Vietnamese is set a size larger and runs longer, so equal columns
        * left the English finishing a third early beside every paragraph (measured 8,996 vs 6,695px of
        * text at 1440). The wider Vietnamese column evens the pair out and says which text governs.
        * `wide` lifts ContentSection's 70ch wrapper so the pair can use the column; each paragraph
        * keeps its own 60ch measure. `linkifyLegal` links the document paths and mailboxes the text
        * names without changing a character of it.
        */}
      {ARTICLES.map((a) => (
        <ContentSection key={a.id} id={a.id} wide>
          <div className="grid gap-1 xl:grid-cols-[4fr_3fr] xl:items-baseline xl:gap-x-10">
            <h2 className="h-title text-foreground" lang="vi">{a.titleVi}</h2>
            <p className="text-sm font-medium text-ink-4" lang="en">{a.titleEn}</p>
          </div>
          {a.body.map((p, i) => (
            <Fragment key={i}>
              <div className="grid gap-1.5 xl:grid-cols-[4fr_3fr] xl:items-baseline xl:gap-x-10">
                <p className="max-w-[60ch] text-base leading-relaxed text-body" lang="vi">{linkifyLegal(p.vi)}</p>
                <p className="max-w-[60ch] text-sm leading-relaxed text-ink-4" lang="en">{linkifyLegal(p.en)}</p>
              </div>
              {a.table?.tableAfter === i && <DeadlineTable head={a.table.head} rows={a.table.rows} />}
            </Fragment>
          ))}
          {a.links && (
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {a.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-sm font-semibold text-accent-foreground hover:underline">{l.label}</a>
                </li>
              ))}
            </ul>
          )}
        </ContentSection>
      ))}
    </ContentPage>
  )
}
