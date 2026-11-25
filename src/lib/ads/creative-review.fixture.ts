import type { AdQuestionKey, AdWords } from './review-jev'

/**
 * ── THE AD REVIEW'S CALIBRATION SET: 30 hand-made ads, 15 lawful and 15 not (owner 2026-11-25), plus one more unlawful ad for
 * each refusing class the 30 left without a sample (36 in all). Each names the classes
 * Jev should answer HIGH for it: the refusal class of an unlawful ad, the permit classes of a lawful one (permit classes
 * are allowed since 2026-11-25 and only recorded). Every other class should answer low.
 *
 * Two readers:
 *   · scripts/ad-review-calibrate.ts sends each one to the LIVE model (needs TYPESAFE_API_KEY) and prints, per class, the
 *     scores of the samples labelled with it against the rest — the numbers JEV_AD_THRESHOLDS (review-jev.ts) must be
 *     re-pinned from, with JEV_AD_MODEL;
 *   · creative-review.test.ts runs the review over them with Jev MOCKED to answer each label — it proves the plumbing
 *     (labels → refusals or permit classes → verdict), never the model.
 * ⚠️ Words in several languages on purpose (owner 2026-11-25: "any language").
 */
export type ReviewSample = { id: string; words: AdWords; expect: 'approve' | 'refuse'; classes: AdQuestionKey[] }

const w = (advertiserName: string, headline: string, body: string, landingHost: string, landingTitle: string, landingDescription = ''): AdWords => ({
  advertiserName, legalName: `${advertiserName} Company Limited`, headline, body, landingHost, landingTitle, landingDescription,
})

