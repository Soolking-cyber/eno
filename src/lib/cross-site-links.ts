/**
 * THE CANONICAL eno.vn DESTINATIONS THAT eno.forum LINKS TO — services edition only.
 *
 * eno.forum's visitors arrive with one job (a Vietnam e-visa) and then, very often, actually come
 * to Vietnam. The marketplace they need once they land is on eno.vn. These are the links that say
 * so, and they are also the SEO half of the arrangement: eno.forum ranks for a query set eno.vn is
 * legally barred from touching, and the equity it earns is worth passing to the sister site.
 *
 * ⚠️ THESE LINKS ARE DOFOLLOW, DELIBERATELY, AND MUST STAY THAT WAY. See CROSS_SITE_REL below —
 * the reasoning is long enough that it lives on the constant rather than here.
 *
 * ⚠️ EVERY href IS ABSOLUTE AND POINTS AT THE APEX. Two reasons, both measurable:
 *   · ABSOLUTE, because this renders on eno.forum. A root-relative `/housing-vietnam-expats` would
 *     resolve to eno.forum's OWN copy of that page — the two deployments are one codebase, so the
 *     path exists on both — and the link would silently stop being a cross-site link at all while
 *     continuing to look like one in the diff.
 *   · APEX (`https://eno.vn`, never `www.`), because next.config.ts 301s www→apex on every path.
 *     Linking to www means every visitor and every crawler takes a redirect hop it did not need.
 *
 * ⚠️ NEVER LINK A `.svc.` ROUTE FROM HERE. Services-only pages (`/vietnam-evisa`,
 * `/services-for-expats-vietnam`, `/itinerary`) are named `page.svc.tsx`, which a MARKETPLACE build
 * does not compile — so `https://eno.vn/vietnam-evisa` is a 404, not a page. That is the one way
 * this file can produce a link that is worse than no link, and it is invisible to tsc: an href is a
 * string. Every path below was checked against `src/app/**` for a plain `page.tsx` before it was
 * added, and cross-site-links.test.ts re-checks them on every run so a future rename cannot orphan
 * one quietly.
 *
 * ⚠️ AND `/c/<slug>` CATEGORY PAGES ARE DELIBERATELY ABSENT even though the routes exist. An empty
 * category self-noindexes (`src/app/c/[category]/page.tsx` sets robots from its live count, and 8 of
 * 15 categories currently hold zero listings), so a link there can point at a page that has removed
 * itself from the index — real, but worthless to link to. The four keyword landing pages below are
 * always indexable, are the pages built to rank, and each already funnels to its own category. Link
 * the page that can receive the equity.
 *
 * ⚠️ THIS MODULE IS ALIASED AWAY ON A MARKETPLACE BUILD (next.config.ts → cross-site-links.stub.ts).
 * On eno.vn every one of these is a self-link and every label is promotional copy about the site the
 * reader is already on — nothing renders it (the promo component is aliased too), but a gate leaves
 * the STRINGS in the artifact and the alias does not. Same mechanism, same reasoning, as
 * src/lib/edition-services-copy.ts, which documents the measurement behind it.
 */

/** Apex, no trailing slash. Not exported: every href is built here, so no caller needs the host. */
const MARKETPLACE_ORIGIN = 'https://eno.vn'

/**
 * THE `rel` ON EVERY CROSS-SITE ANCHOR — `noopener`, and NOTHING ELSE.
 *
 * ⚠️ `nofollow` AND `sponsored` ARE BANNED HERE, AND THAT IS A DECISION, NOT AN OVERSIGHT. It is
 * the reflex to add one — "it's a link to another property of ours, be safe" — and it would forfeit
 * the entire point of this file. These are genuine editorial recommendations: eno.forum's readers
 * are people moving to Vietnam, and eno.vn is where the housing and the motorbikes are. Google's
 * own guidance reserves `sponsored` for paid placements and `nofollow` for links you do not vouch
 * for; we are not paid and we do vouch. Marking them would tell a crawler to discount a link we
 * mean, on the one axis this whole surface exists to move.
 *
 * `noopener` stays because it costs nothing and is correct hygiene for any cross-origin anchor: it
 * denies the destination a `window.opener` handle if the link is ever opened in a new context.
 * (Modern browsers imply it for `target="_blank"`, but these anchors do not carry `target` and a
 * future edit that adds one should not have to remember.)
 *
 * ⚠️ IT IS ALSO NOT A DISCLOSURE. The relationship between the two sites is disclosed in WORDS —
 * AFFILIATION in src/lib/site-legal.ts, rendered next to the links by the promo component. A `rel`
 * attribute is not a disclosure a reader can read, and swapping the visible line for a machine
 * attribute would be a downgrade in both directions.
 */
