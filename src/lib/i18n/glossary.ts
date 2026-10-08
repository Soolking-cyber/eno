import type { Language } from './langs'

// Curated glossary for short, ambiguous UI terms that machine translation gets
// wrong out of context (e.g. the bare verb "Post" → 後 "after", "Property" → ru
// "Свойства" object-attributes instead of real estate). Checked by tr() AND
// useTr()/<Tr> before the MT cache. Entries are PARTIAL — any language not listed
// falls through to machine translation. Values are native-marketplace-reviewed
// (2026-07-06 i18n audit, 3 language review panels): category tiles + top-nav
// terms — the highest-visibility strings, where a wrong sense is most jarring.
// The same values are seeded into the Translation DB (scripts/seed-glossary.mjs)
// so server-embedded paths agree; this client copy guarantees them even if a DB
// row is later re-translated. Keep the two in sync.
export const TR_OVERRIDES: Record<string, Partial<Record<Language, string>>> = {
  // A mobile CARRIER's brand (ASIM's "Local", the Services > eSIM carrier chip), not the adjective,
  // which MT renders as ko 지역 / ja 地元 / fr Locale. A name stays a name. Mirrored in glossary-data.json.
  Local: { 'zh-Hans': 'Local', ko: 'Local', ja: 'Local', ru: 'Local', km: 'Local', ms: 'Local', th: 'Local', fr: 'Local', hi: 'Local' },
  Post: { 'zh-Hans': '发布', ko: '등록', ja: '投稿', ru: 'Разместить', fr: 'Publier' },
  // ⛔ SIGN IN WITH APPLE'S BUTTON TITLE IS APPLE'S OWN STRING, NEVER A MACHINE TRANSLATION (HIG: "use only Sign in
  // with Apple, Sign up with Apple, or Continue with Apple"; App Review judges a custom button by it). These are the
  // titles Apple's own button shows in each language (the Vietnamese, "Tiếp tục với Apple", is the tr() pair in
  // sign-in-form.tsx). Apple ships no Khmer title, so km keeps the English — pinned, so the engine cannot invent one.
  // Mirrored in scripts/glossary-data.json; i18n/apple-title.test.ts holds the two to each other and to this table.
  'Continue with Apple': { 'zh-Hans': '通过 Apple 继续', ko: 'Apple로 계속하기', ja: 'Appleで続ける', ru: 'Продолжить с Apple', km: 'Continue with Apple', ms: 'Teruskan dengan Apple', th: 'ดำเนินการต่อด้วย Apple', fr: 'Continuer avec Apple', hi: 'Apple से जारी रखें' },
  // Saved-listings nav: marketplaces use "favorites", not generic "saved" (Avito
  // Избранное, Leboncoin Favoris, 闲鱼 收藏, Karrot 찜 목록, ジモティー お気に入り).
  Saved: { 'zh-Hans': '收藏', ko: '찜 목록', ja: 'お気に入り', ru: 'Избранное', km: 'បានរក្សាទុក', ms: 'Disimpan', th: 'บันทึกไว้', fr: 'Favoris', hi: 'सेव किए गए' },
  'Recently viewed': { 'zh-Hans': '最近浏览', ko: '최근 본 상품', ja: '閲覧履歴', ru: 'Вы недавно смотрели', km: 'បានមើលថ្មីៗនេះ', ms: 'Dilihat baru-baru ini', th: 'ดูล่าสุด', fr: 'Vus récemment', hi: 'हाल ही में देखे गए' },
  // ── SENSE-TAGGED entries: `word@sense`, read by tr(en, vi, sense) / <Tr text ctx> before the plain word.
  // "Home" below is the FURNITURE CATEGORY; the homepage link (breadcrumbs, the sold page) is a different
  // word in every one of these languages, and sharing the key printed "Для дома" ("for the home") as
  // the first crumb of every Russian breadcrumb. ⚠️ Client-only, and deliberately NOT mirrored into
  // scripts/glossary-data.json: those rows seed the Translation table keyed by the English source, and
  // `Home@page` is not a string anything sends to the translator.
  'Home@page': { 'zh-Hans': '首页', ko: '홈', ja: 'ホーム', ru: 'Главная', km: 'ទំព័រដើម', ms: 'Laman Utama', th: 'หน้าแรก', fr: 'Accueil', hi: 'होम' },
  // ── Templates the engine reduced to a bare number (measured 2026-10-05 with numbered placeholders: km
  // "{n} available" → "{n}", "{total} listing." and "{total} listings." → "{total}"). Client-only like
  // `Home@page`: only the client renders these templates in a machine-translated language.
  // The second batch (measured on prod after the 2026-10-05 warm run) came from the {placeholder} conversion:
  // km dropped every word but the number, zh-Hans lost "step … of". Checked against the cache with
  // ~/eno-i18n-work/db-tokens.mjs ("token-correct but no words left").
  '{n} available': { km: 'មាន {n}' },
  '{label}, {badgeLabel} new': { km: '{label}, {badgeLabel} ថ្មី' },
  '{n} contacted': { km: '{n} នាក់បានទាក់ទង' },
  '{size} files ready': { km: 'ឯកសារ {size} រួចរាល់' },
  '· {days} day left': { km: '· នៅសល់ {days} ថ្ងៃ' },
  '· {days} days left': { km: '· នៅសល់ {days} ថ្ងៃ' },
  '{length} replies': { km: '{length} ការឆ្លើយតប' },
  '{label} — step {n} of {total}': { 'zh-Hans': '{label} — 第{n}步，共{total}步' },
  '{total} listing.': { km: 'បញ្ជីចំនួន {total}។' },
  '{total} listings.': { km: 'បញ្ជីចំនួន {total}។' },
  // ── Category tiles (DB Category.name → <Tr>) — bare words MT reliably mis-senses ──
  Vehicles: { 'zh-Hans': '交通工具', ko: '차량', ja: '乗り物', ru: 'Транспорт', km: 'យានយន្ត', ms: 'Kenderaan', th: 'ยานพาหนะ', fr: 'Véhicules', hi: 'वाहन' },
  Rentals: { 'zh-Hans': '租赁', ko: '렌탈·임대', ja: 'レンタル・賃貸', ru: 'Аренда', km: 'ជួល', ms: 'Sewaan', th: 'ให้เช่า', fr: 'Locations', hi: 'किराये पर' },
  // Real estate — NOT object attributes (the ru "Свойства" bug).
  Property: { 'zh-Hans': '房产', ko: '부동산', ja: '不動産', ru: 'Недвижимость', km: 'អចលនទ្រព្យ', ms: 'Hartanah', th: 'อสังหาริมทรัพย์', fr: 'Immobilier', hi: 'प्रॉपर्टी' },
  // Moving SALE — not relocation services.
  Moving: { 'zh-Hans': '搬家转让', ko: '이사 정리', ja: '引っ越しセール', ru: 'Распродажа при переезде', km: 'លក់ឥវ៉ាន់ផ្លាស់ផ្ទះ', ms: 'Jualan Pindah Rumah', th: 'ขายย้ายบ้าน', fr: 'Déménagement', hi: 'शिफ्टिंग सेल' },
  // Furniture & household goods — not a house.
  Home: { 'zh-Hans': '家居', ko: '가구·인테리어', ja: '家具・インテリア', ru: 'Для дома', km: 'គ្រឿងសង្ហារឹម', ms: 'Perabot & Barangan Rumah', th: 'ของใช้ในบ้าน', fr: 'Maison & Déco', hi: 'घरेलू सामान' },
  Electronics: { 'zh-Hans': '电子产品', ko: '디지털 기기', ja: '家電・スマホ・カメラ', ru: 'Электроника', km: 'គ្រឿងអេឡិចត្រូនិក', ms: 'Elektronik', th: 'อิเล็กทรอนิกส์', fr: 'Électronique', hi: 'इलेक्ट्रॉनिक्स' },
  Fashion: { 'zh-Hans': '服饰', ko: '패션', ja: 'ファッション', ru: 'Одежда и обувь', km: 'សម្លៀកបំពាក់', ms: 'Fesyen', th: 'แฟชั่น', fr: 'Mode', hi: 'फैशन' },
  // Children's GOODS — not "children".
  Kids: { 'zh-Hans': '母婴用品', ko: '유아동', ja: 'ベビー・キッズ', ru: 'Детские товары', km: 'សម្ភារៈកុមារ', ms: 'Bayi & Kanak-kanak', th: 'แม่และเด็ก', fr: 'Enfants & bébés', hi: 'बच्चों का सामान' },
  Hobbies: { 'zh-Hans': '兴趣爱好', ko: '취미', ja: '趣味', ru: 'Хобби и отдых', km: 'ចំណង់ចំណូលចិត្ត', ms: 'Hobi', th: 'กีฬาและงานอดิเรก', fr: 'Loisirs', hi: 'शौक' },
  Pets: { 'zh-Hans': '宠物', ko: '반려동물', ja: 'ペット', ru: 'Животные', km: 'សត្វចិញ្ចឹម', ms: 'Haiwan Peliharaan', th: 'สัตว์เลี้ยง', fr: 'Animaux', hi: 'पालतू जानवर' },
  Jobs: { 'zh-Hans': '招聘', ko: '구인구직', ja: '求人', ru: 'Работа', km: 'ការងារ', ms: 'Kerja Kosong', th: 'งาน', fr: 'Emploi', hi: 'नौकरियां' },
  Services: { 'zh-Hans': '生活服务', ko: '생활서비스', ja: 'サービス', ru: 'Услуги', km: 'សេវាកម្ម', ms: 'Perkhidmatan', th: 'บริการ', fr: 'Services', hi: 'सेवाएं' },
  Community: { 'zh-Hans': '社区', ko: '커뮤니티', ja: 'コミュニティ', ru: 'Сообщество', km: 'សហគមន៍', ms: 'Komuniti', th: 'ชุมชน', fr: 'Communauté', hi: 'समुदाय' },
  Travel: { 'zh-Hans': '旅游', ko: '여행', ja: '旅行', ru: 'Путешествия', km: 'ទេសចរណ៍', ms: 'Pelancongan', th: 'ท่องเที่ยว', fr: 'Voyages', hi: 'यात्रा' },
  Food: { 'zh-Hans': '美食', ko: '식품', ja: '食品', ru: 'Продукты', km: 'អាហារ', ms: 'Makanan & Minuman', th: 'อาหารและเครื่องดื่ม', fr: 'Alimentation', hi: 'खान-पान' },
  // Intent shortcut tiles.
  'Free & Giveaways': { 'zh-Hans': '免费赠送', ko: '무료나눔', ja: '無料・あげます', ru: 'Отдам даром', km: 'ចែកជូនឥតគិតថ្លៃ', ms: 'Barang Percuma', th: 'แจกฟรี', fr: 'À donner', hi: 'मुफ़्त सामान' },
  // ── Cover lessons (teacher profiles, 2026-10-07) — "cover" is SUBSTITUTE TEACHING here, never shelter or a lid:
  // measured on the preview, ko rendered "Available for cover" as 엄폐 가능 (take cover) and "Cover area" as 덮개 구역
  // (lid area). Mirrored in scripts/glossary-data.json.
  'Cover lessons': { 'zh-Hans': '代课', ko: '대체 수업', ja: '代講', ru: 'Замены уроков', km: 'ការបង្រៀនជំនួស', ms: 'Mengajar ganti', th: 'สอนแทน', fr: 'Remplacements', hi: 'स्थानापन्न कक्षाएँ' },
  'Available for cover': { 'zh-Hans': '可代课', ko: '대체 수업 가능', ja: '代講可能', ru: 'Берёт замены', km: 'អាចបង្រៀនជំនួស', ms: 'Boleh mengajar ganti', th: 'รับสอนแทน', fr: 'Disponible pour des remplacements', hi: 'स्थानापन्न पढ़ाने के लिए उपलब्ध' },
  'Available for cover lessons': { 'zh-Hans': '可代课', ko: '대체 수업 가능', ja: '代講可能', ru: 'Берёт замены уроков', km: 'អាចបង្រៀនជំនួស', ms: 'Boleh mengajar ganti', th: 'รับสอนแทน', fr: 'Disponible pour des remplacements', hi: 'स्थानापन्न पढ़ाने के लिए उपलब्ध' },
  'Free for cover': { 'zh-Hans': '可代课时段', ko: '대체 수업 가능 시간', ja: '代講できる時間帯', ru: 'Свободное время для замен', km: 'ពេលទំនេរសម្រាប់បង្រៀនជំនួស', ms: 'Masa lapang untuk mengajar ganti', th: 'เวลาว่างสอนแทน', fr: 'Créneaux de remplacement', hi: 'स्थानापन्न पढ़ाने का खाली समय' },
  'Cover area': { 'zh-Hans': '代课区域', ko: '대체 수업 지역', ja: '代講エリア', ru: 'Район для замен', km: 'តំបន់បង្រៀនជំនួស', ms: 'Kawasan mengajar ganti', th: 'พื้นที่สอนแทน', fr: 'Zone de remplacement', hi: 'स्थानापन्न पढ़ाने का क्षेत्र' },
  'Cover areas': { 'zh-Hans': '代课区域', ko: '대체 수업 지역', ja: '代講エリア', ru: 'Районы для замен', km: 'តំបន់បង្រៀនជំនួស', ms: 'Kawasan mengajar ganti', th: 'พื้นที่สอนแทน', fr: 'Zones de remplacement', hi: 'स्थानापन्न पढ़ाने के क्षेत्र' },
  'a cover lesson': { 'zh-Hans': '代课', ko: '대체 수업', ja: '代講', ru: 'замене урока', km: 'ការបង្រៀនជំនួស', ms: 'kelas ganti', th: 'การสอนแทน', fr: 'un remplacement', hi: 'स्थानापन्न कक्षा' },
  'Cover lessons are on': { 'zh-Hans': '已开启代课', ko: '대체 수업 요청을 받고 있어요', ja: '代講を受け付け中', ru: 'Замены включены', km: 'កំពុងទទួលបង្រៀនជំនួស', ms: 'Mengajar ganti dihidupkan', th: 'เปิดรับสอนแทนแล้ว', fr: 'Remplacements activés', hi: 'स्थानापन्न कक्षाएँ चालू हैं' },
  'New: cover lessons': { 'zh-Hans': '新功能：代课', ko: '새 기능: 대체 수업', ja: '新機能：代講', ru: 'Новое: замены уроков', km: 'ថ្មី៖ ការបង្រៀនជំនួស', ms: 'Baharu: mengajar ganti', th: 'ใหม่: สอนแทน', fr: 'Nouveau : les remplacements', hi: 'नया: स्थानापन्न कक्षाएँ' },
  'Set up cover lessons': { 'zh-Hans': '设置代课', ko: '대체 수업 설정하기', ja: '代講を設定する', ru: 'Настроить замены', km: 'រៀបចំការបង្រៀនជំនួស', ms: 'Sediakan mengajar ganti', th: 'ตั้งค่าการสอนแทน', fr: 'Configurer les remplacements', hi: 'स्थानापन्न कक्षाएँ सेट करें' },
  'I can take cover lessons': { 'zh-Hans': '我可以代课', ko: '대체 수업을 할 수 있어요', ja: '代講を引き受けられます', ru: 'Я могу брать замены', km: 'ខ្ញុំអាចបង្រៀនជំនួសបាន', ms: 'Saya boleh mengajar ganti', th: 'ฉันรับสอนแทนได้', fr: 'Je peux faire des remplacements', hi: 'मैं स्थानापन्न कक्षाएँ ले सकता/सकती हूँ' },
  'Where can you teach a cover?': { 'zh-Hans': '您可以在哪里代课？', ko: '어디에서 대체 수업을 할 수 있나요?', ja: 'どこで代講できますか？', ru: 'Где вы можете провести замену?', km: 'តើអ្នកអាចបង្រៀនជំនួសនៅឯណា?', ms: 'Di mana anda boleh mengajar ganti?', th: 'คุณสอนแทนได้ที่ไหนบ้าง?', fr: 'Où pouvez-vous faire un remplacement ?', hi: 'आप कहाँ स्थानापन्न कक्षा ले सकते हैं?' },
  'Find a cover teacher': { 'zh-Hans': '寻找代课老师', ko: '대체 교사 찾기', ja: '代講の先生を探す', ru: 'Найти учителя на замену', km: 'រកគ្រូបង្រៀនជំនួស', ms: 'Cari guru ganti', th: 'หาครูสอนแทน', fr: 'Trouver un professeur remplaçant', hi: 'स्थानापन्न शिक्षक खोजें' },
  'Schools: find a cover teacher': { 'zh-Hans': '学校：寻找代课老师', ko: '학교: 대체 교사 찾기', ja: '学校の方：代講の先生を探す', ru: 'Школам: найдите учителя на замену', km: 'សាលារៀន៖ រកគ្រូបង្រៀនជំនួស', ms: 'Sekolah: cari guru ganti', th: 'โรงเรียน: หาครูสอนแทน', fr: 'Écoles : trouvez un professeur remplaçant', hi: 'स्कूल: स्थानापन्न शिक्षक खोजें' },
  'Need a cover teacher? See who is free': { 'zh-Hans': '需要代课老师？看看谁有空', ko: '대체 교사가 필요하신가요? 가능한 선생님을 확인하세요', ja: '代講の先生が必要ですか？空いている先生を見る', ru: 'Нужен учитель на замену? Посмотрите, кто свободен', km: 'ត្រូវការគ្រូបង្រៀនជំនួស? មើលថាអ្នកណាទំនេរ', ms: 'Perlukan guru ganti? Lihat siapa yang lapang', th: 'ต้องการครูสอนแทน? ดูว่าใครว่าง', fr: 'Besoin d’un remplaçant ? Voyez qui est disponible', hi: 'स्थानापन्न शिक्षक चाहिए? देखें कौन खाली है' },
  'Offer cover lessons — free': { 'zh-Hans': '提供代课——免费', ko: '대체 수업 제공 — 무료', ja: '代講を引き受ける — 無料', ru: 'Брать замены — бесплатно', km: 'ផ្តល់ការបង្រៀនជំនួស — ឥតគិតថ្លៃ', ms: 'Tawarkan mengajar ganti — percuma', th: 'รับสอนแทน — ฟรี', fr: 'Proposer des remplacements — gratuit', hi: 'स्थानापन्न कक्षाएँ दें — मुफ़्त' },
}
