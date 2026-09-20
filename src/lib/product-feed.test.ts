import { describe, it, expect } from 'vitest'
import {
  feedExcluded, isGtin, feedStock, gpcFor, feedIdentifiers,
  feedApparel, isApparel,
} from './product-feed'

/**
 * ⚠️ EVERY "SHOULD BE EXCLUDED" TITLE BELOW IS REAL. They are taken verbatim from the 118 products
 * Meta actually rejected out of the 69,812 in catalogue 1023045203452456, read back through the
 * Marketing API on 2026-09-10 — including their broken diacritics ("quân lot", "Chântúi"), which
 * the partner importers copy straight from the shops' own pages. Inventing plausible Vietnamese
 * here would have tested the rules against my spelling instead of the shops'.
 *
 * ⛔ THE SECOND BLOCK MATTERS MORE THAN THE FIRST. A rule that excludes too much is invisible —
 * the feed just gets smaller — so the false-positive cases are the ones that catch a bad edit.
 * They are drawn from products that ARE in the live feed and must stay there.
 */
describe('feedExcluded', () => {
  it.each([
    // Medical, diagnostic and orthopaedic — the largest rejected group.
    ['Hộp 100 Cây Bơm Kim Insulin Tiểu Đường 0.5ml BD ULTRA - FINE II SHORT NEEDLE', 'medical'],
    ['Bộ máy đo đường huyết Safe Accu tặng 1 hộp 50 que thử và hộp 50 kim chích máu', 'medical'],
    ['Máy Đo Đường Huyết ACCU-CHEK Active Dùng Cho Cá Nhân - MMOLL', 'medical'],
    ['Hộp 50 Que Thử Đường Huyết ACCU-CHEK Guide', 'medical'],
    /**
     * ⛔ THE BRAND ON ITS OWN, WHICH IS WHAT CAUGHT A DEAD RULE. Every other ACCU-CHEK fixture
     * carries `máy đo`/`que thử đường huyết` and passed on those, hiding the fact that
     * `accu-?chek` could never match: `feedNorm` turns the hyphen into a space first.
     */
    ['Que thử tiểu đường Accu-Chek Instant hộp 50 cái', 'medical'],
    ['Máy Đo Huyết Áp Cổ Tay Omron - HEM-6161', 'medical'],
    ['Máy đo huyết áp cơ Microlife AG1-20', 'medical'],
    ['Nhiệt Kế Hồng Ngoại Đo Tai Và Trán Fr1mf1  Tặng Đèn Soi Tai', 'medical'],
    ['Nhiệt Kế Điện Tử Đo Trán OMRON MC-720', 'medical'],
    // ⚠️ The same product as many shops title it — no `nhiệt kế`, and the bare brands are gone.
    ['Máy đo thân nhiệt điện tử Omron MC-720 hồng ngoại', 'medical'],
    ['Máy đo nồng độ OXY trong máu và nhịp tim Microlife SPO2 OXY200', 'medical'],
    ['Máy Xông Mũi Họng Omron Ne - C28  Tặng 1 Kính Bảo Hộ', 'medical'],
    ['Ống Nghe Y Tế Hai Dây Microlife ST-77', 'medical'],
    ['Máy hút sữa điện đơn Medela Swing', 'medical'],
    ['Máy hút sữa cầm tay Medela Harmony', 'medical'],
    ['Bộ Giác Hơi Không Dùng Lửa Duy Thành YGH05 6 ống giác', 'medical'],
    ['Máy Massage Xung Điện Trị Liệu Nikio NK-102 - 8 Miếng Dán Mát Xa', 'medical'],
    ['MÁY DƯỠNG KHÍ TUẦN HOÀN NỘI TẠNG DUY THÀNH', 'medical'],
    ['Đai thắt lưng hỗ trợ cột sống ORBE OLUMBA cho người đau lưng, thoát vị đĩa đệm', 'medical'],
    ['Đai điều chỉnh cột sống chống gù lưng AOLIKES A-3106 Back Posture Corrector - XXL', 'medical'],
    ['Nẹp Ngón Tay Cái ORBE H1 - Phải Size L', 'medical'],
    ['Nẹp cổ tay 75729-SPO Actimove Wrist Stabilizer - M', 'medical'],
    ['Bộ 2 bó bảo vệ khớp đầu gối AOLIKES A-7911 Compression support - Blue - L', 'medical'],
    ['Đai bảo vệ cố định khớp vai AOLIKES A-1693 Sport Shoulder Support - Vai Phải', 'medical'],
    ['Dây đai bảo vệ xương bánh chè đầu gối 75589-SPO Actimove Patella Strap - UNI', 'medical'],
    ['Gối massage hồng ngoại vai cổ lưng Shiatsu OKACHI JP-568', 'medical'],

    // Veterinary medicine.
    ['1 hộp NexGard Spectra trị giun, ghẻ, ve rận, viêm da chó 7,5 - 15kg hộp 3 viên', 'vet_medicine'],
    ['Viên nhai Nexgard trị ve rận, bọ chét cho chó 1 viên - 4-10kg', 'vet_medicine'],

    // Raw meat, fish, live seafood.
    ['Tôm hùm Canada Alaska sống size 500g', 'fresh_food'],
    ['Chỉ Giao HCM - ĐÙI GÀ TA GÒ CÔNG 500G', 'fresh_food'],
    ['HCM - Đùi tỏi gà 500g - Thích hợp với các món nướng, sốt cà chua', 'fresh_food'],
    ['Cánh gà khúc giữa Truefood nhập khẩu 500g Chỉ giao hỏa tốc HN', 'fresh_food'],
    ['Chỉ Giao HCM - Thịt ba rọi heo ăn chay BAF 500g', 'fresh_food'],
    ['HCM - Thịt nạc thăn heo 500g - Thích hợp với các món nướng, chiên', 'fresh_food'],
    ['HCM - Chân giò sau heo Chântúi - Thích hợp vói các món hầm nấu cháo', 'fresh_food'],
    ['BẮP BÒ ÚC CẮT LÁT 500G', 'fresh_food'],
    ['HCM - Xương ống bò Úc 500g - Thích hợp với các món canh, hầm,...', 'fresh_food'],
    // ⛔ LOAD-BEARING: `làm sạch` folds to `lam sach`, so a free-floating `sach` book-veto rescued
    // this fillet back into the feed. This case is what caught it — keep it.
    ['Cá ba sa nguyên con làm sạch cắt khúc 1kg Chỉ giao hỏa tốc HN', 'fresh_food'],
    ['Chỉ Giao HCM - Cá đù 1 nắng 300g', 'fresh_food'],

    // Underwear — note the unaccented spellings, which are how the shop supplied them.
    ['Bộ 4 quần lót nữ ren sexy Miley Lingerie FLS06 - S', 'underwear'],
    ['Combo 4 quân lot nam tam giac Bamboo Organic mêm min thoang mat', 'underwear'],
    ['Áo Ngực Nữ Có Gọng Mút Vừa Miley Lingerie - Màu đen BRM01002 - 38B', 'underwear'],
    ['Combo 3 quân lot nam Boxer sơi Organic mêm min thoang mat co gian 4 chiêu', 'underwear'],
    // ⛔ WHITESPACE VARIANTS OF THE SAME GARMENT. Both returned null until `feedNorm` collapsed
    // runs of whitespace — a doubled space and a non-breaking space each bypassed every
    // multi-word rule in the file, and importer titles carry both.
    ['Quần  lót nữ cotton co giãn', 'underwear'],
    ['Quần\u00a0lót nữ cotton co giãn', 'underwear'],
    // `nội y` is the ordinary Vietnamese word and appears in none of the 118 — the rejected rows
    // all said `quần lót`/`áo ngực`. Covered because the policy is about the garment, not the word.
    ['Quần nội y nữ cotton co giãn size M', 'underwear'],

    // Ingestibles carrying a health claim.
    ['Bột Rau Má hữu cơ nguyên chất sấy lạnh Dalahouse - Giải độc, mát gan, thanh nhiệt', 'supplement'],
    ['Bột Diếp Cá Hữu Cơ Nguyên Chất Sấy Lạnh Dalahouse - Bột Uống Detox, Thải Độc Gan', 'supplement'],
    // ⚠️ `supplement`, not `medical`: the medical rules need `máy đo`/`que thử` next to
    // `đường huyết`, so a tea that merely CLAIMS to steady blood sugar falls to the health-claim
    // rule instead. ⚠️ THE LABEL NAMES THE GROUP, NOT THE RULE — three separate rules report
    // `medical`, so a tally of `{medical: 60}` does not tell you which one to edit.
    ['Trà Quế giúp giảm cân, giúp lưu thông máu, tăng kháng thể, ổn định đường huyết', 'supplement'],

    /**
     * ⛔ A FREE GIFT MUST NOT RESCUE THE GOODS. The veto is scoped to `alcohol` and `fresh_food`
     * because that is where books collide; a global one let a bundle title's `tặng kèm túi xách`
     * re-admit a blood-pressure monitor. VN listings name their gifts constantly — several
     * fixtures above carry `Tặng Đèn Soi Tai`, `Tặng 1 Kính Bảo Hộ`, `tặng 1 hộp 50 que thử`.
     */
    ['Máy đo huyết áp Omron HEM-7121 tặng kèm túi xách đựng máy', 'medical'],
    ['Combo 4 quần lót nữ cotton tặng kèm túi xách mini', 'underwear'],
    // …and the veto still holds inside the two groups it was measured on.
    ['Rượu vang Đà Lạt Classic 750ml', 'alcohol'],
    /**
     * ⛔ A FREE GIFT MUST NOT RESCUE THE GOODS INSIDE THE VETOED GROUPS EITHER. Both of these
     * shipped while the veto read the whole title: `túi xách` fired it and the bottle went out.
     * A Tết gift set is the commonest way alcohol is listed here, and Meta enforces alcohol
     * hardest of the six, so it ends up with no veto at all rather than a parseable one.
     */
    ['Rượu vang Đà Lạt Classic 750ml tặng kèm túi xách', 'alcohol'],
    ['Tôm hùm Alaska sống 500g tặng túi xách giữ nhiệt', 'fresh_food'],
    /**
     * ⛔ `- sạch` IS NOT A BOOK. VN food titles advertise hygiene with the same dash the delivery
     * prefix uses, so relaxing the book anchor to accept `Chỉ Giao HCM - Sách…` admitted raw pork.
     * The anchor stays strict, and the cost is recorded below rather than hidden.
     */
    ['Thịt heo BAF - sạch an toàn 500g', 'fresh_food'],
    /**
     * ⚠️ THE ACCEPTED COST OF HAVING NO VETO AT ALL: a book about the food is withheld with the
     * food, via `gà ta`. Every veto that tried to rescue it also re-admitted the goods it was
     * meant to protect — a `Sạch Food` brand defeats `^sach`, and a bundled manga defeated the
     * book list — so the trade is made deliberately and asserted here rather than discovered
     * later as a mystery.
     */
    ['Sách hướng dẫn nuôi gà ta thả vườn', 'fresh_food'],
    ['Chỉ Giao HCM - Sách hướng dẫn nuôi gà ta thả vườn', 'fresh_food'],
    ['Sạch Food - thịt heo tươi 500g giao nhanh', 'fresh_food'],
    ['Tôm hùm Alaska sống 500g tặng truyện tranh tập 1', 'fresh_food'],
    /**
     * ⚠️ ALCOHOL TITLED BY NAME OR BRAND. None of these carry `rượu` or a qualified `bia`, so the
     * rule matched nothing real until the qualified forms and the brands were listed.
     */
    ['Bia Sài Gòn Special 330ml thùng 24 lon', 'alcohol'],
    // ⚠️ Names neither `rượu` nor a listed grape — caught only by `vang` + a bottle volume.
    ['Vang đỏ Chile Central Valley 750ml', 'alcohol'],
    ['Chivas Regal 18 năm 750ml hộp quà', 'alcohol'],
    // ⚠️ A brace that lost its rule when the one-word versions were dropped.
    ['Bó gối thể thao co giãn 1 đôi size L', 'medical'],
    /**
     * ⛔ THE TẾT HAMPER, WHICH IS WHY THE ACCESSORY VETO IS GONE. `ly uống`, `túi xách`, `balo`
     * and `móc khóa` used to veto the `alcohol` rule so a wine-RED backpack and a set of wine
     * GLASSES would survive it. A hamper names the same accessory and joins it with `và` or `+`
     * rather than `tặng`, so cutting the title could not tell them apart — and Meta enforces
     * alcohol hardest of the six groups. ⚠️ THESE PASS BECAUSE ALCOHOL HAS NO VETO, not because
     * anything parses the bundle: there is no veto list at all.
     */
    ['Giỏ quà Tết rượu vang Đà Lạt 750ml và 2 ly uống pha lê', 'alcohol'],
    ['Set rượu vang Chile + túi xách da đựng chai', 'alcohol'],
    /**
     * ⚠️ THE ACCEPTED COST OF CLOSING IT, ASSERTED SO IT STAYS VISIBLE. Alcohol ends up with no
     * veto at all — every version of one leaked, because a hamper names whatever noun the veto
     * trusts. These five are real rows that are now withheld: wine glasses, a display cabinet, a
     * wine-RED backpack, and two books. Five rows against an escape hatch every Tết hamper in the
     * country fits through.
     */
    ['Ly uống rượu vang thủy tinh 300ml set 6 chiếc Luminarc', 'alcohol'],
    ['Tủ Trưng Bày Rượu 117CMx255CMx40CM Hiện Đại Giá Xưởng Mới 99%', 'alcohol'],
    ['Balo dây kéo ANELLO cỡ vừa AT-B0193A - Màu Đỏ Rượu', 'alcohol'],
    ['Sách Ly Rượu Trần Gian', 'alcohol'],
    ['Quán Rượu Dị Giới Nobu - Tập 08', 'alcohol'],
    ['Rượu Vang Đỏ Edengate Hidden Cellar Shiraz 750ml 14 Acl', 'alcohol'],

    // Alcohol. `thùng bia` covers a class the rejected set happened not to contain.
    ['Rượu vang ngọt Passion 750ml 11', 'alcohol'],
    ['Thùng bia Heineken Silver 24 lon 330ml', 'alcohol'],
    ['Rượu Wild Turkey Aged 12 Years 50.5 1x0.7L', 'alcohol'],
    ['Vang sủi Robinvale Grape Sparkling 750ml - Không Cồn Organic - Ruby Nho đỏ', 'alcohol'],
  ])('excludes %s', (title, reason) => {
    expect(feedExcluded(title)).toBe(reason)
  })

  /**
   * ⛔ THESE MUST STAY IN THE FEED. Each one is a product class that IS in the live catalogue and
   * sells normally; a rule that starts matching any of them is silently costing real inventory.
   */
  it.each([
    // ⛔ THE e-VISA PRODUCTS ARE THE POINT OF eno.forum'S CATALOGUE. `nhập cảnh` normalises to
    // `nhap canh`, one character away from the `canh ga` rule — excluding the desk's own products
    // to satisfy a chicken-wing rule would be the worst possible failure of this file.
    // ⚠️ THIS ASSERTS NOTHING ABOUT eno.vn, AND MUST NOT BE READ AS DOING SO. Keeping visa OFF the
    // marketplace is `scopedListingWhere` plus `feedCategories()`/`feedListingTypes()`, which give
    // the marketplace build neither the `services` category nor the `service` listing type — those
    // rows never reach this function there. `feedExcluded` is edition-blind on purpose; if you are
    // adding a marketplace-side visa guard, it belongs in product-feed.ts's gates, not here.
    'Visa điện tử nhập cảnh nhiều lần vào Việt Nam - 1 ngày làm việc',
    'Visa điện tử nhập cảnh một lần vào Việt Nam - Quy trình tiêu chuẩn',
    'Visa điện tử nhập cảnh một lần vào Việt Nam - Cấp tốc 4 giờ',

    // ⛔ `mạ vàng` (gold-plated) normalises to `ma vang` — which is why the alcohol rule may never
    // carry a bare `vang`. This exact cable is in the live feed.
    'Cáp Audio 3.5mm dây tròn 5M Chính hãng Ugreen 10737 mạ vàng 24K',
    // ⛔ `đỏ lót` (red + LINING) folds to `do lot`, so the underwear rule may never carry it.
    'Áo khoác nam màu đỏ lót lông cừu size XL',
    // ⛔ AND THESE GUARD THE `vang` + VOLUME RULE. Gold is sold by karat and by colour, never in
    // millilitres — measured, `vàng trắng`-shaped colour lists alone are 44 rows.
    'Bóng đèn Philips LED Bright E27 ánh sáng vàng 3000K - 13W',
    'Dập ghim 10 Deli - Kèm 1000 ghim - Xanh, vàng, trắng, hồng - 1 cái E0254',
    'Nhẫn cưới vàng trắng 18K đính đá size 10',
    // ⛔ GOLD LEADS WITH THE WORD AS READILY AS WINE, so a start anchor alone was not enough
    // either — the rule needs a bottle-standard volume, which gold never carries.
    'Vàng trắng 18K nhẫn cưới đính đá',
    'Vàng ta 9999 miếng 1 chỉ SJC',
    // ⛔ `champagne` and `cognac` are COLOUR names here — the `vàng` collision, in English.
    'Vòi sen tăng áp màu champagne Inax',
    'Ví da bò nam màu cognac cầm tay',
    // ⛔ Shelf-stable snacks that fold onto meat cuts, and a plumbing fitting onto an elbow brace.
    'Bắp bơ caramel vị phô mai gói 200g',
    'Bánh tai heo giòn tan gói 300g đặc sản Hội An',
    'Bộ khuỷu nối ống nước PVC 90 độ phi 27',
    // ⚠️ Swimwear is ordinary apparel and Meta allows it — `bikini` was here for one round.
    'Bikini nữ hai mảnh họa tiết hoa size M',
    // ⛔ …and these guard the UNIT. Gold is never sold in ml, but paint, engine oil and bin bags
    // are sold by the litre, so the rule takes `ml`/`cl` and never a bare `l`.
    'Sơn nước nội thất màu vàng kem 5L Dulux',
    'Nhớt động cơ màu vàng Castrol GTX 4L',
    // ⛔ …and millilitres are no better than litres: pairing `vang` with a volume was tried and
    // withheld nail polish, perfume and a flask. Only a title that LEADS with `vang` is a wine.
    'Sơn móng tay màu vàng chanh 15ml OPI',
    'Nước hoa nữ hương hoa cỏ màu vàng 50ml',
    'Bình giữ nhiệt inox màu vàng 500ml Lock&Lock',
    /**
     * ⛔ `nẹp` (SPLINT) FOLDS TO `nếp` — twice more than the first narrowing caught. Sticky rice
     * and hair gel are both live categories here; `Giữ Nếp Cong` above is the same collision.
     */
    'Gạo nếp ngon Điện Biên túi 5kg',
    'Gel giữ nếp định hình tóc nam Romano 150ml',

    // ⛔ `bộ gối` (pillow set) normalises identically to `bó gối` (knee brace).
    'Bộ gối cao su non 2 chiếc cao cấp cho phòng ngủ',

    /**
     * ⛔ THE ONE-WORD RULES THAT USED TO SHIP TOOK ALL OF THESE. Each line is a real product read
     * out of catalogue 1023045203452456 on 2026-09-10 while checking what the first draft cost:
     * `heo` matched 42 products, mostly picture books and a DOLPHIN massager; `thit` matched 29
     * meat grinders; `nep ` matched 39 books and cosmetics and not one brace; `cot song` took a
     * mattress. If a future edit widens a rule back to a single word, these fail first.
     */
    'Sách Molly, Milly, Lilly - Câu Chuyện Trưởng Thành Tập 2 Một Chú Heo Con',
    'Agatha Christie - Năm Chú Heo Con - Five Little Pigs',
    'Móc Khóa Mông MoChi Animal Cute Hàng Chính Hãng - Heo',
    'Máy xay thịt Philips HR1502/00',
    'Máy Xay Thịt Cối Inox Lock&Lock EJM172 2 lít Hàng Chính Hãng',
    'Sách Nếp Cũ - Con Người Việt Nam',
    'Cùng Con Rèn Nếp Sinh Hoạt - 45 Quy Tắc Dành Cho Trẻ Mẫu Giáo',
    'Kem Lão Hóa FEIYA - Chống Lão Hóa - Ngừa Nếp Nhăn - Giảm Mụn - 30 Gram',
    'Mascara Lót Nền Siêu Nâng Giữ Nếp Cong Chống Trôi Kissme Heroine Make - 4.5 G',

    /**
     * ⛔ CROSS-SYLLABLE MATCHES. Folding strips diacritics but keeps spaces, so an UNANCHORED
     * two-syllable term runs straight into the next syllable's first letter. Every line below was
     * matched by the rules as first written, and the first one is a visa product — the exact
     * failure the block above calls the worst this file can have. `anyOf`'s `\b` wrapping is what
     * stops them; these fail the moment someone hand-writes an alternation again.
     */
    'Visa điện tử nhập cảnh gấp trong 1 giờ',      // cảnh gấp → `canh ga`
    // ⛔ AND THE RAILWAY CHECKPOINTS, which word anchors CANNOT save: `cảnh` and `ga` really are
    // two whole words here, so `cánh gà` carries a lookbehind for the one word that precedes them.
    'Visa điện tử nhập cảnh ga Đồng Đăng - 3 ngày làm việc',
    'Visa điện tử nhập cảnh ga Lào Cai - Quy trình tiêu chuẩn',
    // ⛔ …and the other two visa verbs. Guarding only `nhập cảnh` left these withheld as poultry.
    'Visa quá cảnh ga Đồng Đăng 3 ngày làm việc',
    'Visa điện tử xuất cảnh ga Lào Cai - Cấp tốc',
    'Bóng đèn LED đui gài B22 Rạng Đông',           // đui gài  → `dui ga`
    'Miếng dán giữ ấm giảm căng cơ bắp 10 miếng',   // giảm căng → `giam can`
    'Bơ Úc nhập khẩu loại 1 hộp 250g',              // bơ Úc    → `bo uc`
    'Ống dẫn đường khí nén 8mm cuộn 10m',           // đường khí → `duong khi`
    'Bìa cứng hồ sơ A4 nhựa PP văn phòng phẩm',     // bìa      → `bia`


    /**
     * ⛔ TWO TERMS THAT WERE COSTING ORDINARY INVENTORY. `song size` also folds `sóng size`
     * (a microwave), and bare `omron` is a whole brand with an industrial relay line — every
     * Omron product in the rejected set is caught by its device word instead.
     */
    'Lò vi sóng size lớn 25L Sharp R-G226VN-BK',
    'Rơ le trung gian Omron MY2N-J 220VAC 8 chân',
    /**
     * ⛔ `chống gù` MATCHED 26 ROWS AND MOST WERE SCHOOL BACKPACKS. Narrowed to `đai chống gù`;
     * the real posture belts carry `aolikes`, `olumba` or that phrase.
     */
    'Balo học sinh tiểu học siêu nhẹ chống gù chống nước cao cấp - đỏ đen',
    'CHÍNH HÃNG ABLUE Ghế chỉnh dáng ngồi đúng, chống gù, Curble Wider - Đen',

    // Ordinary electronics and appliances — the bulk of the catalogue.
    'Card màn hình GIGABYTE GeForce RTX 4070 Ti AERO OC 12GB',
    'iPhone 6S 16GB/ mới 99% / Hồng',
    'Smart Tivi Samsung QLED 4K Vision AI 65 Inch QA65Q7FA',
    'Bàn Ủi Hơi Nước Đứng Panasonic NI-GSG060WRA',
    'Nồi lẩu điện Sunhouse SHD4521 5 lít',
    'Máy hút bụi cầm tay Xiaomi Mi Vacuum Cleaner G10',
    'Tủ lạnh Samsung Inverter 236 lít RT22M4032BU/SV',
    'Cáp DVI ra DVI (24 + 1) dài 3m (DV101) Ugreen 11607',
    'Giày Thể Thao Nam Warrior W27 Màu Trắng Đỏ - Size 39',
    'Cà phê rang xay Arabica Cầu Đất sấy lạnh 500g',
  ])('keeps %s', (title) => {
    expect(feedExcluded(title)).toBeNull()
  })
})

