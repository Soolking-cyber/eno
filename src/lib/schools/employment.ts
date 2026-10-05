import 'server-only'
import crypto from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { EXPIRED_PROOF_REASON, ORPHAN_REVIEW_DAYS, PENDING_MAX_DAYS, PURGE_AFTER_DAYS, VOTE_LOG_KEEP_DAYS } from './constants'

/**
 * PROOF OF EMPLOYMENT for /schools reviews (owner, 2026-10-05: "in order to leave a comment they should attach
 * linkedin profile so we can check whether they really worked for that company"). Plan + review:
 * ~/.claude/plans/eno-schools-v2-2026-10-05.md.
 *
 * A review stays ANONYMOUS: the public sees "Employment checked" and nothing else. Behind it sits one private
 * SchoolEmployment row per (teacher, school): the teacher's LinkedIn profile URL and an opaque code they put on
 * that profile until a MODERATOR has looked — the school in Experience, the code present. We never fetch or
 * scrape LinkedIn, and nothing about it is ever public.
 * ⛔ NO WORK-EMAIL PROOF (seven review rounds): a school controls its own mail domain, so it could mint
 * "employees" with a catch-all and, reading codes on its own mail server, learn which staff had reviewed. A
 * moderator looking at a LinkedIn profile has neither hole.
 * ⛔ PROOF MAKES A REVIEW COUNT, NEVER A VOTE: LinkedIn Experience is self-declared. Votes need a verified
 * identity (constants.ts VOTES_NEED_IDENTITY).
 * ⛔ NOTHING HERE TELLS ONE TEACHER ABOUT ANOTHER: a LinkedIn profile someone else submitted or proved is
 * flagged to the moderator, never answered to the submitter — which would let a manager test a colleague.
 * ⚠️ THE LEDGER BINDS A PROFILE URL, NOT A PERSON (diff review): LinkedIn lets its owner change their /in/ URL,
 * and a renamed URL is a new key, so one person could prove a second eno account and write a second review at a
 * school. What bounds it: a moderator sees the same person and reads every review; reviews never move the
 * ranking (votes need a verified identity, one per person); and the awards count only reviews whose writers
 * hold a verified identity. Requiring KYC of every reviewer would close it, at the owner's word.
 */

export { PENDING_MAX_DAYS, PURGE_AFTER_DAYS }

let cachedKey: Buffer | null = null
/**
 * The HMAC key: `SCHOOL_PROOF_SECRET`, set ONCE, identical on both editions, NEVER rotated (diff review).
 * SchoolProofKey keeps every proved LinkedIn profile as these hashes for good, so a different key — a fallback
 * secret today, a rotated one tomorrow, another edition's env — would let a profile prove a second account.
 * Hence no fallback at all: ⛔ FAILS CLOSED, and the route answers `not_configured` until it is set.
 */
export const proofConfigured = () => (process.env.SCHOOL_PROOF_SECRET ?? '').length >= 32
function key(): Buffer {
  if (cachedKey) return cachedKey
  const ikm = process.env.SCHOOL_PROOF_SECRET
  if (!ikm || ikm.length < 32) throw new Error('school-proof: SCHOOL_PROOF_SECRET is not set (32+ characters)')
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-school-proof-v1'), Buffer.from('school-employment'), 32))
  return cachedKey
}

let keyMatched = false
/**
 * ⛔ BOTH EDITIONS MUST HASH WITH THE SAME KEY, AND THIS IS WHAT ENFORCES IT (diff review). They share one database:
 * with two different SCHOOL_PROOF_SECRETs one LinkedIn profile would hash twice, prove one account per edition, and
 * never raise the shared-profile flag (that compares hashes). So the first edition to use the key records its
 * FINGERPRINT (an HMAC of a fixed label — never the key) in SchoolProofKeyCheck, and an edition whose key does not
 * match refuses to prove anything: the proof route answers not_configured, as if no key were set.
 * Only a MATCH is remembered (diff review): a mismatch is asked again on the next proof, so fixing the row or the
 * secret takes effect without waiting for a restart. ⚠️ The FIRST key used is the one recorded: set the secret on
 * both editions before /schools takes proofs; if a wrong one got recorded first, delete the single row — safe
 * only while no proof exists, since every ledger hash was made with that key.
 */
