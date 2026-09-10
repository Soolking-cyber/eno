import 'server-only'
import crypto from 'crypto'
import { IS_SERVICES } from '@/lib/edition'

// Shared config for the product feeds (Google Merchant Center + Meta/Facebook catalog).
// Both platforms accept PHYSICAL PRODUCTS only — rentals, jobs, services, events,
// tickets and property aren't products, so feeding them flags the whole feed. Restrict
// to the sellable retail categories, and to listingType 'sell'.
export const FEED_CATEGORIES = [
  'electronics', 'fashion-beauty', 'vehicles', 'furniture-appliances',
  'baby-kids', 'hobbies-sports', 'pets', 'food-drink', 'moving-sale',
]

/**
 * THE CATEGORIES THIS DEPLOYMENT MAY PUT IN AN AD CATALOGUE.
 *
 * ⛔ `services` IS ADDED ON eno.forum AND NEVER ON eno.vn, AND THAT ASYMMETRY IS THE WHOLE REASON
 * THIS FUNCTION EXISTS RATHER THAN A SECOND CONSTANT. The route comments call the omission of
 * 'services' a licensing guarantee for the licensed sàn TMĐT — "re-categorise ONE product and eno's
 * e-Visa service enters the licensed company's live Merchant Center / Meta ad catalog" — and that
 * stays exactly true. eno.forum is the deployment that MAY sell visa and trip services, and the
 * owner asked for its catalogue (2026-08-18: "we need eno forum catalogue too"), so the same feed
 * has to answer differently there.
 *
 * ⚠️ `IS_SERVICES` IS A BUILD-TIME CONSTANT, so the marketplace artifact folds this to the bare
 * FEED_CATEGORIES list. The guarantee is not a runtime branch someone can flip with an env var.
 *
 * ⚠️ WHAT THIS DOES NOT CHANGE: `scopedListingWhere` still runs on both editions, `verified: true`
 * and `status: 'active'` still apply, and the marketplace still excludes the desk's seller. Adding
 * a category widens what eno.forum MAY advertise; it removes none of the other filters.
 *
 * ⚠️ AND META/GOOGLE TREAT SERVICES DIFFERENTLY FROM GOODS. The header above is right that both
 * platforms are built for physical products — a service catalogue is accepted but is the platform's
 * looser path, so expect more manual review on eno.forum's items than on ordinary retail.
 */
export function feedCategories(): string[] {
  return IS_SERVICES ? [...FEED_CATEGORIES, 'services'] : FEED_CATEGORIES
}

/**
 * The `listingType` values this deployment may put in an ad catalogue.
 *
 * ⛔ THERE ARE TWO INDEPENDENT GUARDS, NOT ONE, AND MISSING THIS SECOND ONE IS WHY THE FORUM FEED
 * STAYED EMPTY AFTER `services` WAS ADDED ABOVE. The route comment states both plainly —
 * "FEED_CATEGORIES omits 'services' AND the desk's rows are listingType 'service'" — and they are
 * belt and braces: either alone keeps visa products out of eno.vn's catalogue. Widening one and
 * declaring victory produced a feed that still returned a bare header, which is exactly the kind of
 * "shipped and silently does nothing" result a 200 response hides.
 *
 * ⚠️ eno.vn KEEPS `['sell']` AND ONLY THAT. A service is not a product on either platform, and on
 * the licensed sàn TMĐT it is also the thing that may not be advertised at all. Both reasons point
 * the same way, so this list must never grow on the marketplace side.
 */
export function feedListingTypes(): string[] {
  return IS_SERVICES ? ['sell', 'service'] : ['sell']
}

// Our top-level categories → Google product taxonomy IDs (broad + safe; the platform
// refines from title/description). Meta's catalog also accepts the Google taxonomy id
// in google_product_category. Omitted categories let the platform auto-categorize.
export const GOOGLE_PRODUCT_CATEGORY: Record<string, string> = {
  electronics: '222',            // Electronics
  'fashion-beauty': '166',       // Apparel & Accessories
  vehicles: '888',               // Vehicles & Parts
  'furniture-appliances': '536', // Home & Garden
  'baby-kids': '537',            // Baby & Toddler
  'hobbies-sports': '988',       // Sporting Goods
  pets: '1',                     // Animals & Pet Supplies
  'food-drink': '422',           // Food, Beverages & Tobacco
  'moving-sale': '536',          // Home & Garden (whole-home liquidations)
}

