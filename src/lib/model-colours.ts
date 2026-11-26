/**
 * ⛔ THE MAKER'S OWN COLOURS FOR A MODEL PRICE PAGE (owner, 2026-11-26: "Official colours line"). Seobility's duplicate
 * check ignores numbers, so /price/apple-iphone-13-pro-max and …-17-pro-max — whose words differed only in "13" and "17" —
 * were one page to it (crawl 11), and every listing on them is the same three shops, "used", in HCMC or Hà Nội. The
 * colours are words only that model has, and a buyer's check: a phone in a colour its maker never sold has had its
 * back or frame replaced.
 * ⚠️ READ FROM THE MAKERS' PAGES, NEVER WRITTEN FROM MEMORY (2026-11-26): Apple's tech specs (support.apple.com/en-us/<id>
 * and /vi-vn/<id>, the id beside each row), Samsung's US and VN product pages. `vi` is the Vietnamese page's own spelling —
 * Apple's vi-vn pages for the 11, 12 Pro Max and 13 Pro Max print the English names, so those stay English; the 14 Pro
 * pages print "Gold". Colours added mid-cycle (13 Green / Alpine Green 2022-03-08, 14 Plus Yellow 2023-03) and
 * Samsung's online-only colours are in the list: leaving one out would call a genuine phone repaired.
 * A model missing here keeps the general meeting paragraph (model-price-page.tsx).
 */
export type ModelColours = { en: readonly string[]; vi: readonly string[] }

export const MODEL_COLOURS: Readonly<Record<string, ModelColours>> = {
  // support.apple.com/111865 (vi-vn: English names)
  'apple-iphone-11': { en: ['Black', 'Green', 'Yellow', 'Purple', '(PRODUCT)RED', 'White'], vi: ['Black', 'Green', 'Yellow', 'Purple', '(PRODUCT)RED', 'White'] },
  // 111874 (vi-vn: English names)
  'apple-iphone-12-pro-max': { en: ['Silver', 'Graphite', 'Gold', 'Pacific Blue'], vi: ['Silver', 'Graphite', 'Gold', 'Pacific Blue'] },
  // 111872; Green added 2022-03-08 (Apple Newsroom)
  'apple-iphone-13': { en: ['(PRODUCT)RED', 'Starlight', 'Midnight', 'Blue', 'Pink', 'Green'], vi: ['(PRODUCT)RED', 'Ánh Sao', 'Đêm Xanh Thẳm', 'Xanh Dương', 'Hồng', 'Xanh Lá'] },
  // 111870 (vi-vn: English names); Alpine Green added 2022-03-08
  'apple-iphone-13-pro-max': { en: ['Graphite', 'Gold', 'Silver', 'Sierra Blue', 'Alpine Green'], vi: ['Graphite', 'Gold', 'Silver', 'Sierra Blue', 'Alpine Green'] },
  // 111854; Yellow added 2023-03
  'apple-iphone-14-plus': { en: ['Midnight', 'Purple', 'Starlight', '(PRODUCT)RED', 'Blue', 'Yellow'], vi: ['Đêm Xanh Thẳm', 'Tím', 'Ánh Sao', '(PRODUCT)RED', 'Xanh Dương', 'Vàng'] },
  // 111849
  'apple-iphone-14-pro': { en: ['Space Black', 'Silver', 'Gold', 'Deep Purple'], vi: ['Đen Ánh Thép', 'Bạc', 'Gold', 'Tía Đậm'] },
  // 111846
  'apple-iphone-14-pro-max': { en: ['Space Black', 'Silver', 'Gold', 'Deep Purple'], vi: ['Đen Ánh Thép', 'Bạc', 'Gold', 'Tía Đậm'] },
  // 111831
  'apple-iphone-15': { en: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'], vi: ['Đen', 'Xanh Dương', 'Xanh Lá', 'Vàng', 'Hồng'] },
  // 111830
  'apple-iphone-15-plus': { en: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'], vi: ['Đen', 'Xanh Dương', 'Xanh Lá', 'Vàng', 'Hồng'] },
  // 111829
  'apple-iphone-15-pro': { en: ['Black Titanium', 'White Titanium', 'Blue Titanium', 'Natural Titanium'], vi: ['Titan Đen', 'Titan Trắng', 'Titan Xanh', 'Titan Tự Nhiên'] },
  // 111828
  'apple-iphone-15-pro-max': { en: ['Black Titanium', 'White Titanium', 'Blue Titanium', 'Natural Titanium'], vi: ['Titan Đen', 'Titan Trắng', 'Titan Xanh', 'Titan Tự Nhiên'] },
  // 121029
  'apple-iphone-16': { en: ['Black', 'White', 'Pink', 'Teal', 'Ultramarine'], vi: ['Đen', 'Trắng', 'Hồng', 'Xanh Mòng Két', 'Xanh Lưu Ly'] },
  // 121031
  'apple-iphone-16-pro': { en: ['Black Titanium', 'White Titanium', 'Natural Titanium', 'Desert Titanium'], vi: ['Titan Đen', 'Titan Trắng', 'Titan Tự Nhiên', 'Titan Sa Mạc'] },
  // 121032
  'apple-iphone-16-pro-max': { en: ['Black Titanium', 'White Titanium', 'Natural Titanium', 'Desert Titanium'], vi: ['Titan Đen', 'Titan Trắng', 'Titan Tự Nhiên', 'Titan Sa Mạc'] },
  // 125089
  'apple-iphone-17': { en: ['Black', 'White', 'Mist Blue', 'Sage', 'Lavender'], vi: ['Đen', 'Trắng', 'Xanh Lam Khói', 'Xanh Lá Xô Thơm', 'Tím Oải Hương'] },
  // 125090
  'apple-iphone-17-pro': { en: ['Silver', 'Cosmic Orange', 'Deep Blue'], vi: ['Bạc', 'Cam Vũ Trụ', 'Xanh Đậm'] },
  // 125091
  'apple-iphone-17-pro-max': { en: ['Silver', 'Cosmic Orange', 'Deep Blue'], vi: ['Bạc', 'Cam Vũ Trụ', 'Xanh Đậm'] },
  // samsung.com/us and samsung.com/vn galaxy-s25-ultra; the last three of each are sold online only. Each list is its own
  // page's (the VN page does not map its names to the US ones).
  'samsung-galaxy-s25-ultra': {
    en: ['Titanium Silverblue', 'Titanium Black', 'Titanium Gray', 'Titanium Whitesilver', 'Titanium Jetblack', 'Titanium Jadegreen', 'Titanium Pinkgold'],
    vi: ['Xanh Titan', 'Đen Titan', 'Xám Titan', 'Bạc Titan', 'Đen Tuyền Titan', 'Xanh Ngọc Titan', 'Vàng Hồng Titan'],
  },
  // samsung.com/us and samsung.com/vn galaxy-s26-ultra; the last two of each are sold online only.
  'samsung-galaxy-s26-ultra': {
    en: ['Cobalt Violet', 'Sky Blue', 'Black', 'White', 'Silver Shadow', 'Pink Gold'],
    vi: ['Tím Cobalt', 'Xanh Sky Blue', 'Đen Classic', 'Trắng Classic', 'Bạc Shadow', 'Vàng Hồng'],
  },
}

export function modelColours(slug: string): ModelColours | null {
  return MODEL_COLOURS[slug] ?? null
}
