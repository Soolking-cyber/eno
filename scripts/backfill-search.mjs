import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const fold = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()

const listings = await db.listing.findMany({ include: { category: true } })
for (const l of listings) {
  const txt = fold(
    [l.title, l.titleVi, l.description, l.location, l.district, l.category.name, l.category.nameVi].filter(Boolean).join(' '),
  )
  await db.listing.update({ where: { id: l.id }, data: { searchText: txt } })
}
console.log('backfilled searchText for', listings.length, 'listings')
await db.$disconnect()
