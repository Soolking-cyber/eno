/**
 * The post wizard's CATEGORY-AWARE examples: the title placeholder, the description hint and the
 * model placeholder. Before this every category got the phone example ("iPhone 14 128GB — battery
 * 92%"), so a seller posting a job or an airport pickup was shown how to list a phone.
 *
 * ⚠️ RENDERED THROUGH A VARIABLE — tr(copy.title, copy.titleVi) — so the literal scans in
 * scripts/gen-ui-strings.mjs never see these strings. That script's VARIABLE_RENDERED_COPY lists
 * this file with the fields below; add a field here and it has to go there too, or the nine
 * machine-translated languages fetch it lazily, once per string. For the same reason the English
 * values are single-quoted and carry no straight apostrophe.
 *
 * ⚠️ PLACES ARE FROM THE 2025 WARD DATASET ONLY. Bình Thạnh exists there; the pre-merger districts
 * and wards (Quận 1, Thảo Điền) do not, and an example the area picker cannot find reads as a bug.
 *
 * ⛔ NO VISA WORDING, in any entry. services/visa-legal is an ordinary subcategory of Services, and
 * eno.vn may not describe visa services at all (the edition boundary in CLAUDE.md).
 */

export type PostCopy = {
  title: string
  titleVi: string
  hint: string
  hintVi: string
  model: string
  modelVi: string
}

const DEFAULT: PostCopy = {
  title: 'e.g. What it is, brand, one key detail',
  titleVi: 'VD: Tên món đồ, thương hiệu, một điểm nổi bật',
  hint: 'Condition, why you’re selling, what stands out. No phone numbers.',
  hintVi: 'Tình trạng, lý do bán, điểm nổi bật. Đừng ghi số điện thoại.',
  model: 'e.g. the model name on the box or label',
  modelVi: 'VD: tên mẫu ghi trên hộp hoặc nhãn',
}

/** Keyed by category slug (src/lib/taxonomy.ts). A missing field falls back to DEFAULT's. */
const POST_COPY: Record<string, Partial<PostCopy>> = {
  electronics: {
    title: 'e.g. iPhone 14 128GB — battery 92%',
    titleVi: 'VD: iPhone 14 128GB — pin 92%',
    hint: 'Condition, why you are selling, what is included. No phone numbers.',
    hintVi: 'Tình trạng, lý do bán, phụ kiện kèm theo. Đừng ghi số điện thoại.',
    model: 'e.g. iPhone 14 Pro',
    modelVi: 'VD: iPhone 14 Pro',
  },
  vehicles: {
    title: 'e.g. Honda Air Blade 2021 — 12,000 km',
    titleVi: 'VD: Honda Air Blade 2021 — đã đi 12.000 km',
    hint: 'Year, mileage, papers, service history, any damage. No phone numbers.',
    hintVi: 'Năm, số km, giấy tờ, lịch sử bảo dưỡng, hư hỏng nếu có. Đừng ghi số điện thoại.',
    model: 'e.g. Air Blade 160',
    modelVi: 'VD: Air Blade 160',
  },
  property: {
    title: 'e.g. 2-bedroom apartment, 75 m², Bình Thạnh',
    titleVi: 'VD: Căn hộ 2 phòng ngủ, 75 m², Bình Thạnh',
    hint: 'Size, rooms, floor, legal papers, what is nearby. No phone numbers.',
    hintVi: 'Diện tích, số phòng, tầng, pháp lý, tiện ích xung quanh. Đừng ghi số điện thoại.',
  },
  rentals: {
    title: 'e.g. 2-bedroom apartment, pool, pets OK — Bình Thạnh',
    titleVi: 'VD: Căn hộ 2 phòng ngủ, có hồ bơi, cho nuôi thú cưng — Bình Thạnh',
    hint: 'What is included, minimum stay, deposit, when it is free. No phone numbers.',
    hintVi: 'Bao gồm những gì, thời hạn thuê tối thiểu, tiền cọc, ngày trống. Đừng ghi số điện thoại.',
    // Brand and model only mean something for the vehicle rentals in this category.
    model: 'e.g. Air Blade 160',
    modelVi: 'VD: Air Blade 160',
  },
  jobs: {
    title: 'e.g. English teacher, full-time — Bình Thạnh',
    titleVi: 'VD: Giáo viên tiếng Anh, toàn thời gian — Bình Thạnh',
    // The pay has its own Salary section on a job (taxonomy.ts paysSalary), so the body asks for what it cannot say.
    hint: 'Duties, hours, requirements, benefits. Candidates message you in the app. No phone numbers.',
    hintVi: 'Công việc, giờ làm, yêu cầu, quyền lợi. Ứng viên nhắn tin cho bạn trong ứng dụng. Đừng ghi số điện thoại.',
  },
  services: {
    title: 'e.g. Airport pickup, 7-seat car',
    titleVi: 'VD: Đưa đón sân bay, xe 7 chỗ',
    hint: 'What you offer, where, how long it takes, what is included. No phone numbers.',
    hintVi: 'Bạn cung cấp gì, ở đâu, mất bao lâu, bao gồm những gì. Đừng ghi số điện thoại.',
  },
  'furniture-appliances': {
    title: 'e.g. IKEA 3-seat sofa, grey — like new',
    titleVi: 'VD: Sofa IKEA 3 chỗ, màu xám — như mới',
  },
  'fashion-beauty': {
    title: 'e.g. Uniqlo down jacket, size M — worn twice',
    titleVi: 'VD: Áo phao Uniqlo, size M — mặc 2 lần',
  },
  'moving-sale': {
    title: 'e.g. Moving sale: sofa, desk, fridge',
    titleVi: 'VD: Thanh lý đồ chuyển nhà: sofa, bàn, tủ lạnh',
  },
  'baby-kids': {
    title: 'e.g. Joie stroller, foldable — 1 year old',
    titleVi: 'VD: Xe đẩy Joie, gấp gọn — dùng 1 năm',
  },
  // The four below sell no object with a "condition", so the default hint would ask the wrong
  // questions too — each carries its own.
  pets: {
    title: 'e.g. Corgi puppy, 3 months — vaccinated',
    titleVi: 'VD: Chó Corgi 3 tháng tuổi — đã tiêm phòng',
    hint: 'Age, health, vaccinations, temperament. No phone numbers.',
    hintVi: 'Tuổi, sức khoẻ, tiêm phòng, tính cách. Đừng ghi số điện thoại.',
  },
  'community-events': {
    title: 'e.g. Language exchange — Thursday evenings',
    titleVi: 'VD: Giao lưu ngôn ngữ — tối thứ Năm hằng tuần',
    hint: 'What happens, when, where, who it is for, what it costs. No phone numbers.',
    hintVi: 'Hoạt động gì, khi nào, ở đâu, dành cho ai, chi phí bao nhiêu. Đừng ghi số điện thoại.',
  },
  'tickets-travel': {
    title: 'e.g. 2 concert tickets, Saturday — seats together',
    titleVi: 'VD: 2 vé ca nhạc tối thứ Bảy — ghế cạnh nhau',
    hint: 'Date, what is included, how you hand it over. No phone numbers.',
    hintVi: 'Ngày, bao gồm những gì, cách giao nhận. Đừng ghi số điện thoại.',
  },
  'food-drink': {
    title: 'e.g. Homemade kimchi, 1 kg jar',
    titleVi: 'VD: Kim chi nhà làm, hũ 1 kg',
    hint: 'What is in it, portion size, how to order, delivery area. No phone numbers.',
    hintVi: 'Thành phần, khẩu phần, cách đặt hàng, khu vực giao hàng. Đừng ghi số điện thoại.',
  },
}

