import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const pool = [
  { author: 'Minh T.', rating: 5, text: 'Item exactly as described, smooth handover. Highly recommend this seller.' },
  { author: 'Anna K.', rating: 5, text: 'Responsive and honest. Met in District 1, no issues at all — felt safe.' },
  { author: 'David L.', rating: 4, text: 'Good communication and fair price. A little late but kept me updated.' },
  { author: 'Linh P.', rating: 5, text: 'The verified listing was accurate — photos matched perfectly. Trustworthy.' },
  { author: 'Sang N.', rating: 5, text: 'Quick replies on Zalo, friendly meetup. Would definitely buy again.' },
  { author: 'Emma R.', rating: 5, text: 'Great experience as an expat — clear English, no haggling games.' },
]

const sellers = await db.seller.findMany()
await db.review.deleteMany({})
let n = 0
for (const s of sellers) {
  const count = s.verifiedSeller ? 3 : 1
  const start = s.id.length % pool.length
  for (let i = 0; i < count; i++) {
    const r = pool[(start + i) % pool.length]
    await db.review.create({ data: { sellerId: s.id, author: r.author, rating: r.rating, text: r.text } })
    n++
  }
}
console.log('seeded', n, 'reviews across', sellers.length, 'sellers')
await db.$disconnect()
