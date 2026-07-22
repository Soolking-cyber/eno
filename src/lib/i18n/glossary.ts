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
  Post: { 'zh-Hans': '发布', ko: '등록', ja: '投稿', ru: 'Разместить', fr: 'Publier' },
  // Saved-listings nav: marketplaces use "favorites", not generic "saved" (Avito
  // Избранное, Leboncoin Favoris, 闲鱼 收藏, Karrot 찜 목록, ジモティー お気に入り).
  Saved: { 'zh-Hans': '收藏', ko: '찜 목록', ja: 'お気に入り', ru: 'Избранное', km: 'បានរក្សាទុក', ms: 'Disimpan', th: 'บันทึกไว้', fr: 'Favoris', hi: 'सेव किए गए' },
  'Recently viewed': { 'zh-Hans': '最近浏览', ko: '최근 본 상품', ja: '閲覧履歴', ru: 'Вы недавно смотрели', km: 'បានមើលថ្មីៗនេះ', ms: 'Dilihat baru-baru ini', th: 'ดูล่าสุด', fr: 'Vus récemment', hi: 'हाल ही में देखे गए' },
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
}
