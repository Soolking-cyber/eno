import { decodeEntities } from '@/lib/feed-text'
import type { NewAppleLine, NewAppleShop } from '@/lib/new-apple'

/**
 * ── THE WORDS OF A NEW-APPLE LISTING, WRITTEN BY CODE ───────────────────────────────────────────────────────────────
 *
 * No machine translation and no model (src/lib/new-apple.ts): the English and Vietnamese text is built here from the shop's
 * product name and the facts the site can stand behind — new, which shop lists it, how buying works, that we may earn.
 * ⛔ NO SITE NAME: the row is shared by both editions (one database), so the text never says "eno.vn" (commit gate, opus).
 * ⛔ NO PRICE IN THE TEXT. The nightly changes the price; a sentence quoting one would go stale the first night.
 * ⛔ "CHÍNH HÃNG" ONLY WHEN THE SHOP SAYS IT. CellphoneS writes "| Chính hãng Apple Việt Nam" on its Macs; ShopDunk and Hoàng Hà's
 * iPhone 18 names say nothing, and the listing does not claim for them what their own title does not.
 * ⚠️ Long enough to be indexed: an import under 200 characters of description is noindexed (src/lib/thin-import.ts), and every
 * row's text differs by its own title (src/lib/duplicate-import.ts compares within a storefront).
 */

const clean = (s: string) => decodeEntities(s).normalize('NFC').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim()

/** The shop says it is Apple Vietnam stock (the VN/A distribution). */
const saysGenuine = (name: string) => /chính\s*hãng|(?<![\p{L}])VN\/A(?![\p{L}])/iu.test(name)

const VI_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu

/**
 * The English title: the shop's name without its Vietnamese parts. "| Chính hãng Apple Việt Nam" goes (the claim moves to the
 * description, in words); "Sạc 70W" becomes "70W charger". Anything still Vietnamese is cut at its " | " / " - " separator, and
 * a title that would still carry a Vietnamese letter falls back to the model and the tiers it names.
 */
function englishTitle(rawName: string): string {
  let t = clean(rawName)
    .replace(/\s*[|\-–]\s*chính\s*hãng(?:\s*apple)?(?:\s*việt\s*nam)?(?:\s*\(?VN\/A\)?)?\s*$/iu, '')
    .replace(/(?<![\p{L}])sạc\s*nhanh\s*(\d+\s*W)(?![\p{L}])/giu, '$1 fast charger')
    .replace(/(?<![\p{L}])sạc\s*(\d+\s*W)(?![\p{L}])/giu, '$1 charger')
    .replace(/(?<![\p{L}])(?:màn|mặt kính)\s*nano(?![\p{L}])/giu, 'Nano-texture')
    .replace(/(?<![\p{L}])macbook(?![\p{L}])/giu, 'MacBook')
    .replace(/(?<![\p{L}])imac(?![\p{L}])/giu, 'iMac')
    .replace(/(?<![\p{L}])iphone(?![\p{L}])/giu, 'iPhone')
    .trim()
  if (VI_LETTER.test(t)) t = t.split(/\s+[|]\s+|\s+-\s+/).filter((p) => !VI_LETTER.test(p)).join(' - ').trim()
  if (!t || VI_LETTER.test(t)) return clean(rawName).replace(VI_LETTER, '').replace(/\s+/g, ' ').trim()
  return t
}

export type NewAppleText = { title: string; titleVi: string; description: string; descriptionVi: string }

function describe(input: { name: string; line: NewAppleLine; shop: Pick<NewAppleShop, 'name'> }): NewAppleText {
  const { line, shop } = input
  const name = clean(input.name)
  const title = englishTitle(name).slice(0, 180)
  const titleVi = name.slice(0, 180)
  const genuine = saysGenuine(name)
  const thing = line.kind === 'iphone' ? 'phone' : 'Mac'
  const thingVi = line.kind === 'iphone' ? 'máy' : 'máy'
  const description = [
    `${title}: new${genuine ? ', Apple Vietnam (VN/A) stock' : ''}, listed by ${shop.name}.`,
    `To buy it, message ${shop.name} on this page. The chat gives you a Buy now link to ${shop.name}'s own page for this ${thing}, and you can ask there about colours, stock and delivery.`,
    `The price is the shop's and it can change: the chat and the shop's page show the current one. We may earn a commission when you buy through the Buy now link.`,
  ].join('\n\n')
  const descriptionVi = [
    `${titleVi}: hàng mới${genuine ? ', chính hãng Apple Việt Nam (VN/A)' : ''}, do ${shop.name} đăng bán.`,
    `Để mua, hãy nhắn tin cho ${shop.name} ngay trên trang này. Trong cuộc trò chuyện bạn sẽ nhận được nút Mua ngay dẫn tới trang của ${shop.name} cho ${thingVi} này, và có thể hỏi thêm về màu, tồn kho và giao hàng.`,
    `Giá do cửa hàng đặt và có thể thay đổi: giá hiện tại có trong cuộc trò chuyện và trên trang của cửa hàng. Chúng tôi có thể nhận hoa hồng khi bạn mua qua nút Mua ngay.`,
  ].join('\n\n')
  return { title, titleVi, description, descriptionVi }
}

export const newAppleText = { englishTitle, describe, saysGenuine }

/**
 * Apple Vietnam's entry price per iPhone line (src/app/[lang]/iphone-18-vietnam/price-guard.ts APPLE_VN_FROM_PRICE — a test
 * holds the two equal). A shop row outside [0.8×, 3×] of it is a typo, a deposit or an accessory, never a phone.
 */
export const APPLE_VN_FROM: Readonly<Record<string, number>> = {
  'iPhone 18 Pro': 38_999_000,
  'iPhone 18 Pro Max': 41_999_000,
  'iPhone Duo': 64_999_000,
}

/** Macs: the cheapest current Mac is the MacBook Neo (18,490,000 ₫ at Hoàng Hà), the dearest a Mac Studio M5 Ultra (158,990,000 ₫). */
const MAC_BAND = { min: 12_000_000, max: 250_000_000 }

export function plausibleNewPrice(line: NewAppleLine, price: number): boolean {
  if (!Number.isFinite(price) || price <= 0) return false
  if (line.kind === 'mac') return price >= MAC_BAND.min && price <= MAC_BAND.max
  const from = APPLE_VN_FROM[line.model]
  return !!from && price >= from * 0.8 && price <= from * 3
}

/** A night's new price against the stored one: a move of more than 40 % either way is read as UNKNOWN, never written. */
export const plausibleMove = (stored: number, next: number) => stored > 0 && next >= stored * 0.6 && next <= stored * 1.4

export { VI_LETTER as NEW_APPLE_VI_LETTER }
