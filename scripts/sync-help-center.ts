import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
// ⚠️ `ALL_HELP_TOPICS`, NEVER `HELP_TOPICS`. That name is EDITION-SCOPED now (a topic
// may be declared services-only so eno.vn 404s its articles), and this script writes to
// the ONE database both deployments share. Seeding through the scoped list would make
// the seed depend on whichever env happened to be loaded — and the "retired" sweep below
// HIDES posts, so a scoped list there would silently stop maintaining a whole topic.
import { ALL_HELP_TOPICS, ALL_HELP_TOPIC_SLUGS } from '../src/lib/help-center'

// ─────────────────────────────────────────────────────────────────────────────
// SYNC HELP CENTER — non-destructive, idempotent. Upserts:
//   1. the Help Center topics (src/lib/help-center.ts) as ForumCommunity rows
//   2. the seeded official answers (scripts/help-center-seed.json) as ForumPost rows
//   3. the CURATED Vietnamese for every seeded title/body into the Translation cache
//
// Modelled on scripts/sync-categories.ts: it never deletes, and it never touches
// engagement. Re-running after editing the JSON updates the copy in place while
// score / commentCount / viewCount / votes / comments all survive — so a rewrite of an
// answer never erases the upvotes it earned.
//
// IDs are DETERMINISTIC (`help-<slugHint>`) rather than cuid, which is what makes the
// upsert idempotent and gives readable permalinks (/help/how-offers-work). ForumPost.id
// is a plain String, and every engagement table keys off it, so a stable id is also what
// keeps votes attached across re-runs.
//
// AUTHORSHIP: seeds are written with authorProfileId = null + authorName 'eno team',
// the same shape the live welcome post already uses. That is deliberate — it avoids
// minting a fake Profile row, and serializeForumAuthor() renders the fallback name.
//
// TRANSLATION: the marketplace translation cache is keyed by sha1(source text) + target
// (src/lib/translate.ts). Writing our hand-authored Vietnamese straight into that table
// means VI readers get CURATED copy instead of machine translation, at zero API cost and
// with no first-visitor latency. The other 9 languages still translate lazily on demand.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/sync-help-center.ts
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