export const CROSS_SITE_REL = 'noopener'

export type CrossSiteLink = {
  /** Stable key for React and for tests; never rendered. */
  key: string
  /** Absolute apex URL. */
  href: string
  /** Anchor text — a natural phrase, not a keyword string. EN is authored, VI is a curated pass. */
  labelEn: string
  labelVi: string
  /** One line of context, so the link is an editorial recommendation rather than a bare URL. */
  blurbEn: string
  blurbVi: string
}

/**
 * The marketplace itself.
 *
 * ⚠️ TYPED `| null` BECAUSE OF THE STUB. tsc never sees cross-site-links.stub.ts — an alias is a
 * bundler resolution — so a consumer that dereferences this without a null check typechecks green
 * and throws on eno.vn. The union forces the check to be written once, in the component, where it
 * doubles as the "render nothing on the marketplace edition" guard.
 */
export const MARKETPLACE_HOME: CrossSiteLink | null = {
  key: 'home',
  href: `${MARKETPLACE_ORIGIN}/`,
  // ⚠️ THE ANCHOR TEXT IS THE PAYLOAD. It has to work unchanged in two places — the promo's first
  // row and a narrow footer column — so it is kept short enough for the column while still naming
  // what is on the other end. "Click here" and a bare URL are the two failure modes.
  labelEn: 'Browse the eno.vn marketplace',
  labelVi: 'Xem chợ eno.vn',
  blurbEn:
    'Classifieds for the international community: housing, jobs, vehicles, furniture and moving sales.',
  blurbVi:
    'Rao vặt cho cộng đồng quốc tế: nhà ở, việc làm, xe cộ, nội thất và thanh lý chuyển nhà.',
}

/**
 * The destinations worth a link, most-useful-first.
 *
 * Order matters: the promo shows the first three (under MARKETPLACE_HOME) and the footer column
 * shows all four, so a re-ordering here is a product change. Keep the list SHORT. A block of a dozen outbound links
 * reads as a link farm to a reader and to a crawler, and the legal story ("we disclose a real
 * affiliation") is easier to tell about five deliberate links than about twenty.
 */
export const MARKETPLACE_LINKS: CrossSiteLink[] = [
  {
    key: 'housing',
    href: `${MARKETPLACE_ORIGIN}/housing-vietnam-expats`,
    labelEn: 'Housing and apartment rentals in Vietnam',
    labelVi: 'Thuê nhà và căn hộ tại Việt Nam',
    blurbEn: 'Apartments, houses and serviced rentals — furnished, monthly or yearly.',
    blurbVi: 'Căn hộ, nhà nguyên căn và căn hộ dịch vụ — có nội thất, thuê theo tháng hoặc theo năm.',
  },
  {
    key: 'motorbikes',
    href: `${MARKETPLACE_ORIGIN}/motorbikes-for-sale-vietnam`,
    labelEn: 'Motorbikes for sale and rent',
    labelVi: 'Mua bán và thuê xe máy',
    blurbEn: 'Automatic scooters and manual bikes, used for sale or rented by the month.',
    blurbVi: 'Xe tay ga và xe số, bán xe đã qua sử dụng hoặc cho thuê theo tháng.',
  },
  {
    key: 'jobs',
    href: `${MARKETPLACE_ORIGIN}/jobs-vietnam-expats`,
    labelEn: 'Jobs in Vietnam for internationals',
    labelVi: 'Việc làm tại Việt Nam cho người nước ngoài',
    blurbEn: 'Teaching, hospitality, marketing, design and tech roles where English is required.',
    blurbVi: 'Giảng dạy, nhà hàng khách sạn, marketing, thiết kế và công nghệ — các vị trí cần tiếng Anh.',
  },
  {
    key: 'moving-sales',
    href: `${MARKETPLACE_ORIGIN}/moving-sales-vietnam`,
    labelEn: 'Moving sales and secondhand furniture',
    labelVi: 'Thanh lý chuyển nhà và nội thất cũ',
    blurbEn: 'Furniture, appliances and home goods from people leaving Vietnam.',
    blurbVi: 'Nội thất, đồ điện máy và đồ gia dụng từ những người sắp rời Việt Nam.',
  },
]