/**
 * Per-SUBCATEGORY overrides, keyed `category/subcategory`, layered over the category's entry. Rentals
 * is the case that needs it: its category example is an apartment, and a seller renting out a scooter
 * was shown "2-bedroom apartment, pool" (sell-13).
 */
const SUBCAT_COPY: Record<string, Partial<PostCopy>> = {
  'rentals/motorbike-rental': {
    title: 'e.g. Honda Vision 2022 for rent — helmet included',
    titleVi: 'VD: Cho thuê Honda Vision 2022 — kèm mũ bảo hiểm',
    hint: 'Daily or monthly price, deposit, papers needed, delivery. No phone numbers.',
    hintVi: 'Giá theo ngày hoặc tháng, tiền cọc, giấy tờ cần có, giao xe. Đừng ghi số điện thoại.',
    model: 'e.g. Vision, Air Blade, Lead',
    modelVi: 'VD: Vision, Air Blade, Lead',
  },
  'rentals/car-rental': {
    title: 'e.g. Toyota Vios 2021 self-drive, 5 seats',
    titleVi: 'VD: Toyota Vios 2021 tự lái, 5 chỗ',
    hint: 'Daily price, deposit, licence needed, km limit, delivery. No phone numbers.',
    hintVi: 'Giá theo ngày, tiền cọc, bằng lái cần có, giới hạn km, giao xe. Đừng ghi số điện thoại.',
    model: 'e.g. Vios, Xpander, VF 5',
    modelVi: 'VD: Vios, Xpander, VF 5',
  },
  'rentals/bicycle-rental': {
    title: 'e.g. City bike for rent, with lock',
    titleVi: 'VD: Cho thuê xe đạp đi phố, kèm khoá',
    hint: 'Price per day or week, deposit, pickup point. No phone numbers.',
    hintVi: 'Giá theo ngày hoặc tuần, tiền cọc, điểm nhận xe. Đừng ghi số điện thoại.',
    model: 'e.g. the model name on the frame',
    modelVi: 'VD: tên mẫu ghi trên khung xe',
  },
  'rentals/ebike-rental': {
    title: 'e.g. VinFast Evo200 e-scooter for rent — charger included',
    titleVi: 'VD: Cho thuê xe máy điện VinFast Evo200 — kèm sạc',
    hint: 'Price per day or month, range per charge, deposit, delivery. No phone numbers.',
    hintVi: 'Giá theo ngày hoặc tháng, quãng đường mỗi lần sạc, tiền cọc, giao xe. Đừng ghi số điện thoại.',
    model: 'e.g. Evo200, Feliz',
    modelVi: 'VD: Evo200, Feliz',
  },
}

/** The examples for a category (and subcategory) — DEFAULT's for none, or for a slug no table names. */
export function postCopyFor(categorySlug: string | null | undefined, subcategorySlug?: string | null): PostCopy {
  return {
    ...DEFAULT,
    ...(categorySlug ? POST_COPY[categorySlug] : undefined),
    ...(categorySlug && subcategorySlug ? SUBCAT_COPY[`${categorySlug}/${subcategorySlug}`] : undefined),
  }
}
