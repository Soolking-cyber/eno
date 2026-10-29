/**
 * HCMC's PRE-2025 wards, by the old district they sat in, each district with its block of GSO ward codes. A 2025 ward kept
 * the code of one of the old wards it absorbed, so its code places it in exactly one old district (honeycomb-listing.ts
 * `checkWard`, hcmc-ward-groups.ts). Data only, no imports — moved out of honeycomb-listing.ts (2026-10-30) so the ward
 * picker's API does not load an importer (review, opus). Keys are the exact `Listing.district` strings `districtOf` emits.
 */
export const HCMC_OLD_WARDS: readonly (readonly [district: string, codeLo: number, codeHi: number, wards: string])[] = [
  ['Quận 1', 26734, 26761, 'Tân Định|Đa Kao|Bến Nghé|Bến Thành|Nguyễn Thái Bình|Phạm Ngũ Lão|Cầu Ông Lãnh|Cô Giang|Nguyễn Cư Trinh|Cầu Kho'],
  ['Quận 12', 26764, 26791, 'Thạnh Xuân|Thạnh Lộc|Hiệp Thành|Thới An|Tân Chánh Hiệp|An Phú Đông|Tân Thới Hiệp|Trung Mỹ Tây|Tân Hưng Thuận|Đông Hưng Thuận|Tân Thới Nhất'],
  ['Thủ Đức', 26794, 26827, 'Linh Xuân|Bình Chiểu|Linh Trung|Tam Bình|Tam Phú|Hiệp Bình Phước|Hiệp Bình Chánh|Linh Chiểu|Linh Tây|Linh Đông|Bình Thọ|Trường Thọ'],
  ['Quận 9', 26830, 26866, 'Long Bình|Long Thạnh Mỹ|Tân Phú|Hiệp Phú|Tăng Nhơn Phú A|Tăng Nhơn Phú B|Phước Long B|Phước Long A|Trường Thạnh|Long Phước|Long Trường|Phước Bình|Phú Hữu'],
  ['Quận Gò Vấp', 26872, 26902, '15|17|6|16|12|14|10|5|1|8|11|3'],
  ['Quận Bình Thạnh', 26905, 26962, '13|11|27|26|12|25|5|7|14|2|1|17|22|19|28'],
  ['Quận Tân Bình', 26965, 27007, '2|4|12|13|1|3|11|7|5|10|6|8|9|14|15'],
  ['Quận Tân Phú', 27010, 27040, 'Tân Sơn Nhì|Tây Thạnh|Sơn Kỳ|Tân Quý|Tân Thành|Phú Thọ Hòa|Phú Thạnh|Phú Trung|Hòa Thạnh|Hiệp Tân|Tân Thới Hòa'],
  ['Quận Phú Nhuận', 27043, 27085, '4|5|9|7|1|2|8|15|10|11|13'],
  ['Quận 2', 27088, 27118, 'Thảo Điền|An Phú|An Khánh|Bình Trưng Đông|Bình Trưng Tây|Cát Lái|Thạnh Mỹ Lợi|An Lợi Đông|Thủ Thiêm'],
  ['Quận 3', 27127, 27160, '14|12|11|Võ Thị Sáu|9|4|5|3|2|1'],
  ['Quận 10', 27163, 27202, '15|13|14|12|10|9|1|8|2|4|6'],
  ['Quận 11', 27208, 27253, '15|5|14|11|3|10|8|7|1|16'],
  ['Quận 4', 27259, 27298, '13|9|8|18|4|3|16|2|15|1'],
  ['Quận 5', 27301, 27343, '4|9|2|12|7|1|11|14|5|13'],
  ['Quận 6', 27346, 27385, '14|13|9|12|2|11|8|1|7|10'],
  ['Quận 8', 27397, 27433, 'Rạch Ông|Hưng Phú|4|Xóm Củi|5|14|6|15|16|7'],
  ['Quận Bình Tân', 27436, 27463, 'Bình Hưng Hòa|Bình Hưng Hoà A|Bình Hưng Hoà B|Bình Trị Đông|Bình Trị Đông A|Bình Trị Đông B|Tân Tạo|Tân Tạo A|An Lạc|An Lạc A'],
  ['Quận 7', 27466, 27493, 'Tân Thuận Đông|Tân Thuận Tây|Tân Kiểng|Tân Hưng|Bình Thuận|Tân Quy|Phú Thuận|Tân Phú|Tân Phong|Phú Mỹ'],
  ['Huyện Củ Chi', 27496, 27556, 'Củ Chi|Phú Mỹ Hưng|An Phú|Trung Lập Thượng|An Nhơn Tây|Nhuận Đức|Phạm Văn Cội|Phú Hòa Đông|Trung Lập Hạ|Trung An|Phước Thạnh|Phước Hiệp|Tân An Hội|Phước Vĩnh An|Thái Mỹ|Tân Thạnh Tây|Hòa Phú|Tân Thạnh Đông|Bình Mỹ|Tân Phú Trung|Tân Thông Hội'],
  ['Huyện Hóc Môn', 27559, 27592, 'Hóc Môn|Tân Hiệp|Nhị Bình|Đông Thạnh|Tân Thới Nhì|Thới Tam Thôn|Xuân Thới Sơn|Tân Xuân|Xuân Thới Đông|Trung Chánh|Xuân Thới Thượng|Bà Điểm'],
  ['Huyện Bình Chánh', 27595, 27640, 'Tân Túc|Phạm Văn Hai|Vĩnh Lộc A|Vĩnh Lộc B|Bình Lợi|Lê Minh Xuân|Tân Nhựt|Tân Kiên|Bình Hưng|Phong Phú|An Phú Tây|Hưng Long|Đa Phước|Tân Quý Tây|Bình Chánh|Quy Đức'],
  ['Huyện Nhà Bè', 27643, 27661, 'Nhà Bè|Phước Kiển|Phước Lộc|Nhơn Đức|Phú Xuân|Long Thới|Hiệp Phước'],
  ['Huyện Cần Giờ', 27664, 27682, 'Cần Thạnh|Bình Khánh|Tam Thôn Hiệp|An Thới Đông|Thạnh An|Long Hòa|Lý Nhơn'],
]
