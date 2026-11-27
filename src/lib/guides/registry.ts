import { isReleased, releaseDate } from '@/lib/teach-guides/registry'
import { GUIDE_CONTENT } from './content.generated'

/**
 * THE GENERAL GUIDE LIBRARY: guides for renters, shops, landlords and employers, as data, through the same schema, renderer and review gate as the Teach in Vietnam library
 * (src/lib/teach-guides). English lives at /guides/<slug> and Vietnamese at /huong-dan/<slug>: an article is written in one language, so its address says which, and the proxy can pin the
 * language from the path alone without carrying this list into every request (src/lib/lang-pinned.ts).
 *
 * ⛔ NO VISA, ITINERARY OR PAYPAL VOCABULARY, AND NO PERMISSION-TO-STAY VOCABULARY (src/test/edition-words.ts, enforced by guides.test.ts): these are on the licensed marketplace.
 *
 * ⛔ NO REVIEW, NO RELEASE. `reviewed` is the day a person on the eno.vn team approved this guide, and `reviewedDigest` is what they approved (content.ts fails the build if the text has
 * changed since). Drafts are written with AI by eno Reach; a person approves them there, and Google's guidance on AI content asks for exactly that before publishing.
 *
 * Released by date: `published` can be in the future, so one deploy can carry several guides and release them a few at a time. A new domain publishing in bulk reads as scaled production.
 *
 * scripts/carry-guides.mjs brings approved guides over from Reach and owns the generated block below: run it right before a deploy that should take them. It dates each one the day it is carried,
 * never ahead, because a date ahead would let a guide go live long after a person took it back.
 */
export type GuideEntry = {
  slug: string
  lang: 'en' | 'vi'
  /** YYYY-MM-DD: the day it may go live. */
  published: string
  updated?: string
  released?: string
  reviewed?: string
  reviewedDigest?: string
  /** The same article's slug in the other language, when there is one. */
  pair?: string
}

