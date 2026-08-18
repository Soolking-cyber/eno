// Seed a handful of STARTER QUESTIONS on the Help Center's community wall.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/seed-community-starters.ts
//
// IDEMPOTENT — keyed on (communitySlug, title), so re-running updates nothing and creates nothing
// twice. Modelled on scripts/sync-help-center.ts, which seeds the OFFICIAL answers.
//
// ⛔ THESE ARE ATTRIBUTED TO 'eno team', NOT TO INVENTED PEOPLE, AND THAT IS NOT A DETAIL.
// The wall is `official: false` posts — the half of the page that reads as "real users asked this".
// Seeding it with fabricated members would be inventing user-generated content on a marketplace
// whose entire pitch is trust, and it is the kind of thing that is impossible to walk back once
// someone notices. Written instead as questions eno is openly putting to the community and
// inviting answers to, with the author shown as the team. An empty wall is a smaller problem than
// a dishonest one.
//
// ⚠️ `official: false` IS WHAT PUTS THEM ON THE WALL. src/lib/help-center-data.ts splits the page on
// exactly that flag: true → the curated Answers list, false → "From the community". Setting it true
// here would file these under the FAQ and leave the wall as empty as it was.
//
// ⚠️ `kind: 'question'` so the card renders with the question treatment, and `score: 0` so nothing
// arrives pre-upvoted — the ordering is by score, and a seeded vote would be a fake signal.
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter })

type Starter = { community: string; title: string; body: string; flair: string; flairVi: string }

const STARTERS: Starter[] = [
  {
    community: 'help-buying',
    flair: 'Buying', flairVi: 'Mua hàng',
    title: 'What do you check before paying for a used motorbike here?',
    body: 'Buying used is where most money goes wrong, and the people who have done it a few times know things the rest of us do not. What do you actually check — papers, engine, the seller — before you hand anything over? Answers here help the next buyer.',
  },
  {
    community: 'help-selling',
    flair: 'Selling', flairVi: 'Bán hàng',
    title: 'What made your listing sell fast — photos, price, or something else?',
    body: 'Some listings go in a day and some sit for weeks with the same item at a similar price. If yours sold quickly, what do you think did it? Tell us what you changed, and we will fold the good answers into the selling guide.',
  },
  {
    community: 'vietnam-travel',
    flair: 'Vietnam travel', flairVi: 'Du lịch Việt Nam',
    title: 'First month in Vietnam: what do you wish someone had told you?',
    body: 'SIM card, bank account, getting around, the small everyday things nobody writes a guide about. If you have been here a while, what would you tell yourself on day one?',
  },
  {
    community: 'help-trust-safety',
    flair: 'Trust & safety', flairVi: 'An toàn & uy tín',
    title: 'Where do you prefer to meet a stranger for a handover?',
    body: 'Meeting to buy or sell means meeting someone you do not know. What works for you — a cafe, a bank lobby, somewhere with cameras? Practical answers, please; we will add the best ones to the safety page.',
  },
]

// ⚠️ WRAPPED IN main(), NOT TOP-LEVEL AWAIT. tsx transpiles these scripts to CJS, where top-level
// await is a build error — sync-help-center.ts is written the same way for the same reason.
async function main() {
let created = 0
for (const s of STARTERS) {
  const existing = await db.forumPost.findFirst({
    where: { communitySlug: s.community, title: s.title },
    select: { id: true },
  })
  if (existing) { console.log(`  EXISTS   ${s.community.padEnd(20)} ${s.title.slice(0, 52)}`); continue }
  await db.forumPost.create({
    data: {
      communitySlug: s.community,
      authorProfileId: null,
      authorName: 'eno team',
      authorRole: 'team',
      kind: 'question',
      flair: s.flair,
      flairVi: s.flairVi,
      title: s.title,
      body: s.body,
      status: 'published',
      official: false,
      pinned: false,
      score: 0,
    },
  })
  created += 1
  console.log(`  CREATED  ${s.community.padEnd(20)} ${s.title.slice(0, 52)}`)
}
console.log(`\nDone — ${created} created, ${STARTERS.length - created} already present.`)
await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
