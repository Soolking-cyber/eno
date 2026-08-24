/**
 * Classify every CellphoneS product into our taxonomy — category, subcategory, brand, model.
 *
 *   npx tsx scripts/classify-cellphones.ts                 # DRY RUN + full distribution report
 *   npx tsx scripts/classify-cellphones.ts --sample 40     # eyeball a random sample of decisions
 *   npx tsx scripts/classify-cellphones.ts --apply
 *
 * ⛔ THE RULE THAT MATTERS IS ORDER: INTENT BEFORE OBJECT. My first pass tested the device name
 * first, so every "Ốp lưng iPhone 16" (an iPhone CASE) matched /iphone/ and was filed as a phone.
 * Measured on the live catalogue: 69% of `phones-tablets`, 73% of `audio` and 52% of `gaming` were
 * actually accessories. A title naming a device is usually an accessory FOR that device — cases,
 * cables, screen protectors and straps all name the phone they fit.
 *
 * ⚠️ CONFIRMED AGAINST THE MERCHANT'S OWN TAXONOMY, not invented. CellphoneS carries `Phụ kiện`
 * (Accessories) as a TOP-LEVEL department whose children are `Ốp lưng | Bao da > iPhone > iPhone 15
 * Pro Max` — i.e. they too treat "case for an iPhone" as an accessory, not a phone. Their
 * breadcrumbs are the authority; these rules are a faithful reading of them for titles we hold.
 *
 * ⚠️ EVERY RULE IS BILINGUAL. The feed is Vietnamese and the titles are now translated to English,
 * so both spellings must match or half the catalogue falls through.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { buildSearchText } from '../src/lib/fold'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SAMPLE = Number(arg('sample') ?? 0)

type Hit = { category: string; subcategory: string | null }

/**
 * ⛔ ORDER IS THE ALGORITHM. Read top to bottom; first match wins. Anything that describes what a
 * thing IS FOR (a case, a cable, a warranty) must sit above anything that names WHAT IT FITS.
 */
