import { fold } from '@/lib/fold'
import { CITY_MAP, type CityId } from '@/lib/itinerary-data'
import { isNearCity } from '@/lib/itinerary-geo'

/**
 * Curated Vietnamese places with real coordinates — the only thing in the app that can turn a
 * place NAME into a point on a map. /api/geo is static province/ward JSON and
 * /api/reverse-geocode goes the other way, so before this there was nothing.
 *
 * HOW THIS DATA WAS PRODUCED, because that governs how far to trust it. Places were curated
 * per destination, then EVERY coordinate was re-derived by a SECOND pass that never saw the
 * first. A place was kept only if all of the following held:
 *   · it sits inside the Vietnam bounding box (isInVietnam);
 *   · it sits within its destination radius (isNearCity — the gate that catches a coordinate
 *     which is in Vietnam but nowhere near the city it claims);
 *   · the two passes AGREED — within 5km for a point, 15km for an area feature
 *     such as a bay or a national park, which has no single point.
 * Where they agreed the stored coordinate is the MEAN of the two readings. 484 candidates
 * were produced and 322 survived; the rest were dropped rather than guessed at,
 * 122 of them because the second pass said outright that it did not know the place.
 *
 * ⚠️ BE HONEST ABOUT WHAT THAT PROVES. The two passes are not independent sources: they share
 * a model family and most of their training data, so agreement suppresses RANDOM error but
 * not a CORRELATED mistake both would make (codex, reviewing this). Nor do the bbox and
 * radius gates establish identity — they establish plausibility, and a wide regional radius
 * (hagiang and mekong are 120km) is permissive by design. Treat these coordinates as good
 * enough to plot an itinerary, NOT as survey data, and never as a source of truth for
 * anything a traveller navigates by alone.
 *
 * ⚠️ Stored coordinates are the MEAN of the two readings. For an area feature that is the
 * right answer; for a precise point such as a station entrance or a border gate the mean can
 * sit at neither exact location (bounded: the two agreed within 5km, so the mean is within
 * 2.5km of each). Fine for a map pin, wrong for turn-by-turn.
 *
 * ⚠️ This is CURATED data, not a gazetteer, and it is deliberately incomplete: a place absent
 * here is not a place that does not exist. Callers must handle a miss (findPlace returns
 * null) instead of treating the catalog as exhaustive.
 *
 * ⚠️ Do not hand-add a row without putting it through the same two-pass validation. A merely
 * PLAUSIBLE coordinate is exactly what the gate exists to reject, and one bad pin drags a
 * map's fitBounds across the country — see the incident recorded in lib/geo.ts.
 *
 * Coverage: hanoi 19 · halong 17 · ninhbinh 18 · sapa 14 · hagiang 12 · caobang 12 · puluong 8 · hue 12 · danang 17 · hoian 13 · phongnha 16 · quynhon 14 · nhatrang 20 · dalat 17 · buonmathuot 21 · hochiminh 20 · mekong 15 · cantho 9 · muine 12 · phuquoc 19 · condao 17.
 */
export type PlaceKind =
  | 'landmark' | 'museum' | 'temple' | 'market' | 'beach'
  | 'nature' | 'viewpoint' | 'activity' | 'food' | 'transport'

export type ItineraryPlace = {
  id: string
  name: string
  nameVi: string
  cityId: CityId
  lat: number
  lng: number
  kind: PlaceKind
}