// A listing seeded with mock images (picsum / loremflickr) is TEST data. Excluded from
// a feed when ?exclude_mock=1 (or env CATALOG_EXCLUDE_MOCK=true), so paid catalog ads
// never run against fake products. Default OFF so the initial catalog import still works.
// ── Ad-catalogue exclusions ──────────────────────────────────────────────────
/**
 * ⛔ LEGAL TO SELL ON eno, BANNED FROM AN AD CATALOGUE. THIS IS NOT MODERATION AND MUST NEVER
 * BECOME IT. `src/lib/ai-moderation.ts` and the publish guard block goods that are ILLEGAL IN
 * VIETNAM — drugs, weapons, wildlife, vape, Rx medicine, counterfeits — cited to Weapons Law
 * 42/2024, Resolution 173/2024, the Pharmacy Law and CITES. Everything below is lawful to sell
 * here and stays visible, searchable and buyable on the site. It is excluded from the FEED alone,
 * because Meta's and Google's commerce policies refuse these classes regardless of local legality.
 *
 * ⚠️ MEASURED, NOT GUESSED. Every rule comes from the 118 items Meta actually rejected out of the
 * 69,812 in catalogue 1023045203452456 on 2026-09-10 — glucose meters and test strips, blood
 * pressure monitors, thermometers, nebulisers, breast pumps, TENS units, cupping sets, orthopaedic
 * braces, raw pork/chicken/beef/fish, live lobster, bras and briefs, detox powders, whisky, and
 * NexGard for dogs. A rejected product is not merely unshown: enough of them puts the whole
 * catalogue's standing at risk on an account that is actively spending.
 *
 * ⚠️ ONE LIST SERVES BOTH ROUTES. Google Shopping bans the same classes, so facebook-catalog and
 * google-shopping call `feedExcluded()` at the same point in their row loops. Adding a rule here
 * takes effect on both; adding it to one route only is how the two feeds drift apart.
 *
 * ⚠️ OVER-BLOCKING IS THE CHEAPER MISTAKE and the rules are deliberately broad — `massage` catches
 * massage guns and chairs that would sell fine, `tri lieu` catches anything calling itself
 * therapy, and `y te` takes khẩu trang / găng tay / bông y tế along with the diagnostics.
 * A skipped listing loses one ad impression; a policy strike costs the catalogue. Do not narrow a
 * rule to recover inventory without checking what it re-admits.
 */
/**
 * ⛔ EVERY TERM IS WORD-ANCHORED BY `anyOf`, AND HAND-WRITING THE ALTERNATION IS HOW THIS BROKE.
 * The first draft spelled the rules out as one long `/a|b|c/`. Folding strips diacritics but not
 * spaces, so an unanchored two-syllable term matches straight ACROSS a syllable break — measured
 * 2026-09-10, with the visa desk's own products caught in it:
 *
 *   `canh ga`   matched  "Visa điện tử nhập **cảnh gấ**p trong 1 giờ"   → the desk's own product
 *   `dui ga`    matched  "Bóng đèn LED **đui gà**i B22"                 → a lamp base
 *   `giam can`  matched  "Máy massage **giảm căn**g thẳng"              → a health claim it isn't
 *   `uc ga`     matched  "Bò **Úc gạ**o..."                             → a grocery
 *
 * `anyOf` wraps each term in `\b…\b`, which is what makes the trailing consonant of the next
 * syllable a non-match. Add terms to the ARRAYS; never reach for a raw literal here again.
 *
 * ⛔ AND A TERM IS MATCHED AGAINST NORMALISED TEXT, WHERE HYPHENS ARE ALREADY SPACES. `accu-?chek`
 * sat here and was DEAD: `feedNorm` rewrites `-` to a space before matching, and `-?` accepts a
 * hyphen or nothing, never a space. Both fixtures naming it passed on their device words instead,
 * so the suite never saw it. Write the SPACED form (`accu chek`) and never a hyphen.
 *
 * ⚠️ A TERM IS STILL REGEX SOURCE, NOT A LITERAL — `tap \\d+` relied on that while it existed. So a term
 * carrying an unescaped `(`, `+` or `?` (a brand or model number would) THROWS AT MODULE LOAD,
 * which 500s both feed routes and everything else importing this file. Escape any metachar you
 * do not mean, and keep the tests green — they load the module, so a bad term fails there first.
 */
