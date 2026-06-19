import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function coordsFor(listing) {
  const city = (listing.city || '').toLowerCase()
  const district = (listing.district || '').toLowerCase()
  let baseLat = 10.7769, baseLng = 106.7009 // HCMC

  if (city.includes('hanoi') || city.includes('hà nội')) {
    baseLat = 21.0285; baseLng = 105.8542
    if (district.includes('tay ho') || district.includes('tây hồ')) { baseLat = 21.0718; baseLng = 105.8152 }
    else if (district.includes('cau giay') || district.includes('cầu giấy')) { baseLat = 21.0264; baseLng = 105.7977 }
  } else if (city.includes('danang') || city.includes('đà nẵng')) {
    baseLat = 16.0471; baseLng = 108.2068
    if (district.includes('son tra') || district.includes('sơn trà')) { baseLat = 16.0820; baseLng = 108.2435 }
    else if (district.includes('hai chau') || district.includes('hải châu')) { baseLat = 16.0594; baseLng = 108.2199 }
  } else {
    if (district.includes('district 2') || district.includes('thao dien') || district.includes('quận 2')) { baseLat = 10.8016; baseLng = 106.7368 }
    else if (district.includes('binh thanh') || district.includes('bình thạnh')) { baseLat = 10.7981; baseLng = 106.7061 }
    else if (district.includes('district 1') || district.includes('quận 1')) { baseLat = 10.7769; baseLng = 106.7009 }
    else if (district.includes('district 7') || district.includes('phu my hung') || district.includes('quận 7')) { baseLat = 10.7226; baseLng = 106.7271 }
  }

  const h = listing.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return { lat: baseLat + ((h % 20) - 10) * 0.0009, lng: baseLng + (((h >> 2) % 20) - 10) * 0.0009 }
}

const listings = await db.listing.findMany()
for (const l of listings) {
  const { lat, lng } = coordsFor(l)
  await db.listing.update({ where: { id: l.id }, data: { lat, lng } })
}
console.log('seeded coordinates for', listings.length, 'listings')
await db.$disconnect()
