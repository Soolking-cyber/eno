/**
 * ONE-OFF: a teacher who posted THEMSELVES as a Jobs › Teaching "looking for work" ad gets that post back as a
 * teacher-profile DRAFT (owner, 2026-10-12: "move that persons profile to teacher profile" — the post was made before the
 * wizard and the server refused the pair; taxonomy.ts TEACHER_SEEKING_POST).
 *
 * ⛔ A DRAFT, NEVER A PUBLISHED PROFILE. Publishing is the teacher's own act: the Publish tap IS the consent
 * (profile.ts PUBLISH_NOTICE_VERSION — the record must say which words each teacher accepted, PDP Law 91/2025), the
 * nationality is theirs to state, and a draft holds no consent (draft.ts). So this writes only the answers the post
 * already gave, as the form stores them (fromDraft), and the teacher checks, completes and publishes at /teachers/join —
 * the dashboard and the home rail say "Continue your teacher profile" from the moment the draft exists.
 * ⛔ NO PERSON'S DATA IN THIS REPOSITORY. The hand-mapped answers live in an ANSWERS FILE outside it (--answers; under
 * ~/eno-import-journals/), and the name, headline and bio are read live from the account and the post.
 * ⛔ ONLY THE POST THAT WAS REVIEWED. The answers file pins `reviewed` = sha256 of the post as it was mapped (reviewedHash);
 * a post edited since refuses, so a stale mapping is never written. The post must still be live: the draft comes first.
 * ⛔ THE SAME WRITE AS THE FORM'S FIRST SAVE (draft.ts saveTeacherDraft): under the per-account advisory lock, refused when
 * the account already has a teacher profile, inserted only when there is no draft (an existing draft is never touched).
 * ⛔ RE-CHECKED UNDER LOCKS. Inside the write's transaction the post is re-read FOR SHARE (no edit can land until the
 * commit) and its hash and status checked again; the account's draft/profile under draft.ts's advisory lock.
 * ⛔ IT WRITES AT MOST ONCE, AND NEVER AFTER THE POST IS GONE. --apply writes only while the post is still LIVE and the
 * account has no draft and no teacher profile; a draft already there is the account's own and is never touched (the
 * post's text is not lost either: a removal keeps the row as a tombstone). So a re-run can never re-create a draft the
 * teacher discarded once the post is removed, and confirming is a plain dry run.
 * ⛔ TWO STEPS, AND THE SCRIPT SAYS WHICH IS LEFT. It writes nothing to Listing: the post is removed in the admin console
 * (Listings → Remove: tombstone, audit row, purges). "Done" (exit 0) only once a draft or profile exists AND the post's
 * status is `removed`; a draft with the post in any other state ends exit 3 with what to do.
 *
 *   set -a; . ~/eno.vn/.env; set +a                               (DIRECT_URL — the build's env)
 *   npx tsx scripts/teacher-draft-from-listing.ts --answers <file>            DRY RUN (also the confirm run): the state, the draft
 *   npx tsx scripts/teacher-draft-from-listing.ts --answers <file> --apply    writes the draft; prints the rollback
 *
 * The answers file: { "listingId": "…", "reviewed": "sha256:…", "answers": { <TeacherInput fields> } }.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { invokedDirectly } from '../src/lib/cli-entry'
import { draftResumeStep, fromDraft } from '../src/components/teachers/teacher-form-rules'
import { EMPTY_TEACHER, type TeacherInput } from '../src/lib/teachers/profile'
import { isTeacherSeekingPost } from '../src/lib/taxonomy'

export type AnswersFile = { listingId: string; reviewed: string; answers: Partial<TeacherInput> }
type Post = { title: string; description: string; city: string; category: string; subcategorySlug: string | null; listingType: string }

/** The fingerprint of the post as it was mapped — what the answers file pins. */
export function reviewedHash(p: Post): string {
  const canon = JSON.stringify([p.category, p.subcategorySlug, p.listingType, p.city, p.title, p.description])
  return `sha256:${createHash('sha256').update(canon).digest('hex')}`
}