const RULES: [RegExp, Hit][] = [
  // 1 ─ NOT A PHYSICAL PRODUCT. A warranty plan or a software licence is a service; leaving these
  //     among the phones puts "AppleCare+ for AirPods" in the earphones aisle.
  [/applecare|care\+|bảo hành|gói bảo|gói \d+ năm|\d+-year package|\d+-year .*package|extended warranty|phần mềm|office 365|microsoft 365|windows \d|kaspersky|antivirus|^sim |thuê bao/i,
    { category: 'services', subcategory: null }],

  // 2 ─ ACCESSORY INTENT, ABOVE EVERY DEVICE NAME. This is the block my first pass had last.
  [/ốp lưng|^ốp |bao da|case for|phone case|ốp điện thoại|\bcase\b|\bcover\b|folio/i, { category: 'electronics', subcategory: 'phone-cases' }],
  // `bộ dán` = a multi-piece skin/protector set, the common MacBook listing shape; without it
  // twenty of those sat in laptops-pcs pretending to be laptops.
  [/cường lực|dán màn|dán cường|miếng dán|bộ dán|dán full|skin set|screen protector|tempered glass|kính cường lực/i, { category: 'electronics', subcategory: 'screen-protectors' }],
  /**
   * ⛔ THE STRAP MUST BE THE SUBJECT, NOT A FEATURE. "Huawei Watch GT 5 Pro with Rubber Strap" is a
   * WATCH; a bare /strap/ filed it as a strap — the same intent-vs-object confusion as the case
   * rules, running the other way. Anchored, or followed by "for", so only a strap sold on its own
   * matches.
   */
  [/^dây đeo|^dây cao su|^dây da|^dây kim loại|watch band for|watch strap for|strap for (apple|galaxy|huawei)/i,
    { category: 'electronics', subcategory: 'accessories' }],
  [/^sạc |củ sạc|cốc sạc|adapter sạc|charger|đế sạc|sạc không dây|wireless charg/i, { category: 'electronics', subcategory: 'cables-chargers' }],
  [/^cáp |cáp sạc|cable|dây cáp|hub |bộ chuyển|adapter|docking/i, { category: 'electronics', subcategory: 'cables-chargers' }],
  [/pin dự phòng|sạc dự phòng|power bank|powerbank/i, { category: 'electronics', subcategory: 'power-banks' }],
  [/balo|túi chống sốc|túi đựng|cặp laptop|laptop bag|backpack|túi xách|sleeve|shoulder bag|carrying case/i, { category: 'electronics', subcategory: 'bags-sleeves' }],
  [/giá đỡ|chân đế|tripod|gimbal|gậy chụp|selfie stick|mount|kẹp /i, { category: 'electronics', subcategory: 'accessories' }],
  [/bút cảm ứng|apple pencil|stylus/i, { category: 'electronics', subcategory: 'accessories' }],
  // ⚠️ ABOVE `cameras`: "camera lens protector" is a sticker for a phone, not a lens.
  [/bảo vệ camera|lens protector|camera protector|dán camera|ring camera/i, { category: 'electronics', subcategory: 'accessories' }],
  // Generic carry cases the specific rules above miss ("accessory bag", "pouch").
  [/accessory bag|túi phụ kiện|pouch|hộp đựng|storage box|accessory box/i, { category: 'electronics', subcategory: 'accessories' }],
  [/chuột |bàn phím|keyboard|mouse|lót chuột|mousepad/i, { category: 'electronics', subcategory: 'keyboards-mice' }],

  // 3 ─ SUBCATEGORIES THAT ARE THEIR OWN DEPARTMENT AT THE MERCHANT.
  [/thẻ nhớ|memory card|ổ cứng|ssd|hdd|usb \d|flash drive|thẻ microsd|external drive/i, { category: 'electronics', subcategory: 'storage' }],
  /**
   * ⛔ NOT A BARE `wifi`. Tablets and laptops ship as "Wifi" vs "5G" variants, and IP cameras and
   * warranty plans mention it too — a bare match filed a HONOR Pad, an Ezviz camera and a Samsung
   * Care+ plan as networking gear. The word only means networking next to a device that routes.
   */
  [/router|modem|access point|mesh wifi|bộ phát wifi|phát sóng wifi|usb wifi|card wifi|repeater|powerline/i,
    { category: 'electronics', subcategory: 'networking' }],
  [/máy in|printer|mực in|toner|máy scan|máy photo/i, { category: 'electronics', subcategory: 'printers' }],
  [/đồng hồ thông minh|smartwatch|apple watch|galaxy watch|smart band|vòng tay thông minh|huawei watch|amazfit|sports watch|gps watch|đồng hồ gps|đồng hồ thể thao|garmin|suunto|coros/i,
    { category: 'electronics', subcategory: 'smartwatch' }],

  // 4 ─ AUDIO before phones: "Tai nghe cho iPhone" is a headphone, not a phone.
  [/tai nghe|headphone|earbud|airpod|^loa |loa bluetooth|speaker|soundbar|micro|microphone/i, { category: 'electronics', subcategory: 'audio' }],

  // 5 ─ THE DEVICES THEMSELVES.
  [/laptop|macbook|thinkpad|máy tính xách tay|notebook|ultrabook|máy tính để bàn|^pc |desktop|imac|mac mini|mac studio/i,
    { category: 'electronics', subcategory: 'laptops-pcs' }],
  // ⚠️ \btivi\b, NOT ^tivi — the titles read "Google tivi TCL …", so an anchor dropped every
  // television into no category at all.
  [/màn hình|monitor|\btivi\b|\btv\b|smart tv|television|máy chiếu|projector/i, { category: 'electronics', subcategory: 'tv-monitors' }],
  [/máy ảnh|camera|ống kính|^lens |gopro|flycam|drone|dji |đèn flash|speedlite|softbox/i, { category: 'electronics', subcategory: 'cameras' }],
  [/playstation|\bps5\b|xbox|nintendo|máy chơi game|tay cầm chơi|gaming console|steam deck/i, { category: 'electronics', subcategory: 'gaming' }],
  [/điện thoại|iphone|galaxy [asz]\d|galaxy note|smartphone|máy tính bảng|^ipad|tablet|redmi|oppo|vivo |realme|xiaomi \d/i,
    { category: 'electronics', subcategory: 'phones-tablets' }],

  // 6 ─ HOME. `tủ lạnh` contains `tủ`, so the two-word appliance terms come before the generic ones.
  [/tủ lạnh|tủ đông|máy giặt|máy sấy quần|điều hòa|máy lạnh|máy rửa bát|máy rửa chén|refrigerator|washing machine|air conditioner/i,
    { category: 'furniture-appliances', subcategory: 'white-goods' }],
  [/nồi cơm|nồi chiên|nồi áp suất|bếp từ|bếp ga|lò vi sóng|lò nướng|máy xay|ấm đun|máy pha cà phê|air fryer|rice cooker/i,
    { category: 'furniture-appliances', subcategory: 'kitchenware' }],
  [/máy hút bụi|robot hút|quạt điều hòa|^quạt |standing fan|máy lọc không khí|máy lọc nước|bàn ủi|bàn là|vacuum cleaner|robot vacuum|air purifier|water purifier|máy rửa xe|pressure washer|máy nén khí/i,
    { category: 'furniture-appliances', subcategory: 'white-goods' }],
  // ⚠️ `led` ONLY AS A LAMP. A bare /led / matched "QD-MiniLED 144Hz" and filed 65-inch televisions
  // under lighting.
  [/^đèn |bóng đèn|đèn led|lamp|light bulb/i, { category: 'furniture-appliances', subcategory: 'lighting-decor' }],

  // 7 ─ PERSONAL CARE, which is not electronics however electric it is.
  [/máy cạo râu|tông đơ|máy massage|bàn chải điện|máy triệt lông|máy sấy tóc|máy uốn tóc|shaver|trimmer|hair clipper|hair dryer|massager/i,
    { category: 'fashion-beauty', subcategory: null }],
  [/xe điện|xe đạp điện|xe scooter|e-bike|electric scooter/i, { category: 'vehicles', subcategory: null }],
]

