-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- MESSAGE REACTIONS — the Zalo-style tap-back on a chat message.
--
-- ⛔ RUN THIS BEFORE DEPLOYING THE CODE THAT READS IT, never after. Prisma SELECTs every scalar
--    column of a model, so a new revision querying MessageReaction against a database that lacks
--    the table fails with 42P01. New tables are purely additive, so DB-first is always the safe
--    order (same rule CLAUDE.md records for new COLUMNS, and for the same reason).
--
-- ⛔ WHY THIS IS A HAND-RUN FILE AND NOT `prisma db push`. Measured 2026-08-03: the database holds
--    67 tables against 52 Prisma models, so `db push` reconciles the DB *to* the schema and emits
--    18 DROP TABLE statements — visa_applications (live applicant PII), visa_events, next_cache,
--    the Postgres rate limiter, the rotating Zalo OTP chain. It is not a safe command on this
--    database and must not be used to apply this change.
--
-- ⚠️ `prisma migrate diff --from-config-datasource` CANNOT GENERATE THIS. It fails P4002 on the
--    cross-schema FK `profile_auth_fk` (public.Profile → auth.users). The statements below were
--    therefore produced by Prisma itself from an EMPTY baseline
--    (`prisma migrate diff --from-empty --to-schema prisma/schema.prisma`) and the MessageReaction
--    statements lifted out verbatim — so the names match exactly what Prisma expects and a future
--    diff sees no drift. Nothing here was hand-typed.
--
-- ⚠️ EVERY STATEMENT IS ADDITIVE. There is no DROP, no ALTER of an existing table, no ALTER COLUMN.
--    ⛔ VERIFY IT WITH A CHECK THAT ACTUALLY WORKS. An earlier version of this comment said to run
--    `grep -i drop`, which was WRONG and reviewer-caught: the prose above legitimately contains the
--    word DROP three times while describing what this file does NOT do, so that grep alarms on a
--    safe file and would train you to ignore it. Match executable statements only:
--        grep -inE '^\s*(DROP|TRUNCATE|DELETE|ALTER TABLE [^ ]+ ALTER)' scripts/sql/add-message-reactions.sql
--    That must print nothing. (Applied to production 2026-08-16; verified 74 → 75 tables with the
--    Message row count unchanged at 474.)
--
-- Apply with:
--    psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/sql/add-message-reactions.sql
--
-- Then, from the repo:  npx prisma generate
-- ─────────────────────────────────────────────────────────────────────────────────────────────

BEGIN;

-- The table. `emoji` holds the Unicode sequence itself ("❤️"), not a name or an id, so a reaction
-- outlives any change to the Lottie artwork and the tally below is a plain GROUP BY.
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- Read path: the thread fetches reactions for a page of messages.
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");
-- Covering index for the profileId FK (joins + cascade-delete checks). Supabase's performance
-- advisor flags unindexed FKs, and Message.senderProfileId was already fixed for this reason.
CREATE INDEX "MessageReaction_profileId_idx" ON "MessageReaction"("profileId");
-- Feeds the global top-5 tally, which is a recent-window scan by time.
CREATE INDEX "MessageReaction_createdAt_idx" ON "MessageReaction"("createdAt");

-- ⛔ THE TOGGLE'S CORRECTNESS LIVES HERE, NOT IN THE HANDLER. A second tap must REMOVE a reaction
--    rather than add a duplicate; enforcing that in application code alone loses the race when a
--    double-tap sends two requests. With this constraint the second insert simply conflicts.
CREATE UNIQUE INDEX "MessageReaction_messageId_profileId_emoji_key"
    ON "MessageReaction"("messageId", "profileId", "emoji");

-- Both cascade: deleting a message or a profile removes its reactions. A reaction has no meaning
-- without the message it points at, and orphans would leak a deleted user's activity into a thread.
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