/**
 * The attribute work of 2026-09-18. Each case below is a defect that was live in the feed, not a
 * hypothetical — the measured numbers are in the comments on the functions themselves.
 */
describe('feedStock', () => {
  it('reads availability off the row instead of asserting in_stock', () => {
    expect(feedStock({ status: 'active' })).toBe('in_stock')
    expect(feedStock({ status: 'sold' })).toBe('out_of_stock')
  })
})

describe('gpcFor', () => {
  it('prefers the leaf over the aisle', () => {
    // The whole point: 67,353 electronics rows shared '222' before this.
    expect(gpcFor('electronics', 'phones-tablets')).toBe('267')
    // ⛔ THE TWO SHELVES ADDED BY THE SORTING PASS. Without these the rows land in Merchant Center
    // with no google_product_category, which suppresses them — the defect this whole map prevents.
    // ⚠️ These two assert VERIFIED ids — checked against Google's taxonomy-with-ids file on
    // 2026-09-20, not recalled. The first values written here (`1502`, `359`) were both wrong:
    // one does not exist, the other is Home & Garden. A test like this cannot catch that by
    // itself; the verification is the curl in product-feed.ts's comment.
    expect(gpcFor('electronics', 'pc-components')).toBe('285')
    expect(gpcFor('electronics', 'security-cameras')).toBe('362')
    // ⚠️ The parent, because the slug covers desktops too — a narrower id that is sometimes wrong
    // is worse than the aisle it replaced.
    expect(gpcFor('electronics', 'laptops-pcs')).toBe('278')
    expect(gpcFor('electronics', 'screen-protectors')).toBe('5525')
  })

  it('disambiguates a slug that means two things in two aisles', () => {
    expect(gpcFor('electronics', 'storage')).toBe('499954')          // SSDs
    expect(gpcFor('furniture-appliances', 'storage')).toBe('6356')   // wardrobes
  })

  it('falls back to the aisle rather than emitting nothing', () => {
    expect(gpcFor('electronics', null)).toBe('222')
    expect(gpcFor('electronics', 'a-slug-we-never-mapped')).toBe('222')
    expect(gpcFor('not-a-category', null)).toBeUndefined()
  })
})