export const ITINERARY_PLACES: ItineraryPlace[] = [
  { id: 'bat-trang-pottery-village', name: 'Bat Trang Pottery Village', nameVi: 'Làng gốm Bát Tràng', cityId: 'hanoi', lat: 20.9756, lng: 105.9134, kind: 'activity' },
  { id: 'dong-xuan-market', name: 'Dong Xuan Market', nameVi: 'Chợ Đồng Xuân', cityId: 'hanoi', lat: 21.0384, lng: 105.8497, kind: 'market' },
  { id: 'hanoi-old-quarter', name: 'Hanoi Old Quarter', nameVi: 'Phố cổ Hà Nội', cityId: 'hanoi', lat: 21.0345, lng: 105.8501, kind: 'landmark' },
  { id: 'hanoi-opera-house', name: 'Hanoi Opera House', nameVi: 'Nhà hát Lớn Hà Nội', cityId: 'hanoi', lat: 21.0245, lng: 105.8577, kind: 'landmark' },
  { id: 'hanoi-railway-station', name: 'Hanoi Railway Station', nameVi: 'Ga Hà Nội', cityId: 'hanoi', lat: 21.0245, lng: 105.8412, kind: 'transport' },
  { id: 'ho-chi-minh-mausoleum', name: 'Ho Chi Minh Mausoleum', nameVi: 'Lăng Chủ tịch Hồ Chí Minh', cityId: 'hanoi', lat: 21.0368, lng: 105.8347, kind: 'landmark' },
  { id: 'hoa-lo-prison', name: 'Hoa Lo Prison Museum', nameVi: 'Nhà tù Hỏa Lò', cityId: 'hanoi', lat: 21.0256, lng: 105.8464, kind: 'museum' },
  { id: 'hoan-kiem-lake', name: 'Hoan Kiem Lake', nameVi: 'Hồ Hoàn Kiếm', cityId: 'hanoi', lat: 21.0287, lng: 105.8524, kind: 'landmark' },
  { id: 'long-bien-bridge', name: 'Long Bien Bridge', nameVi: 'Cầu Long Biên', cityId: 'hanoi', lat: 21.0445, lng: 105.861, kind: 'landmark' },
  { id: 'ngoc-son-temple', name: 'Ngoc Son Temple', nameVi: 'Đền Ngọc Sơn', cityId: 'hanoi', lat: 21.031, lng: 105.8525, kind: 'temple' },
  { id: 'noi-bai-international-airport', name: 'Noi Bai International Airport', nameVi: 'Sân bay Quốc tế Nội Bài', cityId: 'hanoi', lat: 21.2212, lng: 105.8072, kind: 'transport' },
  { id: 'one-pillar-pagoda', name: 'One Pillar Pagoda', nameVi: 'Chùa Một Cột', cityId: 'hanoi', lat: 21.0357, lng: 105.8339, kind: 'temple' },
  { id: 'st-josephs-cathedral-hanoi', name: 'St. Joseph\'s Cathedral', nameVi: 'Nhà thờ Lớn Hà Nội', cityId: 'hanoi', lat: 21.0288, lng: 105.849, kind: 'landmark' },
  { id: 'ta-hien-street', name: 'Ta Hien Beer Street', nameVi: 'Phố Tạ Hiện', cityId: 'hanoi', lat: 21.0344, lng: 105.8529, kind: 'food' },
  { id: 'temple-of-literature-hanoi', name: 'Temple of Literature', nameVi: 'Văn Miếu – Quốc Tử Giám', cityId: 'hanoi', lat: 21.0285, lng: 105.8355, kind: 'temple' },
  { id: 'thang-long-imperial-citadel', name: 'Imperial Citadel of Thang Long', nameVi: 'Hoàng thành Thăng Long', cityId: 'hanoi', lat: 21.0347, lng: 105.8402, kind: 'landmark' },
  { id: 'tran-quoc-pagoda', name: 'Tran Quoc Pagoda', nameVi: 'Chùa Trấn Quốc', cityId: 'hanoi', lat: 21.0463, lng: 105.8355, kind: 'temple' },
  { id: 'vietnam-museum-of-ethnology', name: 'Vietnam Museum of Ethnology', nameVi: 'Bảo tàng Dân tộc học Việt Nam', cityId: 'hanoi', lat: 21.0407, lng: 105.7986, kind: 'museum' },
  { id: 'west-lake-hanoi', name: 'West Lake', nameVi: 'Hồ Tây', cityId: 'hanoi', lat: 21.0543, lng: 105.8203, kind: 'nature' },
  { id: 'bai-chay-beach', name: 'Bai Chay Beach', nameVi: 'Bãi biển Bãi Cháy', cityId: 'halong', lat: 20.9495, lng: 107.046, kind: 'beach' },
  { id: 'bai-chay-bridge', name: 'Bai Chay Bridge', nameVi: 'Cầu Bãi Cháy', cityId: 'halong', lat: 20.9517, lng: 107.0575, kind: 'landmark' },
  { id: 'bai-tho-mountain', name: 'Bai Tho Mountain', nameVi: 'Núi Bài Thơ', cityId: 'halong', lat: 20.9517, lng: 107.0791, kind: 'viewpoint' },
  { id: 'bai-tu-long-bay', name: 'Bai Tu Long Bay', nameVi: 'Vịnh Bái Tử Long', cityId: 'halong', lat: 20.985, lng: 107.365, kind: 'nature' },
  { id: 'cat-ba-town', name: 'Cat Ba Town', nameVi: 'Thị trấn Cát Bà', cityId: 'halong', lat: 20.7233, lng: 107.0481, kind: 'landmark' },
  { id: 'cat-co-beach', name: 'Cat Co Beach', nameVi: 'Bãi biển Cát Cò', cityId: 'halong', lat: 20.719, lng: 107.054, kind: 'beach' },
  { id: 'ha-long-bay', name: 'Ha Long Bay', nameVi: 'Vịnh Hạ Long', cityId: 'halong', lat: 20.9101, lng: 107.1419, kind: 'nature' },
  { id: 'halong-international-cruise-port', name: 'Halong International Cruise Port', nameVi: 'Cảng tàu khách quốc tế Hạ Long', cityId: 'halong', lat: 20.9435, lng: 107.0332, kind: 'transport' },
  { id: 'lan-ha-bay', name: 'Lan Ha Bay', nameVi: 'Vịnh Lan Hạ', cityId: 'halong', lat: 20.7525, lng: 107.0575, kind: 'nature' },
  { id: 'long-tien-pagoda', name: 'Long Tien Pagoda', nameVi: 'Chùa Long Tiên', cityId: 'halong', lat: 20.9504, lng: 107.0808, kind: 'temple' },
  { id: 'quang-ninh-museum', name: 'Quang Ninh Museum', nameVi: 'Bảo tàng Quảng Ninh', cityId: 'halong', lat: 20.9492, lng: 107.0944, kind: 'museum' },
  { id: 'sun-world-ha-long', name: 'Sun World Ha Long (Queen Cable Car & Sun Wheel)', nameVi: 'Sun World Hạ Long', cityId: 'halong', lat: 20.9497, lng: 107.0443, kind: 'activity' },
  { id: 'sung-sot-cave', name: 'Sung Sot Cave (Surprise Cave)', nameVi: 'Hang Sửng Sốt', cityId: 'halong', lat: 20.845, lng: 107.0987, kind: 'nature' },
  { id: 'thien-cung-cave', name: 'Thien Cung Cave', nameVi: 'Hang Thiên Cung', cityId: 'halong', lat: 20.9087, lng: 107.0101, kind: 'nature' },
  { id: 'titop-island', name: 'Titop Island', nameVi: 'Đảo Ti Tốp', cityId: 'halong', lat: 20.8466, lng: 107.0805, kind: 'viewpoint' },
  { id: 'van-don-international-airport', name: 'Van Don International Airport', nameVi: 'Sân bay Quốc tế Vân Đồn', cityId: 'halong', lat: 21.1178, lng: 107.4142, kind: 'transport' },
  { id: 'yen-tu-mountain', name: 'Yen Tu Mountain', nameVi: 'Núi Yên Tử', cityId: 'halong', lat: 21.1575, lng: 106.721, kind: 'temple' },
  { id: 'am-tien-cave', name: 'Am Tien Cave', nameVi: 'Động Am Tiên', cityId: 'ninhbinh', lat: 20.2828, lng: 105.915, kind: 'nature' },
  { id: 'bai-dinh-pagoda', name: 'Bai Dinh Pagoda', nameVi: 'Chùa Bái Đính', cityId: 'ninhbinh', lat: 20.269, lng: 105.8715, kind: 'temple' },
  { id: 'bich-dong-pagoda', name: 'Bich Dong Pagoda', nameVi: 'Chùa Bích Động', cityId: 'ninhbinh', lat: 20.2091, lng: 105.9094, kind: 'temple' },
  { id: 'cuc-phuong-national-park', name: 'Cuc Phuong National Park', nameVi: 'Vườn quốc gia Cúc Phương', cityId: 'ninhbinh', lat: 20.2534, lng: 105.679, kind: 'nature' },
  { id: 'hang-mua', name: 'Mua Cave Viewpoint', nameVi: 'Hang Múa', cityId: 'ninhbinh', lat: 20.2339, lng: 105.928, kind: 'viewpoint' },
  { id: 'hoa-lu-ancient-capital', name: 'Hoa Lu Ancient Capital', nameVi: 'Cố đô Hoa Lư', cityId: 'ninhbinh', lat: 20.2852, lng: 105.9122, kind: 'landmark' },
  { id: 'kenh-ga-hot-spring', name: 'Kenh Ga Hot Spring', nameVi: 'Suối nước nóng Kênh Gà', cityId: 'ninhbinh', lat: 20.3105, lng: 105.8179, kind: 'activity' },
  { id: 'nhat-tru-pagoda', name: 'Nhat Tru Pagoda', nameVi: 'Chùa Nhất Trụ', cityId: 'ninhbinh', lat: 20.2824, lng: 105.9119, kind: 'temple' },
  { id: 'ninh-binh-railway-station', name: 'Ninh Binh Railway Station', nameVi: 'Ga Ninh Bình', cityId: 'ninhbinh', lat: 20.2525, lng: 105.9759, kind: 'transport' },
  { id: 'non-nuoc-mountain-ninh-binh', name: 'Non Nuoc Mountain (Duc Thuy Son)', nameVi: 'Núi Non Nước (Dục Thúy Sơn)', cityId: 'ninhbinh', lat: 20.2591, lng: 105.976, kind: 'viewpoint' },
  { id: 'phat-diem-cathedral', name: 'Phat Diem Stone Cathedral', nameVi: 'Nhà thờ đá Phát Diệm', cityId: 'ninhbinh', lat: 20.0868, lng: 106.1057, kind: 'landmark' },
  { id: 'rong-market-ninh-binh', name: 'Rong Market', nameVi: 'Chợ Rồng Ninh Bình', cityId: 'ninhbinh', lat: 20.2548, lng: 105.9741, kind: 'market' },
  { id: 'tam-coc', name: 'Tam Coc', nameVi: 'Tam Cốc', cityId: 'ninhbinh', lat: 20.2206, lng: 105.9198, kind: 'nature' },
  { id: 'thai-vi-temple', name: 'Thai Vi Temple', nameVi: 'Đền Thái Vi', cityId: 'ninhbinh', lat: 20.2217, lng: 105.9276, kind: 'temple' },
  { id: 'thung-nham-bird-park', name: 'Thung Nham Bird Park', nameVi: 'Vườn chim Thung Nham', cityId: 'ninhbinh', lat: 20.2014, lng: 105.9292, kind: 'nature' },
  { id: 'trang-an-landscape-complex', name: 'Trang An Landscape Complex', nameVi: 'Quần thể danh thắng Tràng An', cityId: 'ninhbinh', lat: 20.2538, lng: 105.9069, kind: 'nature' },
  { id: 'van-lam-embroidery-village', name: 'Van Lam Embroidery Village', nameVi: 'Làng thêu Văn Lâm', cityId: 'ninhbinh', lat: 20.2206, lng: 105.9396, kind: 'activity' },
  { id: 'van-long-nature-reserve', name: 'Van Long Nature Reserve', nameVi: 'Khu bảo tồn thiên nhiên Vân Long', cityId: 'ninhbinh', lat: 20.3533, lng: 105.8768, kind: 'nature' },
  { id: 'cat-cat-village', name: 'Cat Cat Village', nameVi: 'Bản Cát Cát', cityId: 'sapa', lat: 22.3274, lng: 103.834, kind: 'landmark' },
  { id: 'cau-may-street', name: 'Cau May Street', nameVi: 'Phố Cầu Mây', cityId: 'sapa', lat: 22.3343, lng: 103.8432, kind: 'food' },
  { id: 'fansipan-legend-cable-car', name: 'Fansipan Legend Cable Car Station', nameVi: 'Ga cáp treo Fansipan Legend', cityId: 'sapa', lat: 22.3205, lng: 103.8342, kind: 'activity' },
  { id: 'fansipan-peak', name: 'Fansipan Peak', nameVi: 'Đỉnh Fansipan', cityId: 'sapa', lat: 22.3032, lng: 103.7756, kind: 'viewpoint' },
  { id: 'ham-rong-mountain', name: 'Ham Rong Mountain Park', nameVi: 'Núi Hàm Rồng', cityId: 'sapa', lat: 22.3327, lng: 103.843, kind: 'viewpoint' },
  { id: 'lao-cai-railway-station', name: 'Lao Cai Railway Station', nameVi: 'Ga Lào Cai', cityId: 'sapa', lat: 22.4914, lng: 103.9656, kind: 'transport' },
  { id: 'lao-chai-village', name: 'Lao Chai Village', nameVi: 'Bản Lao Chải', cityId: 'sapa', lat: 22.308, lng: 103.871, kind: 'landmark' },
  { id: 'love-waterfall-sapa', name: 'Love Waterfall', nameVi: 'Thác Tình Yêu', cityId: 'sapa', lat: 22.3483, lng: 103.7758, kind: 'nature' },
  { id: 'muong-hoa-valley', name: 'Muong Hoa Valley', nameVi: 'Thung lũng Mường Hoa', cityId: 'sapa', lat: 22.31, lng: 103.865, kind: 'nature' },
  { id: 'o-quy-ho-pass', name: 'O Quy Ho Pass (Tram Ton)', nameVi: 'Đèo Ô Quy Hồ', cityId: 'sapa', lat: 22.3539, lng: 103.7596, kind: 'viewpoint' },
  { id: 'sapa-lake', name: 'Sa Pa Lake', nameVi: 'Hồ Sa Pa', cityId: 'sapa', lat: 22.3361, lng: 103.8405, kind: 'landmark' },
  { id: 'sapa-stone-church', name: 'Sa Pa Stone Church', nameVi: 'Nhà thờ Đá Sa Pa', cityId: 'sapa', lat: 22.3356, lng: 103.8434, kind: 'landmark' },
  { id: 'silver-waterfall-sapa', name: 'Silver Waterfall', nameVi: 'Thác Bạc', cityId: 'sapa', lat: 22.3548, lng: 103.7746, kind: 'nature' },
  { id: 'ta-van-village', name: 'Ta Van Village', nameVi: 'Bản Tả Van', cityId: 'sapa', lat: 22.2953, lng: 103.89, kind: 'landmark' },
  { id: 'dong-van-old-quarter', name: 'Dong Van Old Quarter', nameVi: 'Phố cổ Đồng Văn', cityId: 'hagiang', lat: 23.2782, lng: 105.3624, kind: 'landmark' },
  { id: 'hoang-su-phi-rice-terraces', name: 'Hoang Su Phi Rice Terraces', nameVi: 'Ruộng bậc thang Hoàng Su Phì', cityId: 'hagiang', lat: 22.7317, lng: 104.6716, kind: 'nature' },
  { id: 'lo-lo-chai-village', name: 'Lo Lo Chai Village', nameVi: 'Làng Lô Lô Chải', cityId: 'hagiang', lat: 23.3585, lng: 105.323, kind: 'landmark' },
  { id: 'lung-cu-flag-tower', name: 'Lung Cu Flag Tower', nameVi: 'Cột cờ Lũng Cú', cityId: 'hagiang', lat: 23.3625, lng: 105.3193, kind: 'landmark' },
  { id: 'ma-pi-leng-pass', name: 'Ma Pi Leng Pass', nameVi: 'Đèo Mã Pí Lèng', cityId: 'hagiang', lat: 23.2401, lng: 105.3559, kind: 'viewpoint' },
  { id: 'meo-vac-market', name: 'Meo Vac Market', nameVi: 'Chợ Mèo Vạc', cityId: 'hagiang', lat: 23.1587, lng: 105.4134, kind: 'market' },
  { id: 'pao-house-sung-la', name: 'Pao\'s House, Sung La Valley', nameVi: 'Nhà của Pao, thung lũng Sủng Là', cityId: 'hagiang', lat: 23.2621, lng: 105.262, kind: 'landmark' },
  { id: 'quan-ba-heaven-gate', name: 'Quan Ba Heaven\'s Gate', nameVi: 'Cổng trời Quản Bạ', cityId: 'hagiang', lat: 23.0535, lng: 104.9855, kind: 'viewpoint' },
  { id: 'quan-ba-twin-mountains', name: 'Quan Ba Twin Mountains', nameVi: 'Núi đôi Quản Bạ', cityId: 'hagiang', lat: 23.0635, lng: 104.9761, kind: 'viewpoint' },
  { id: 'sung-la-valley', name: 'Sung La Valley', nameVi: 'Thung lũng Sủng Là', cityId: 'hagiang', lat: 23.2056, lng: 105.2515, kind: 'nature' },
  { id: 'tu-san-canyon', name: 'Tu San Canyon on the Nho Que River', nameVi: 'Hẻm vực Tu Sản (sông Nho Quế)', cityId: 'hagiang', lat: 23.2317, lng: 105.3345, kind: 'nature' },
  { id: 'vuong-palace-sa-phin', name: 'Vuong Family Palace (Sa Phin)', nameVi: 'Dinh thự họ Vương (Sà Phìn)', cityId: 'hagiang', lat: 23.2983, lng: 105.2655, kind: 'landmark' },
  { id: 'angel-eye-mountain-cao-bang', name: 'Angel Eye Mountain', nameVi: 'Núi Mắt Thần (Núi Thủng)', cityId: 'caobang', lat: 22.7968, lng: 106.3362, kind: 'nature' },
  { id: 'ban-gioc-waterfall', name: 'Ban Gioc Waterfall', nameVi: 'Thác Bản Giốc', cityId: 'caobang', lat: 22.8536, lng: 106.7237, kind: 'nature' },
  { id: 'cao-bang-provincial-museum', name: 'Cao Bang Provincial Museum', nameVi: 'Bảo tàng tỉnh Cao Bằng', cityId: 'caobang', lat: 22.665, lng: 106.2578, kind: 'museum' },
  { id: 'khuoi-ky-stone-village', name: 'Khuoi Ky Ancient Stone Village', nameVi: 'Làng đá Khuổi Ky', cityId: 'caobang', lat: 22.846, lng: 106.6965, kind: 'landmark' },
  { id: 'ma-phuc-pass', name: 'Ma Phuc Pass', nameVi: 'Đèo Mã Phục', cityId: 'caobang', lat: 22.7308, lng: 106.3469, kind: 'viewpoint' },
  { id: 'nguom-ngao-cave', name: 'Nguom Ngao Cave', nameVi: 'Động Ngườm Ngao', cityId: 'caobang', lat: 22.8464, lng: 106.6969, kind: 'nature' },
  { id: 'pac-bo-historic-site', name: 'Pac Bo Historic Site', nameVi: 'Khu di tích Pác Bó', cityId: 'caobang', lat: 22.9736, lng: 105.8686, kind: 'landmark' },
  { id: 'phia-oac-phia-den-national-park', name: 'Phia Oac - Phia Den National Park', nameVi: 'Vườn quốc gia Phia Oắc – Phia Đén', cityId: 'caobang', lat: 22.5951, lng: 105.8768, kind: 'nature' },
  { id: 'phong-nam-valley', name: 'Phong Nam Valley', nameVi: 'Thung lũng Phong Nậm', cityId: 'caobang', lat: 22.89, lng: 106.5025, kind: 'nature' },
  { id: 'ta-lung-border-gate', name: 'Ta Lung International Border Gate', nameVi: 'Cửa khẩu Quốc tế Tà Lùng', cityId: 'caobang', lat: 22.5726, lng: 106.6003, kind: 'transport' },
  { id: 'thang-hen-lake', name: 'Thang Hen Lake', nameVi: 'Hồ Thang Hen', cityId: 'caobang', lat: 22.7521, lng: 106.353, kind: 'nature' },
  { id: 'truc-lam-ban-gioc-pagoda', name: 'Truc Lam Ban Gioc Pagoda', nameVi: 'Chùa Phật Tích Trúc Lâm Bản Giốc', cityId: 'caobang', lat: 22.849, lng: 106.717, kind: 'temple' },
  { id: 'ban-lac-mai-chau', name: 'Lac Village, Mai Chau', nameVi: 'Bản Lác', cityId: 'puluong', lat: 20.6546, lng: 105.0845, kind: 'landmark' },
  { id: 'cam-luong-fish-stream', name: 'Cam Luong Fish Stream', nameVi: 'Suối cá Cẩm Lương', cityId: 'puluong', lat: 20.2523, lng: 105.4263, kind: 'nature' },
  { id: 'chieu-cave-mai-chau', name: 'Chieu Cave', nameVi: 'Hang Chiều', cityId: 'puluong', lat: 20.6692, lng: 105.0901, kind: 'nature' },
  { id: 'mai-chau-valley', name: 'Mai Chau Valley', nameVi: 'Thung lũng Mai Châu', cityId: 'puluong', lat: 20.6625, lng: 105.065, kind: 'nature' },
  { id: 'mo-luong-cave', name: 'Mo Luong Cave', nameVi: 'Hang Mỏ Luông', cityId: 'puluong', lat: 20.6584, lng: 105.0927, kind: 'nature' },
  { id: 'muong-cultural-space-museum', name: 'Muong Cultural Space Museum', nameVi: 'Bảo tàng Không gian văn hóa Mường', cityId: 'puluong', lat: 20.8189, lng: 105.3219, kind: 'museum' },
  { id: 'pa-co-market', name: 'Pa Co Sunday Market', nameVi: 'Chợ Pà Cò', cityId: 'puluong', lat: 20.7319, lng: 104.9355, kind: 'market' },
  { id: 'pu-luong-nature-reserve', name: 'Pu Luong Nature Reserve', nameVi: 'Khu bảo tồn thiên nhiên Pù Luông', cityId: 'puluong', lat: 20.51, lng: 105.105, kind: 'nature' },
  { id: 'an-dinh-palace', name: 'An Dinh Palace', nameVi: 'Cung An Định', cityId: 'hue', lat: 16.4605, lng: 107.5934, kind: 'landmark' },
  { id: 'dong-ba-market', name: 'Dong Ba Market', nameVi: 'Chợ Đông Ba', cityId: 'hue', lat: 16.472, lng: 107.5871, kind: 'market' },
  { id: 'hue-imperial-city', name: 'Hue Imperial City (Citadel)', nameVi: 'Đại Nội - Kinh thành Huế', cityId: 'hue', lat: 16.4699, lng: 107.5786, kind: 'landmark' },
  { id: 'hue-museum-royal-antiquities', name: 'Museum of Royal Antiquities', nameVi: 'Bảo tàng Cổ vật Cung đình Huế', cityId: 'hue', lat: 16.4681, lng: 107.5828, kind: 'museum' },
  { id: 'hue-railway-station', name: 'Hue Railway Station', nameVi: 'Ga Huế', cityId: 'hue', lat: 16.4603, lng: 107.5787, kind: 'transport' },
  { id: 'khai-dinh-tomb', name: 'Tomb of Emperor Khai Dinh', nameVi: 'Lăng Khải Định', cityId: 'hue', lat: 16.3997, lng: 107.5856, kind: 'landmark' },
  { id: 'perfume-river', name: 'Perfume River', nameVi: 'Sông Hương', cityId: 'hue', lat: 16.467, lng: 107.5838, kind: 'nature' },
  { id: 'phu-bai-airport', name: 'Phu Bai International Airport', nameVi: 'Sân bay quốc tế Phú Bài', cityId: 'hue', lat: 16.4015, lng: 107.7026, kind: 'transport' },
  { id: 'thien-mu-pagoda', name: 'Thien Mu Pagoda', nameVi: 'Chùa Thiên Mụ', cityId: 'hue', lat: 16.4533, lng: 107.5452, kind: 'temple' },
  { id: 'thuan-an-beach', name: 'Thuan An Beach', nameVi: 'Biển Thuận An', cityId: 'hue', lat: 16.5684, lng: 107.6341, kind: 'beach' },
  { id: 'truong-tien-bridge', name: 'Truong Tien Bridge', nameVi: 'Cầu Trường Tiền', cityId: 'hue', lat: 16.4701, lng: 107.5897, kind: 'landmark' },
  { id: 'tu-duc-tomb', name: 'Tomb of Emperor Tu Duc', nameVi: 'Lăng Tự Đức', cityId: 'hue', lat: 16.4577, lng: 107.553, kind: 'landmark' },
  { id: 'asia-park-sun-wheel', name: 'Asia Park & Sun Wheel', nameVi: 'Công viên Châu Á - Sun Wheel', cityId: 'danang', lat: 16.0365, lng: 108.2259, kind: 'activity' },
  { id: 'cham-sculpture-museum', name: 'Museum of Cham Sculpture', nameVi: 'Bảo tàng Điêu khắc Chăm', cityId: 'danang', lat: 16.0604, lng: 108.2233, kind: 'museum' },
  { id: 'con-market', name: 'Con Market', nameVi: 'Chợ Cồn', cityId: 'danang', lat: 16.0675, lng: 108.2121, kind: 'market' },
  { id: 'danang-airport', name: 'Da Nang International Airport', nameVi: 'Sân bay quốc tế Đà Nẵng', cityId: 'danang', lat: 16.0439, lng: 108.1993, kind: 'transport' },
  { id: 'danang-cathedral', name: 'Da Nang Cathedral (Pink Church)', nameVi: 'Nhà thờ Chính tòa Đà Nẵng (Nhà thờ Con Gà)', cityId: 'danang', lat: 16.0665, lng: 108.2232, kind: 'landmark' },
  { id: 'danang-museum', name: 'Da Nang Museum', nameVi: 'Bảo tàng Đà Nẵng', cityId: 'danang', lat: 16.0743, lng: 108.2231, kind: 'museum' },
  { id: 'danang-railway-station', name: 'Da Nang Railway Station', nameVi: 'Ga Đà Nẵng', cityId: 'danang', lat: 16.0732, lng: 108.209, kind: 'transport' },
  { id: 'dragon-bridge', name: 'Dragon Bridge', nameVi: 'Cầu Rồng', cityId: 'danang', lat: 16.0614, lng: 108.2273, kind: 'landmark' },
  { id: 'golden-bridge-ba-na', name: 'Golden Bridge, Ba Na Hills', nameVi: 'Cầu Vàng - Bà Nà Hills', cityId: 'danang', lat: 15.9956, lng: 107.9963, kind: 'landmark' },
  { id: 'hai-van-pass', name: 'Hai Van Pass', nameVi: 'Đèo Hải Vân', cityId: 'danang', lat: 16.1988, lng: 108.1294, kind: 'viewpoint' },
  { id: 'han-market', name: 'Han Market', nameVi: 'Chợ Hàn', cityId: 'danang', lat: 16.069, lng: 108.2243, kind: 'market' },
  { id: 'han-river-bridge', name: 'Han River Bridge', nameVi: 'Cầu Sông Hàn', cityId: 'danang', lat: 16.0729, lng: 108.2267, kind: 'landmark' },
  { id: 'linh-ung-pagoda-son-tra', name: 'Linh Ung Pagoda (Son Tra)', nameVi: 'Chùa Linh Ứng Bãi Bụt', cityId: 'danang', lat: 16.1001, lng: 108.2776, kind: 'temple' },
  { id: 'marble-mountains', name: 'Marble Mountains', nameVi: 'Ngũ Hành Sơn', cityId: 'danang', lat: 16.0033, lng: 108.2638, kind: 'nature' },
  { id: 'my-khe-beach', name: 'My Khe Beach', nameVi: 'Bãi biển Mỹ Khê', cityId: 'danang', lat: 16.0597, lng: 108.2468, kind: 'beach' },
  { id: 'non-nuoc-beach', name: 'Non Nuoc Beach', nameVi: 'Bãi biển Non Nước', cityId: 'danang', lat: 16.0003, lng: 108.2666, kind: 'beach' },
  { id: 'thuan-phuoc-bridge', name: 'Thuan Phuoc Bridge', nameVi: 'Cầu Thuận Phước', cityId: 'danang', lat: 16.097, lng: 108.2253, kind: 'landmark' },
  { id: 'an-bang-beach', name: 'An Bang Beach', nameVi: 'Bãi biển An Bàng', cityId: 'hoian', lat: 15.9083, lng: 108.3418, kind: 'beach' },
  { id: 'bay-mau-coconut-forest', name: 'Bay Mau Coconut Forest (Cam Thanh)', nameVi: 'Rừng dừa Bảy Mẫu - Cẩm Thanh', cityId: 'hoian', lat: 15.878, lng: 108.3665, kind: 'nature' },
  { id: 'cham-islands', name: 'Cham Islands', nameVi: 'Cù Lao Chàm', cityId: 'hoian', lat: 15.9528, lng: 108.5086, kind: 'nature' },
  { id: 'cua-dai-beach', name: 'Cua Dai Beach', nameVi: 'Bãi biển Cửa Đại', cityId: 'hoian', lat: 15.8976, lng: 108.353, kind: 'beach' },
  { id: 'hoi-an-ancient-town', name: 'Hoi An Ancient Town', nameVi: 'Phố cổ Hội An', cityId: 'hoian', lat: 15.8785, lng: 108.3276, kind: 'landmark' },
  { id: 'hoi-an-central-market', name: 'Hoi An Central Market', nameVi: 'Chợ Hội An', cityId: 'hoian', lat: 15.8771, lng: 108.3313, kind: 'market' },
  { id: 'hoi-an-night-market', name: 'Hoi An Night Market', nameVi: 'Chợ đêm Hội An', cityId: 'hoian', lat: 15.8755, lng: 108.3263, kind: 'market' },
  { id: 'japanese-covered-bridge', name: 'Japanese Covered Bridge', nameVi: 'Chùa Cầu', cityId: 'hoian', lat: 15.8772, lng: 108.3257, kind: 'landmark' },
  { id: 'phuc-kien-assembly-hall', name: 'Fujian (Phuc Kien) Assembly Hall', nameVi: 'Hội quán Phúc Kiến', cityId: 'hoian', lat: 15.878, lng: 108.3291, kind: 'temple' },
  { id: 'quan-cong-temple', name: 'Quan Cong Temple', nameVi: 'Chùa Ông - Quan Công Miếu', cityId: 'hoian', lat: 15.8775, lng: 108.3307, kind: 'temple' },
  { id: 'tan-ky-old-house', name: 'Tan Ky Old House', nameVi: 'Nhà cổ Tấn Ký', cityId: 'hoian', lat: 15.8765, lng: 108.3279, kind: 'landmark' },
  { id: 'thanh-ha-pottery-village', name: 'Thanh Ha Pottery Village', nameVi: 'Làng gốm Thanh Hà', cityId: 'hoian', lat: 15.8793, lng: 108.3051, kind: 'activity' },
  { id: 'tra-que-vegetable-village', name: 'Tra Que Vegetable Village', nameVi: 'Làng rau Trà Quế', cityId: 'hoian', lat: 15.8959, lng: 108.3328, kind: 'activity' },
  { id: 'bong-lai-valley', name: 'Bong Lai Valley', nameVi: 'Thung lũng Bồng Lai', cityId: 'phongnha', lat: 17.5725, lng: 106.3285, kind: 'activity' },
  { id: 'da-nhay-beach', name: 'Da Nhay Beach', nameVi: 'Bãi biển Đá Nhảy', cityId: 'phongnha', lat: 17.6575, lng: 106.476, kind: 'beach' },
  { id: 'dark-cave-phong-nha', name: 'Dark Cave (Hang Toi)', nameVi: 'Hang Tối', cityId: 'phongnha', lat: 17.527, lng: 106.2611, kind: 'activity' },
  { id: 'dong-hoi-airport', name: 'Dong Hoi Airport', nameVi: 'Sân bay Đồng Hới', cityId: 'phongnha', lat: 17.515, lng: 106.5905, kind: 'transport' },
  { id: 'dong-hoi-market', name: 'Dong Hoi Market', nameVi: 'Chợ Đồng Hới', cityId: 'phongnha', lat: 17.4697, lng: 106.6238, kind: 'market' },
  { id: 'dong-hoi-railway-station', name: 'Dong Hoi Railway Station', nameVi: 'Ga Đồng Hới', cityId: 'phongnha', lat: 17.4804, lng: 106.5989, kind: 'transport' },
  { id: 'hang-en-cave', name: 'Hang En Cave', nameVi: 'Hang Én', cityId: 'phongnha', lat: 17.4733, lng: 106.2835, kind: 'nature' },
  { id: 'nhat-le-beach', name: 'Nhat Le Beach', nameVi: 'Bãi biển Nhật Lệ', cityId: 'phongnha', lat: 17.4824, lng: 106.6308, kind: 'beach' },
  { id: 'nuoc-mooc-eco-trail', name: 'Nuoc Mooc Eco Trail', nameVi: 'Suối Nước Moọc', cityId: 'phongnha', lat: 17.5078, lng: 106.2456, kind: 'nature' },
  { id: 'paradise-cave', name: 'Paradise Cave', nameVi: 'Động Thiên Đường', cityId: 'phongnha', lat: 17.5117, lng: 106.2282, kind: 'nature' },
  { id: 'phong-nha-boat-pier', name: 'Phong Nha Boat Pier (Xuan Son)', nameVi: 'Bến thuyền Xuân Sơn', cityId: 'phongnha', lat: 17.5971, lng: 106.2836, kind: 'transport' },
  { id: 'phong-nha-cave', name: 'Phong Nha Cave', nameVi: 'Động Phong Nha', cityId: 'phongnha', lat: 17.5832, lng: 106.2836, kind: 'nature' },
  { id: 'phong-nha-ke-bang-national-park', name: 'Phong Nha-Ke Bang National Park', nameVi: 'Vườn quốc gia Phong Nha - Kẻ Bàng', cityId: 'phongnha', lat: 17.5367, lng: 106.195, kind: 'nature' },
  { id: 'quang-binh-quan', name: 'Quang Binh Gate', nameVi: 'Quảng Bình Quan', cityId: 'phongnha', lat: 17.4694, lng: 106.621, kind: 'landmark' },
  { id: 'son-doong-cave', name: 'Son Doong Cave', nameVi: 'Hang Sơn Đoòng', cityId: 'phongnha', lat: 17.4558, lng: 106.2872, kind: 'nature' },
  { id: 'tam-toa-church-ruins', name: 'Tam Toa Church Ruins', nameVi: 'Nhà thờ Tam Tòa', cityId: 'phongnha', lat: 17.4726, lng: 106.6248, kind: 'landmark' },
  { id: 'bai-xep-quy-nhon', name: 'Bai Xep Beach', nameVi: 'Bãi Xếp', cityId: 'quynhon', lat: 13.7099, lng: 109.2481, kind: 'beach' },
  { id: 'cau-thi-nai', name: 'Thi Nai Bridge', nameVi: 'Cầu Thị Nại', cityId: 'quynhon', lat: 13.7997, lng: 109.2403, kind: 'landmark' },
  { id: 'cho-lon-quy-nhon', name: 'Quy Nhon Central Market', nameVi: 'Chợ Lớn Quy Nhơn', cityId: 'quynhon', lat: 13.7749, lng: 109.2214, kind: 'market' },
  { id: 'chua-long-khanh', name: 'Long Khanh Pagoda', nameVi: 'Chùa Long Khánh', cityId: 'quynhon', lat: 13.7756, lng: 109.2219, kind: 'temple' },
  { id: 'cu-lao-xanh', name: 'Cu Lao Xanh Island', nameVi: 'Cù Lao Xanh', cityId: 'quynhon', lat: 13.611, lng: 109.3382, kind: 'nature' },
  { id: 'duong-xuan-dieu-quy-nhon', name: 'Xuan Dieu Seafood Street', nameVi: 'Đường Xuân Diệu', cityId: 'quynhon', lat: 13.7721, lng: 109.2284, kind: 'food' },
  { id: 'eo-gio', name: 'Eo Gio', nameVi: 'Eo Gió', cityId: 'quynhon', lat: 13.8165, lng: 109.289, kind: 'viewpoint' },
  { id: 'ghenh-rang-tien-sa', name: 'Ghenh Rang Tien Sa', nameVi: 'Ghềnh Ráng Tiên Sa', cityId: 'quynhon', lat: 13.7527, lng: 109.2257, kind: 'viewpoint' },
  { id: 'ky-co-beach', name: 'Ky Co Beach', nameVi: 'Bãi Kỳ Co', cityId: 'quynhon', lat: 13.7958, lng: 109.2985, kind: 'beach' },
  { id: 'phu-cat-airport', name: 'Phu Cat Airport', nameVi: 'Sân bay Phù Cát', cityId: 'quynhon', lat: 13.955, lng: 109.0422, kind: 'transport' },
  { id: 'quy-nhon-beach', name: 'Quy Nhon Beach', nameVi: 'Bãi biển Quy Nhơn', cityId: 'quynhon', lat: 13.7693, lng: 109.2294, kind: 'beach' },
  { id: 'thap-banh-it', name: 'Banh It Cham Towers', nameVi: 'Tháp Bánh Ít', cityId: 'quynhon', lat: 13.8701, lng: 109.1099, kind: 'temple' },
  { id: 'thap-canh-tien', name: 'Canh Tien Cham Tower', nameVi: 'Tháp Cánh Tiên', cityId: 'quynhon', lat: 13.9141, lng: 109.0744, kind: 'temple' },
  { id: 'thap-doi-quy-nhon', name: 'Thap Doi Cham Towers', nameVi: 'Tháp Đôi', cityId: 'quynhon', lat: 13.7834, lng: 109.213, kind: 'temple' },
  { id: 'bai-dai-cam-ranh', name: 'Bai Dai Beach', nameVi: 'Bãi Dài', cityId: 'nhatrang', lat: 12.0853, lng: 109.2139, kind: 'beach' },
  { id: 'bao-tang-yersin', name: 'Alexandre Yersin Museum', nameVi: 'Bảo tàng Alexandre Yersin', cityId: 'nhatrang', lat: 12.2397, lng: 109.1964, kind: 'museum' },
  { id: 'cam-ranh-airport', name: 'Cam Ranh International Airport', nameVi: 'Sân bay quốc tế Cam Ranh', cityId: 'nhatrang', lat: 11.9982, lng: 109.2192, kind: 'transport' },
  { id: 'cap-treo-vinpearl', name: 'Vinpearl Cable Car', nameVi: 'Cáp treo Vinpearl', cityId: 'nhatrang', lat: 12.2023, lng: 109.2213, kind: 'activity' },
  { id: 'cho-dam-nha-trang', name: 'Dam Market', nameVi: 'Chợ Đầm', cityId: 'nhatrang', lat: 12.2547, lng: 109.1897, kind: 'market' },
  { id: 'chua-long-son-nha-trang', name: 'Long Son Pagoda', nameVi: 'Chùa Long Sơn', cityId: 'nhatrang', lat: 12.2499, lng: 109.1813, kind: 'temple' },
  { id: 'dao-khi-hon-lao', name: 'Monkey Island (Hon Lao)', nameVi: 'Đảo Khỉ (Hòn Lao)', cityId: 'nhatrang', lat: 12.4078, lng: 109.2151, kind: 'nature' },
  { id: 'duong-nguyen-thien-thuat', name: 'Nguyen Thien Thuat Food Street', nameVi: 'Đường Nguyễn Thiện Thuật', cityId: 'nhatrang', lat: 12.234, lng: 109.194, kind: 'food' },
  { id: 'ga-nha-trang', name: 'Nha Trang Railway Station', nameVi: 'Ga Nha Trang', cityId: 'nhatrang', lat: 12.2472, lng: 109.1788, kind: 'transport' },
  { id: 'hon-chong-nha-trang', name: 'Hon Chong Promontory', nameVi: 'Hòn Chồng', cityId: 'nhatrang', lat: 12.2736, lng: 109.2066, kind: 'viewpoint' },
  { id: 'hon-mun', name: 'Hon Mun Island', nameVi: 'Hòn Mun', cityId: 'nhatrang', lat: 12.1685, lng: 109.2985, kind: 'nature' },
  { id: 'hon-tam', name: 'Hon Tam Island', nameVi: 'Hòn Tằm', cityId: 'nhatrang', lat: 12.1935, lng: 109.2555, kind: 'nature' },
  { id: 'lau-bao-dai-nha-trang', name: 'Bao Dai Villas', nameVi: 'Lầu Bảo Đại', cityId: 'nhatrang', lat: 12.2058, lng: 109.2189, kind: 'landmark' },
  { id: 'nha-tho-nui-nha-trang', name: 'Nha Trang Cathedral', nameVi: 'Nhà thờ Núi Nha Trang', cityId: 'nhatrang', lat: 12.2449, lng: 109.1833, kind: 'landmark' },
  { id: 'nha-trang-beach', name: 'Nha Trang Beach', nameVi: 'Bãi biển Nha Trang', cityId: 'nhatrang', lat: 12.2375, lng: 109.1985, kind: 'beach' },
  { id: 'tam-bun-thap-ba', name: 'Thap Ba Hot Spring Mud Bath', nameVi: 'Tắm bùn Tháp Bà', cityId: 'nhatrang', lat: 12.2706, lng: 109.1806, kind: 'activity' },
  { id: 'thap-ba-ponagar', name: 'Po Nagar Cham Towers', nameVi: 'Tháp Bà Ponagar', cityId: 'nhatrang', lat: 12.2654, lng: 109.1954, kind: 'temple' },
  { id: 'thap-tram-huong', name: 'Tram Huong Tower', nameVi: 'Tháp Trầm Hương', cityId: 'nhatrang', lat: 12.2397, lng: 109.1959, kind: 'landmark' },
  { id: 'vien-hai-duong-hoc', name: 'Institute of Oceanography', nameVi: 'Viện Hải dương học', cityId: 'nhatrang', lat: 12.2052, lng: 109.2164, kind: 'museum' },
  { id: 'vinwonders-nha-trang', name: 'VinWonders Nha Trang', nameVi: 'VinWonders Nha Trang', cityId: 'nhatrang', lat: 12.2135, lng: 109.245, kind: 'activity' },
  { id: 'biet-thu-hang-nga', name: 'Crazy House', nameVi: 'Biệt thự Hằng Nga', cityId: 'dalat', lat: 11.9353, lng: 108.4308, kind: 'landmark' },
  { id: 'cho-da-lat', name: 'Da Lat Market', nameVi: 'Chợ Đà Lạt', cityId: 'dalat', lat: 11.9425, lng: 108.4369, kind: 'market' },
  { id: 'chua-linh-phuoc', name: 'Linh Phuoc Pagoda', nameVi: 'Chùa Linh Phước', cityId: 'dalat', lat: 11.9345, lng: 108.4992, kind: 'temple' },
  { id: 'dinh-bao-dai-da-lat', name: 'Bao Dai Summer Palace', nameVi: 'Dinh Bảo Đại (Dinh III)', cityId: 'dalat', lat: 11.9329, lng: 108.4263, kind: 'landmark' },
  { id: 'ga-da-lat', name: 'Da Lat Railway Station', nameVi: 'Ga Đà Lạt', cityId: 'dalat', lat: 11.9421, lng: 108.4535, kind: 'transport' },
  { id: 'ho-than-tho', name: 'Sighing Lake', nameVi: 'Hồ Than Thở', cityId: 'dalat', lat: 11.9597, lng: 108.4613, kind: 'nature' },
  { id: 'ho-tuyen-lam', name: 'Tuyen Lam Lake', nameVi: 'Hồ Tuyền Lâm', cityId: 'dalat', lat: 11.896, lng: 108.4197, kind: 'nature' },
  { id: 'ho-xuan-huong', name: 'Xuan Huong Lake', nameVi: 'Hồ Xuân Hương', cityId: 'dalat', lat: 11.9412, lng: 108.4399, kind: 'nature' },
  { id: 'lien-khuong-airport', name: 'Lien Khuong Airport', nameVi: 'Sân bay Liên Khương', cityId: 'dalat', lat: 11.7501, lng: 108.3685, kind: 'transport' },
  { id: 'nha-tho-con-ga', name: 'Da Lat Cathedral', nameVi: 'Nhà thờ Con Gà', cityId: 'dalat', lat: 11.9386, lng: 108.4386, kind: 'landmark' },
  { id: 'nha-tho-domaine-de-marie', name: 'Domaine de Marie Church', nameVi: 'Nhà thờ Domaine de Marie', cityId: 'dalat', lat: 11.9372, lng: 108.4296, kind: 'landmark' },
  { id: 'nui-langbiang', name: 'Lang Biang Mountain', nameVi: 'Núi Langbiang', cityId: 'dalat', lat: 12.0457, lng: 108.4339, kind: 'viewpoint' },
  { id: 'quang-truong-lam-vien', name: 'Lam Vien Square', nameVi: 'Quảng trường Lâm Viên', cityId: 'dalat', lat: 11.942, lng: 108.4423, kind: 'landmark' },
  { id: 'thac-datanla', name: 'Datanla Waterfall', nameVi: 'Thác Datanla', cityId: 'dalat', lat: 11.9099, lng: 108.4363, kind: 'nature' },
  { id: 'thien-vien-truc-lam', name: 'Truc Lam Zen Monastery', nameVi: 'Thiền viện Trúc Lâm', cityId: 'dalat', lat: 11.9026, lng: 108.4138, kind: 'temple' },
  { id: 'thung-lung-tinh-yeu', name: 'Valley of Love', nameVi: 'Thung lũng Tình Yêu', cityId: 'dalat', lat: 11.9688, lng: 108.4453, kind: 'nature' },
  { id: 'vuon-hoa-da-lat', name: 'Da Lat Flower Gardens', nameVi: 'Vườn hoa thành phố Đà Lạt', cityId: 'dalat', lat: 11.948, lng: 108.4446, kind: 'nature' },
  { id: 'ako-dhong-village', name: 'Ako Dhong Village', nameVi: 'Buôn Akŏ Dhông', cityId: 'buonmathuot', lat: 12.6948, lng: 108.037, kind: 'landmark' },
  { id: 'bao-dai-palace-lak', name: 'Bao Dai Palace at Lak Lake', nameVi: 'Biệt điện Bảo Đại hồ Lắk', cityId: 'buonmathuot', lat: 12.4199, lng: 108.1799, kind: 'viewpoint' },
  { id: 'bao-tang-dak-lak', name: 'Dak Lak Museum', nameVi: 'Bảo tàng Đắk Lắk', cityId: 'buonmathuot', lat: 12.6743, lng: 108.0496, kind: 'museum' },
  { id: 'buon-ako-dhong', name: 'Ako Dhong Village', nameVi: 'Buôn Ako Dhông', cityId: 'buonmathuot', lat: 12.6901, lng: 108.0404, kind: 'landmark' },
  { id: 'buon-jun-village', name: 'Jun Village (M\'nong stilt houses)', nameVi: 'Buôn Jun', cityId: 'buonmathuot', lat: 12.4123, lng: 108.1867, kind: 'landmark' },
  { id: 'buon-ma-thuot-airport', name: 'Buon Ma Thuot Airport', nameVi: 'Sân bay Buôn Ma Thuột', cityId: 'buonmathuot', lat: 12.6683, lng: 108.1203, kind: 'transport' },
  { id: 'buon-ma-thuot-central-market', name: 'Buon Ma Thuot Central Market', nameVi: 'Chợ Trung tâm Buôn Ma Thuột', cityId: 'buonmathuot', lat: 12.6792, lng: 108.0485, kind: 'market' },
  { id: 'buon-ma-thuot-prison', name: 'Buon Ma Thuot Prison', nameVi: 'Nhà đày Buôn Ma Thuột', cityId: 'buonmathuot', lat: 12.6744, lng: 108.0488, kind: 'museum' },
  { id: 'buon-ma-thuot-victory-monument', name: 'Buon Ma Thuot Victory Monument', nameVi: 'Tượng đài Chiến thắng Buôn Ma Thuột', cityId: 'buonmathuot', lat: 12.6796, lng: 108.0493, kind: 'landmark' },
  { id: 'cho-buon-ma-thuot', name: 'Buon Ma Thuot Central Market', nameVi: 'Chợ Buôn Ma Thuột', cityId: 'buonmathuot', lat: 12.6796, lng: 108.0434, kind: 'market' },
  { id: 'chua-khai-doan', name: 'Khai Doan Pagoda', nameVi: 'Chùa Sắc tứ Khải Đoan', cityId: 'buonmathuot', lat: 12.679, lng: 108.0461, kind: 'temple' },
  { id: 'dak-lak-museum', name: 'Dak Lak Museum', nameVi: 'Bảo tàng Đắk Lắk', cityId: 'buonmathuot', lat: 12.6823, lng: 108.0443, kind: 'museum' },
  { id: 'dray-nur-waterfall', name: 'Dray Nur Waterfall', nameVi: 'Thác Dray Nur', cityId: 'buonmathuot', lat: 12.5347, lng: 107.9704, kind: 'nature' },
  { id: 'dray-sap-waterfall', name: 'Dray Sap Waterfall', nameVi: 'Thác Đray Sáp', cityId: 'buonmathuot', lat: 12.5303, lng: 107.9627, kind: 'nature' },
  { id: 'ho-lak', name: 'Lak Lake', nameVi: 'Hồ Lắk', cityId: 'buonmathuot', lat: 12.4113, lng: 108.1787, kind: 'nature' },
  { id: 'khai-doan-pagoda', name: 'Khai Doan Pagoda', nameVi: 'Chùa Sắc tứ Khải Đoan', cityId: 'buonmathuot', lat: 12.6793, lng: 108.0498, kind: 'temple' },
  { id: 'lak-lake', name: 'Lak Lake', nameVi: 'Hồ Lắk', cityId: 'buonmathuot', lat: 12.4134, lng: 108.18, kind: 'nature' },
  { id: 'thac-dray-nur', name: 'Dray Nur Waterfall', nameVi: 'Thác Dray Nur', cityId: 'buonmathuot', lat: 12.531, lng: 107.968, kind: 'nature' },
  { id: 'tuong-dai-chien-thang-bmt', name: 'Buon Ma Thuot Victory Monument', nameVi: 'Tượng đài Chiến thắng Buôn Ma Thuột', cityId: 'buonmathuot', lat: 12.6797, lng: 108.0393, kind: 'landmark' },
  { id: 'vuon-quoc-gia-yok-don', name: 'Yok Don National Park', nameVi: 'Vườn quốc gia Yok Đôn', cityId: 'buonmathuot', lat: 12.8948, lng: 107.7622, kind: 'nature' },
  { id: 'yok-don-national-park', name: 'Yok Don National Park', nameVi: 'Vườn quốc gia Yok Đôn', cityId: 'buonmathuot', lat: 12.8962, lng: 107.7728, kind: 'nature' },
  { id: 'ben-thanh-market', name: 'Ben Thanh Market', nameVi: 'Chợ Bến Thành', cityId: 'hochiminh', lat: 10.7725, lng: 106.698, kind: 'market' },
  { id: 'binh-tay-market', name: 'Binh Tay Market', nameVi: 'Chợ Bình Tây', cityId: 'hochiminh', lat: 10.7499, lng: 106.6504, kind: 'market' },
  { id: 'bitexco-financial-tower', name: 'Bitexco Financial Tower Skydeck', nameVi: 'Tòa nhà Bitexco Financial Tower', cityId: 'hochiminh', lat: 10.7717, lng: 106.7044, kind: 'viewpoint' },
  { id: 'bui-vien-street', name: 'Bui Vien Street', nameVi: 'Phố Bùi Viện', cityId: 'hochiminh', lat: 10.767, lng: 106.6923, kind: 'food' },
  { id: 'cu-chi-tunnels', name: 'Cu Chi Tunnels', nameVi: 'Địa đạo Củ Chi', cityId: 'hochiminh', lat: 11.1417, lng: 106.462, kind: 'landmark' },
  { id: 'giac-lam-pagoda', name: 'Giac Lam Pagoda', nameVi: 'Chùa Giác Lâm', cityId: 'hochiminh', lat: 10.778, lng: 106.6358, kind: 'temple' },
  { id: 'ho-chi-minh-city-fine-arts-museum', name: 'Ho Chi Minh City Fine Arts Museum', nameVi: 'Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh', cityId: 'hochiminh', lat: 10.7687, lng: 106.6979, kind: 'museum' },
  { id: 'ho-chi-minh-city-museum', name: 'Ho Chi Minh City Museum', nameVi: 'Bảo tàng Thành phố Hồ Chí Minh', cityId: 'hochiminh', lat: 10.7757, lng: 106.699, kind: 'museum' },
  { id: 'independence-palace-saigon', name: 'Independence Palace (Reunification Palace)', nameVi: 'Dinh Độc Lập', cityId: 'hochiminh', lat: 10.7772, lng: 106.6958, kind: 'landmark' },
  { id: 'jade-emperor-pagoda', name: 'Jade Emperor Pagoda', nameVi: 'Chùa Ngọc Hoàng', cityId: 'hochiminh', lat: 10.7903, lng: 106.6913, kind: 'temple' },
  { id: 'landmark-81-saigon', name: 'Landmark 81', nameVi: 'Tòa nhà Landmark 81', cityId: 'hochiminh', lat: 10.7949, lng: 106.7219, kind: 'landmark' },
  { id: 'nguyen-hue-walking-street', name: 'Nguyen Hue Walking Street', nameVi: 'Phố đi bộ Nguyễn Huệ', cityId: 'hochiminh', lat: 10.7744, lng: 106.7034, kind: 'landmark' },
  { id: 'saigon-central-post-office', name: 'Saigon Central Post Office', nameVi: 'Bưu điện Trung tâm Sài Gòn', cityId: 'hochiminh', lat: 10.78, lng: 106.6997, kind: 'landmark' },
  { id: 'saigon-notre-dame-cathedral', name: 'Saigon Notre-Dame Cathedral Basilica', nameVi: 'Nhà thờ Đức Bà Sài Gòn', cityId: 'hochiminh', lat: 10.7797, lng: 106.699, kind: 'landmark' },
  { id: 'saigon-opera-house', name: 'Saigon Opera House (Municipal Theatre)', nameVi: 'Nhà hát Thành phố Hồ Chí Minh', cityId: 'hochiminh', lat: 10.7767, lng: 106.703, kind: 'landmark' },
  { id: 'saigon-railway-station', name: 'Saigon Railway Station', nameVi: 'Ga Sài Gòn', cityId: 'hochiminh', lat: 10.7822, lng: 106.6779, kind: 'transport' },
  { id: 'saigon-zoo-and-botanical-gardens', name: 'Saigon Zoo and Botanical Gardens', nameVi: 'Thảo Cầm Viên Sài Gòn', cityId: 'hochiminh', lat: 10.7874, lng: 106.7056, kind: 'nature' },
  { id: 'tan-son-nhat-international-airport', name: 'Tan Son Nhat International Airport', nameVi: 'Sân bay quốc tế Tân Sơn Nhất', cityId: 'hochiminh', lat: 10.8188, lng: 106.652, kind: 'transport' },
  { id: 'thien-hau-temple-saigon', name: 'Thien Hau Temple', nameVi: 'Chùa Bà Thiên Hậu', cityId: 'hochiminh', lat: 10.7528, lng: 106.6586, kind: 'temple' },
  { id: 'war-remnants-museum', name: 'War Remnants Museum', nameVi: 'Bảo tàng Chứng tích Chiến tranh', cityId: 'hochiminh', lat: 10.7797, lng: 106.6921, kind: 'museum' },
  { id: 'an-binh-island-vinh-long', name: 'An Binh Island', nameVi: 'Cù lao An Bình', cityId: 'mekong', lat: 10.2694, lng: 105.9796, kind: 'nature' },
  { id: 'ang-pagoda-tra-vinh', name: 'Ang Pagoda', nameVi: 'Chùa Âng', cityId: 'mekong', lat: 9.9162, lng: 106.3217, kind: 'temple' },
  { id: 'ao-ba-om', name: 'Ba Om Pond', nameVi: 'Ao Bà Om', cityId: 'mekong', lat: 9.9177, lng: 106.324, kind: 'nature' },
  { id: 'ben-tre-market', name: 'Ben Tre Market', nameVi: 'Chợ Bến Tre', cityId: 'mekong', lat: 10.238, lng: 106.3766, kind: 'market' },
  { id: 'con-phung-islet', name: 'Con Phung (Phoenix Island)', nameVi: 'Cồn Phụng', cityId: 'mekong', lat: 10.3283, lng: 106.3303, kind: 'nature' },
  { id: 'huynh-thuy-le-ancient-house', name: 'Huynh Thuy Le Ancient House', nameVi: 'Nhà cổ Huỳnh Thủy Lê', cityId: 'mekong', lat: 10.2953, lng: 105.7605, kind: 'landmark' },
  { id: 'my-tho-tourist-pier', name: 'My Tho Tourist Boat Pier', nameVi: 'Bến tàu du lịch Mỹ Tho', cityId: 'mekong', lat: 10.3483, lng: 106.3606, kind: 'transport' },
  { id: 'my-thuan-bridge', name: 'My Thuan Bridge', nameVi: 'Cầu Mỹ Thuận', cityId: 'mekong', lat: 10.275, lng: 105.9166, kind: 'landmark' },
  { id: 'nguyen-sinh-sac-memorial', name: 'Nguyen Sinh Sac Memorial Site', nameVi: 'Khu di tích Nguyễn Sinh Sắc', cityId: 'mekong', lat: 10.4537, lng: 105.6294, kind: 'landmark' },
  { id: 'rach-mieu-bridge', name: 'Rach Mieu Bridge', nameVi: 'Cầu Rạch Miễu', cityId: 'mekong', lat: 10.3258, lng: 106.3391, kind: 'landmark' },
  { id: 'sa-dec-flower-village', name: 'Sa Dec Flower Village', nameVi: 'Làng hoa Sa Đéc', cityId: 'mekong', lat: 10.2853, lng: 105.7428, kind: 'nature' },
  { id: 'thoi-son-island', name: 'Thoi Son Island (Unicorn Island)', nameVi: 'Cồn Thới Sơn', cityId: 'mekong', lat: 10.3321, lng: 106.3364, kind: 'nature' },
  { id: 'tram-chim-national-park', name: 'Tram Chim National Park', nameVi: 'Vườn quốc gia Tràm Chim', cityId: 'mekong', lat: 10.7243, lng: 105.5236, kind: 'nature' },
  { id: 'vinh-long-market', name: 'Vinh Long Market', nameVi: 'Chợ Vĩnh Long', cityId: 'mekong', lat: 10.2525, lng: 105.9728, kind: 'market' },
  { id: 'vinh-trang-pagoda', name: 'Vinh Trang Pagoda', nameVi: 'Chùa Vĩnh Tràng', cityId: 'mekong', lat: 10.375, lng: 106.3611, kind: 'temple' },
  { id: 'binh-thuy-ancient-house', name: 'Binh Thuy Ancient House', nameVi: 'Nhà cổ Bình Thủy', cityId: 'cantho', lat: 10.065, lng: 105.743, kind: 'landmark' },
  { id: 'cai-rang-floating-market', name: 'Cai Rang Floating Market', nameVi: 'Chợ nổi Cái Răng', cityId: 'cantho', lat: 10.013, lng: 105.7758, kind: 'market' },
  { id: 'can-tho-airport', name: 'Can Tho International Airport', nameVi: 'Sân bay quốc tế Cần Thơ', cityId: 'cantho', lat: 10.0851, lng: 105.7119, kind: 'transport' },
  { id: 'can-tho-ancient-market', name: 'Can Tho Ancient Market', nameVi: 'Chợ cổ Cần Thơ', cityId: 'cantho', lat: 10.0339, lng: 105.7897, kind: 'market' },
  { id: 'can-tho-international-airport', name: 'Can Tho International Airport', nameVi: 'Sân bay quốc tế Cần Thơ', cityId: 'cantho', lat: 10.084, lng: 105.712, kind: 'transport' },
  { id: 'can-tho-museum', name: 'Can Tho Museum', nameVi: 'Bảo tàng Cần Thơ', cityId: 'cantho', lat: 10.0341, lng: 105.7817, kind: 'museum' },
  { id: 'munirangsyaram-pagoda', name: 'Munirangsyaram Khmer Pagoda', nameVi: 'Chùa Munirangsyaram', cityId: 'cantho', lat: 10.0336, lng: 105.7831, kind: 'temple' },
  { id: 'ninh-kieu-wharf', name: 'Ninh Kieu Wharf', nameVi: 'Bến Ninh Kiều', cityId: 'cantho', lat: 10.0326, lng: 105.7896, kind: 'landmark' },
  { id: 'ong-pagoda-can-tho', name: 'Ong Pagoda', nameVi: 'Chùa Ông', cityId: 'cantho', lat: 10.0337, lng: 105.7888, kind: 'temple' },
  { id: 'bau-trang-white-sand-dunes', name: 'Bau Trang White Sand Dunes', nameVi: 'Bàu Trắng', cityId: 'muine', lat: 11.0565, lng: 108.4195, kind: 'nature' },
  { id: 'doi-duong-beach-phan-thiet', name: 'Doi Duong Beach', nameVi: 'Bãi biển Đồi Dương', cityId: 'muine', lat: 10.9258, lng: 108.116, kind: 'beach' },
  { id: 'duc-thanh-school-phan-thiet', name: 'Duc Thanh School', nameVi: 'Trường Dục Thanh', cityId: 'muine', lat: 10.9292, lng: 108.1014, kind: 'museum' },
  { id: 'fairy-stream-mui-ne', name: 'Fairy Stream', nameVi: 'Suối Tiên', cityId: 'muine', lat: 10.9423, lng: 108.2629, kind: 'nature' },
  { id: 'hon-rom-beach', name: 'Hon Rom Beach', nameVi: 'Bãi biển Hòn Rơm', cityId: 'muine', lat: 10.9675, lng: 108.3145, kind: 'beach' },
  { id: 'mui-ne-beach', name: 'Mui Ne Beach', nameVi: 'Bãi biển Mũi Né', cityId: 'muine', lat: 10.9331, lng: 108.2852, kind: 'beach' },
  { id: 'mui-ne-fishing-village', name: 'Mui Ne Fishing Village', nameVi: 'Làng chài Mũi Né', cityId: 'muine', lat: 10.949, lng: 108.2932, kind: 'landmark' },
  { id: 'mui-ne-red-sand-dunes', name: 'Red Sand Dunes', nameVi: 'Đồi cát Hồng', cityId: 'muine', lat: 10.9559, lng: 108.3091, kind: 'nature' },
  { id: 'phan-thiet-market', name: 'Phan Thiet Market', nameVi: 'Chợ Phan Thiết', cityId: 'muine', lat: 10.9321, lng: 108.1018, kind: 'market' },
  { id: 'phan-thiet-water-tower', name: 'Phan Thiet Water Tower', nameVi: 'Tháp nước Phan Thiết', cityId: 'muine', lat: 10.9314, lng: 108.1036, kind: 'landmark' },
  { id: 'po-sah-inu-cham-towers', name: 'Po Sah Inu Cham Towers', nameVi: 'Tháp Pô Sah Inư', cityId: 'muine', lat: 10.942, lng: 108.1557, kind: 'temple' },
  { id: 'van-thuy-tu-whale-temple', name: 'Van Thuy Tu Whale Temple', nameVi: 'Vạn Thủy Tú', cityId: 'muine', lat: 10.9328, lng: 108.1009, kind: 'temple' },
  { id: 'an-thoi-port', name: 'An Thoi Port', nameVi: 'Cảng An Thới', cityId: 'phuquoc', lat: 10.0141, lng: 103.9938, kind: 'transport' },
  { id: 'bai-dai-phu-quoc', name: 'Bai Dai (Long Beach North)', nameVi: 'Bãi Dài', cityId: 'phuquoc', lat: 10.3291, lng: 103.8528, kind: 'beach' },
  { id: 'bai-khem-phu-quoc', name: 'Khem Beach', nameVi: 'Bãi Khem', cityId: 'phuquoc', lat: 10.0253, lng: 104.0196, kind: 'beach' },
  { id: 'bai-ong-lang', name: 'Ong Lang Beach', nameVi: 'Bãi Ông Lang', cityId: 'phuquoc', lat: 10.2633, lng: 103.9282, kind: 'beach' },
  { id: 'bai-sao-phu-quoc', name: 'Sao Beach', nameVi: 'Bãi Sao', cityId: 'phuquoc', lat: 10.0436, lng: 104.0288, kind: 'beach' },
  { id: 'bai-truong-phu-quoc', name: 'Long Beach (Bai Truong)', nameVi: 'Bãi Trường', cityId: 'phuquoc', lat: 10.1872, lng: 103.9625, kind: 'beach' },
  { id: 'dinh-cau', name: 'Dinh Cau Shrine', nameVi: 'Dinh Cậu', cityId: 'phuquoc', lat: 10.2164, lng: 103.9552, kind: 'temple' },
  { id: 'duong-dong-market', name: 'Duong Dong Market', nameVi: 'Chợ Dương Đông', cityId: 'phuquoc', lat: 10.2178, lng: 103.96, kind: 'market' },
  { id: 'ham-ninh-fishing-village', name: 'Ham Ninh Fishing Village', nameVi: 'Làng chài Hàm Ninh', cityId: 'phuquoc', lat: 10.1916, lng: 104.0457, kind: 'landmark' },
  { id: 'ho-quoc-pagoda', name: 'Ho Quoc Zen Monastery', nameVi: 'Thiền viện Hộ Quốc', cityId: 'phuquoc', lat: 10.1133, lng: 104.0291, kind: 'temple' },
  { id: 'hon-thom-island', name: 'Hon Thom (Pineapple Island)', nameVi: 'Hòn Thơm', cityId: 'phuquoc', lat: 9.9649, lng: 104.0115, kind: 'nature' },
  { id: 'phu-quoc-airport', name: 'Phu Quoc International Airport', nameVi: 'Sân bay quốc tế Phú Quốc', cityId: 'phuquoc', lat: 10.1698, lng: 103.9931, kind: 'transport' },
  { id: 'phu-quoc-national-park', name: 'Phu Quoc National Park', nameVi: 'Vườn quốc gia Phú Quốc', cityId: 'phuquoc', lat: 10.375, lng: 103.9723, kind: 'nature' },
  { id: 'phu-quoc-night-market', name: 'Phu Quoc Night Market', nameVi: 'Chợ đêm Phú Quốc', cityId: 'phuquoc', lat: 10.2139, lng: 103.9589, kind: 'food' },
  { id: 'phu-quoc-prison-museum', name: 'Phu Quoc Prison (Coconut Tree Prison)', nameVi: 'Nhà tù Phú Quốc', cityId: 'phuquoc', lat: 10.0371, lng: 104.0014, kind: 'museum' },
  { id: 'sunset-town-phu-quoc', name: 'Sunset Town', nameVi: 'Thị trấn Hoàng Hôn', cityId: 'phuquoc', lat: 10.0074, lng: 103.9893, kind: 'landmark' },
  { id: 'suoi-tranh-waterfall', name: 'Tranh Stream Waterfall', nameVi: 'Suối Tranh', cityId: 'phuquoc', lat: 10.2049, lng: 104.0092, kind: 'nature' },
  { id: 'vinpearl-safari-phu-quoc', name: 'Vinpearl Safari Phu Quoc', nameVi: 'Vinpearl Safari Phú Quốc', cityId: 'phuquoc', lat: 10.3348, lng: 103.8717, kind: 'activity' },
  { id: 'vinwonders-phu-quoc', name: 'VinWonders Phu Quoc', nameVi: 'VinWonders Phú Quốc', cityId: 'phuquoc', lat: 10.3452, lng: 103.8618, kind: 'activity' },
  { id: 'bai-dam-trau-con-dao', name: 'Dam Trau Beach', nameVi: 'Bãi Đầm Trầu', cityId: 'condao', lat: 8.7262, lng: 106.6238, kind: 'beach' },
  { id: 'bai-lo-voi-con-dao', name: 'Lo Voi Beach', nameVi: 'Bãi Lò Vôi', cityId: 'condao', lat: 8.6882, lng: 106.6146, kind: 'beach' },
  { id: 'bai-nhat-con-dao', name: 'Nhat Beach', nameVi: 'Bãi Nhát', cityId: 'condao', lat: 8.6574, lng: 106.5891, kind: 'beach' },
  { id: 'cang-ben-dam-con-dao', name: 'Ben Dam Port', nameVi: 'Cảng Bến Đầm', cityId: 'condao', lat: 8.6538, lng: 106.569, kind: 'transport' },
  { id: 'cau-tau-914-con-dao', name: 'Wharf 914', nameVi: 'Cầu tàu 914', cityId: 'condao', lat: 8.6775, lng: 106.605, kind: 'landmark' },
  { id: 'con-dao-airport', name: 'Con Dao Airport (Co Ong)', nameVi: 'Sân bay Côn Đảo (Cỏ Ống)', cityId: 'condao', lat: 8.7316, lng: 106.6329, kind: 'transport' },
  { id: 'con-dao-bay-canh-island', name: 'Bay Canh Island (turtle watching)', nameVi: 'Hòn Bảy Cạnh', cityId: 'condao', lat: 8.6739, lng: 106.7007, kind: 'activity' },
  { id: 'con-dao-ben-dam-port', name: 'Ben Dam Port', nameVi: 'Cảng Bến Đầm', cityId: 'condao', lat: 8.6515, lng: 106.5602, kind: 'transport' },
  { id: 'con-dao-co-ong-airport', name: 'Con Dao (Co Ong) Airport', nameVi: 'Sân bay Côn Đảo (Cỏ Ống)', cityId: 'condao', lat: 8.7319, lng: 106.6329, kind: 'transport' },
  { id: 'con-dao-dam-trau-beach', name: 'Dam Trau Beach', nameVi: 'Bãi Đầm Trầu', cityId: 'condao', lat: 8.7262, lng: 106.6252, kind: 'beach' },
  { id: 'con-dao-hang-duong-cemetery', name: 'Hang Duong Cemetery', nameVi: 'Nghĩa trang Hàng Dương', cityId: 'condao', lat: 8.6925, lng: 106.6171, kind: 'landmark' },
  { id: 'con-dao-nhat-beach', name: 'Nhat Beach', nameVi: 'Bãi Nhát', cityId: 'condao', lat: 8.6471, lng: 106.5721, kind: 'beach' },
  { id: 'con-dao-phu-hai-prison', name: 'Phu Hai Prison Camp', nameVi: 'Trại Phú Hải (Nhà tù Côn Đảo)', cityId: 'condao', lat: 8.6835, lng: 106.6042, kind: 'landmark' },
  { id: 'con-dao-tiger-cages', name: 'The Tiger Cages (Phu Tuong Camp)', nameVi: 'Chuồng Cọp (Trại Phú Tường)', cityId: 'condao', lat: 8.6849, lng: 106.6055, kind: 'landmark' },
  { id: 'con-dao-van-son-pagoda', name: 'Van Son Pagoda (Nui Mot Pagoda)', nameVi: 'Vân Sơn Tự (Chùa Núi Một)', cityId: 'condao', lat: 8.6806, lng: 106.5992, kind: 'temple' },
  { id: 'hang-duong-cemetery', name: 'Hang Duong Cemetery', nameVi: 'Nghĩa trang Hàng Dương', cityId: 'condao', lat: 8.6915, lng: 106.6088, kind: 'landmark' },
  { id: 'phu-hai-prison-camp', name: 'Phu Hai Prison Camp', nameVi: 'Trại Phú Hải', cityId: 'condao', lat: 8.6825, lng: 106.6026, kind: 'landmark' },
]

