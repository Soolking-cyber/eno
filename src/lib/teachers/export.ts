import 'server-only'
import { db } from '@/lib/db'
import { identityMarkHidden } from '@/lib/teachers/identity-mark'

/**
 * A teacher's part of the account export (PDPL access right; src/app/api/account/export).
 * Teacher profile (2026-09-30) + cover lessons (2026-10-07): what the teacher entered and what eno recorded about it
 * (cover consent and withdrawal timestamps; since 2026-10-08 also each opt-in's stamp, AI notice version and withdrawal —
 * they come along with the row), and their own private contact row. ⚖️ Since 2026-10-22 a new profile's two opt-ins
 * START ON (owner decision, accepted risk): the stamp is the switch's state at the save, not a separate act — and the
 * compliance-log row 'teacher.optins.default' (exported with the account's consent records) says which were left on by
 * default. The CV is named, not its storage path (a bucket key
 * is not their data).
 * ⚖️ "IDENTITY VERIFIED" (AUTOMATIC since 2026-10-16 — src/lib/teachers/identity-mark.ts): its four columns come along
 * with the row too, and are LABELLED in `identityMark` for what they record now — the teacher's own hide and show-again,
 * never an opt-in consent (the consent is the identity declaration — identity_verifications.declarationVersion):
 *   · `hidden` — hidden by the teacher right now (identityMarkHidden: the last act on the switch was a hide);
 *   · `shownAgainAt` — identityMarkAt: when they last chose to show it (before 2026-10-16, when they switched it on);
 *   · `hiddenAt` — identityMarkWithdrawnAt: when they last hid it (before 2026-10-16, when they switched it off);
 *   · `wordsVersion` — identityMarkNoticeVersion: the words beside the switch when they last chose to show it.
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
    include: { private: { select: { phone: true, email: true, cvFileName: true, videoPath: true, updatedAt: true, coverZalo: true, coverZaloAt: true, coverZaloVersion: true, coverZaloWithdrawnAt: true } } },
  })
  if (!row) return null
  const { private: priv, ...rest } = row
  const [videoShares, matches, zaloSeenBy] = await Promise.all([
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
    // "Zalo for urgent cover" (2026-10-28 — zalo.ts): every school that saw a grant of the number, and when — what the
    // teacher disclosed and to whom. The school's name as it read then; never its account id.
    db.teacherZaloReveal.findMany({ where: { teacherProfileId: row.id }, select: { viewerName: true, grantAt: true, revealedAt: true }, orderBy: { revealedAt: 'desc' } }),
  ])
  return {
    ...rest,
    identityMark: {
      hidden: identityMarkHidden(rest),
      shownAgainAt: rest.identityMarkAt,
      hiddenAt: rest.identityMarkWithdrawnAt,
      wordsVersion: rest.identityMarkNoticeVersion,
    },
    private: priv ? { phone: priv.phone, email: priv.email, cvFileName: priv.cvFileName, updatedAt: priv.updatedAt, hasPrivateVideo: !!priv.videoPath } : null,
    coverZalo: priv ? { number: priv.coverZalo, grantedAt: priv.coverZaloAt, noticeVersion: priv.coverZaloVersion, withdrawnAt: priv.coverZaloWithdrawnAt, seenBy: zaloSeenBy } : null,
    videoShares,
    matches: matches.map(({ listing, ...m }) => ({ ...m, jobTitle: listing.title })),
  }
}
