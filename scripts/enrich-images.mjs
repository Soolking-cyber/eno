import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const pool = {
  'electronics': ['/listings/electronics-iphone.png', '/listings/electronics-macbook.png'],
  'house-rentals': ['/listings/apartment-thaodien.png', '/listings/apartment-phumyhung.png'],
  'moving-sale': ['/listings/furniture-sofa.png', '/listings/furniture-bedroom.png'],
  'motorbike-rentals': ['/listings/motorbike-airblade.png', '/listings/motorbike-wave.png'],
  'jobs': ['/listings/job-cafe.png', '/listings/hero-market.png'],
  'services': ['/listings/service-moving.png', '/listings/hero-market.png'],
}
const extra = '/listings/hero-market.png'

const listings = await db.listing.findMany({ include: { category: true } })
for (const l of listings) {
  const p = pool[l.category.slug] || [extra]
  const imgs = Array.from(new Set([...p, extra])).slice(0, 3)
  await db.listing.update({ where: { id: l.id }, data: { images: JSON.stringify(imgs) } })
}
console.log('updated', listings.length, 'listings with multi-image arrays')
await db.$disconnect()