function anyOf(...terms: string[]): RegExp {
  return new RegExp(terms.map((t) => `\\b${t}\\b`).join('|'))
}

/**
 * ⛔ THERE IS NO VETO LIST, AND EVERY VERSION OF ONE LEAKED. Three were tried. A global one let
 * `tặng kèm túi xách` re-admit a blood-pressure monitor. Scoping it to alcohol and fresh food left
 * the Tết hamper — `Rượu vang 750ml + 2 ly uống pha lê`, `… + kệ rượu gỗ` — because a bundle names
 * whatever noun the veto trusts, and `và`/`+`/`combo`/`:` join it as readily as `tặng`. Narrowing
 * it to books alone still let `Tôm hùm Alaska sống 500g tặng truyện tranh tập 1` through, and
 * `^sach` still fires on a shop called `Sạch Food` — `sách` and `sạch` fold identically.
 *
 * ⚠️ THE COLLISION IT WAS TRYING TO SOLVE IS REAL AND IS NOW ACCEPTED. Of the 46 live titles
 * containing `rượu`, roughly half are not drink: `Sách Ly Rượu Trần Gian`, `Quán Rượu Dị Giới Nobu
 * - Tập 08` (manga), `Balo … Màu Đỏ Rượu` (a wine-RED backpack), `Tủ Trưng Bày Rượu` (a display
 * cabinet). All of them are withheld, deliberately.
 *
 * ⚠️ THE COST IS NAMED AND ASSERTED: a handful of wine glasses, a display cabinet, a wine-red
 * backpack and two books about wine are withheld, and the tests say so. That is the whole price of
 * removing a mechanism that re-admitted the goods it was meant to protect.
 */