type SeedPost = {
  slugHint: string
  community: string
  kind: string
  flair: string
  flairVi: string
  title: string
  titleVi: string
  body: string
  bodyVi: string
  pinned: boolean
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

/** Mirror one EN→VI pair into the translation cache the whole app already reads. */
async function cacheVi(source: string, vietnamese: string) {
  const clean = vietnamese.trim()
  // An empty or identical "translation" is worse than none: it would cache a miss
  // permanently and block the real translator from ever filling it in.
  if (!clean || clean === source.trim()) return
  await db.translation.upsert({
    where: { hash_target: { hash: sha1(source), target: 'vi' } },
    create: { hash: sha1(source), target: 'vi', value: clean },
    update: { value: clean },
  })
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // ── 1. Topics ──────────────────────────────────────────────────────────────
  const existingCommunities = new Set(
    (await db.forumCommunity.findMany({ select: { slug: true } })).map((c) => c.slug),
  )
  console.log(`\nTopics (${ALL_HELP_TOPICS.length})`)
  for (const topic of ALL_HELP_TOPICS) {
    if (!dryRun) {
      await db.forumCommunity.upsert({
        where: { slug: topic.slug },
        update: {
          name: topic.name,
          nameVi: topic.nameVi,
          description: topic.description,
          descriptionVi: topic.descriptionVi,
          icon: topic.icon,
        },
        create: {
          slug: topic.slug,
          name: topic.name,
          nameVi: topic.nameVi,
          description: topic.description,
          descriptionVi: topic.descriptionVi,
          icon: topic.icon,
        },
      })
      await cacheVi(topic.name, topic.nameVi)
      await cacheVi(topic.description, topic.descriptionVi)
    }
    console.log(`  ${existingCommunities.has(topic.slug) ? 'updated' : 'CREATED'}  ${topic.slug.padEnd(24)} ${topic.name}`)
  }

  // ── 2. Seeded answers ──────────────────────────────────────────────────────
  const seedPath = join(import.meta.dirname, 'help-center-seed.json')
  const seeds: SeedPost[] = JSON.parse(readFileSync(seedPath, 'utf8'))

  const knownCommunities = new Set([
    ...existingCommunities,
    ...ALL_HELP_TOPIC_SLUGS,
  ])
  const orphans = seeds.filter((s) => !knownCommunities.has(s.community))
  if (orphans.length) {
    // ForumPost.communitySlug is a RESTRICT foreign key — a bad slug fails the insert
    // mid-run and leaves the seed half-applied. Refuse up front instead.
    console.error(`\n✗ ${orphans.length} seed post(s) reference an unknown community:`)
    for (const o of orphans) console.error(`    ${o.slugHint} → ${o.community}`)
    process.exit(1)
  }

  const ids = seeds.map((s) => `help-${s.slugHint}`)
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (duplicates.length) {
    console.error(`\n✗ duplicate slugHint(s): ${[...new Set(duplicates)].join(', ')}`)
    process.exit(1)
  }

  const existingPosts = new Set(
    (await db.forumPost.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id),
  )

  console.log(`\nAnswers (${seeds.length})`)
  // Seeded posts are written in list order with a stable, strictly increasing createdAt.
  // /help falls back to createdAt when scores tie, so the curated order is what a brand-new
  // reader sees — and upvotes are free to reorder it from there, which is the point.
  const base = Date.UTC(2026, 6, 21, 0, 0, 0)
  for (const [index, seed] of seeds.entries()) {
    const id = `help-${seed.slugHint}`
    const createdAt = new Date(base + index * 60_000)
    if (!dryRun) {
      await db.forumPost.upsert({
        where: { id },
        // Copy only. score/commentCount/viewCount/hotScore are engagement and are never
        // reset by a content edit.
        update: {
          communitySlug: seed.community,
          kind: seed.kind,
          flair: seed.flair,
          flairVi: seed.flairVi,
          title: seed.title,
          body: seed.body,
          pinned: seed.pinned,
          official: true,
          status: 'published',
          // createdAt is the curated-order key, so it must be re-applied on UPDATE too.
          // Setting it only on create meant reordering this JSON changed nothing on the
          // page — the copy moved, the order did not. It stays idempotent because the
          // value is derived from a fixed base date plus the item's index, not from now().
          createdAt,
          // Re-publish a seed that a previous run retired (see the reconciliation below);
          // restoring a slug should bring its post back, not leave it hidden forever.
        },
        create: {
          id,
          communitySlug: seed.community,
          kind: seed.kind,
          flair: seed.flair,
          flairVi: seed.flairVi,
          title: seed.title,
          body: seed.body,
          authorProfileId: null,
          authorName: 'eno team',
          authorRole: 'Community team',
          location: 'all',
          pinned: seed.pinned,
          official: true,
          status: 'published',
          createdAt,
        },
      })
      await cacheVi(seed.title, seed.titleVi)
      await cacheVi(seed.body, seed.bodyVi)
      // NOT the flair. The Translation cache is keyed on sha1(source) with NO namespace,
      // so it is global to the whole app — and flairs are short, generic words ("Photos",
      // "Fees", "Guide"). Caching one would bind that English word to a help-specific
      // Vietnamese rendering everywhere it appears, and two seeds sharing a flair with
      // different Vietnamese would silently overwrite each other. Long, unique title and
      // body text carries no such collision risk.
    }
    console.log(`  ${existingPosts.has(id) ? 'updated' : 'CREATED'}  ${seed.community.padEnd(24)} ${seed.title.slice(0, 58)}`)
  }

  // ── 3. Retire seeds that are no longer in the JSON ─────────────────────────
  // The id is derived from slugHint, so RENAMING a slug (or deleting an entry) does not
  // update the old row — it silently leaves a second, stale official answer published
  // alongside the new one. Reconcile by hiding any `help-` seed that this run did not
  // write. Hidden, never deleted: `status` is reversible, the post keeps its votes and
  // comments, and re-adding the slug republishes it via the upsert above.
  const retired = await db.forumPost.findMany({
    where: {
      official: true,
      status: 'published',
      communitySlug: { in: ALL_HELP_TOPIC_SLUGS },
      id: { startsWith: 'help-', notIn: ids },
    },
    select: { id: true, title: true },
  })
  if (retired.length) {
    console.log(`\nRetired (${retired.length}) — no longer in the seed file`)
    for (const post of retired) console.log(`  hidden   ${post.id.padEnd(40)} ${post.title.slice(0, 40)}`)
    if (!dryRun) {
      await db.forumPost.updateMany({ where: { id: { in: retired.map((p) => p.id) } }, data: { status: 'hidden' } })
    }
  }

  // ── 4. Re-denormalize postCount ────────────────────────────────────────────
  // ForumCommunity.postCount is denormalized and only ever incremented by the create
  // API, so a direct-DB seed would leave it stale. Recount EVERY community, not just the
  // help topics: moving a seed between communities (or retiring one) also changes the
  // count of the community it left, which a help-topics-only pass would leave inflated.
  if (!dryRun) {
    const communities = await db.forumCommunity.findMany({ select: { slug: true } })
    for (const { slug } of communities) {
      const postCount = await db.forumPost.count({ where: { communitySlug: slug, status: 'published' } })
      await db.forumCommunity.update({ where: { slug }, data: { postCount } })
    }
  }

  console.log(`\n${dryRun ? 'DRY RUN — nothing written.' : 'Done.'}\n`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