const fingerprintOf = () => crypto.createHmac('sha256', key()).update('eno-school-proof-key-check').digest('hex')
export async function proofKeyMatches(): Promise<boolean> {
  if (keyMatched) return true
  const fingerprint = fingerprintOf()
  if ((await recordedFingerprint(fingerprint)) === fingerprint) return (keyMatched = true)
  console.error('[school-proof] SCHOOL_PROOF_SECRET differs from the key already recorded for this database: proofs are refused until the editions share one key.')
  return false
}
async function recordedFingerprint(fingerprint: string): Promise<string> {
  try {
    return (await db.schoolProofKeyCheck.upsert({ where: { id: 1 }, create: { id: 1, fingerprint }, update: {}, select: { fingerprint: true } })).fingerprint
  } catch (e) {
    // Two processes recording at the same moment: the second reads what the first wrote.
    if ((e as { code?: string })?.code !== 'P2002') throw e
    return (await db.schoolProofKeyCheck.findUniqueOrThrow({ where: { id: 1 }, select: { fingerprint: true } })).fingerprint
  }
}
/** Read-only, for a GET: false only when a fingerprint made with ANOTHER key is recorded (none yet: the POST records). */
export async function proofKeyMayMatch(): Promise<boolean> {
  if (keyMatched) return true
  const row = await db.schoolProofKeyCheck.findUnique({ where: { id: 1 }, select: { fingerprint: true } })
  return !row || row.fingerprint === fingerprintOf()
}
/** Drop the memo — for the probes, which change the recorded fingerprint and must see it at once. */
export function forgetProofKeyCheck() { keyMatched = false }

/** The HMAC of a normalised LinkedIn slug — what identifies a profile URL without storing it in the ledger. */
export function proofHash(kind: 'linkedin', value: string): string {
  return crypto.createHmac('sha256', key()).update(`${kind}:${value}`).digest('hex')
}

type ProofKeyTx = { schoolProofKey: { upsert: (a: { where: { kind_hash: { kind: string; hash: string } }; create: { kind: string; hash: string; profileId: string }; update: Record<string, never>; select: { profileId: true; rejectedAt: true } }) => Promise<{ profileId: string | null; rejectedAt: Date | null }> } }

/**
 * Claim a proved LinkedIn profile for this account, inside the caller's transaction. ⛔ READ THE OWNER BACK FROM
 * THE UPSERT (diff review): two transactions that both saw "no owner" serialise on the primary key, and the
 * second gets the FIRST one's row — comparing its profileId is what refuses it. 'taken' = someone else's (or an
 * erased account's); 'rejected' = a moderator rejected or revoked it once, and no new account brings it back.
 */
export async function claimProofKey(tx: ProofKeyTx, hash: string, profileId: string): Promise<'ok' | 'taken' | 'rejected'> {
  const row = await tx.schoolProofKey.upsert({ where: { kind_hash: { kind: 'linkedin', hash } }, create: { kind: 'linkedin', hash, profileId }, update: {}, select: { profileId: true, rejectedAt: true } })
  return row.rejectedAt ? 'rejected' : row.profileId === profileId ? 'ok' : 'taken'
}

/**
 * A LinkedIn profile URL → its canonical form, or null. Only a personal profile (`/in/<slug>`) on a
 * linkedin.com host; any query, fragment or trailing path is dropped. The slug is what identifies the
 * person, so it is what gets hashed (one LinkedIn ↔ one eno account).
 */
