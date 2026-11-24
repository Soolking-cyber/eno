import { feedExcluded, feedIdentifiers, isMockImages } from '@/lib/product-feed'
import { plainSnippet } from '@/lib/strip-md'
import type { SerializedFeedListing } from '@/lib/serialize'

/**
 * ── The ChatGPT product feed (owner 2026-11-24: eno's business profile in ChatGPT, "set it up properly with chat agent
 * products"). One JSON object per line in OpenAI's product feed schema (developers.openai.com/commerce/specs/file-upload/
 * products), fetched by ChatGPT from a hosted URL (/api/feeds/chatgpt) so the catalogue stays current by itself.
 *
 * The SAME catalogue as the Google Shopping feed (route.ts there says why: live + checked + no affiliate rows, the
 * feed categories and listing types, no per-hour/day/week/month prices, the platform-banned classes withheld by
 * feedExcluded), because ChatGPT's product surface answers to the same kind of policy — a product page whose purchase
 * happens elsewhere is not a product page. Search only: eno has no checkout, so `is_eligible_checkout` is false.
 * ⛔ No seller contact data: seller_name is the shop's public name, seller_url its public storefront.
 */
export type ChatgptFeedRow = SerializedFeedListing & { seller: { id: string; name: string } }

export type ChatgptFeedItem = {
  item_id: string
  title: string
  description: string
  url: string
  brand: string
  seller_name: string
  seller_url: string
  image_url: string
  additional_image_urls?: string[]
  availability: 'in_stock'
  price: string
  condition: 'new' | 'refurbished' | 'used'
  product_category: string
  target_countries: string[]
  store_country: string
  is_eligible_search: true
  is_eligible_checkout: false
  gtin?: string
  mpn?: string
}

const TITLE_MAX = 150
const DESCRIPTION_MAX = 5000

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const absolute = (host: string, u: string) => (/^https?:\/\//i.test(u) ? u : u.startsWith('/') ? `${host}${u}` : '')

/**
 * One listing as a feed item, or the reason it is withheld. Withheld: a banned class, no price, no usable image, a
 * placeholder image set (when asked), or a price in another currency than đồng (the feed declares VND).
 */
export function chatgptFeedItem(
  row: ChatgptFeedRow,
  ctx: { host: string; brandName: string | null; excludeMock: boolean },
): { item: ChatgptFeedItem } | { withheld: string } {
  const title0 = clean(row.title) || clean(row.titleVi)
  // Both titles: ChatGPT receives the English one, and either may carry a banned term.
  const refused = feedExcluded(clean(row.titleVi)) || feedExcluded(clean(row.title))
  if (refused) return { withheld: refused }
  if (!(row.price > 0)) return { withheld: 'no_price' }
  if (row.currency && row.currency !== '₫' && row.currency.toUpperCase() !== 'VND') return { withheld: 'not_vnd' }
  if (ctx.excludeMock && isMockImages(row.images)) return { withheld: 'mock_images' }
  const images = row.images.map((u) => absolute(ctx.host, u)).filter(Boolean)
  if (!images.length) return { withheld: 'no_image' }

  const has = (s: string | null | undefined) => !!s && title0.toLowerCase().includes(s.toLowerCase())
  const title = [ctx.brandName && !has(ctx.brandName) ? ctx.brandName : null, row.model && !has(row.model) ? row.model : null, title0]
    .filter(Boolean).join(' ').slice(0, TITLE_MAX)
  // Plain text (listing descriptions may carry markdown), as the Google feed sends it.
  const description = (clean(plainSnippet(row.description || '')) || clean(plainSnippet(row.descriptionVi || '')) || title).slice(0, DESCRIPTION_MAX)
  // ⛔ ONLY AN UNAMBIGUOUS "NEW" IS NEW: "như mới" (like new) and "mới 99%" are the usual words for USED goods in Vietnamese,
  // and a used phone must never reach ChatGPT as new. Everything that is not plainly new or refurbished is used.
  const cond = clean(row.condition).toLowerCase()
  const condition = /^(new|brand new|mới|mới 100%|hàng mới)$/.test(cond) ? 'new' : /refurb|tân trang/.test(cond) ? 'refurbished' : 'used'
  const ident = feedIdentifiers(row)
  const seller = clean(row.seller.name) || 'eno.vn seller'

  return {
    item: {
      item_id: row.id,
      title,
      description,
      url: `${ctx.host}/listings/${row.id}?utm_source=chatgpt&utm_medium=shopping`,
      // The listing's brand when it names one; otherwise "Unbranded" — never the shop's name, which would read as a
      // manufacturer the item does not have (the schema requires the field and refuses null / unknown / n/a).
      brand: ctx.brandName || 'Unbranded',
      seller_name: seller,
      seller_url: `${ctx.host}/sellers/${row.seller.id}`,
      image_url: images[0],
      ...(images.length > 1 ? { additional_image_urls: images.slice(1, 11) } : {}),
      availability: 'in_stock',
      // VND has no minor unit: a whole number of đồng.
      price: `${Math.round(row.price)} VND`,
      condition,
      product_category: [row.category.name, row.subcategorySlug ? row.subcategorySlug.replace(/-/g, ' ') : null].filter(Boolean).join(' > '),
      target_countries: ['VN'],
      store_country: 'VN',
      is_eligible_search: true,
      is_eligible_checkout: false,
      ...(ident.gtin ? { gtin: ident.gtin } : {}),
      ...(ident.mpn ? { mpn: ident.mpn } : {}),
    },
  }
}