export const REVIEW_SAMPLES: ReviewSample[] = [
  // ── Lawful, no permit class ────────────────────────────────────────────────────────────────────────────────────────
  { id: 'coffee', expect: 'approve', classes: [], words: w('Saigon Bean', 'Cà phê rang xay mỗi sáng', 'Giao tận nơi ở Quận 1 và Quận 3', 'saigonbean.vn', 'Saigon Bean — cà phê rang xay') },
  { id: 'english-school', expect: 'approve', classes: [], words: w('Lotus English', 'Learn English with friendly teachers', 'Small evening classes in Thảo Điền', 'lotusenglish.edu.vn', 'Lotus English Centre') },
  { id: 'moto-rental', expect: 'approve', classes: [], words: w('Ride Saigon', 'Rent a Honda Vision from 150k a day', 'Helmets and delivery included', 'ridesaigon.com', 'Motorbike rental in Ho Chi Minh City') },
  { id: 'sofa-sale', expect: 'approve', classes: [], words: w('Nhà Xinh Home', 'Sofa sale this weekend: 20% off', 'Free delivery inside the city', 'nhaxinhhome.vn', 'Sofa and living room furniture') },
  { id: 'movers', expect: 'approve', classes: [], words: w('Easy Move VN', 'Moving house? We pack and carry', 'Fixed price quote in one call', 'easymove.vn', 'House moving service') },
  { id: 'yoga-ko', expect: 'approve', classes: [], words: w('Lotus Yoga', '요가 첫 수업 무료', '7군 푸미흥 스튜디오', 'lotusyoga.vn', 'Lotus Yoga Studio Phú Mỹ Hưng') },
  { id: 'ramen-ja', expect: 'approve', classes: [], words: w('Menya Saigon', '本格ラーメン 1区', '平日ランチセットあり', 'menyasaigon.com', 'Menya Saigon ramen') },
  { id: 'craft-beer', expect: 'approve', classes: [], words: w('Heart of Darkness', 'Craft beer tasting night', 'Five IPAs at 5% to 7%, Friday from 7 pm', 'heartofdarknessbrewery.com', 'Heart of Darkness Craft Brewery') },
  { id: 'coworking', expect: 'approve', classes: [], words: w('Dreamplex', 'Hot desks in District 1', 'Day passes and monthly plans', 'dreamplex.co', 'Coworking space in Ho Chi Minh City') },
  { id: 'laundry-vi', expect: 'approve', classes: [], words: w('Giặt Ủi Nhanh', 'Giặt ủi lấy trong ngày', 'Nhận và giao tận nhà ở Thủ Đức', 'giatuinhanh.vn', 'Dịch vụ giặt ủi') },
  // ── Lawful, in a permit class (allowed; the class is recorded) ─────────────────────────────────────────────────────
  { id: 'skincare', expect: 'approve', classes: ['cosmetics'], words: w('Cỏ Mềm', 'Natural skincare made in Đà Lạt', 'Lip balm, toner and cream', 'comem.vn', 'Cỏ Mềm — mỹ phẩm thiên nhiên') },
  { id: 'savings', expect: 'approve', classes: ['finance'], words: w('Saigon Bank', 'Open a savings account online', 'In ten minutes, with your passport', 'saigonbank.example.vn', 'Savings accounts for foreigners') },
  { id: 'dental', expect: 'approve', classes: ['medical'], words: w('Smile Dental', 'Teeth cleaning and check-up', 'English-speaking dentists in District 2', 'smiledental.vn', 'Smile Dental Clinic') },
  { id: 'villa-project', expect: 'approve', classes: ['real_estate_project'], words: w('River Homes', 'Riverside villas: book a viewing', 'A new project in Thủ Thiêm, handover 2028', 'riverhomes.vn', 'River Homes villa project') },
  { id: 'study-abroad', expect: 'approve', classes: ['study_work_abroad'], words: w('Go Abroad Edu', 'Study in Australia: free consultation', 'Advice on schools and scholarships', 'goabroad.edu.vn', 'Study abroad consultancy') },
  // ── Unlawful: banned classes ───────────────────────────────────────────────────────────────────────────────────────
  { id: 'vape', expect: 'refuse', classes: ['tobacco'], words: w('Cloud Nine', 'New vape pods, all flavours', 'Delivery in one hour', 'cloudnine.vn', 'Vape and pod shop') },
  { id: 'whisky', expect: 'refuse', classes: ['alcohol'], words: w('Spirit House', 'Single malt whisky, 40% ABV', 'Imported bottles at duty-free prices', 'spirithouse.vn', 'Whisky and spirits') },
  { id: 'formula', expect: 'refuse', classes: ['infant_formula'], words: w('Baby Grow', 'Infant formula for 0 to 12 months', 'Closest to breast milk', 'babygrow.vn', 'Sữa công thức cho bé') },
  { id: 'antibiotics', expect: 'refuse', classes: ['prescription_drugs'], words: w('Fast Pharma', 'Antibiotics delivered, no prescription', 'Amoxicillin and azithromycin in stock', 'fastpharma.vn', 'Online pharmacy') },
  { id: 'replica-guns', expect: 'refuse', classes: ['weapons'], words: w('Tactical VN', 'Realistic replica pistols and tasers', 'Metal body, real weight', 'tacticalvn.com', 'Tactical gear') },
  { id: 'fireworks', expect: 'refuse', classes: ['fireworks'], words: w('Tết Sparkle', 'Pháo hoa Tết giao tận nhà', 'Pháo dàn 36 quả', 'tetsparkle.vn', 'Pháo hoa Tết') },
  { id: 'casino', expect: 'refuse', classes: ['gambling'], words: w('Lucky88', 'Online casino: 100% welcome bonus', 'Slots, baccarat and football betting', 'lucky88.bet', 'Lucky88 casino') },
  { id: 'escort', expect: 'refuse', classes: ['sexual'], words: w('Saigon Angels', 'VIP girls to your hotel tonight', 'Discreet, 24/7', 'saigonangels.club', 'Escort service') },
  { id: 'replica-watch', expect: 'refuse', classes: ['counterfeit'], words: w('Time Luxe', '1:1 Rolex replicas, super fake', 'Swiss movement copy', 'timeluxe.shop', 'Replica watches') },
  { id: 'ivory', expect: 'refuse', classes: ['wildlife'], words: w('Jungle Gifts', 'Real ivory bracelets', 'Lucky charms from Africa', 'junglegifts.vn', 'Ivory and horn gifts') },
  { id: 'mlm', expect: 'refuse', classes: ['mlm'], words: w('Wealth Circle', 'Earn 50 million a month recruiting friends', 'Join our team, build your downline', 'wealthcircle.vn', 'Business opportunity') },
  { id: 'spy-cam', expect: 'refuse', classes: ['spy_devices'], words: w('Spy Shop', 'Hidden pen camera, records 8 hours', 'Nobody will notice', 'spyshop.vn', 'Spy cameras') },
  { id: 'evisa', expect: 'refuse', classes: ['visa_legal'], words: w('Visa Fast', 'Vietnam e-visa in 24 hours', 'Work permits and residence cards too', 'visafast.vn', 'Visa services') },
  // ── Unlawful: Art. 8 and misleading claims ─────────────────────────────────────────────────────────────────────────
  { id: 'best-coffee', expect: 'refuse', classes: ['superlative'], words: w('Bean King', 'Cà phê ngon nhất Việt Nam, số 1', 'Không đâu sánh bằng', 'beanking.vn', 'Bean King coffee') },
  { id: 'slimming', expect: 'refuse', classes: ['misleading', 'supplements'], words: w('Slim Fast VN', 'Lose 10 kg in 7 days, guaranteed', '100% effective herbal capsules', 'slimfastvn.com', 'Weight loss capsules') },
  // ── One more for every refusing class the 30 leave unmeasured (commit gate, opus: a class with no sample is not
  //    calibrated, ad-review-calibrate.ts fails it) ────────────────────────────────────────────────────────────────
  { id: 'party-pills', expect: 'refuse', classes: ['drugs'], words: w('Night Owl', 'Party pills and happy gas for your weekend', 'Fast discreet delivery', 'nightowl.vn', 'Party supplies') },
  { id: 'debt', expect: 'refuse', classes: ['debt_collection'], words: w('Đòi Nợ Nhanh', 'Đòi nợ thuê, thu hồi nợ khó đòi', 'Xử lý trong 3 ngày', 'doinonhanh.vn', 'Dịch vụ đòi nợ') },
  { id: 'customer-data', expect: 'refuse', classes: ['unlawful'], words: w('Data Leads', 'Buy 1 million phone numbers and customer lists', 'Fresh data by district and income', 'dataleads.vn', 'Customer data') },
  { id: 'versus', expect: 'refuse', classes: ['comparison'], words: w('Fresh Mart', 'Cheaper than Bách Hóa Xanh, better than Co.op', 'Compare our prices with theirs', 'freshmart.vn', 'Fresh Mart groceries') },
  { id: 'flag', expect: 'refuse', classes: ['national_symbols'], words: w('Vina Pride', 'Our shirts carry the national flag and Uncle Ho\'s portrait', 'Proud of Vietnam', 'vinapride.vn', 'Patriotic apparel') },
  { id: 'map', expect: 'refuse', classes: ['map'], words: w('Sea Tours', 'Our map of Vietnam: Hoàng Sa to Trường Sa', 'Island hopping trips', 'seatours.vn', 'Island tours') },
]