/** Places grouped by destination. Built once at module load. */
export const PLACES_BY_CITY: Map<CityId, ItineraryPlace[]> = (() => {
  const m = new Map<CityId, ItineraryPlace[]>()
  for (const p of ITINERARY_PLACES) {
    const list = m.get(p.cityId)
    if (list) list.push(p)
    else m.set(p.cityId, [p])
  }
  return m
})()

// Folded lookup keys (accent- and case-insensitive), built once. Both the English and the
// Vietnamese name resolve, because a generated itinerary may use either.
const BY_FOLDED_NAME: Map<string, ItineraryPlace> = (() => {
  const m = new Map<string, ItineraryPlace>()
  for (const p of ITINERARY_PLACES) {
    for (const key of [fold(p.name), fold(p.nameVi), fold(p.id.replace(/-/g, ' '))]) {
      if (!m.has(key)) m.set(key, p) // first writer wins; ids are unique, so these are aliases
    }
  }
  return m
})()

/**
 * Resolve a free-text place name to a catalogued place, or null.
 *
 * Returns null rather than a guess, deliberately: on a miss the caller must omit the
 * coordinate, not invent one. Pass cityId whenever it is known — that is what makes a generic
 * name like "Central Market" unambiguous, and a city-scoped miss NEVER falls back to a
 * nationwide match, because a same-named place in another province would put the pin ~1000km
 * away while looking perfectly valid. EVERY hit, scoped or not, clears isNearCity before
 * it is returned.
 */
