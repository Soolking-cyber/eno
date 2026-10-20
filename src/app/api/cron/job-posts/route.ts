import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { IS_MARKETPLACE } from '@/lib/edition'
import { INGEST_LIMITS, checkPost } from '@/lib/teachers/job-dms/ingest'
import { purgeJobPosts } from '@/lib/teachers/job-dms/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * JOB POSTS IN (teacher job DMs, owner 2026-10-20) — the one door for posts from outside: the Mac's Facebook shipper
 * (over ssh to this box's localhost, the teachers-send.sh path) and the box's mailbox reader (LinkedIn job alerts, team
 * forwards). Bearer CRON_SECRET, marketplace only (the box route is pinned to eno.vn:3001).
 *
 * Body: {"posts":[…]} (≤50; ingest.ts checkPost). Answer 200 {accepted, duplicate, rejected} — a sender marks a post as
 * shipped ONLY when its key is in accepted or duplicate; any other answer stored nothing it can rely on, and it resends
 * (the unique (source, externalKey) key makes a resend a duplicate, never a second row).
 * ⚠️ The posts are only STORED here ('new'); reading and matching happen in /api/cron/teacher-job-dms, so a slow Laya
 * can never make a sender time out and resend.
 */
export const POST = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: false, skipped: 'marketplace_only' }
  const body = (await req.json().catch(() => null)) as { posts?: unknown } | null
  const posts = Array.isArray(body?.posts) ? body!.posts : null
  if (!posts) return Response.json({ error: 'bad_body' }, { status: 400 })
  if (posts.length > INGEST_LIMITS.posts) return Response.json({ error: 'too_many_posts', max: INGEST_LIMITS.posts }, { status: 413 })

  const now = new Date()
  const rejected: { key: string; reason: string }[] = []
  const valid = new Map<string, ReturnType<typeof checkPost> & { ok: true }>()
  for (const raw of posts) {
    const c = checkPost(raw, now)
    if (!c.ok) { rejected.push({ key: c.key, reason: c.reason }); continue }
    valid.set(`${c.post.source}\u0000${c.post.externalKey}`, c)
  }
  const list = [...valid.values()].map((c) => c.post)
  // The answer lists keys, not source+key: a batch that carries one key under two sources could not be told apart, so
  // it is refused whole (the senders send one source a batch; the mailbox reader's keys are prefixed per source).
  if (new Set(list.map((p) => p.externalKey)).size !== list.length) return Response.json({ error: 'key_in_two_sources' }, { status: 400 })
  if (!list.length) return { accepted: [], duplicate: [], rejected }

  const existing = await db.externalJobPost.findMany({
    where: { OR: list.map((p) => ({ source: p.source, externalKey: p.externalKey })) },
    select: { source: true, externalKey: true },
  })
  const seen = new Set(existing.map((e) => `${e.source}\u0000${e.externalKey}`))
  const fresh = list.filter((p) => !seen.has(`${p.source}\u0000${p.externalKey}`))
  if (fresh.length) {
    // skipDuplicates: a parallel sender that inserted the same key a moment ago turns this into a no-op for that row.
    await db.externalJobPost.createMany({
      data: fresh.map((p) => ({
        source: p.source, externalKey: p.externalKey, sourceName: p.sourceName, sourceRef: p.sourceRef, groupPublic: p.groupPublic,
        url: p.url, applyText: p.applyText, title: p.title, company: p.company, locationText: p.locationText, text: p.text,
        lang: p.lang, postedAt: p.postedAt, status: 'new',
      })),
      skipDuplicates: true,
    })
  }
  // The retention bound holds even while the matcher's timer is off: run.ts purgeJobPosts on every delivery too (opus,
  // gate 3b) — the content at 30 days, the shell that keeps a post from coming back at 180.
  await purgeJobPosts(now)
  return {
    accepted: fresh.map((p) => p.externalKey),
    duplicate: list.filter((p) => seen.has(`${p.source}\u0000${p.externalKey}`)).map((p) => p.externalKey),
    rejected,
  }
})