const FEED_EXCLUDE_RULES: [RegExp, string][] = [
  // Diagnostic and therapeutic devices — the largest rejected group.
  [anyOf('may do duong huyet', 'que thu duong huyet', 'kim chich mau', 'bom kim', 'kim tiem',
         'may do huyet ap', 'huyet ap', 'nhiet ke', 'do than nhiet', 'may xong mui', 'ong nghe y te', 'spo2',
         'nong do oxy', 'may hut sua', 'giac hoi', 'xung dien', 'may duong khi', 'tri lieu', 'y te',
         'glucose meter', 'blood pressure monitor', 'breast pump', 'nebulizer', 'nebuliser',
         'knee brace', 'back brace', 'posture corrector', 'wrist splint'), 'medical'],
  // Orthopaedic supports.
  // ⛔ EVERY ONE OF THESE IS TWO WORDS OR MORE — except `massage`, which is a deliberate,
  // documented over-block (see the header: it takes `Ghế massage` and `Súng massage`, which are
  // high-ticket appliances, because Meta refuses massagers as healthcare devices either way). Measured against the live
  // catalogue, the one-word versions were pure loss: `nep ` matched 39 products and ZERO braces
  // (`Sách Nếp Cũ`, `Mờ Nếp Nhăn` — books and cosmetics); `cot song` matched 48 including a
  // MATTRESS sold on spinal alignment; `banh che` also reads `bánh chè lam`, a confection; and
  // `chong gu` matched 26 rows that were mostly SCHOOL BACKPACKS (`Balo học sinh … chống gù`)
  // plus an ergonomic chair and a book stand — the three real braces in it carry `aolikes`,
  // `olumba` or `dai chong gu`.
  // ⛔ AND `nẹp` (SPLINT) FOLDS TO `nếp` TWICE MORE, which the first narrowing missed: `nep ngon`
  // is also `nếp ngon` (good sticky rice) and `nep dinh hinh` is also `giữ nếp định hình` (hair
  // gel) — the keeper list below carries `Giữ Nếp Cong`, so those products are demonstrably here.
  // Every `nep` term must name a BODY PART, and `nep dinh hinh` is gone entirely because the real
  // splints carry `orbe` or `actimove`.
  [anyOf('dai that lung', 'dai dieu chinh', 'ho tro cot song', 'keo gian cot song',
         'dieu chinh cot song', 'bao ve cot song', 'dinh hinh cot song', 'thoat vi dia dem',
         'dai chong gu', 'nep ngon tay', 'nep co tay', 'nep cang chan', 'nep co chan',
         'nep dau goi', 'bo goi the thao', 'dai bo goi', 'bao ve dau goi', 'dai dau goi',
         'bao ve khop', 'tro luc khop', 'khop goi', 'khop vai', 'khop dau goi',
         'xuong banh che', 'co dinh khop', 'massage'), 'medical'],
  // Health-device brands, for the titles that name only the model.
  // ⚠️ SINGLE-PURPOSE MEDICAL BRANDS ONLY. `omron` and `microlife` were here and are gone: both
  // sell industrial lines (`Rơ le trung gian Omron MY2N-J`), and every one of their products in
  // the rejected set is already caught by its device word (`máy đo huyết áp`, `nhiệt kế`, `máy
  // xông mũi`, `ống nghe y tế`, `massage`) — verified against all 118. `aolikes` DOES stay despite
  // also selling gym gear: 114 of its rows here are braces, and each would be rejected one by one.
  [anyOf('accu chek', 'sinocare', 'safe accu', 'medela', 'aolikes', 'actimove', 'olumba',
         'diskdr'), 'medical'],
  // Veterinary medicines.
    // ⛔ NOT `tri ghe`: it also folds `bố trí ghế` (a SEATING LAYOUT). The NexGard rows carry the
  // brand, which is unambiguous.
  [anyOf('nexgard', 'tri giun', 've ran', 'bo chet'), 'vet_medicine'],
  // Raw meat, fish and live seafood.
  // ⛔ NEVER a bare `heo` or `thit`. Measured: `heo` matched 42 products of which most were
  // CHILDREN'S BOOKS (`Một Chú Heo Con`) plus a keychain and a `Cá Heo` (DOLPHIN) massager;
  // `thit` matched 29 MEAT GRINDERS. The cut is always named, so name the cut. And no `bo uc`:
  // it also reads `Bơ Úc` (butter), while every real beef row is caught by its cut. And `chan gio`
  // alone folds `chắn gió` — 5 rows of car windshield phone mounts and a stove wind guard — so the
  // pork knuckle is named in full. `canh ga` moved out of this list entirely — see below — and
  // `hai san` is gone: it names a FLAVOUR as often as a food
  // (`Mì tôm hương vị hải sản`, `Bánh phồng tôm hải sản`), both of them shelf-stable.
  [anyOf('thit heo', 'thit bo', 'thit ga', 'thit vit', 'ba chi heo', 'ba roi', 'chan gio sau', 'chan gio rut xuong', 'tim heo', 'nac dam', 'nac than', 'suon sun', 'xuong ong', 'xuong uc',
         'dui ga', 'uc ga', 'dui toi ga', 'ga ta', 'bap bo uc', 'dui go bo', 'ca ba sa',
         'ca du 1 nang', 'tom hum'), 'fresh_food'],
  /**
   * ⛔ `cánh gà` NEEDS A LOOKBEHIND, BECAUSE `nhập cảnh ga <ga đường sắt>` IS A VISA TITLE.
   * Word anchors fixed `nhập cảnh gấp`; they cannot fix `nhập cảnh ga Đồng Đăng` or `ga Lào Cai`,
   * where `cảnh` and `ga` really are two whole words. Withholding the desk's own e-visa products
   * as chicken wings is the worst outcome this file can produce, so the preceding words that make
   * it a visa are excluded explicitly.
   * ⛔ ALL THREE VERBS, NOT JUST `nhập`. `xuất cảnh` (exit) and `quá cảnh` (transit) are the other
   * two standard terms, and guarding only entry left `Visa quá cảnh ga Đồng Đăng` withheld as
   * poultry — one word away from the case that was covered. ⚠️ The cost runs the other way too: a
   * merchant writing `hàng mới nhập cánh gà` keeps its chicken. That is the safe direction.
   */
  [/(?<!nhap )(?<!xuat )(?<!qua )\bcanh ga\b/, 'fresh_food'],
  // Body-adjacent apparel.
    // ⛔ `quan boxer`, never a bare `boxer` — that is also a DOG BREED. And ⛔ NEVER `do lot`. `đồ lót` (underwear) and `đỏ lót` (red + LINING) fold identically, so
  // `Áo khoác nam màu đỏ lót lông cừu` was withheld as underwear — `sách`/`sạch`, `vàng`/`vang`
  // and `bìa`/`bia` a fourth time. `quần lót` and `áo ngực` carry the real rows.
  [anyOf('quan lot', 'ao nguc', 'noi y', 'lingerie', 'sip nam', 'quan boxer', 'bra'), 'underwear'],
  // Ingestibles making a health claim — the claim is refused, not the food.
  [anyOf('thuc pham chuc nang', 'vien uong', 'detox', 'thai doc', 'giam can', 'bot rau ma',
         'bot diep ca'), 'supplement'],
  // Alcohol.
  // ⛔ NEVER a bare `vang` or `bia`: folded, they also read `vàng` (GOLD — this feed carries
  // "mạ vàng 24K" cables) and `bìa` (a book COVER, "Bìa cứng hồ sơ A4"). Word anchors do not
  // save you here, because both collisions are whole words. Qualify the drink instead.
  // ⚠️ AND WITHOUT THOSE TWO WORDS THE RULE MATCHED ALMOST NOTHING REAL. `Bia Sài Gòn 330ml`,
  // `Bia 333`, `Vang đỏ Chile 750ml` and every spirit titled by brand alone carry neither `rượu`
  // nor a qualified `bia`, so the qualified forms and the brands are listed explicitly. `lon bia`
  // is safe where `bia lon` is not — `bìa lớn` folds to the latter, never the former.
  // ⛔ AND NEVER `vang do` / `vang trang`. Both were here for one round and both are the `mạ vàng`
  // collision again: `vàng trắng` (WHITE GOLD) and colour lists like `Xanh, vàng, trắng, hồng`
  // matched 44 rows — lamps, staplers, a valve. Grape names carry no collision, so they cover the
  // wines that omit `rượu`. ⚠️ A BRAND LIST CANNOT BE COMPLETE: a beer or spirit named only by an
  // unlisted brand still ships. Add to the list when one turns up rather than reaching for `bia`.
  // ⛔ AND NOT `champagne` OR `cognac`: both are COLOUR names here — `Vòi sen màu champagne`,
  // `Ví da bò màu cognac`, `iPhone màu champagne gold`. Same collision as `vàng`, in English.
  // `shiraz`, `merlot` and `prosecco` carry no such second meaning and stay.
  // ⛔ AND EVERY BEER BRAND IS PREFIXED `bia `. Bare `heineken` and `tiger beer` take branded
  // GLASSWARE, shirts and coolers; bare `sapporo` takes `Mì Sapporo Ichiban`, instant noodles.
  [anyOf('ruou', 'ruou vang', 'vang sui', 'vang ngot', 'whisky',
         'whiskey', 'vodka', 'tequila', 'soju', 'thung bia', 'bia tuoi',
         'lon bia', 'bia sai gon', 'bia saigon', 'bia ha noi', 'bia tiger', 'bia 333',
         'bia heineken', 'bia budweiser', 'bia sapporo', 'bia carlsberg', 'bia larue', 'bia huda',
         'bia truc bach', 'bia viet', 'bia corona', 'strongbow', 'chivas', 'jack daniel', 'johnnie walker', 'absolut',
         'hennessy', 'remy martin', 'ballantine', 'macallan', 'shiraz', 'cabernet', 'merlot',
         'pinot', 'chardonnay', 'sauvignon', 'prosecco'), 'alcohol'],
  /**
   * ⚠️ `vang` + A BOTTLE VOLUME, which is the one way to use the word safely. Bare `vang` is
   * banned above because it folds `vàng` (GOLD), but that ban left `Vang đỏ Chile 750ml` — a real
   * wine that names neither `rượu` nor a listed grape — shipping to both feeds. Gold is sold by
   * karat and by colour, never in millilitres, so pairing the word with `750ml` separates them:
   * `mạ vàng 24K` and `ánh sáng vàng 3000K` both stay out. This is the only rule here that is not
   * a plain word list — the `cánh gà` lookbehind above is the other.
   * ⛔ BOTTLE-STANDARD SIZES ONLY (375/700/750 ml). A bare unit fails in both directions: litres
   * take paint, engine oil and bin bags (`Sơn nước màu vàng 5L`); any millilitre takes nail polish
   * and perfume (`Sơn móng tay màu vàng 15ml`). Wine comes in three sizes and gold comes in none.
   */
  /**
   * ⚠️ `vang` AT THE START **AND** A BOTTLE-STANDARD VOLUME. Neither half works alone. Bare
   * `vang` is banned above because it folds `vàng` (GOLD/YELLOW), but that ban left `Vang đỏ Chile
   * 750ml` — a real wine naming neither `rượu` nor a listed grape — shipping to both feeds.
   * ⛔ PAIRING IT WITH A VOLUME WAS TRIED AND IS WRONG. `750ml` looked like the discriminator, but
   * `Sơn móng tay màu vàng 15ml`, `Nước hoa màu vàng 50ml` and `Bình giữ nhiệt màu vàng 500ml` are
   * nail polish, perfume and a flask; litres are worse still (`Sơn nước màu vàng 5L`). A wine LEADS
   * with the word; a yellow thing names its product type first and its colour later.
   * ⛔ BUT THE START ANCHOR ALONE WITHHOLDS GOLD, which leads with the word just as readily —
   * `Vàng trắng 18K nhẫn cưới`, `Vàng ta 9999 miếng 1 chỉ`, `Vàng miếng SJC`. Pairing it with a
   * BOTTLE-STANDARD volume is what separates them: gold is sold by the chỉ and the karat, never in
   * 750ml. ⚠️ THE COST IS A PREFIXED WINE — `HCM - Vang Đà Lạt 750ml` fails the anchor and ships.
   * Accepted: the alternative withholds jewellery, which is high-value live inventory.
   */
  [/^vang\b.{0,40}\b(?:375|700|750)\s?ml\b/, 'alcohol'],
]

