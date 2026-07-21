import { Tr } from '@/context/language-context'

const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')

// eno.forum's job, besides being the community's web home, is to send authority and
// traffic to eno.vn (owner 2026-07-21: "forum we keep as seo optimization tool have
// multiple backlinks in forum to eno.vn").
//
// Why this component exists when the footer ALREADY links to eno.vn ~15 times: footer
// links are sitewide boilerplate, and search engines discount boilerplate heavily. What
// carries weight is a CONTEXTUAL link inside the main content of a page, and that is what
// this is — it renders inside <article> on the indexable /post/[id] permalinks, of which
// there are now 40+ from the seeded Help Center answers alone.
//
// Three rules this block must keep or it stops being an SEO asset:
//   1. PLAIN SERVER-RENDERED <a href>. No onClick-only navigation, no client-side router
//      shim — a crawler has to see the href in the HTML.
//   2. NO rel="nofollow"/"sponsored". These are first-party links between our own two
//      properties; marking them nofollow would throw away the entire point.
//   3. DEEP links, not just the homepage. A link to /c/electronics helps that landing page
//      rank; fifteen links to / do almost nothing for anything but the root.
// Deliberately NOT target="_blank": keeping it a same-tab navigation is the normal
// cross-property hop, and inside the native app the WebView keeps eno.vn in-app anyway.

/** The 15 canonical marketplace categories. Mirrors src/lib/taxonomy.ts on eno.vn — the
 *  forum is a separate Next app and cannot import from it, so the slugs are duplicated
 *  here. ⚠️ A slug that drifts becomes a 404 backlink, which is worse than no link: check
 *  against TAXONOMY when categories change. */
const CATEGORIES: { slug: string; en: string; vi: string }[] = [
  { slug: 'vehicles', en: 'Vehicles', vi: 'Xe cộ' },
  { slug: 'rentals', en: 'Rentals', vi: 'Cho thuê' },
  { slug: 'property', en: 'Property', vi: 'Nhà đất' },
  { slug: 'moving-sale', en: 'Moving sales', vi: 'Thanh lý' },
  { slug: 'furniture-appliances', en: 'Home & furniture', vi: 'Nhà cửa' },
  { slug: 'electronics', en: 'Electronics', vi: 'Điện tử' },
  { slug: 'fashion-beauty', en: 'Fashion & beauty', vi: 'Thời trang' },
  { slug: 'baby-kids', en: 'Baby & kids', vi: 'Mẹ & Bé' },
  { slug: 'hobbies-sports', en: 'Hobbies & sports', vi: 'Sở thích' },
  { slug: 'pets', en: 'Pets', vi: 'Thú cưng' },
  { slug: 'jobs', en: 'Jobs', vi: 'Việc làm' },
  { slug: 'services', en: 'Services', vi: 'Dịch vụ' },
  { slug: 'community-events', en: 'Community & events', vi: 'Cộng đồng' },
  { slug: 'tickets-travel', en: 'Tickets & travel', vi: 'Du lịch' },
  { slug: 'food-drink', en: 'Food & drink', vi: 'Ẩm thực' },
]

export const MARKETPLACE_CATEGORIES = CATEGORIES
export const MARKETPLACE_BASE = MARKETPLACE_URL

/**
 * In-content marketplace block for the indexable post permalinks. Server-rendered, so the
 * whole thing is in the initial HTML a crawler receives.
 */
export function MarketplaceLinks() {
  return (
    <section
      aria-labelledby="marketplace-links-title"
      className="mt-8 rounded-2xl border border-border bg-card p-5"
    >
      <h2 id="marketplace-links-title" className="text-base font-bold text-foreground">
        <Tr text="Buying or selling in Vietnam?" vi="Bạn đang mua hoặc bán tại Việt Nam?" />
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-body">
        <Tr
          text="This community runs alongside eno.vn, a trusted marketplace for people living in Vietnam — housing, motorbikes, furniture, jobs and services, with a public trust score on every seller."
          vi="Cộng đồng này đi cùng eno.vn, sàn rao vặt uy tín cho người đang sống tại Việt Nam — nhà ở, xe máy, nội thất, việc làm và dịch vụ, mỗi người bán đều có điểm uy tín công khai."
        />
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={MARKETPLACE_URL}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          <Tr text="Browse the eno.vn marketplace" vi="Xem sàn eno.vn" />
        </a>
        <a
          href={`${MARKETPLACE_URL}/post`}
          className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-tint"
        >
          <Tr text="Post a listing" vi="Đăng tin" />
        </a>
        <a
          href={`${MARKETPLACE_URL}/help`}
          className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-tint"
        >
          <Tr text="Help center" vi="Trung tâm trợ giúp" />
        </a>
      </div>

      <p className="mt-5 text-xs font-bold text-foreground">
        <Tr text="Browse by category" vi="Xem theo danh mục" />
      </p>
      {/* Fifteen DEEP links to the category landings — the part that actually moves the
          needle, versus repeating the homepage link fifteen times. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {CATEGORIES.map((category) => (
          <li key={category.slug}>
            <a
              href={`${MARKETPLACE_URL}/c/${category.slug}`}
              className="text-xs text-body underline-offset-2 transition-colors hover:text-accent-foreground hover:underline"
            >
              <Tr text={category.en} vi={category.vi} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
