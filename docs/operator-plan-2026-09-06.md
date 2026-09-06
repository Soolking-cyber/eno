# Operator plan — everything from the 2026-09-06 re-audit that needs approval

**Nothing in this file has been run.** The repair prompt is explicit: *"Production migrations, timer
activation and destructive retention policy require a separate reviewed operator plan/approval.
Prepare the plan; do not execute it under this prompt alone."* This is that plan. Each item states
what it changes, what it cannot undo, how to verify it worked, and how to back out.

Everything else from the re-audit is code, is in the working tree, and is covered by tests — it
carries no operational step and is not listed here.

---

## 1. Name the visa RPC's parameters (production migration)

**Why.** PostgREST resolves an RPC by ARGUMENT NAME. Production's catalogue reports
`proargnames = NULL` for `public.visa_commit_document`, so the named call the application makes
(`documents/route.svc.ts`) cannot reach it. `pg_get_function_identity_arguments` never shows names,
which is why this survived: the function looks present and correct from every angle except the one
that matters.

**What runs.** `scripts/visa-commit-document-fn.mjs`, against `DIRECT_URL` through the SSH tunnel.
It is idempotent: it drops the unnamed function by its identity signature
(`public.visa_commit_document(uuid, uuid, jsonb, boolean)`) and recreates it with
`p_application_id`, `p_user_id`, `p_document`, `p_replace`, preserving the fixed `search_path`, the
owner/status checks and service-role-only execution, then issues `notify pgrst, 'reload schema'`.

**Blast radius.** Between the drop and the create inside one transaction, no caller can commit a
visa document. That window is milliseconds; visa uploads fail closed and the applicant retries.

**Verify — all three, in this order.**
1. `select proargnames from pg_proc where proname = 'visa_commit_document';` returns the four names.
2. `select has_function_privilege('anon', '<identity sig>', 'execute');` and the same for
   `authenticated` both return **false**.
3. A named RPC call over PostgREST as the service role returns `{"ok": true, ...}`. Rehearsed on an
   isolated database during implementation with a fixture `visa_documents` table carrying
   `validation_status` / `validation_report`.

**Back out.** Re-run the previous revision of the script from git; the function body is unchanged,
only its parameter names and the grants differ.

**Approval needed from:** the owner, as a production DDL change.

---

## 2. Business-verification retention timer (currently installed, deliberately not enabled)

**Why it is off.** `infra/vn-node/cron/install-cron-timers.sh` puts this in `POLICY`, not `SAFE`,
with the reason in the file: the FIRST run acts on a policy nobody has acted on yet. Every decided
case older than `VERIFICATION_DOC_RETENTION_MS` — **30 days** — loses its registration scans,
approved sellers included. The backlog is every case decided since the feature shipped, so run one
is not a trickle.

**Decisions the owner has to make before it is enabled.**
- Is 30 days after a decision the retention period we want for business registration documents?
- Does an APPROVED seller's licence go too, or only rejected/expired cases? Today the sweep does not
  distinguish them.
- What is the retention period for **identity** captures (KYC passport/CCCD photographs)? There is
  no identity retention sweep at all today — the re-audit asked for one and it cannot be written
  without this number. The compliance note in `docs/compliance-2026.md` §4.2 covers erasure, not a
  standing retention clock.

**Then.** `systemctl enable --now eno-cron-business-verification-retention.timer` on the box.

**Verify without deleting anything.** Before enabling, count what the first run would touch:
`select count(*) from "SellerVerification" where status in ('approved','rejected') and "retentionUntil" < now();`
That number is how many cases lose their scans on the first firing.

**Irreversible.** Deleted storage objects are not recoverable. There is no dry-run mode; adding one
is the safer first step if the count above is large.

---

## 3. Confirm the erasure queue is actually draining

**State.** `StorageTombstone` exists, its services-targeted timer is enabled, and at the time of the
audit it had not yet run. Enabled is not draining.

**Check, read-only, no deletions:**
```
GET /api/cron/storage-tombstones?status=1     # Authorization: Bearer $CRON_SECRET
```
Returns `{ queued, due, failing, oldestDueAt, oldestQueuedAt, byReason, checkedAt }` — counts and
timestamps only, never a storage path (a path identifies a person's document). Added for this
purpose; the sweep itself stays on the unqualified GET.

**What to alert on.**
- `oldestDueAt` getting steadily older run over run — the queue is not draining, whatever the run
  summaries say.
- `failing > 0` sustained across days. Rows back off 1, 2, 4 … days, capped at 30, so a permanent
  failure goes quiet rather than loud.
- `due` growing while `queued` grows faster — writers outpacing the sweep.

**Note.** The reference check for the private verification bucket is now a real query against
`SellerVerification.documents` and `IdentityVerification.evidence`; it was previously an
unconditional "unreferenced". Expect `dropped` to be non-zero on the first runs where it was
previously always `removed`.

---

## 4. Not needed, recorded so nobody re-opens it

- **`/vietkite` 404 on eno.forum is correct.** Measured 2026-09-06: `/vietkite` and `/gmbr` both 404
  on eno.forum (apex and www) and 200 on eno.vn. That is `SERVICES_HIDDEN_OWNER_EMAILS` doing what
  the owner asked on 2026-08-17. `e2e/guest/visa.spec.ts` now asserts both halves rather than
  skipping one, so the day the variable is unset the suite says so. No route change, no test skip.
