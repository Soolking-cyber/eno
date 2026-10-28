-- WHO the one-time "Zalo for urgent cover" invite would tell (src/lib/teachers/zalo-invite.ts inviteWhere) — READ-ONLY.
--   set -a; . ./.env; set +a; psql "$DIRECT_URL" -f scripts/cover-zalo-invite-list.sql
-- The owner's look at the list before the send (the route's dry run gives only counts — eno-cron.sh logs its answer).
-- `job_messages`: on = a chat is possible (the route still checks the desk is live, nothing waits for a reply and no
-- jobs/cover message went today);
-- paused = skipped; off / never = in-app bell. ⚠️ Keep the WHERE in step with inviteWhere(): the cover notice version
-- (cover.ts COVER_CONSENT_VERSION) and the demo listing (constants.ts HOME_HIDDEN_TEACHER_LISTING_IDS) are written in
-- below — src/lib/teachers/zalo-invite.test.ts checks both against the code.
BEGIN READ ONLY;
SELECT tp."fullName" AS teacher,
       CASE WHEN k."optIn" AND k."pausedAt" IS NOT NULL THEN 'paused'
            -- on under a notice the desk counts (job-dms/consent.ts JOB_DM_ON_VERSIONS); an older one is a bell
            WHEN k."optIn" AND k."noticeVersion" IN ('2026-10-20', 'default-on-2026-10-21') THEN 'on'
            WHEN k."profileId" IS NULL THEN 'never'
            ELSE 'off' END AS job_messages,
       tp."createdAt"::date AS profile_since
  FROM "TeacherProfile" tp
  JOIN "Listing" l ON l.id = tp."listingId"
  LEFT JOIN "TeacherPrivate" p ON p."teacherProfileId" = tp.id
  LEFT JOIN "TeacherJobDmConsent" k ON k."profileId" = tp."profileId"
 WHERE tp.status = 'live' AND l.status = 'active' AND l.verified
   AND tp."coverOpen" AND tp."coverConsentVersion" = '2026-10-08'   -- cover.ts COVER_CONSENT_VERSION
   AND tp."listingId" NOT IN ('cmuzccru60000wvq4mojalida')           -- the owner's demo profile(s)
   AND p."coverZalo" IS NULL AND p."coverZaloWithdrawnAt" IS NULL AND p."coverZaloInvitedAt" IS NULL
 ORDER BY tp."createdAt", tp.id;
ROLLBACK;
