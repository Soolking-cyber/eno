import type { StoreConfig } from './partner-fetch'

/**
 * THE PARTNER SHOPS, AND WHAT WAS MEASURED TO REACH EACH ONE.
 *
 * ⛔ A TypeScript MODULE, NOT scripts/partner-stores.json — AND THE REASON IS THE DEPLOY SHAPE.
 * next.config sets `output: 'standalone'`, which traces IMPORTS to decide what ships in the
 * container. A `readFileSync(process.cwd() + '/scripts/…')` traces to nothing, so the daily cron
 * would have read a file that is not in the image and answered `partner_stores_unreadable` on
 * every run — a job that looks installed, runs nightly, and does nothing. A reviewer caught it
 * before it shipped. Imported, the list is part of the bundle by construction.
 *
 * ⚠️ EVERY `endpoint` HERE WAS PROVEN BY FETCHING TWO REAL PRODUCTS THROUGH IT. A guessed endpoint
 * that 404s is worse than an honest gap, so nothing is listed on inference — each `note` records
 * what was measured, including the ones that cost something to find.
 *
 * ⚠️ `condition` IS A CLAIM ABOUT THE GOODS, taken from that same evidence: `used` where the
 * endpoint is a used/liquidation collection, `new` for the one components retailer, and `null`
 * where the shop exposes no signal at all — which is excluded from both facet chips rather than
 * guessed. See the note on each entry.
 */
