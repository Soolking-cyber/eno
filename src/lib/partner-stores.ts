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
    "domain": "daitailoc.com",
    "name": "Đại Tài Lộc",
    "city": "Hồ Chí Minh",
    "adapter": "sitemap-jsonld",
    "endpoint": "",
    "sitemaps": ["https://daitailoc.com/sitemap-products.xml"],
    "urlMatch": "^https://daitailoc\\.com/[a-z0-9-]+$",
    "note": "⚠️ CONDITION IS UNCLAIMED: the evidence here is prices and JSON-LD, not condition — nothing on these pages says used, and the owner's instruction was \"add all used new doesnt matter\", so no claim is made about the goods. ⛔ THIS SHOP WAS WRONGLY WRITTEN OFF AS 'NO PRICES'. An earlier pass sampled 14 products and found a price on none of them — the real cause was findProductNode comparing `@type` against the bare string 'Product' while these pages publish the FULLY-QUALIFIED `http://schema.org/Product`. With that fixed, 4 of 5 sampled carry a price (e.g. 'Màn hình máy tính LCD VSP V2408S' @ 1,850,000). 4,642 URLs in its own sitemap-products.xml; a stale one 404s here and there, which counts as a failed read rather than a delisting.",
    "condition": null
  },
  {
    "domain": "hoanghamobile.com",
    "name": "Hoàng Hà Mobile",
    "city": "Hồ Chí Minh",
    "adapter": "sitemap-jsonld",
    "endpoint": "",
    "sitemaps": ["https://hoanghamobile.com/sitemap.xml"],
    "urlMatch": "^https://hoanghamobile\\.com/[a-z0-9-]+/[a-z0-9-]+",
    "note": "One flat sitemap, 9,608 URLs, 4 of 5 sampled carry a JSON-LD price. ⚠️ DO NOT FILTER THIS SHOP ON 'cu' — `/cu-sac-day-cap` is 'củ sạc' (a CHARGER), not 'cũ' (used), and a used-only regex matched 251 charger and cable categories while missing the actual stock. Owner, 2026-09-10: \"add all used new doesnt matter\", so the whole catalogue is taken and the condition is left unclaimed.",
    "condition": null
  },
  {
    "domain": "laptoptrunghau.com",
    "name": "Laptop Trung Hậu",
    "city": "Hồ Chí Minh",
    "adapter": "collection-crawl",
    "endpoint": "",
    "collections": [
      "https://laptoptrunghau.com/laptop-cu.htm",
      "https://laptoptrunghau.com/laptop-acer-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-asus-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-dell-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-hp-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-lenovo-ibm-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-msi-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-panasonic-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-samsung-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-sony-vaio-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-surface-cu-gia-re.htm",
      "https://laptoptrunghau.com/laptop-toshiba-cu-gia-re.htm",
      "https://laptoptrunghau.com/macbook-cu-gia-re.htm"
    ],
    "urlMatch": "^https://laptoptrunghau\\.com/[a-z0-9-]+\\.htm$",
    "maxPages": 1,
    "note": "The whole shop is used laptops, and it publishes 13 brand collections under /laptop-cu.htm — all of them are listed because the crawler does not recurse. ⚠️ maxPages 1: the collections carry NO pagination links at all, so asking for page 2 just refetches page 1. ⛔ PRODUCTS AND CATEGORIES SHARE ONE URL SHAPE (both are /<slug>.htm at depth 1) and cannot be told apart by the URL — the JSON-LD check does it instead: a category page has no Product node and drops out, exactly as zshop's about page does. Verified 3 of 4 sampled products carry a price (ASUS X441UVK @ 5,200,000).",
    "condition": "used"
  },
  {
    "domain": "zshop.vn",
    "name": "ZShop",
    "city": "Hồ Chí Minh",
    "adapter": "collection-crawl",
    "endpoint": "",
    "collections": ["https://zshop.vn/kho-hang-cu/"],
    "pageParam": "/page-{n}/",
    "urlMatch": "^https://zshop\\.vn/[a-z0-9-]+\\.html$",
    "note": "The owner's own link: /kho-hang-cu/ is the used warehouse. ⚠️ PAGINATION IS PATH-BASED (/kho-hang-cu/page-2/), not a query string — the default ?page={n} returns page 1 forever, which reads as a shop with 20 products. ⛔ PRODUCTS END IN .html AND CATEGORIES END IN /, which is the only reliable discriminator here: depth alone matches 210 links of which most are category pages. Measured 2026-09-10: 109 product URLs over the first 3 pages; of 6 real products sampled, 4 carry a JSON-LD price (12.99M, 30.99M, 34.99M, 7.5M) and the rest are sold — the importer drops those. Two of the eight sampled .html URLs were an about page and a profile page; they have no Product node and fall out on their own.",
    "condition": "used"
  },
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