export function normaliseLinkedIn(raw: string): { slug: string; url: string } | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
  const m = /^\/in\/([^/]+)\/?/i.exec(u.pathname)
  if (!m) return null
  let slug: string
  try {
    slug = decodeURIComponent(m[1]).normalize('NFC').toLowerCase()
  } catch {
    return null
  }
  if (slug.length < 3 || slug.length > 100 || /[\s/?#]/.test(slug)) return null
  // ⛔ A MEMBER-ID LINK (linkedin.com/in/ACoAA…, what LinkedIn's share button gives) names the same person as their
  // public URL, so accepting both would let one person prove two accounts without even renaming (diff review):
  // only the public profile URL is accepted, and the form says where to find it.
  // (ACoAA… and ACwAA… are the member-id encodings LinkedIn hands out — diff review.)
  if (/^ac[ow]aa[a-z0-9_-]{20,}$/i.test(slug)) return null
  return { slug, url: `https://www.linkedin.com/in/${encodeURIComponent(slug)}/` }
}

/**
 * The code a teacher puts on their LinkedIn profile. Opaque on purpose (plan review): nothing in it says
 * eno.vn, schools or reviews, so a colleague who sees it learns nothing, and it is removed once checked.
 */
export function newChallenge(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const pick = () => alphabet[crypto.randomInt(0, alphabet.length)]
  return `${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`
}

/**
 * ⛔ THE RETENTION PROMISE, KEPT ON A SCHEDULE (/api/cron/school-proof-retention, daily) — never only when a
 * moderator happens to look, and never as a side effect of a page GET (diff review):
 *   • a decided proof's LinkedIn URL and code are erased PURGE_AFTER_DAYS after the decision;
 *   • a proof nobody decided within PENDING_MAX_DAYS is closed as expired, and erased the same way;
 *   • a review whose writer's proof has been withdrawn or rejected for ORPHAN_REVIEW_DAYS is deleted;
 *   • the vote log is kept VOTE_LOG_KEEP_DAYS (any award year can be decided inside it), then swept.
 * The HMAC stays — pseudonymous (only the server's key and a guess of the profile link it back), and it is what
 * stops reuse.
 */
export async function sweepProofRetention(now: Date = new Date(), opts: { schoolIds?: string[] } = {}): Promise<{ erased: number; expired: number; reviews: number; voteEvents: number }> {
  // SCOPED only for the probes (diff review: they must never sweep a database they did not fill); the cron sweeps all.
  const only = opts.schoolIds ? { schoolId: { in: opts.schoolIds } } : {}
  const onlySql = opts.schoolIds ? Prisma.sql`and r."schoolId" in (${Prisma.join(opts.schoolIds)})` : Prisma.empty
  const expired = await db.schoolEmployment.updateMany({
    where: { status: 'pending', purgeAt: { lt: now }, ...only },
    data: { status: 'rejected', rejectReason: EXPIRED_PROOF_REASON, decidedAt: now, decidedBy: 'retention', linkedinUrl: null, challenge: null },
  })
  const erased = await db.schoolEmployment.updateMany({
    where: { purgeAt: { lt: now }, OR: [{ linkedinUrl: { not: null } }, { challenge: { not: null } }], ...only },
    data: { linkedinUrl: null, challenge: null },
  })
  // ⛔ A REVIEW ITS WRITER CAN NO LONGER PUBLISH IS NOT KEPT FOREVER (diff review): once their proof at that
  // school has been withdrawn or rejected for ORPHAN_REVIEW_DAYS, the review goes, its pay report with it (the
  // proof step says so). A proof sent again before then sets the status back to pending, which saves it.
  // ⚠️ The cutoff is converted to UTC IN SQL: decidedAt is a naive UTC timestamp, and the session may run in Saigon time.
  const cutoff = new Date(now.getTime() - ORPHAN_REVIEW_DAYS * 86_400_000).toISOString()
  // ⛔ NEVER ONE UNDER AN OPEN REPORT OR SCHOOL COMPLAINT (diff review): that review is moderation evidence, and the
  // writer would control when it disappears by withdrawing. It goes on the first run after the report is resolved.
  // ⛔ THE PROOF ROWS ARE LOCKED FOR THE STATEMENT, AND ONE BEING CHANGED IS SKIPPED (diff review): a re-send in
  // flight is never swept (the next run sees it pending); one that lands after the delete has nothing left to save.
  const reviews = await db.$executeRaw`
    with gone as (
      select e."profileId", e."schoolId" from "SchoolEmployment" e
       where e.status in ('rejected', 'withdrawn')
         and e."decidedAt" < (${cutoff}::timestamptz at time zone 'UTC')
       for update skip locked)
    delete from "SchoolReview" r using gone e
     where e."profileId" = r."profileId" and e."schoolId" = r."schoolId"
       and not exists (select 1 from "SchoolReport" rp where rp."reviewId" = r.id and rp.status = 'open')
       ${onlySql}`
  // …and one with NO proof row at all — written before proofs existed — measured from its last change (diff review:
  // nothing else would ever remove it, and it can never be published).
  const proofless = await db.$executeRaw`
    delete from "SchoolReview" r
     where not exists (select 1 from "SchoolEmployment" e where e."profileId" = r."profileId" and e."schoolId" = r."schoolId")
       and r."updatedAt" < (${cutoff}::timestamptz at time zone 'UTC')
       and not exists (select 1 from "SchoolReport" rp where rp."reviewId" = r.id and rp.status = 'open')
       ${onlySql}`
  // ⛔ THE VOTE LOG IS NOT KEPT FOR GOOD (diff review): it is a timestamped history of how each account voted, kept
  // only as long as an award year can need it (VOTE_LOG_KEEP_DAYS). ⛔ Only SUPERSEDED events go (diff review): each
  // account's newest event per school stays — the record of the vote as it stands, whatever counts it later —
  // unless it is a withdrawal (0): then there is no vote to record, and the old log goes whole.
  const logCutoff = new Date(now.getTime() - VOTE_LOG_KEEP_DAYS * 86_400_000).toISOString()
  const onlyLog = opts.schoolIds ? Prisma.sql`and e."schoolId" in (${Prisma.join(opts.schoolIds)})` : Prisma.empty
  const voteEvents = await db.$executeRaw`
    delete from "SchoolVoteEvent" e
     where e.at < (${logCutoff}::timestamptz at time zone 'UTC')
       and (e.value = 0 or exists (select 1 from "SchoolVoteEvent" n
                    where n."schoolId" = e."schoolId" and n."profileId" = e."profileId" and (n.at > e.at or (n.at = e.at and n.id > e.id))))
       ${onlyLog}`
  return { erased: erased.count, expired: expired.count, reviews: reviews + proofless, voteEvents }
}