describe('feedIdentifiers', () => {
  it('declares identifier_exists=no only where the claim is credible', () => {
    // Unbranded: nobody assigned this thing an identifier — the honest case.
    expect(feedIdentifiers({ model: null, attributes: null }).identifierExists).toBe(true)
    /**
     * ⛔ BRANDED: A BOXED iPHONE HAS A GTIN, WE JUST DO NOT HOLD IT. Declaring `no` here is a
     * false statement about the product rather than a gap in our data — and two reviewers assert
     * Google refuses the attribute beside a brand outright. Omit, and take the warning.
     */
    expect(feedIdentifiers({ brandSlug: 'apple', condition: 'used' }).identifierExists).toBe(false)
    expect(feedIdentifiers({ brandSlug: 'apple', condition: 'new' }).identifierExists).toBe(false)
  })

  it('takes the mpn from the model, but only beside a brand', () => {
    const id = feedIdentifiers({ model: 'BJ18A-RD', brandSlug: 'mipow' })
    expect(id.mpn).toBe('BJ18A-RD')
    expect(id.identifierExists).toBe(false)
    // ⛔ A part number identifies a part of SOMETHING. Unbranded, it is not an identifier at all —
    // and a bare MPN beside `identifier_exists=no` was two contradictory statements in one item.
    const bare = feedIdentifiers({ model: 'BJ18A-RD', brandSlug: null })
    expect(bare.mpn).toBeUndefined()
    expect(bare.identifierExists).toBe(true)
  })

  it('prefers an explicitly stored mpn over the model name', () => {
    expect(feedIdentifiers({ model: 'M4 Pro', attributes: '{"mpn":"MRX33SA/A"}', brandSlug: 'apple' }).mpn).toBe('MRX33SA/A')
  })

  it('reads a barcode stored as a JSON number', () => {
    expect(feedIdentifiers({ attributes: '{"barcode":8935001820017}' }).gtin).toBe('8935001820017')
  })

  it('refuses a merchant sku wearing a barcode field name', () => {
    expect(feedIdentifiers({ attributes: '{"barcode":"CPS-99120"}' }).gtin).toBeUndefined()
    expect(feedIdentifiers({ attributes: '{"barcode":"8935001820017"}' }).gtin).toBe('8935001820017')
  })

  it('checks the GTIN check digit, not just the length', () => {
    // ⛔ A 13-digit merchant id passes a length test and then gets the ITEM rejected.
    expect(isGtin('8935001820017')).toBe(true)   // a real Vietnamese EAN-13 prefix (893)
    expect(isGtin('8935001820018')).toBe(false)  // same digits, wrong check digit
    expect(isGtin('4006381333931')).toBe(true)   // the EAN-13 in Google's own examples
    expect(isGtin('12345678')).toBe(false)
    expect(isGtin('96385074')).toBe(true)        // a valid EAN-8
  })

  it('survives a malformed attributes column', () => {
    expect(feedIdentifiers({ attributes: 'not json' }).identifierExists).toBe(true)
    expect(feedIdentifiers({ attributes: '[1,2]' }).identifierExists).toBe(true)
  })

  it('reads an already-parsed object, so the page and the feed cannot disagree', () => {
    expect(feedIdentifiers({ attributes: { barcode: '8935001820017' } }).gtin).toBe('8935001820017')
  })
})