/**
 * Fold a Vietnamese title to bare ASCII so one rule matches both spellings.
 *
 * ⛔ `đ` IS A LETTER, NOT A DIACRITIC, so NFD leaves it whole and it must be replaced by hand —
 * without that line `do lot` never matches `đồ lót`.
 * ⚠️ AND THE INPUT IS GENUINELY UNACCENTED HALF THE TIME: the partner importers carry titles like
 * "Combo 4 quân lot nam" and "mêm min thoang mat" straight from the shops' own pages, so matching
 * on accented text alone would miss exactly the rows that were rejected.
 */
function feedNorm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    // ⛔ PUNCTUATION IS WHITESPACE HERE. A shop writing `quần-lót`, `thịt-heo` or `safe-accu`
    // defeats every multi-word rule otherwise, and hyphenated titling is ordinary. Separators
    // become spaces BEFORE the collapse below so `a-b` and `a  b` end up identical.
    .replace(/[-–—_/\\|,;:()[\]{}]+/g, ' ')
    // ⛔ COLLAPSE WHITESPACE OR EVERY MULTI-WORD RULE IS ONE KEYSTROKE FROM BYPASSED. The terms
    // below are written with single spaces, so `Quần  lót` (two spaces) and a non-breaking space
    // both slipped through silently — measured 2026-09-10. Importer titles are copied from shop
    // pages and are full of both.
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}


