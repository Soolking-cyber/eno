import 'server-only'
import { db } from '@/lib/db'

/**
 * A teacher's part of the account export (PDPL access right; src/app/api/account/export).
 * Teacher profile (2026-09-30) + cover lessons (2026-10-07): what the teacher entered and what eno recorded about it
 * (cover consent and withdrawal timestamps), and their own private contact row. The CV is named, not its storage path
 * (a bucket key is not their data). Matches are the local matcher's output: kept out.
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
  const videoShares = await db.teacherVideoShare.findMany({
    where: { conversation: { sellerProfileId: profileId } },
    select: { conversationId: true, requestedAt: true, sharedAt: true, revokedAt: true },
    orderBy: { conversationId: 'asc' },
  })
  return {
    ...rest,
    private: priv ? { phone: priv.phone, email: priv.email, cvFileName: priv.cvFileName, updatedAt: priv.updatedAt, hasPrivateVideo: !!priv.videoPath } : null,
    videoShares,
  }
}
