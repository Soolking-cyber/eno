-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- MESSAGE REPLY + RECALL — two additive columns on "Message".
--
--   deletedAt  → the chat "Delete" action. RECALL, NOT ERASURE (see below).
--   replyToId  → the message this one quotes, in the same conversation.
--
-- ⛔ RUN THIS BEFORE DEPLOYING THE CODE THAT READS IT, never after. Prisma SELECTs every scalar
--    column of a model, so a revision querying Message against a database lacking these columns
--    fails with 42703 undefined_column on EVERY thread read. New nullable columns are additive, so
--    the currently-deployed revision is unaffected by running this early — DB-first is always the
--    safe order (CLAUDE.md records the same rule and the same reason).
--
-- ⛔ WHY THIS IS A HAND-RUN FILE AND NOT `prisma db push`. Measured 2026-08-03: the database holds
--    more tables than there are Prisma models, so `db push` reconciles the DB *to* the schema and
--    emits 18 DROP TABLE statements — visa_applications (live applicant PII), the Postgres rate
--    limiter, the rotating Zalo OTP chain. It is not a safe command on this database.
--
-- ⚠️ NOTHING HERE WAS HAND-TYPED. `prisma migrate diff --from-config-datasource` cannot generate it
--    (P4002 on the cross-schema FK profile_auth_fk: public.Profile → auth.users), so the statements
--    were produced by Prisma from an EMPTY baseline
--    (`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`) and the Message
--    lines lifted out verbatim, rewritten from the CREATE TABLE form into ADD COLUMN. The names
--    therefore match exactly what Prisma expects and a future diff sees no drift.
--
-- ⚠️ EVERY STATEMENT IS ADDITIVE. No DROP, no data change, no ALTER of an existing column.
--    ⛔ VERIFY WITH A CHECK THAT ACTUALLY WORKS — matching the word "DROP" alarms on the prose
--    above, which legitimately contains it while describing what this file does NOT do. Match
--    executable statements only:
--        grep -inE '^\s*(DROP|TRUNCATE|DELETE|UPDATE|ALTER TABLE [^ ]+ ALTER)' scripts/sql/add-message-reply-recall.sql
--    That must print nothing.
--
-- ⛔ RECALL IS NOT ERASURE, AND THE COLUMN SHAPE IS THE WHOLE ARGUMENT. `body` is deliberately left
--    intact when deletedAt is set. eno.vn runs a dispute center: Report.conversationId is populated
--    whenever a report is filed FROM a chat, and an admin reads that thread to adjudicate a scam or
--    harassment case. A hard delete in the participants' hands is therefore an evidence-destruction
--    primitive aimed at the exact conversation someone is about to report. The server redacts the
--    body out of both participants' responses; only the row keeps it.
--    (There WAS a hard-delete endpoint — DELETE /api/conversations/[id]/messages/[mid] — with zero
--    UI call sites. This migration is what lets that endpoint become a recall instead of the hole
--    that wiring a Delete button to it would have opened.)
--
-- Apply with:
--    psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/sql/add-message-reply-recall.sql
--
-- Then, from the repo:  npx prisma generate
-- ─────────────────────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "replyToId" TEXT;

-- Covering index for the self-FK below. Supabase's performance advisor flags unindexed FKs, and
-- Message.senderProfileId was already fixed for this exact reason; it is also what keeps the
-- SET NULL sweep cheap if a quoted row is ever hard-deleted by an admin purge.
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");

-- ⚠️ SET NULL, NOT CASCADE. A reply is its own message with its own meaning; deleting the message
-- it quoted must drop the quote, never the reply. Cascade here would let one purge take an
-- unbounded chain of unrelated messages with it.
-- ⚠️ THE FK CANNOT EXPRESS "SAME CONVERSATION" — that is enforced on write in the send route. A
-- self-FK only proves the target exists, so without that check a caller could quote any message id
-- on the site and have its body rendered back to them.
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey"
    FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