/** The draft as the account will store it: EMPTY_TEACHER + the mapped answers + the live name/title/description. */
export function draftFor(answers: Partial<TeacherInput>, live: { fullName: string; title: string; description: string }): { t: TeacherInput; dropped: string[] } {
  const raw: TeacherInput = { ...EMPTY_TEACHER, ...answers, fullName: live.fullName.trim(), headline: live.title.trim(), bio: live.description.trim() }
  const t = { ...fromDraft(raw), phone: '' }
  // Every answer must survive the form's own normalization — one that does not is a mapping error, not a silent loss.
  const dropped = (Object.keys(answers) as (keyof TeacherInput)[]).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(raw[k]))
  for (const k of ['fullName', 'headline', 'bio'] as const) if (t[k] !== raw[k]) dropped.push(k)
  return { t, dropped }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] ?? null : null }

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const file = arg('--answers')
  if (!file || !file.endsWith('.answers.json')) { console.error('Usage: --answers <listingId>.answers.json [--apply] (see the header).'); return 1 }
  const spec = JSON.parse(readFileSync(file, 'utf8')) as AnswersFile
  if (!spec.listingId || !/^sha256:[0-9a-f]{64}$/.test(spec.reviewed ?? '') || !spec.answers) { console.error('The answers file needs listingId, reviewed (sha256:…) and answers.'); return 1 }
  // The name, headline and bio are always the live ones — a mapped value for them would be silently replaced.
  const live = (['fullName', 'headline', 'bio'] as const).filter((k) => k in spec.answers)
  if (live.length) { console.error(`The answers file must not set ${live.join(', ')}: they are read live from the account and the post.`); return 1 }
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) { console.error('Set DIRECT_URL (set -a; . ~/eno.vn/.env; set +a).'); return 1 }

  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const { rows } = await c.query(
      `SELECT l.id, l.title, l.description, l.city, l."listingType", l."subcategorySlug", l.status, cat.slug AS category,
              s."ownerId", p.id AS "profileId", coalesce(nullif(p."displayName", ''), s.name) AS name,
              (SELECT count(*)::int FROM "TeacherProfile" t WHERE t."profileId" = s."ownerId") AS profiles,
              (SELECT d.gen::text FROM "TeacherDraft" d WHERE d."profileId" = s."ownerId") AS "draftGen"
         FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" cat ON cat.id = l."categoryId"
         LEFT JOIN "Profile" p ON p.id = s."ownerId"
        WHERE l.id = $1`, [spec.listingId])
    const r = rows[0]
    if (!r) { console.log(`STOP — no listing ${spec.listingId}`); return 1 }
    const post: Post = { title: r.title ?? '', description: r.description ?? '', city: r.city ?? '', category: r.category, subcategorySlug: r.subcategorySlug, listingType: r.listingType }
    console.log(`listing ${r.id} — status ${r.status}, ${post.category}/${post.subcategorySlug}/${post.listingType}, city ${post.city}`)
    if (!isTeacherSeekingPost(post.category, post.listingType, post.subcategorySlug)) { console.log('STOP — not a Jobs › Teaching "looking for work" post'); return 1 }
    if (!r.ownerId || !r.profileId) { console.log('STOP — no account owns this post (a guest post, or a deleted account): nothing can hold a draft'); return 1 }
    const remaining = () => (r.status === 'removed'
      ? (console.log('✅ done: the account has its draft (or profile) and the post is removed.'), 0)
      : (console.log(`⏳ NEXT: the post is ${r.status} — remove it in the admin console (Listings → Remove), then dry-run this again to confirm.`), 3))
    if (r.profiles > 0) { console.log('the account has a published teacher profile — nothing to draft'); return remaining() }
    if (r.draftGen) { console.log(`the account has a teacher draft (gen ${r.draftGen}) — never touched`); return remaining() }

    if (r.status !== 'active') { console.log(`STOP — the post is ${r.status}: a draft is written only while the post is live`); return 1 }
    if (reviewedHash(post) !== spec.reviewed) { console.log(`STOP — the post changed since it was mapped (${reviewedHash(post)} ≠ reviewed ${spec.reviewed}): map it again`); return 1 }
    const { t, dropped } = draftFor(spec.answers, { fullName: r.name ?? '', title: post.title, description: post.description })
    if (dropped.length) { console.log(`STOP — the form's normalization dropped: ${dropped.join(', ')}`); return 1 }
    const resume = draftResumeStep(t, 'plans')
    console.log(`→ a teacher draft for account ${r.ownerId}, opening on step ${resume.index} of ${resume.total} (${resume.step})`)
    console.log(`  name: ${t.fullName}\n  headline: ${t.headline}\n  bio: ${t.bio}`)
    console.log(`  answers: ${JSON.stringify(spec.answers)}`)
    console.log('  the teacher adds their nationality, checks every step and publishes (the Publish tap records their consent)')
    if (!apply) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return 0 }

    await c.query('BEGIN')
    try {
      // The post, re-read and held: no edit or status change can land on it until this commits.
      const again = (await c.query(
        `SELECT l.title, l.description, l.city, l."listingType", l."subcategorySlug", l.status, cat.slug AS category, s."ownerId"
           FROM "Listing" l JOIN "Category" cat ON cat.id = l."categoryId" JOIN "Seller" s ON s.id = l."sellerId"
          WHERE l.id = $1 FOR SHARE OF l`, [spec.listingId])).rows[0]
      const now: Post | null = again ? { title: again.title ?? '', description: again.description ?? '', city: again.city ?? '', category: again.category, subcategorySlug: again.subcategorySlug, listingType: again.listingType } : null
      // …and still the same account's: the draft goes to the owner read above, or nowhere.
      if (!now || reviewedHash(now) !== spec.reviewed || again.status !== 'active' || again.ownerId !== r.ownerId) {
        await c.query('ROLLBACK'); console.log('STOP — the post changed while this ran: nothing written; map it again'); return 1
      }
      // draft.ts saveTeacherDraft's lock key, verbatim: 'teacher:' + profileId.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`teacher:${r.ownerId}`])
      if ((await c.query(`SELECT 1 FROM "TeacherProfile" WHERE "profileId" = $1`, [r.ownerId])).rowCount) {
        await c.query('ROLLBACK'); console.log('SKIP — a teacher profile appeared meanwhile'); return remaining()
      }
      const gen = randomUUID()
      const ins = await c.query(
        `INSERT INTO "TeacherDraft" ("profileId", data, step, rev, gen, "createdAt", "updatedAt")
         VALUES ($1, $2::jsonb, 'plans', 1, $3, now(), now()) ON CONFLICT ("profileId") DO NOTHING`,
        [r.ownerId, JSON.stringify(t), gen])
      if (ins.rowCount !== 1) { await c.query('ROLLBACK'); console.log('STOP — a draft appeared meanwhile (never overwritten): nothing written'); return 1 }
      await c.query('COMMIT')
      console.log(`✅ draft written (gen ${gen}).`)
      console.log(`   Rollback: DELETE FROM "TeacherDraft" WHERE "profileId" = '${r.ownerId}' AND gen = '${gen}';`)
      return remaining()
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    }
  } finally {
    await c.end()
  }
}

if (invokedDirectly(import.meta.url)) main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1) })