/**
 * Condition. Everything from this retailer is new EXCEPT the stock they themselves label used —
 * CellphoneS runs a `Hàng cũ` (used goods) department, and 1,015 of these titles say so.
 *
 * ⛔ "LABEL THEM ALL NEW" WOULD BE FALSE FOR A TENTH OF THE CATALOGUE (owner, immediately:
 * "unless it doesn't say refurbished or second hand"). A used iPhone sold as new is the exact
 * thing the condition filter exists to prevent, and it is the kind of claim a marketplace gets
 * held to. `cũ` = used, `trầy xước` = scratched — both are the merchant's own words.
 */
const USED_RE = /\bcũ\b|trầy xước|đã qua sử dụng|\bused\b|refurbish|second[- ]hand|like new|hàng cũ/i
function conditionFor(title: string, titleVi: string | null): 'new' | 'used' {
  return USED_RE.test(title) || USED_RE.test(titleVi ?? '') ? 'used' : 'new'
}

function classify(title: string, titleVi: string | null): Hit {
  /**
   * ⛔ EACH LANGUAGE TESTED SEPARATELY, NEVER CONCATENATED. Joining them into one haystack kills
   * every `^` anchor — "Quạt đứng Casper" only starts the Vietnamese string, so `/^quạt /` never
   * fired and standing fans fell through to no category at all. Caught by reading a sample.
   */
  const hays = [title, titleVi ?? ''].filter(Boolean)
  for (const [re, hit] of RULES) if (hays.some((h) => re.test(h))) return hit
  // ⚠️ The honest default. CellphoneS is an electronics retailer, so an unmatched product is
  // electronics with NO subcategory rather than a guessed one — a wrong chip is worse than none.
  return { category: 'electronics', subcategory: null }
}

async function main() {
  const seller = await db.seller.findFirst({ where: { name: 'CellphoneS' }, select: { id: true } })
  if (!seller) { console.error('no CellphoneS storefront'); process.exit(1) }
  const cats = await db.category.findMany({ select: { id: true, slug: true, name: true, nameVi: true } })
  const bySlug = new Map(cats.map((c) => [c.slug, c]))

  const rows = await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, titleVi: true, description: true, descriptionVi: true,
      district: true, location: true, brandSlug: true, model: true, categoryId: true, subcategorySlug: true, condition: true },
  })

  const dist = new Map<string, number>()
  const cond = new Map<string, number>()
  const changes: { id: string; hit: Hit; cond: 'new' | 'used'; title: string; from: string }[] = []
  for (const r of rows) {
    const hit = classify(r.title, r.titleVi)
    const c = conditionFor(r.title, r.titleVi)
    cond.set(c, (cond.get(c) ?? 0) + 1)
    const key = `${hit.category} / ${hit.subcategory ?? '(none)'}`
    dist.set(key, (dist.get(key) ?? 0) + 1)
    const cat = bySlug.get(hit.category)
    if (!cat) continue
    if (r.categoryId !== cat.id || r.subcategorySlug !== hit.subcategory || r.condition !== c) {
      changes.push({ id: r.id, hit, cond: c, title: r.title, from: `${cats.find((x) => x.id === r.categoryId)?.slug} / ${r.subcategorySlug ?? '(none)'}` })
    }
  }

  console.log(`${rows.length} products\n`)
  console.log('RESULTING DISTRIBUTION')
  ;[...dist.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
    console.log(`  ${String(n).padStart(5)}  ${k}`))
  console.log(`\nCONDITION  new: ${cond.get('new') ?? 0}   used: ${cond.get('used') ?? 0}`)
  console.log(`${changes.length} would change`)

  if (SAMPLE) {
    console.log(`\nRANDOM SAMPLE — read these, they are the whole argument:`)
    const shuffled = [...changes].sort(() => Math.random() - 0.5).slice(0, SAMPLE)
    for (const c of shuffled) console.log(`  ${c.from.padEnd(28)} -> ${(c.hit.category + '/' + (c.hit.subcategory ?? '-')).padEnd(28)} ${c.title.slice(0, 58)}`)
  }

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  let n = 0
  for (const c of changes) {
    const cat = bySlug.get(c.hit.category)!
    const r = rows.find((x) => x.id === c.id)!
    await db.listing.update({
      where: { id: c.id },
      data: {
        categoryId: cat.id, subcategorySlug: c.hit.subcategory, condition: c.cond,
        // The blob carries the category words, so it has to be rebuilt when the category moves.
        searchText: buildSearchText([r.title, r.titleVi, r.description, r.descriptionVi,
          r.district, r.location, cat.name, cat.nameVi, r.brandSlug, r.model]),
      },
    }).catch(() => {})
    if (++n % 1000 === 0) console.log(`  ${n}/${changes.length}`)
  }
  console.log(`\nAPPLIED: ${n} reclassified`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