describe('feedApparel', () => {
  const row = { category: { slug: 'sports' }, subcategorySlug: 'sportswear' }

  it('emits colour and gender in Google vocabulary', () => {
    // ⚠️ Labels, not our filter slugs: `neutral` is a chip, "Beige" is a colour a shopper searches.
    const a = feedApparel({ ...row, attributes: '{"color":"black","gender":"men"}' })
    expect(a).toMatchObject({ color: 'Black', gender: 'male' })
    expect(feedApparel({ ...row, attributes: '{"color":"neutral"}' }).color).toBe('Beige')
  })

  it('emits a size only when the row has exactly one', () => {
    // "XS, S, M, L, XL" is five products, not a size — see the note on feedApparel.
    expect(feedApparel({ ...row, facetTokens: '|size:m|' }).size).toBe('M')
    expect(feedApparel({ ...row, facetTokens: '|size:xs|size:s|size:m|' }).size).toBeUndefined()
    // ⛔ A multi-size row must fall through to NOTHING, never to a stray attributes.size.
    expect(feedApparel({ ...row, facetTokens: '|size:xs|size:m|', attributes: '{"size":"l"}' }).size).toBeUndefined()
    // ⛔ `xs-s` and `eu-44-plus` are browse BUCKETS — not sizes any garment is made in.
    expect(feedApparel({ ...row, facetTokens: '|size:xs-s|' }).size).toBeUndefined()
    expect(feedApparel({ ...row, facetTokens: '|shoeSize:eu-44-plus|' }).size).toBeUndefined()
    expect(feedApparel({ ...row, facetTokens: '|shoeSize:eu-41|' }).size).toBe('41')
    // ⚠️ Mixed axes are ambiguous too — one size, on one axis, or nothing.
    expect(feedApparel({ ...row, facetTokens: '|size:xs|size:m|shoeSize:eu-41|' }).size).toBeUndefined()
  })

  it('marks kids apparel and leaves adult apparel unmarked', () => {
    expect(feedApparel({ category: { slug: 'baby-kids' }, subcategorySlug: 'kids-shoes' }).ageGroup).toBe('kids')
    // This function only ever runs on apparel, so "not kids" means adult and should say so.
    expect(feedApparel(row).ageGroup).toBe('adult')
  })

  it('cannot be talked into a prototype method by a seller-supplied value', () => {
    expect(feedApparel({ ...row, attributes: '{"gender":"constructor"}' }).gender).toBeUndefined()
  })

  it('takes the gender from the shelf when the attribute is empty', () => {
    expect(feedApparel({ category: { slug: 'fashion-beauty' }, subcategorySlug: 'womens' }).gender).toBe('female')
    expect(feedApparel({ category: { slug: 'fashion-beauty' }, subcategorySlug: 'mens' }).gender).toBe('male')
    // An explicit attribute still wins over the shelf.
    expect(feedApparel({ category: { slug: 'fashion-beauty' }, subcategorySlug: 'womens', attributes: '{"gender":"unisex"}' }).gender).toBe('unisex')
  })

  it('matches regardless of case, so a typed attribute does not silently drop', () => {
    expect(feedApparel({ ...row, attributes: '{"gender":"Men","color":"Black"}' }))
      .toMatchObject({ gender: 'male', color: 'Black' })
    expect(feedApparel({ ...row, attributes: '{"color":"Other"}' }).color).toBeUndefined()
  })
})