export const PARTNER_STORES: StoreConfig[] = [
  {
    "domain": "dienmaysaigon.com",
    "name": "Điện Máy Sài Gòn",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://dienmaysaigon.com/wp-json/wc/store/v1/products?category=2572&per_page=100&page={page}",
    "note": "category 2572 = 'Sản phẩm đã qua sử dụng', the used section the owner's URL (/hang-thanh-ly-hang-da-qua-su-dung/) points at. Woo's tax_query includes descendants, so the children come with it — 7573 Máy Giặt Thanh Lý, 7574 Máy Lạnh Thanh Lý, 8298 Tivi cũ. X-WP-Total 79, and the page returns all 79. Measured 2026-09-10: 6-12 images per product and real prices, though at least one row prices at 0 (a 55\" LG) which feedPrice refuses — that is the guard working, not a gap.",
    "condition": "used"
  },
  {
    "domain": "phuongtin.vn",
    "name": "Phương Tín",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://phuongtin.vn/wp-json/wc/store/v1/products?category=808&per_page=100&page={page}",
    "note": "category 808 = Laptop Cũ. Woo's tax_query includes descendants, so the brand children (809 Dell Cũ, 810 HP Cũ …) come with it. ~183 used laptops.",
    "condition": "used"
  },
  {
    "domain": "thegioiso365.vn",
    "name": "Thế Giới Số 365",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://thegioiso365.vn/wp-json/wc/store/v1/products?category=98&per_page=100&page={page}",
    "note": "category 98 = Laptop Like New, whole brand subtree. X-WP-Total 486 — larger than the term's own count=393 because the filter rolls in children; 486 is what the endpoint actually returns.",
    "condition": "used"
  },
  {
    "domain": "tystore.vn",
    "name": "Ty Store",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://tystore.vn/wp-json/wc/store/v1/products?category=17,21,25,27&per_page=100&page={page}",
    "note": "the four top-level Cũ terms: 17 iPhone, 21 iPad, 25 MacBook, 27 iMac. 68 used of 188 site-wide.",
    "condition": "used"
  },
  {
    "domain": "tuannguyenmobile.com",
    "name": "Tuấn Nguyễn Mobile",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://tuannguyenmobile.com/wp-json/wc/store/v1/products?category=66,178,187,198,245,246,248,250,283,286,306,314,335,338,341&per_page=100&page={page}",
    "note": "15 root-level used/liquidation terms (iPhone Cũ, iPad Cũ, Apple Watch cũ, PlayStation Cũ, Laptop Cũ, Macbook Cũ, Máy Ảnh Cũ, Samsung Cũ …). 489 of the shop's 504.",
    "condition": "used"
  },
  {
    "domain": "banghethanhly.vn",
    "name": "Bàn Ghế Thanh Lý",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://banghethanhly.vn/wp-json/wc/store/v1/products?category=16,17,18,19,20,21,22,23,198,210,211,219,221,222&per_page=100&page={page}",
    "note": "⚠️ THE FILTER IS AN EXCLUSION, NOT AN INCLUSION. The whole shop is liquidation stock, so the useful question is not 'which category is used' but 'which is already SOLD' — category 15 'Đã bán' holds 7,286 of the 11,124. These 14 ids are everything else: 3,764 still available. robots.txt Disallows ?sort= and ?order=; this importer sends neither.",
    "condition": "used"
  },
  {
    "domain": "laptopgiare.vn",
    "name": "Laptop Giá Rẻ",
    "city": "Hồ Chí Minh",
    "adapter": "woocommerce",
    "endpoint": "https://laptopgiare.vn/wp-json/wc/store/products?per_page=100&page={page}",
    "note": "⚠️ NO used signal exists here — all 23 categories are brand/form-factor only, so the whole 101-product catalogue is pulled (23 in stock). Note the path is /wc/store/products, NOT /wc/store/v1/products. ⛔ condition:null DELIBERATELY — the endpoint carries no used/new signal, so asserting either on a marketplace would be a claim about the goods that nothing here supports. A null condition is excluded from BOTH facet chips, which is the honest answer.",
    "condition": null
  },
  {
    "domain": "digiphone.vn",
    "name": "Digiphone",
    "city": "Hồ Chí Minh",
    "adapter": "haravan",
    "endpoint": "https://digiphone.vn/collections/hang-cu/products.json?limit=250&page={page}",
    "note": "⚠️ EXPECT ~45% YIELD, NOT 178. Collection `hang-cu` holds 178 used phones/tablets, but 55% of fetched rows price every variant at \"0\", which the shop's own PDP renders as 'Liên hệ' (call for price). Those are skipped — a 0 price renders as 'Free / Miễn phí' on a card.",
    "condition": "used"
  },
  {
    "domain": "vnlaptop.vn",
    "name": "VN Laptop",
    "city": "Hồ Chí Minh",
    "adapter": "haravan",
    "endpoint": "https://vnlaptop.vn/collections/laptop/products.json?limit=250&page={page}",
    "note": "⚠️ NO used flag exists — all 61 collections enumerated, none carries a cũ/hàng-cũ cue — so this is the whole 113-machine catalogue rather than a used subset. ⛔ condition:null DELIBERATELY — the endpoint carries no used/new signal, so asserting either on a marketplace would be a claim about the goods that nothing here supports. A null condition is excluded from BOTH facet chips, which is the honest answer.",
    "condition": null
  },
  {
    "domain": "hshop.vn",
    "name": "HShop",
    "city": "Hồ Chí Minh",
    "adapter": "sapo",
    "endpoint": "https://hshop.vn/collections/all/products.json?limit=250&page={page}",
    "note": "⚠️ CARRIES NO USED STOCK AT ALL — all 85 collections enumerated, not one has a cũ/thanh lý/like new cue; it is an Arduino/components retailer. Included only because the owner asked for full catalogues (~1,090 products).",
    "condition": "new"
  },
  {
    "domain": "minhtuanmobile.com",
    "name": "Minh Tuấn Mobile",
    "city": "Hồ Chí Minh",
    "adapter": "sitemap-jsonld",
    "endpoint": "",
    "sitemaps": [
      "https://minhtuanmobile.com/sitemap-hang-cu-apple.xml/",
      "https://minhtuanmobile.com/sitemap-hang-cu-other.xml/"
    ],
    "urlMatch": "^https://minhtuanmobile\\.com/(?!sitemap)[^/]+/?$",
    "note": "⚠️ THE TRAILING SLASH ON THE SITEMAP URL IS REQUIRED — without it the server 301s. The shop publishes DEDICATED used sitemaps (hang-cu-apple + hang-cu-other) separate from its new-stock ones, so the used set needs no keyword guessing: 373 Apple + the other file. ⚠️ Product URLs carry a TRAILING SLASH (/iphone-x-cu-dep/) — a [^/]+$ pattern matches none of them.",
    "condition": "used"
  },
  {
    "domain": "mayanh24h.com",
    "name": "Máy Ảnh 24h",
    "city": "Hồ Chí Minh",
    "adapter": "sitemap-jsonld",
    "endpoint": "",
    "sitemaps": [
      "https://mayanh24h.com/sitemap/product/sitemap1.xml",
      "https://mayanh24h.com/sitemap/product/sitemap2.xml",
      "https://mayanh24h.com/sitemap/product/sitemap3.xml",
      "https://mayanh24h.com/sitemap/product/sitemap4.xml",
      "https://mayanh24h.com/sitemap/product/sitemap5.xml",
      "https://mayanh24h.com/sitemap/product/sitemap6.xml"
    ],
    "urlMatch": "-cu$",
    "note": "⚠️ PRODUCT URLs ARE EXTENSIONLESS — https://mayanh24h.com/canon-650d-cu, not .html. A '-cu\\.html$' filter matched 0 of 1,004. Used stock is the '-cu' slug suffix: 144 in file 1, ~850 across all six. The 6 /product/sitemapN.xml paths advertised in robots.txt 404; these come from the /sitemap/sitemap2.xml index. robots.txt blocks ?page= so category pages are not used for discovery.",
    "condition": "used"
  },
  {
    "domain": "didongviet.vn",
    "name": "Di Động Việt",
    "city": "Hồ Chí Minh",
    "adapter": "sitemap-jsonld",
    "endpoint": "",
    "sitemaps": [
      "https://didongviet.vn/product-sitemap1.xml",
      "https://didongviet.vn/product-sitemap2.xml",
      "https://didongviet.vn/product-sitemap3.xml",
      "https://didongviet.vn/product-sitemap4.xml",
      "https://didongviet.vn/product-sitemap5.xml",
      "https://didongviet.vn/product-sitemap6.xml",
      "https://didongviet.vn/product-sitemap7.xml",
      "https://didongviet.vn/product-sitemap8.xml",
      "https://didongviet.vn/product-sitemap9.xml",
      "https://didongviet.vn/product-sitemap10.xml",
      "https://didongviet.vn/product-sitemap11.xml",
      "https://didongviet.vn/product-sitemap12.xml",
      "https://didongviet.vn/product-sitemap13.xml",
      "https://didongviet.vn/product-sitemap14.xml",
      "https://didongviet.vn/product-sitemap15.xml",
      "https://didongviet.vn/product-sitemap16.xml"
    ],
    "urlMatch": "/may-cu-gia-re/",
    "note": "Used stock lives under one exclusive path prefix, /may-cu-gia-re/ — measured across two 500-URL sitemaps with zero used-looking URLs outside it, so the prefix is both complete and exclusive.",
    "condition": "used"
  },
  {
    "domain": "24hstore.vn",
    "name": "24hStore",
    "city": "Hồ Chí Minh",
    "adapter": "sitemap-jsonld",
    "endpoint": "",
    "sitemaps": [
      "https://24hstore.vn/sitemap_products.xml"
    ],
    "urlMatch": "-cu(-\\d+)?-p\\d+$|-cu/",
    "note": "One flat 1.5 MB sitemap, 5,247 product URLs. Used candidates by slug suffix '-cu…-p<id>' OR a category segment ending '-cu': 498 of them. The /hang-cu landing page renders only 130 cards — a merchandised subset, not the catalogue.",
    "condition": "used"
  }
]
