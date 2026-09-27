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
 * category self-noindexes (`src/app/[lang]/c/[category]/(index)/page.tsx` sets robots from its live count, and 8 of
 * 15 categories currently hold zero listings), so a link there can point at a page that has removed
 * itself from the index — real, but worthless to link to. The keyword landing pages below are the
 * pages built to rank, and each already funnels to its own category. They are NOT always indexable:
 * a landing whose rail is empty noindexes itself too (seo-landing-robots.ts), which is why
 * /motorbikes-for-sale-vietnam is no longer in the list (0 motorbikes, noindex, 2026-09-27). Link
 * only a landing that has stock behind it — the page that can actually receive the equity.
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
 * are people moving to Vietnam, and eno.vn is where the rentals and the jobs are. Google's
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
  // ⚠️ ONLY WHAT IS ACTUALLY LISTED (measured 2026-09-27): rentals, jobs, furniture and electronics.
  // It said "vehicles … and moving sales" — `vehicles` held 100 accessories and no vehicle, and
  // `moving-sale` held 0; the used furniture is shop stock, not people moving out.
  blurbEn: 'Classifieds for the international community: rentals, jobs, furniture and electronics.',
  blurbVi: 'Rao vặt cho cộng đồng quốc tế: nhà cho thuê, việc làm, nội thất và đồ điện tử.',
}

/**
 * The destinations worth a link, most-useful-first.
 *
 * Order matters: the promo shows the first three, in this order, under MARKETPLACE_HOME, so a
 * re-ordering here is a product change. Keep the list SHORT. A block of a dozen outbound links
 * reads as a link farm to a reader and to a crawler, and the legal story ("we disclose a real
 * affiliation") is easier to tell about five deliberate links than about twenty.
 */
export const MARKETPLACE_LINKS: CrossSiteLink[] = [
  {
    key: 'housing',
    href: `${MARKETPLACE_ORIGIN}/housing-vietnam-expats`,
    labelEn: 'Housing and apartment rentals in Vietnam',
    labelVi: 'Thuê nhà và căn hộ tại Việt Nam',
    // Rentals by subcategory, 2026-09-27: apartments, houses, rooms and offices. Nothing here about
    // furnishing or lease length, which the imported listings do not state consistently.
    blurbEn: 'Apartments, houses and rooms for rent.',
    blurbVi: 'Căn hộ, nhà nguyên căn và phòng cho thuê.',
  },
  // ⛔ NO MOTORBIKES ENTRY (2026-09-27): eno.vn held 0 motorbikes and /motorbikes-for-sale-vietnam
  // noindexes itself when empty, so the link promised stock that is not there. Re-add it only once
  // that landing is indexable again (cross-site-links.test.ts pins the absence until then).
  {
    key: 'jobs',
    href: `${MARKETPLACE_ORIGIN}/jobs-vietnam-expats`,
    labelEn: 'Jobs in Vietnam for internationals',
    labelVi: 'Việc làm tại Việt Nam cho người nước ngoài',
    // It listed "hospitality, marketing, design and tech": all 42 live jobs were teaching (2026-09-27).
    blurbEn: 'Roles where English is required, mostly teaching.',
    blurbVi: 'Các vị trí cần tiếng Anh, phần lớn là giảng dạy.',
  },
  {
    key: 'moving-sales',
    href: `${MARKETPLACE_ORIGIN}/moving-sales-vietnam`,
    // ⚠️ The KEY and the URL keep "moving-sales" (that landing's ranking slug); the words do not. The
    // used stock is dealer-supplied — it is not "from people leaving Vietnam" (2026-09-27).
    labelEn: 'Secondhand furniture and appliances',
    labelVi: 'Nội thất và đồ điện máy cũ',
    blurbEn: 'Used sofas, wardrobes, air conditioners and more, mostly from secondhand shops.',
    blurbVi: 'Sofa, tủ quần áo, máy lạnh và nhiều món khác đã qua sử dụng, phần lớn từ các cửa hàng đồ cũ.',
  },
]
