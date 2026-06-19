export type SubcatDef = {
  slug: string
  name: string
  nameVi: string
  keywords: string[]
}

export const SUBCATEGORIES: Record<string, SubcatDef[]> = {
  'motorbike-rentals': [
    { slug: 'vision', name: 'Honda Vision', nameVi: 'Honda Vision', keywords: ['vision'] },
    { slug: 'airblade', name: 'Honda AirBlade', nameVi: 'AirBlade', keywords: ['airblade', 'air blade', 'ab'] },
    { slug: 'lead', name: 'Honda Lead', nameVi: 'Honda Lead', keywords: ['lead'] },
    { slug: 'sh', name: 'Honda SH', nameVi: 'Honda SH', keywords: ['sh'] },
    { slug: 'exciter', name: 'Yamaha Exciter', nameVi: 'Exciter', keywords: ['exciter'] },
    { slug: 'wave', name: 'Honda Wave / Xe số', nameVi: 'Wave / Xe số', keywords: ['wave', 'sirius', 'xe số'] },
  ],
  'house-rentals': [
    { slug: 'studio', name: 'Studio Room', nameVi: 'Phòng Studio', keywords: ['studio'] },
    { slug: '1br', name: '1 Bedroom (1 BR)', nameVi: '1 Phòng Ngủ', keywords: ['1-bedroom', '1br', '1 phòng ngủ', '1pn'] },
    { slug: '2br', name: '2 Bedrooms (2 BR)', nameVi: '2 Phòng Ngủ', keywords: ['2-bedroom', '2br', '2 phòng ngủ', '2pn'] },
    { slug: '3br', name: '3+ Bedrooms (3 BR+)', nameVi: '3+ Phòng Ngủ', keywords: ['3-bedroom', '3br', '3 phòng ngủ', '3pn', '4pn', 'whole house', 'nhà nguyên căn'] },
  ],
  'moving-sale': [
    { slug: 'sofa', name: 'Sofa / Couch', nameVi: 'Sofa / Ghế khách', keywords: ['sofa', 'chair', 'couch', 'ghế'] },
    { slug: 'table', name: 'Dining Table / Desk', nameVi: 'Bàn ăn / Bàn làm việc', keywords: ['table', 'desk', 'bàn'] },
    { slug: 'bed', name: 'Bed / Mattress', nameVi: 'Giường / Nệm', keywords: ['bed', 'mattress', 'giường', 'nệm'] },
    { slug: 'cabinet', name: 'Cabinet / Wardrobe', nameVi: 'Tủ quần áo / Kệ', keywords: ['cabinet', 'wardrobe', 'shelf', 'tủ', 'kệ'] },
    { slug: 'appliances', name: 'Kitchen / Appliances', nameVi: 'Đồ gia dụng', keywords: ['fridge', 'refrigerator', 'microwave', 'oven', 'lò vi sóng', 'tủ lạnh', 'máy giặt'] },
  ],
  'electronics': [
    { slug: 'iphone', name: 'iPhone / iPad', nameVi: 'iPhone / iPad', keywords: ['iphone', 'ipad', 'apple'] },
    { slug: 'laptop', name: 'MacBook / Laptop', nameVi: 'MacBook / Laptop', keywords: ['macbook', 'laptop', 'dell', 'asus', 'thinkpad'] },
    { slug: 'fridge', name: 'Fridge / Washer', nameVi: 'Tủ lạnh / Máy giặt', keywords: ['fridge', 'refrigerator', 'washer', 'washing', 'tủ lạnh', 'máy giặt'] },
    { slug: 'audio', name: 'Speakers / Headphones', nameVi: 'Loa / Tai nghe', keywords: ['speaker', 'headphone', 'audio', 'airpods', 'sony wh', 'loa', 'tai nghe'] },
    { slug: 'camera', name: 'Camera', nameVi: 'Máy ảnh', keywords: ['camera', 'sony', 'canon', 'fujifilm', 'máy ảnh'] },
  ],
  'jobs': [
    { slug: 'tutor', name: 'Tutor / Teacher', nameVi: 'Gia sư / Giáo viên', keywords: ['tutor', 'teacher', 'dạy học', 'gia sư', 'english'] },
    { slug: 'barista', name: 'Barista / Waiter', nameVi: 'Phục vụ / Pha chế', keywords: ['barista', 'waiter', 'waitress', 'phục vụ', 'pha chế', 'f&b'] },
    { slug: 'sales', name: 'Sales / CS Support', nameVi: 'Bán hàng / CSKH', keywords: ['sales', 'customer support', 'telesale', 'bán hàng', 'cskh'] },
    { slug: 'tech', name: 'IT / Tech / Design', nameVi: 'IT / Thiết kế', keywords: ['it', 'developer', 'software', 'engineer', 'designer', 'thiết kế'] },
  ],
  'services': [
    { slug: 'visa', name: 'Visa / Permit', nameVi: 'Visa / Hộ chiếu', keywords: ['visa', 'permit', 'giấy tờ', 'passport'] },
    { slug: 'cleaning', name: 'Cleaning / Maid', nameVi: 'Dọn dẹp / Vệ sinh', keywords: ['cleaning', 'clean', 'maid', 'dọn dẹp', 'vệ sinh'] },
    { slug: 'moving', name: 'Moving / Transport', nameVi: 'Vận chuyển / Chuyển nhà', keywords: ['moving', 'delivery', 'transport', 'chuyển nhà', 'vận chuyển'] },
    { slug: 'vietnamese', name: 'Vietnamese Lessons', nameVi: 'Học tiếng Việt', keywords: ['vietnamese class', 'vietnamese lesson', 'học tiếng việt', 'dạy tiếng việt'] },
  ],
}
