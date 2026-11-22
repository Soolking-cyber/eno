// Client-safe: no imports. The listing guard's refusal codes and sentences (listing-guard.ts runs the check).

export type ListingGuardCode = 'price_required' | 'not_a_listing' | 'price_placeholder' | 'listing_check_limit'
/**
 * The sentence for each refusal, for the native apps and API / MCP / CSV callers (the web wizard words it itself, the same
 * way — post-wizard.tsx). Says what to fix, never the score.
 */
export const LISTING_GUARD_REFUSAL: Record<ListingGuardCode, { en: string; vi: string }> = {
  price_required: { en: 'Enter the real price, at least 1,000 VND. If it’s free, choose Free.', vi: 'Hãy nhập giá thật, từ 1.000 đ trở lên. Nếu miễn phí, hãy chọn Cho tặng.' },
  price_placeholder: { en: 'That price looks like a placeholder — enter your real asking price.', vi: 'Giá này có vẻ chưa phải giá thật — hãy nhập đúng giá bạn muốn bán.' },
  // A storefront past its day's checks (listing-guard.ts JEV_SELLER_DAILY_CAP): held to tomorrow, never let through unchecked.
  listing_check_limit: { en: 'You’ve posted or edited a lot of listings today — try again tomorrow.', vi: 'Hôm nay bạn đã đăng hoặc sửa rất nhiều tin — hãy thử lại vào ngày mai.' },
  not_a_listing: { en: 'This reads like an advert for a business or event. Post one item, place or service you’re offering, with its price.', vi: 'Tin này giống quảng cáo cho cửa hàng hoặc sự kiện. Hãy đăng một món đồ, chỗ ở hoặc dịch vụ cụ thể, kèm giá.' },
}
export const isListingGuardCode = (c: string): c is ListingGuardCode => Object.hasOwn(LISTING_GUARD_REFUSAL, c)
