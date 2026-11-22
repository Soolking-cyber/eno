import { ENO_RUN_SELLER_IDS } from './eno-run-sellers'
import { IS_SERVICES } from './edition'

/**
 * THE PARTNER STRIP'S ROSTER (owner, 2026-11-09: "on top of website and in mobile versions have a strip where partner logos
 * will scroll from right to left 1 word explanation what each does … super professional minimal placement of partners with
 * their official logo"). Rendered by src/components/marketplace/partner-strip.tsx under the home page's header.
 *
 * ⛔ ONLY eno's OFFICIAL PARTNERS — a signed agreement, `Seller.officialPartner` (scripts/set-official-partner.mjs) — and
 * each one links to its own storefront at `/<handle>`. A handle here whose storefront does not exist yet is a dead link on
 * the home page: register the partner (scripts/register-partner-seller.mjs) BEFORE the deploy that lists it.
 *
 * ⛔ THE LOGOS ARE THE PARTNERS' OWN, FROM THEIR OWN SITES (read 2026-11-09), only trimmed to their artwork and, where a
 * tagline or URL line sat under the mark, cut back to the mark (GoPlus's "Kết Nối Tạo Giá Trị Thực", Saigon Moving's
 * "Saigonmoving.com") — at strip height that line is unreadable noise. VietKite's is a white-ground JPEG, its white made
 * transparent. 96 px tall WebP in public/partners/, shown at 18–26 px: 3–5× for any screen.
 *   GoPlus       goplus.com.vn/logo.png
 *   Blvck        thuexemaysaigon.vn/…/Black_Retro_Motorcycle_Circle_Logo__1_-removebg-preview.png (BLVCK_LOGO_URL)
 *   VinWonders   static.vinwonders.com/production/logo_footer.png
 *   VietKite     vietkite.com.vn/wp-content/uploads/2024/12/logo-cty-canh-dieu-viet-vietkite.jpg
 *   Saigon Moving saigonmoving.com/upload/images/Group_6.png
 *
 * ⛔ EDITIONS (CLAUDE.md "EVERY FIX SHIPS TO BOTH SITES", promo-slides.ts): eno.vn promotes VietKite + VinWonders,
 * eno.forum its own visa/trip desk + VinWonders — so VietKite (e-Visa) is `marketplaceOnly`. GMBR left the roster on
 * 2026-11-09 (owner: "remove gmbr account and from strip"). The
 * marketplace partners (rentals, motorbikes, moving) and VinWonders are on both.
 *
 * `label` is ONE word for what the partner does, English + Vietnamese (tr()). `size` is the logo's optical height class:
 * a wide wordmark reads at a shorter height than a square emblem. `dark`: the mark is drawn for a black ground (Blvck's
 * cream "BLVCK" vanishes on white), so its tile is black in both themes.
 */
export type StripPartner = {
  handle: string
  name: string
  logo: { src: string; width: number; height: number }
  label: { en: string; vi: string }
  size: 'wide' | 'square'
  dark?: true
  marketplaceOnly?: true
  /**
   * An ENO-RUN partner (src/lib/eno-run-partners.ts — owner 2026-11-14): it links to `/sellers/<this id>` (an id is never
   * freed and re-claimed the way a handle can be — plan review, codex + opus) and shows ONLY while its (seller, owner) pair
   * is pinned. `handle` is then only the roster key.
   */
  enoRunSellerId?: string
}