describe('isApparel', () => {
  it('covers the aisles that actually carry clothing', () => {
    // Measured: the apparel surface is ~4,400 rows and is mostly sports, not fashion-beauty.
    expect(isApparel('sports', 'sportswear')).toBe(true)
    expect(isApparel('sports', 'sports-shoes')).toBe(true)
    expect(isApparel('baby-kids', 'kids-clothing')).toBe(true)
  })

  it('leaves non-apparel alone — an age_group on a lipstick is its own error', () => {
    expect(isApparel('electronics', 'laptops-pcs')).toBe(false)
    expect(isApparel('sports', 'racket-ball')).toBe(false)
    // ⛔ The aisle is not the garment: fashion-beauty is 301 cosmetics rows plus bags and watches,
    // and gym-yoga is mostly mats and dumbbells.
    expect(isApparel('fashion-beauty', 'beauty')).toBe(false)
    expect(isApparel('fashion-beauty', null)).toBe(false)
    expect(isApparel('sports', 'gym-yoga')).toBe(false)
  })
})

describe('feedApparel colour hygiene', () => {
  it('drops the taxonomy "other" chip rather than publishing it as a colour', () => {
    const row = { category: { slug: 'sports' }, subcategorySlug: 'sportswear' }
    expect(feedApparel({ ...row, attributes: '{"color":"other"}' }).color).toBeUndefined()
    expect(feedApparel({ ...row, attributes: '{"color":"blue"}' }).color).toBe('Blue')
  })
})

describe('gpcFor prototype safety', () => {
  /**
   * ⛔ THE SAME BUG THE `MERCHANT_NAMES` MAP IN affiliate-price-refresh.ts ALREADY RECORDS. A bare
   * object index reads through Object.prototype, and `??` does not catch an inherited method — so a
   * seller-reachable slug of `constructor` put a FUNCTION inside an XML element.
   */
  it('does not return a prototype method for a slug that names one', () => {
    expect(gpcFor('electronics', 'constructor')).toBe('222')
    expect(gpcFor('constructor', null)).toBeUndefined()
    expect(gpcFor('toString', 'hasOwnProperty')).toBeUndefined()
  })
})

describe('feedApparel gender on maternity', () => {
  it('names a gender for every apparel subcategory that carries no attribute', () => {
    expect(feedApparel({ category: { slug: 'baby-kids' }, subcategorySlug: 'maternity' }).gender).toBe('female')
  })
})
