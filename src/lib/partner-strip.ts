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
  // white (its header is red), so its tile is dark; Điện Thoại Vui's red outline reads on the light tile.
  { handle: 'cellphones', name: 'CellphoneS', logo: { src: '/partners/cellphones.webp', width: 574, height: 96 }, label: { en: 'Gadgets', vi: 'Công nghệ' }, size: 'wide', dark: true, enoRunSellerId: 'cmt78nvif0000gpq48kvzmxjw' },
  { handle: 'dienthoaivui', name: 'Điện Thoại Vui', logo: { src: '/partners/dienthoaivui.webp', width: 732, height: 96 }, label: { en: 'Phones', vi: 'Điện thoại' }, size: 'wide', enoRunSellerId: 'cmtr9qva90000glq44fkjs18b' },
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
