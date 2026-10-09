import 'server-only'
import { db } from '@/lib/db'

/**
 * A teacher's part of the account export (PDPL access right; src/app/api/account/export).
 * Teacher profile (2026-09-30) + cover lessons (2026-10-07): what the teacher entered and what eno recorded about it
 * (cover consent and withdrawal timestamps; since 2026-10-08 also each opt-in's grant, AI notice version and withdrawal —
 * they come along with the row), and their own private contact row. The CV is named, not its storage path (a bucket key
 * is not their data).
 * ⛔ THE JOB MATCHES ARE IN IT (2026-10-08): what the AI judge (Claude Haiku 5.5, Anthropic) concluded about a teacher —
 * score, reasons, concerns, the judge's version — and what eno did with it (emailed, the staff status) is that teacher's
 * personal data, so the access copy carries every TeacherJobMatch row of theirs, with the job's public title.
 * The intro video kept private (2026-10-07) the same way: THAT one is stored, never its path — plus the record of where
 * it was asked for and sent (each thread's request / send / stop), which is what the teacher disclosed, and to which
 * conversation.
 */
export async function teacherExportOf(profileId: string) {
  const row = await db.teacherProfile.findUnique({
    where: { profileId },
    include: { private: { select: { phone: true, email: true, cvFileName: true, videoPath: true, updatedAt: true } } },
  })
  if (!row) return null
  const { private: priv, ...rest } = row
  const [videoShares, matches] = await Promise.all([
    db.teacherVideoShare.findMany({
      where: { conversation: { sellerProfileId: profileId } },
      select: { conversationId: true, requestedAt: true, sharedAt: true, revokedAt: true },
      orderBy: { conversationId: 'asc' },
    }),
    db.teacherJobMatch.findMany({
      where: { teacherProfileId: row.id },
      select: {
        listingId: true, score: true, reasons: true, concerns: true, decision: true, modelVersions: true, staffStatus: true,
        createdAt: true, emailedAt: true, listing: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  return {
    ...rest,
    private: priv ? { phone: priv.phone, email: priv.email, cvFileName: priv.cvFileName, updatedAt: priv.updatedAt, hasPrivateVideo: !!priv.videoPath } : null,
    videoShares,
    matches: matches.map(({ listing, ...m }) => ({ ...m, jobTitle: listing.title })),
  }
}