export function findPlace(name: string, cityId?: CityId): ItineraryPlace | null {
  const key = fold(name ?? '')
  if (!key) return null

  const hit = cityId ? findInCity(key, cityId) : BY_FOLDED_NAME.get(key)
  if (!hit) return null

  // ONE gate for EVERY return path. This check used to live only on the nationwide branch,
  // so a city-scoped hit was returned ungated — the resolver could hand back a point that
  // the catalog itself would have rejected (codex found this). Anything a future hand-edit
  // puts in the file still has to clear the radius before it can reach a map.
  const city = CITY_MAP.get(hit.cityId)
  if (!city) return null
  if (!isNearCity({ lat: hit.lat, lng: hit.lng }, { lat: city.lat, lng: city.lng }, hit.cityId)) {
    return null
  }
  return hit
}

/** Scoped lookup: exact on either language, then an unambiguous partial WITHIN the city. */
function findInCity(key: string, cityId: CityId): ItineraryPlace | undefined {
  const list = PLACES_BY_CITY.get(cityId)
  if (!list) return undefined
  const exact = list.find((p) => fold(p.name) === key || fold(p.nameVi) === key)
  if (exact) return exact
  // Partial matches BOTH languages: checking only the English name meant a Vietnamese
  // partial ("cho ben thanh") never resolved even though the exact form did.
  const partial = list.filter((p) => {
    const en = fold(p.name)
    const vi = fold(p.nameVi)
    return en.includes(key) || key.includes(en) || vi.includes(key) || key.includes(vi)
  })
  // Only when unambiguous — two candidates means we do not know which, and a guess here
  // is a pin in the wrong part of town.
  return partial.length === 1 ? partial[0] : undefined
}