export const GUIDES: readonly GuideEntry[] = [
  // <generated-guides>
  { slug: 'international-driving-permit-vietnam', lang: 'en', published: '2026-11-05', updated: '2026-11-05', released: '2026-11-05', reviewed: '2026-11-05', reviewedDigest: 'd8dac8a4a78173f7', pair: 'bang-lai-xe-quoc-te-lai-xe-o-viet-nam' },
  { slug: 'thue-xe-dien-vinfast-tphcm', lang: 'vi', published: '2026-11-05', updated: '2026-11-13', released: '2026-11-05', reviewed: '2026-11-13', reviewedDigest: '5d7845cc1c427b2a', pair: 'vinfast-electric-scooter-and-car-rental-ho-chi-minh-city' },
  { slug: 'thue-xe-may-sai-gon-kinh-nghiem', lang: 'vi', published: '2026-11-06', updated: '2026-11-23', released: '2026-11-06', reviewed: '2026-11-23', reviewedDigest: 'c13c8c5900265fd6', pair: 'renting-a-motorbike-in-ho-chi-minh-city' },
  { slug: 'renting-a-motorbike-in-vietnam', lang: 'en', published: '2026-11-09', updated: '2026-11-26', released: '2026-11-09', reviewed: '2026-11-26', reviewedDigest: '579c8a11936cc865', pair: 'kinh-nghiem-thue-xe-may-viet-nam' },
  { slug: 'hire-a-foreign-english-teacher-in-vietnam', lang: 'en', published: '2026-11-11', reviewed: '2026-11-10', reviewedDigest: '5d30667cfa1c568d', pair: 'tuyen-giao-vien-nuoc-ngoai-day-tieng-anh' },
  { slug: 'renting-to-foreigners-ho-chi-minh-city', lang: 'en', published: '2026-11-11', reviewed: '2026-11-11', reviewedDigest: 'dbd431d0b65a0218', pair: 'cho-nguoi-nuoc-ngoai-thue-nha-tphcm' },
  { slug: 'tuyen-giao-vien-nuoc-ngoai-day-tieng-anh', lang: 'vi', published: '2026-11-11', reviewed: '2026-11-11', reviewedDigest: 'c3d368790e7d83e6', pair: 'hire-a-foreign-english-teacher-in-vietnam' },
  { slug: 'cho-nguoi-nuoc-ngoai-thue-nha-tphcm', lang: 'vi', published: '2026-11-12', reviewed: '2026-11-12', reviewedDigest: '952d761221728279', pair: 'renting-to-foreigners-ho-chi-minh-city' },
  { slug: 'kinh-nghiem-thue-xe-may-viet-nam', lang: 'vi', published: '2026-11-12', updated: '2026-11-23', released: '2026-11-12', reviewed: '2026-11-23', reviewedDigest: '5bfa47feec18fedb', pair: 'renting-a-motorbike-in-vietnam' },
  { slug: 'vinfast-electric-scooter-and-car-rental-ho-chi-minh-city', lang: 'en', published: '2026-11-12', reviewed: '2026-11-12', reviewedDigest: 'dce10898cc7119b1', pair: 'thue-xe-dien-vinfast-tphcm' },
  { slug: 'bang-lai-xe-quoc-te-lai-xe-o-viet-nam', lang: 'vi', published: '2026-11-13', updated: '2026-11-26', released: '2026-11-13', reviewed: '2026-11-26', reviewedDigest: '5de888e8e05d418a', pair: 'international-driving-permit-vietnam' },
  { slug: 'thue-xe-o-to-tu-lai-hay-co-tai-xe-tphcm', lang: 'vi', published: '2026-11-17', updated: '2026-11-18', released: '2026-11-17', reviewed: '2026-11-18', reviewedDigest: '68e1a40dcb3ad2f1', pair: 'car-rental-with-driver-ho-chi-minh-city' },
  { slug: 'car-rental-with-driver-ho-chi-minh-city', lang: 'en', published: '2026-11-17', updated: '2026-11-18', released: '2026-11-17', reviewed: '2026-11-18', reviewedDigest: '998944e862acb9aa', pair: 'thue-xe-o-to-tu-lai-hay-co-tai-xe-tphcm' },
  { slug: 'renting-a-motorbike-in-ho-chi-minh-city', lang: 'en', published: '2026-11-18', updated: '2026-11-23', released: '2026-11-18', reviewed: '2026-11-23', reviewedDigest: '15d2e74b11c48e6c', pair: 'thue-xe-may-sai-gon-kinh-nghiem' },
  { slug: 'hieu-truong-phai-biet-tieng-anh-thong-tu-94', lang: 'vi', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: '7af513a9f6b99a10', pair: 'vietnam-school-leaders-english-requirements' },
  { slug: 'saigonmoving', lang: 'en', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: '7f8a13e55afda67e' },
  { slug: 'tuyen-giao-vien-nuoc-ngoai', lang: 'vi', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: 'aea55f964498b609' },
  { slug: 'vietnam-school-leaders-english-requirements', lang: 'en', published: '2026-11-18', reviewed: '2026-11-18', reviewedDigest: '6e97925fe752ec81', pair: 'hieu-truong-phai-biet-tieng-anh-thong-tu-94' },
  { slug: 'mua-iphone-o-viet-nam-co-re-hon-khong', lang: 'vi', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: '114e27d673d69420', pair: 'is-it-cheaper-to-buy-iphone-in-vietnam' },
  { slug: 'is-it-cheaper-to-buy-iphone-in-vietnam', lang: 'en', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: 'e0c124aa9c5dbdbc', pair: 'mua-iphone-o-viet-nam-co-re-hon-khong' },
  { slug: 'rent-your-apartment-to-foreigners-ho-chi-minh-city', lang: 'en', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: 'de3f0b715cf2b9d1', pair: 'cho-thue-can-ho-nguoi-nuoc-ngoai-tphcm' },
  { slug: 'apartment-for-rent-in-tay-ho', lang: 'en', published: '2026-11-19', updated: '2026-11-26', released: '2026-11-19', reviewed: '2026-11-26', reviewedDigest: '8ad9843cd2d6e4fe', pair: 'thue-can-ho-tay-ho' },
  { slug: 'thue-can-ho-tay-ho', lang: 'vi', published: '2026-11-19', updated: '2026-11-26', released: '2026-11-19', reviewed: '2026-11-26', reviewedDigest: '5d457955344c0d0c', pair: 'apartment-for-rent-in-tay-ho' },
  { slug: 'cho-thue-can-ho-nguoi-nuoc-ngoai-tphcm', lang: 'vi', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: '22340f421f89b8bb', pair: 'rent-your-apartment-to-foreigners-ho-chi-minh-city' },
  { slug: 'cheapest-phone-in-vietnam', lang: 'en', published: '2026-11-20', reviewed: '2026-11-20', reviewedDigest: '8089f9197ac84737', pair: 'dien-thoai-gia-re-nhat-viet-nam' },
  { slug: 'dien-thoai-gia-re-nhat-viet-nam', lang: 'vi', published: '2026-11-20', reviewed: '2026-11-20', reviewedDigest: '77ce25d1dec477e2', pair: 'cheapest-phone-in-vietnam' },
  { slug: 'gia-thue-nha-tphcm-theo-quan', lang: 'vi', published: '2026-11-20', updated: '2026-11-26', released: '2026-11-20', reviewed: '2026-11-26', reviewedDigest: '08b0c3e7ad976cc8', pair: 'rent-prices' },
  { slug: 'rent-prices', lang: 'en', published: '2026-11-20', reviewed: '2026-11-20', reviewedDigest: '8b69cd20f37da914', pair: 'gia-thue-nha-tphcm-theo-quan' },
  { slug: 'buy-iphone-in-vietnam', lang: 'en', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: 'f6ec19a4ed19895f', pair: 'mua-iphone-chinh-hang-o-dau-uy-tin' },
  { slug: 'mua-dien-thoai-o-dau-uy-tin', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '35ca5ccfe75f3c58', pair: 'buy-phone-in-vietnam' },
  { slug: 'english-teaching-jobs-in-ho-chi-minh-city', lang: 'en', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: 'd8ec140b05cd315c', pair: 'viec-lam-giao-vien-tieng-anh-tphcm' },
  { slug: 'viec-lam-giao-vien-tieng-anh-tphcm', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '6df66ad202e60e3d', pair: 'english-teaching-jobs-in-ho-chi-minh-city' },
  { slug: 'mua-dien-thoai-gia-re-o-dau', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '7d9de566272b5e0a', pair: 'cheap-phones-in-vietnam' },
  { slug: 'buy-phone-in-vietnam', lang: 'en', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: 'aa3ce07b0d9d4d4e', pair: 'mua-dien-thoai-o-dau-uy-tin' },
  { slug: 'cheap-phones-in-vietnam', lang: 'en', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: 'c33f12bdc455655e', pair: 'mua-dien-thoai-gia-re-o-dau' },
  { slug: 'giao-vien-ban-ngu-tieng-anh-tphcm', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '9693af977589ccc4' },
  { slug: 'luong-giao-vien-tieng-anh-tphcm', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: 'eba6da825eba1471' },
  { slug: 'international-schools-in-ho-chi-minh-city', lang: 'en', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: 'd879792c2452350f', pair: 'truong-quoc-te-tphcm' },
  { slug: 'truong-quoc-te-tphcm', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '89c6cae328a6f30c', pair: 'international-schools-in-ho-chi-minh-city' },
  { slug: 'mua-iphone-chinh-hang-o-dau-uy-tin', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '8863fa9b3cb4c266', pair: 'buy-iphone-in-vietnam' },
  { slug: 'mua-sofa-cu-tphcm', lang: 'vi', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '6398c220b02d9ea3', pair: 'used-sofa' },
  { slug: 'used-sofa', lang: 'en', published: '2026-11-22', reviewed: '2026-11-22', reviewedDigest: '65caa06d720e0421', pair: 'mua-sofa-cu-tphcm' },
  { slug: 'ho-chi-minh-city-districts', lang: 'en', published: '2026-11-23', reviewed: '2026-11-23', reviewedDigest: '35282e64a685afe0', pair: 'cac-quan-tphcm-nen-thue-nha-o-dau' },
  { slug: 'cac-quan-tphcm-nen-thue-nha-o-dau', lang: 'vi', published: '2026-11-23', reviewed: '2026-11-23', reviewedDigest: '4ab9182adabefb1f', pair: 'ho-chi-minh-city-districts' },
  { slug: '42-inch-tv-dimensions', lang: 'en', published: '2026-11-23', reviewed: '2026-11-23', reviewedDigest: 'd51378368e7c6c67', pair: 'kich-thuoc-tivi-42-inch' },
  { slug: 'what-is-a-lease', lang: 'en', published: '2026-11-23', updated: '2026-11-26', released: '2026-11-23', reviewed: '2026-11-26', reviewedDigest: '346a10d63a6a05ea', pair: 'hop-dong-thue-la-gi-ben-cho-thue-ben-thue' },
  { slug: 'hop-dong-thue-la-gi-ben-cho-thue-ben-thue', lang: 'vi', published: '2026-11-23', updated: '2026-11-26', released: '2026-11-23', reviewed: '2026-11-26', reviewedDigest: '3a20557ae026cd96', pair: 'what-is-a-lease' },
  { slug: 'kich-thuoc-tivi-42-inch', lang: 'vi', published: '2026-11-23', reviewed: '2026-11-23', reviewedDigest: '3c197a5c64b75be7', pair: '42-inch-tv-dimensions' },
  { slug: 'district-1-ho-chi-minh-city', lang: 'en', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: '30b562a13d4386b1', pair: 'quan-1-tphcm-thue-can-ho' },
  { slug: 'thue-nha-quan-7-phu-my-hung', lang: 'vi', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: '98c5ead66c9374df', pair: 'district-7-ho-chi-minh-city' },
  { slug: 'district-7-ho-chi-minh-city', lang: 'en', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: 'ff9c9d4e55041fea', pair: 'thue-nha-quan-7-phu-my-hung' },
  { slug: 'quan-1-tphcm-thue-can-ho', lang: 'vi', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: 'bc0c44c4ad65fbeb', pair: 'district-1-ho-chi-minh-city' },
  { slug: 'danh-gia-noi-lam-viec-giao-vien-tphcm', lang: 'vi', published: '2026-11-24', reviewed: '2026-11-24', reviewedDigest: 'b727e408f72dd820', pair: 'best-schools-to-work-for-in-ho-chi-minh-city' },
  { slug: 'best-schools-to-work-for-in-ho-chi-minh-city', lang: 'en', published: '2026-11-24', reviewed: '2026-11-24', reviewedDigest: '6661dcc4cdad6154', pair: 'danh-gia-noi-lam-viec-giao-vien-tphcm' },
  { slug: 'nha-hat-vinpearl-ocean-city-ve-dat-nuoc-thien-hung-ca', lang: 'vi', published: '2026-11-24', reviewed: '2026-11-24', reviewedDigest: 'dacd4f67ccff901c', pair: 'vinpearl-theatre-ocean-city' },
  { slug: 'vinpearl-theatre-ocean-city', lang: 'en', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: 'adf3e9857db7c0b1', pair: 'nha-hat-vinpearl-ocean-city-ve-dat-nuoc-thien-hung-ca' },
  { slug: 'hp-vs-lenovo-used-laptop', lang: 'en', published: '2026-11-24', reviewed: '2026-11-24', reviewedDigest: '1089641c89165ddc', pair: 'nen-mua-laptop-cu-hp-hay-lenovo' },
  { slug: 'cho-thue-can-ho-tphcm', lang: 'vi', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: 'efd2008c0a7844cd', pair: 'apartments-for-rent-ho-chi-minh-city-by-district' },
  { slug: 'apartments-for-rent-ho-chi-minh-city-by-district', lang: 'en', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: '68462dac155d580c', pair: 'cho-thue-can-ho-tphcm' },
  { slug: '14-inch-vs-15-6-inch-laptop', lang: 'en', published: '2026-11-24', reviewed: '2026-11-24', reviewedDigest: '7bec54ae612973a7', pair: 'nen-mua-laptop-14-inch-hay-15-6-inch' },
  { slug: 'nen-mua-laptop-14-inch-hay-15-6-inch', lang: 'vi', published: '2026-11-24', updated: '2026-11-26', released: '2026-11-24', reviewed: '2026-11-26', reviewedDigest: '3522b0f7b1e97805', pair: '14-inch-vs-15-6-inch-laptop' },
  { slug: 'nen-mua-laptop-cu-hp-hay-lenovo', lang: 'vi', published: '2026-11-24', reviewed: '2026-11-24', reviewedDigest: '23db10ad2b5ed461', pair: 'hp-vs-lenovo-used-laptop' },
  { slug: 'mau-sac-samsung-s26-ultra', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '5346500cb1fde0b2', pair: 'samsung-galaxy-s26-ultra-colors' },
  { slug: 'kich-thuoc-laptop-14-inch-bao-nhieu-cm', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '87f34440718c4b9b', pair: 'how-big-is-a-14-inch-laptop' },
  { slug: 'freedos-laptop', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: 'dc1d7275edc2a9b8', pair: 'laptop-free-dos-co-nen-mua' },
  { slug: 'nen-mua-dell-inspiron-hay-vostro', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '3be0cd5f4f2b1346', pair: 'dell-inspiron-vs-vostro' },
  { slug: 'dell-inspiron-vs-vostro', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '482f01f4ed25bfe3', pair: 'nen-mua-dell-inspiron-hay-vostro' },
  { slug: '55-inch-4k-tv-price-vietnam', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: 'fc0904dbd4ba8b08', pair: 'mua-tivi-4k-55-inch' },
  { slug: 'how-big-is-a-14-inch-laptop', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: 'a229e81db1ea312e', pair: 'kich-thuoc-laptop-14-inch-bao-nhieu-cm' },
  { slug: 'hp-pavilion-3168ngw-la-gi-cau-hinh-gia', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: 'ee7eb82741c33e7b', pair: 'hp-pavilion-3168ngw-specs' },
  { slug: 'hp-pavilion-3168ngw-specs', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '2a1ff008897d3242', pair: 'hp-pavilion-3168ngw-la-gi-cau-hinh-gia' },
  { slug: 'laptop-free-dos-co-nen-mua', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '8921f572c2a89180', pair: 'freedos-laptop' },
  { slug: 'mua-tivi-4k-55-inch', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '093d9b074854652e', pair: '55-inch-4k-tv-price-vietnam' },
  { slug: 'samsung-galaxy-s26-ultra-colors', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '77c622b928d0f2c4', pair: 'mau-sac-samsung-s26-ultra' },
  { slug: 'thue-chung-cu-tphcm', lang: 'vi', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: '7f24c229b0ab1954', pair: 'how-to-find-an-apartment-in-ho-chi-minh-city' },
  { slug: 'how-to-find-an-apartment-in-ho-chi-minh-city', lang: 'en', published: '2026-11-26', reviewed: '2026-11-26', reviewedDigest: 'ad439e22463ffab5', pair: 'thue-chung-cu-tphcm' },
  // </generated-guides>
  // ⚠️ NOT FROM REACH, SO OUTSIDE THE GENERATED BLOCK: the owner approved this text in chat on 2026-11-19 ("blog post in eno.vn deploy so when someone searches
  // for muaban.net alternative on google we pop up"), after reading it. scripts/carry-guides.mjs owns only the block above and never reads or rewrites these lines.
  // Fact-check before release (same day): unsourced competitor claims removed (Batdongsan row, a superlative, Marketplace seller history). The digest still guards them: edit the JSON and the build stops until a person approves the new text and the digest here is updated.
  { slug: 'muaban-net-alternative', lang: 'en', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: 'e631d1d28fe72b4f', pair: 'thay-the-muaban-net-dang-tin-mien-phi' },
  { slug: 'thay-the-muaban-net-dang-tin-mien-phi', lang: 'vi', published: '2026-11-19', reviewed: '2026-11-19', reviewedDigest: '6052a59772ad393a', pair: 'muaban-net-alternative' },
]

