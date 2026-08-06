/**
 * THE FOOTER'S CATEGORY LINKS — slug + bilingual name, and nothing else.
 *
 * ⚠️ IT EXISTS TO KEEP 70 KB OUT OF THIRTY PAGES. `footer.tsx` is a CLIENT component, and it is
 * rendered by 30 route files — the home feed, storefronts, /post, /saved, /not-found and the rest —
 * so whatever it imports ships with all of them. It imported `TAXONOMY` from `src/lib/taxonomy.ts`
 * (70,775 bytes) to render fifteen `<a>` tags, and the bulk of that module is precisely what the
 * footer never touches: every subcategory, its icon, and its `keywords` search-synonym array.
 *
 * ⚠️ THE FOOTER IS NOT IN THE ROOT LAYOUT, which an earlier draft of this comment claimed. Each page
 * renders it explicitly, so this is 30 routes rather than all of them — a smaller win than it first
 * looked, and worth stating accurately since the number is the whole argument.
 *
 * Measured 2026-08-06. Other client components do import from taxonomy.ts (`facetsFor`,
 * `subcategoriesFor` …) and pull the same data transitively, but they are feature-scoped and the two
 * heaviest — FacetBar and ExplorerFiltersDrawer — are already `next/dynamic`. The footer was the one
 * paying that cost on pages that never show a facet.
 *
 * ⚠️ IT CANNOT DRIFT, AND THE TEST IS WHY. A hand-copied list is exactly the kind of duplication
 * that rots — a renamed category or a new one would leave the footer quietly wrong. The paired
 * `taxonomy-nav.test.ts` asserts this array equals `TAXONOMY.map(({ slug, name, nameVi }) => …)`
 * element for element, in order, so the copy is checked on every run rather than trusted. That test
 * is the whole justification for the duplication; do not delete one without the other.
 *
 * ⚠️ DO NOT ADD FIELDS. Every property here is bytes on every page. If a caller needs `icon`,
 * `description`, subcategories or keywords, it wants `TAXONOMY` and it is a server component or a
 * lazily-loaded client one.
 */
export type NavCategory = { slug: string; name: string; nameVi: string }

export const NAV_CATEGORIES: readonly NavCategory[] = [
  { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' },
  { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' },
  { slug: 'property', name: 'Property', nameVi: 'Nhà đất' },
  { slug: 'moving-sale', name: 'Moving', nameVi: 'Thanh lý' },
  { slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' },
  { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  { slug: 'fashion-beauty', name: 'Fashion', nameVi: 'Thời trang' },
  { slug: 'baby-kids', name: 'Kids', nameVi: 'Mẹ & Bé' },
  { slug: 'hobbies-sports', name: 'Hobbies', nameVi: 'Sở thích' },
  { slug: 'pets', name: 'Pets', nameVi: 'Thú cưng' },
  { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
  { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
  { slug: 'community-events', name: 'Community', nameVi: 'Cộng đồng' },
  { slug: 'tickets-travel', name: 'Travel', nameVi: 'Du lịch' },
  { slug: 'food-drink', name: 'Food', nameVi: 'Ẩm thực' },
] as const