/** The reason this title may not go in an ad catalogue, or null when it may. */
export function feedExcluded(title: string): string | null {
  const t = feedNorm(title)
  for (const [re, reason] of FEED_EXCLUDE_RULES) if (re.test(t)) return reason
  return null
}

const MOCK_IMAGE_HOSTS = ['picsum.photos', 'loremflickr.com', 'placehold']
export function isMockImages(images: string[]): boolean {
  if (images.length === 0) return false
  // Match the URL HOSTNAME (not a substring of the whole URL) so a real image whose
  // query string merely mentions a mock host isn't wrongly dropped.
  return images.every((u) => {
    try { return MOCK_IMAGE_HOSTS.some((h) => new URL(u).hostname.includes(h)) }
    catch { return false }
  })
}

// ── Feed access protection ───────────────────────────────────────────────────
// HTTP Basic Auth so ONLY Meta/Google (with the credentials entered in their
// scheduled-fetch "login details") can pull the full product list — not anonymous
// scrapers. Returns a 401 Response when auth is required and fails, else null (allow).
// OPEN by default (no env set) so the feed is never locked out before creds exist —
// set FEED_USER + FEED_PASSWORD in the host to turn protection on.
export function feedAuthError(req: Request): Response | null {
  const user = process.env.FEED_USER
  const pass = process.env.FEED_PASSWORD
  if (!user || !pass) return null // not configured → open (back-compat)

  /**
   * ⛔ A `?key=` TOKEN IS ACCEPTED AS WELL AS BASIC AUTH, BECAUSE META'S VALIDATOR NEVER SENDS THE
   * CREDENTIALS YOU TYPE INTO IT. Measured in Cloud Run's logs while the owner was on the "Add
   * products" screen with the username and password filled in:
   *
   *   13:26:24  401  facebookexternalhit/1.1  /feeds/facebook-catalog.csv
   *   13:25:16  401  facebookexternalhit/1.1  /feeds/facebook-catalog.csv   (×4)
   *
   * Commerce Manager pre-flights the URL ANONYMOUSLY, gets the 401, and reports it as "URL does not
   * link to supported file" — which reads like a format problem and is an auth problem. The Basic
   * credentials are only used later, by the scheduled fetch. So a URL that needs a header can never
   * pass that form, however correct the file is.
   *
   * ⚠️ THE TOKEN IS THE SAME SECRET AS FEED_PASSWORD, deliberately: one value to rotate, and it is
   * already the thing that guards this feed. Compared in constant time like the header path.
   *
   * ⚠️ AND A TOKEN IN A URL IS WEAKER THAN A HEADER — it lands in browser history, referrers and
   * access logs. That is an accepted trade here and NOT a pattern to copy elsewhere: this feed
   * exposes only product data that is already public on the site, and the alternative is no
   * catalogue at all. It must never be used for anything carrying PII.
   */
  const key = new URL(req.url).searchParams.get('key')
  if (key) {
    const a = Buffer.from(key)
    const b = Buffer.from(pass)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return null
  }

  const hdr = req.headers.get('authorization') || ''
  // Only valid base64 credentials (RFC 7617) — no trailing junk. Buffer.from(base64)
  // never throws, so no try/catch is needed; the length + constant-time compare decide.
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(hdr)
  if (m) {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8')
    const expected = `${user}:${pass}` // full-string compare → a ':' in the password is fine
    // Constant-time compare (length-guarded — timingSafeEqual needs equal lengths).
    if (decoded.length === expected.length && crypto.timingSafeEqual(Buffer.from(decoded), Buffer.from(expected))) {
      return null
    }
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="eno-feeds", charset="UTF-8"', 'Cache-Control': 'no-store', Vary: 'Authorization' },
  })
}

// Cache headers for a feed response. CRITICAL: when the feed is PROTECTED, never let a
// shared CDN cache it (a cached authed body could be served to an anonymous request →
// auth bypass). When open, cache normally — the platforms only fetch hourly.
export function feedCacheHeaders(): Record<string, string> {
  // The open feed and the protected feed share one path, so a shared-CDN copy could be
  // served across the auth boundary (e.g. a stale open copy after protection is turned
  // on). Vary on Authorization for correct cache keying + no-store so there's no
  // cross-request reuse at all. Feeds are pulled hourly, so CDN caching buys nothing.
  return { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }
}