export const GUIDE_BASE = { en: '/guides', vi: '/huong-dan' } as const
export const guidePath = (e: Pick<GuideEntry, 'slug' | 'lang'>) => `${GUIDE_BASE[e.lang]}/${e.slug}`
export const guideEntry = (slug: string, entries: readonly GuideEntry[] = GUIDES) => entries.find((e) => e.slug === slug) ?? null

/** Its link text and one line: the guide's own heading and description, so no word on a hub or in llms.txt is outside what a person reviewed. */
const docOf = (slug: string) => (Object.prototype.hasOwnProperty.call(GUIDE_CONTENT, slug) ? (GUIDE_CONTENT[slug] as { h1?: string; description?: string }) : undefined)
export const guideLabel = (e: Pick<GuideEntry, 'slug'>) => docOf(e.slug)?.h1 ?? e.slug
export const guideBlurb = (e: Pick<GuideEntry, 'slug'>) => docOf(e.slug)?.description ?? ''

/** Reviewed, its day reached, and its text in the build. */
export function isGuideLive(e: GuideEntry, now: Date = new Date(), content: Readonly<Record<string, unknown>> = GUIDE_CONTENT): boolean {
  return isReleased(e, now) && Object.prototype.hasOwnProperty.call(content, e.slug)
}
export const liveGuides = (now: Date = new Date()) => GUIDES.filter((e) => isGuideLive(e, now))

/** The article's dates: the day it really went live, and a reader-visible edit if there was one. */
export function guideDates(e: GuideEntry): { published: string; updated?: string } {
  const published = releaseDate(e)
  // An edit made before it went live is not an update: a page must never say it was modified before it was published.
  return { published, ...(e.updated && e.updated > published ? { updated: e.updated } : {}) }
}