export const PARTNER_STRIP: readonly StripPartner[] = [
  { handle: 'goplus', name: 'GoPlus', logo: { src: '/partners/goplus.webp', width: 463, height: 96 }, label: { en: 'Apartments', vi: 'Căn hộ' }, size: 'wide' },
  { handle: 'blvck', name: 'Blvck Motorbike', logo: { src: '/partners/blvck.webp', width: 65, height: 96 }, label: { en: 'Motorbikes', vi: 'Xe máy' }, size: 'square', dark: true },
  { handle: 'saigonmoving', name: 'Saigon Moving', logo: { src: '/partners/saigonmoving.webp', width: 171, height: 96 }, label: { en: 'Moving', vi: 'Chuyển nhà' }, size: 'square' },
  { handle: 'vinwonders', name: 'VinWonders', logo: { src: '/partners/vinwonders.webp', width: 174, height: 96 }, label: { en: 'Tickets', vi: 'Vé tham quan' }, size: 'square' },
  { handle: 'vietkite', name: 'VietKite', logo: { src: '/partners/vietkite.webp', width: 96, height: 96 }, label: { en: 'e-Visa', vi: 'Visa' }, size: 'square', marketplaceOnly: true },
  // Owner 2026-11-14: "partners … make sure the are added to strip". Their marks, from their own sites: CellphoneS' is drawn
  // white (its header is red), so its tile is dark; Điện Thoại Vui's is its wordmark in its brand red (#E41D31) on transparent, cut from its own 4501 px logo file (owner 2026-11-15: the
  // site's header mark is white-on-red and read as a blurry outline on the light tile).
  { handle: 'cellphones', name: 'CellphoneS', logo: { src: '/partners/cellphones.webp', width: 574, height: 96 }, label: { en: 'Gadgets', vi: 'Công nghệ' }, size: 'wide', dark: true, enoRunSellerId: 'cmt78nvif0000gpq48kvzmxjw' },
  { handle: 'dienthoaivui', name: 'Điện Thoại Vui', logo: { src: '/partners/dienthoaivui-v2.webp', width: 799, height: 96 }, label: { en: 'Phones', vi: 'Điện thoại' }, size: 'wide', enoRunSellerId: 'cmtr9qva90000glq44fkjs18b' },
  { handle: 'hoanghamobile', name: 'Hoàng Hà Mobile', logo: { src: '/partners/hoanghamobile.webp', width: 597, height: 96 }, label: { en: 'Phones', vi: 'Điện thoại' }, size: 'wide', enoRunSellerId: 'cmwgyb5m10000rjq4xxjkwwaz' },
  // ShopDunk's mark is its SHOPDUNK wordmark only (2026-11-17): the file it was cut from is the full lockup with Apple's logo and
  // "Authorised Reseller", and eno's strip does not show Apple's mark.
  { handle: 'shopdunk', name: 'ShopDunk', logo: { src: '/partners/shopdunk.webp', width: 865, height: 96 }, label: { en: 'Apple', vi: 'Apple' }, size: 'wide', dark: true, enoRunSellerId: 'cmwgyb5sl0001rjq4yuj9b2sq' },
  // Owner 2026-11-17: "import car rental services … and the shops as partners … partner shops logos make sure they have their
  // logos everywhere where its needed for all partners". The five car rental partners (src/lib/car-partners.ts), each mark from
  // its own site (raw/logo.png of the 11-17 research): Carbi's emblem + wordmark; KarPlus's pale-gold KAR+ on a dark tile;
  // An Khánh's wordmark; Quê Hương's round QH emblem, its two text lines cut (unreadable at strip height). An Bình Tours is held
  // (car-partners.ts `held`): its storefront would be empty, and an empty storefront 404s.
  { handle: 'carbi', name: 'Carbi', logo: { src: '/partners/carbi.webp', width: 129, height: 96 }, label: { en: 'Cars', vi: 'Ô tô' }, size: 'square' },
  { handle: 'karplus', name: 'KarPlus', logo: { src: '/partners/karplus.webp', width: 198, height: 96 }, label: { en: 'Cars', vi: 'Ô tô' }, size: 'square', dark: true },
  { handle: 'ankhanhtravel', name: 'An Khánh Travel', logo: { src: '/partners/ankhanhtravel.webp', width: 554, height: 96 }, label: { en: 'Cars', vi: 'Ô tô' }, size: 'wide' },
  { handle: 'quehuong', name: 'Quê Hương Group', logo: { src: '/partners/quehuong.webp', width: 101, height: 96 }, label: { en: 'Cars', vi: 'Ô tô' }, size: 'square' },
  // …and an official partner the strip had left out (same day): Luật Hoàng Phi's HP mark on its blue, cut from its storefront
  // avatar, corners rounded. ⛔ SDC (sdc_store, a gift shop) is NOT a partner (owner 2026-11-17: "remove sdc store from partners").
  { handle: 'luathoangphi', name: 'Luật Hoàng Phi', logo: { src: '/partners/luathoangphi.webp', width: 96, height: 96 }, label: { en: 'Legal', vi: 'Pháp lý' }, size: 'square' },
  // Owner 2026-11-18: "add them as partners and their apartment listings" — the rental agency Saigon Cribs (apartments, villas,
  // short stays, offices: scripts/import-saigoncribs.ts). Their palm-and-wordmark on its own yellow ground, from their site's
  // logo file (Saigon-Cribs-Logo-revised-black, 2397 px square), cut to the mark with a yellow margin, corners rounded like
  // Luật Hoàng Phi's. ⚠️ Ship this entry only after the import has put listings on /saigoncribs: an empty storefront 404s.
  { handle: 'saigoncribs', name: 'Saigon Cribs', logo: { src: '/partners/saigoncribs.webp', width: 137, height: 96 }, label: { en: 'Homes', vi: 'Nhà ở' }, size: 'square' },
  // Owner 2026-11-18: "add them as a partner for Work permit and TRC issuance". Evisa Saigon's globe-and-EVISA mark from
  // evisasaigon.vn's own LOGO-EVISA file, its white ground made transparent and its "Access and Beyond" line cut (unreadable
  // at strip height). ⚠️ Its two listings are in Legal & permits and go live only after the licence check's approval — ship
  // this entry after that, or the strip links to a storefront with nothing on it.
  { handle: 'evisasaigon', name: 'Evisa Saigon', logo: { src: '/partners/evisasaigon.webp', width: 134, height: 96 }, label: { en: 'Permits', vi: 'Giấy phép' }, size: 'square' },
  // The motorbike rental partners (owner, 2026-11-22; src/lib/moto-partners.ts). The Extra Mile: theextramile.co's
  // theme logo.webp, trimmed. Saigon Scooter Centre: the oval of its cropped-logonew PNG (white lettering, so a dark tile),
  // the side stripes cut back to the mark.
  { handle: 'theextramile', name: 'The Extra Mile', logo: { src: '/partners/theextramile.webp', width: 151, height: 96 }, label: { en: 'Motorbikes', vi: 'Xe máy' }, size: 'square' },
  { handle: 'saigonscootercentre', name: 'Saigon Scooter Centre', logo: { src: '/partners/saigonscootercentre.webp', width: 166, height: 96 }, label: { en: 'Scooters', vi: 'Xe tay ga' }, size: 'square', dark: true },
  // The housing agencies (owner, 2026-11-22; src/lib/housing-partners.ts): Alpha Housing's im_logo_alpha.svg and Housing
  // Saigon's logo.png (housingsgn.com/wp-content/uploads/2023/11/), each trimmed to its artwork.
  { handle: 'alphahousing', name: 'Alpha Housing', logo: { src: '/partners/alphahousing.webp', width: 305, height: 96 }, label: { en: 'Homes', vi: 'Nhà ở' }, size: 'wide' },
  { handle: 'housingsaigon', name: 'Housing Saigon', logo: { src: '/partners/housingsaigon.webp', width: 282, height: 96 }, label: { en: 'Homes', vi: 'Nhà ở' }, size: 'wide' },
]

/** Where a strip entry links: an eno-run partner's storefront by id, every other partner by its handle. */
export function stripHref(p: StripPartner): string {
  return p.enoRunSellerId ? `/sellers/${p.enoRunSellerId}` : `/${p.handle}`
}

/** The partners this edition shows: eno.forum leaves out the visa partner that competes with its own desk. */
export function stripPartners(services: boolean = IS_SERVICES): StripPartner[] {
  const pinned = new Set(ENO_RUN_SELLER_IDS)
  return PARTNER_STRIP.filter((p) => !(services && p.marketplaceOnly) && (!p.enoRunSellerId || pinned.has(p.enoRunSellerId)))
}
