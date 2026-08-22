# Security checklist — config gaps that cannot be closed in code

Each item is either a setting outside the repo, or a risk deliberately accepted.
Tick one only when it has been **verified by measurement**, not by intent.

## ⛔ Live: every production cron is failing UNAUTHENTICATED

- [ ] **Update the `Authorization` header on all Cloud Scheduler jobs to the current
      `CRON_SECRET`.**

Found 2026-08-22 while investigating the visa-retention audit item. Cloud Scheduler
sends a **41-character** bearer token (sha256 `a88f88bb102e…`); the deployed
`CRON_SECRET` is **49** characters (sha256 `cfc31eeb3289…`). They do not match, so
`cronAuthorized()` in `src/lib/api/handler.ts` rejects every call — correctly, since
it compares constant-time and fails closed.

Confirmed in Cloud Logging, not inferred: `resource.type="cloud_scheduler_job"`
shows `ERROR UNAUTHENTICATED` for `eno-price-stats`, `eno-video-gc`,
`eno-saved-search-alerts` and both visa-retention jobs. The secret was rotated at
some point and the schedulers were never updated.

**What is not running, in production, right now:**

| job | consequence |
| --- | --- |
| `eno-forum-visa-retention` / `eno-vn-visa-retention` | ⛔ **expired passport PII is not being deleted** — a PDPL/GDPR retention obligation |
| `eno-saved-search-alerts` | saved-search emails not sent |
| `eno-weekly-digest` | weekly digest not sent |
| `eno-video-gc` | orphaned video objects accumulate in storage |
| `eno-price-stats` | market price bands go stale |

Fix (one command; the secret never needs to be printed):

```bash
P=speedy-victory-500106-h8
S=$(gcloud secrets versions access latest --secret=eno-root-env --project=$P \
      | grep '^CRON_SECRET=' | cut -d= -f2- | tr -d '"')
for j in $(gcloud scheduler jobs list --location=asia-southeast1 --project=$P \
             --format='value(name.basename())'); do
  gcloud scheduler jobs update http "$j" --location=asia-southeast1 --project=$P \
    --update-headers="Authorization=Bearer $S"
done
```

Then verify by **running one and reading the log**, not by the absence of an error:

```bash
gcloud scheduler jobs run eno-vn-visa-retention --location=asia-southeast1 --project=$P
gcloud logging read 'resource.type="cloud_scheduler_job"' --project=$P --limit=3 \
  --format='value(resource.labels.job_id,severity,jsonPayload.status)'
```

⚠️ `gcloud scheduler jobs describe … status.code` reads `2` for a healthy job too —
it is the last recorded error, not current state. The logs are the authority.

## Migration blockers the owner must close

- [ ] **Off-box backups.** `ENO_BACKUP_REMOTE` is unset, so every dump sits on the
      same disk as the database it protects. Once the box serves production that disk
      is the only copy of live data. ⛔ **This must be done BEFORE cutover, not after.**
      Everything except the credential is now in place: rclone is installed and
      `/root/.config/rclone/rclone.conf` holds an `eno-offsite` remote pointed at
      Bizfly Simple Storage HCM1 (VN-resident, chosen for Decree 53) with the two keys
      blank. Fill them, then **prove it rather than assume it**:
      ```bash
      rclone lsd eno-offsite:                                   # must list, not error
      ENO_BACKUP_REMOTE=eno-offsite:eno-db /opt/eno/bin/eno-backup.sh
      rclone ls eno-offsite:eno-db                              # the dump must BE there
      ```
      ⚠️ Nobody has ever tested this provider with live keys, and the backup script's
      off-box branch has therefore never executed. A green backup run today proves only
      the local half.

- [ ] **The Cloud Scheduler secret** (see above) — and note the box no longer depends
      on it: `/opt/eno/bin/eno-cron.sh` reads `CRON_SECRET` from the RUNNING CONTAINER,
      so it cannot drift from what the app validates. That drift is exactly what left
      every GCP cron failing.

## Config gaps

- [ ] **`EDGE_SECRET` set in the Cloud Run production env.** Absent locally, which
      makes `src/proxy.ts:39` IP rate limiting fail **open**. (Measured on the VN box:
      it *is* present there and matches production.)
- [ ] **Supabase dashboard: disable email+password signups.** `/auth/v1/signup` works
      with the anon key while the app only ever uses OTP / magic-link, so the endpoint
      is reachable surface with no product behind it.
- [ ] **`MARKETPLACE_HOSTS_SERVICES=true` in the eno.vn deployment.** ✅ Verified
      2026-08-22: it is set at **build** time in `cloudbuild.yaml:73`, which is the only
      place it can go — `next.config.ts` reads it while choosing `pageExtensions`. It is
      absent from `eno-root-env` and from the Cloud Run service env by design, so
      checking either of those reports a false negative.

## Scheduled removals

- [ ] **Drop the legacy unsubscribe path and the `Profile.unsubscribeToken` column.**
      Unsubscribe tokens are now derived (HMAC over the profile id,
      `src/lib/unsubscribe-token.ts`), so nothing usable is stored. The plaintext
      lookup in `src/app/api/unsubscribe/route.ts` is kept only because emails already
      in inboxes carry the old cuid, and an unsubscribe link that stops working is a
      compliance failure rather than a hardening win. Remove the fallback and the
      column once those digests have aged out — until then the database still holds
      working tokens, so the hardening is partial by design.
      ⚠️ **It will not age out on its own.** `Profile.unsubscribeToken` still carries
      `@unique @default(cuid())`, so every new profile keeps getting a stored token.
      Dropping the fallback means a schema change as well as a code change; a reviewer
      caught that this note originally implied time alone would finish the job.

## Dependency advisories with no non-breaking fix (audit item 1)

`npm audit` went 16 → 10 (high 13 → 6) with semver-compatible bumps only:
brace-expansion ×4, fast-uri, js-yaml, nanoid, @trapezedev/* ×2, @capacitor/cli
8.4.2 → 8.5.0. Every remaining advisory is `fix=none` or needs a MAJOR bump, which
this task excluded. None are skipped silently:

| package | why it stays |
| --- | --- |
| `tar` 6.2.1 **(critical)** | nested inside `@capacitor/assets`, a devDependency with `fix=none`. Top-level `tar` is already 7.5.22, the latest, and outside the vulnerable `<=7.5.20` range. Build-time only; never reachable from a request. |
| `@capacitor/assets`, `@trapezedev/project`, `uuid`, `xcode` | `fix=none` — no fixed version published. Not forked and not pinned, per instruction. |
| `prisma`, `@prisma/config`, `deepmerge-ts`, `@capacitor/cli` | fix requires a MAJOR bump. |

⛔ **The `sharp` advisory does NOT apply to the runtime.** The audit item asked to bump
sharp for libvips CVEs "since it decodes user uploads". Measured: the advisory's range
is `<0.35.0`, the installed version is **0.35.3** — already the latest published — so
it is outside the range. The vulnerable copy is the old sharp bundled inside
`@capacitor/assets`, a dev tool. Verified the real one works rather than trusting the
build: a round-trip encode → metadata → webp transcode succeeds on libvips 8.18.3.
⚠️ `require('sharp/package.json')` throws — sharp's `exports` map forbids it. That is
a property of the package, not a broken install, and it has now twice looked like one.

## Accepted risks

- **Video transcode has no per-instance concurrency cap** (audit item 8b,
  `src/app/api/upload/video/transcode/route.ts`). It keeps its 30/hour fail-closed
  rate limit, which bounds the daily bill but not thirty requests arriving in the
  same minute — each up to ~210s of full-CPU work.
  ⛔ **Attempted and deliberately reverted.** The expensive part is scheduled with
  Next's `after()` and continues past the response, so a semaphore released when the
  handler returns frees the slot before ffmpeg starts — it would count request
  handling, not encoding. All three reviewers caught exactly that in the first
  attempt. Doing it properly means acquiring at request time and handing ownership to
  the background job, with a leak-proof release on the inline fallback path too. That
  is well past this item's "~30 lines" budget, and a semaphore that silently leaks
  slots is worse than none: it refuses every video for the life of the instance while
  looking like a working limit.
  `src/lib/job-semaphore.ts` is kept, with tests including the `after()` case
  (`tryAcquire`), so the next attempt starts from a proven primitive rather than a
  hand-rolled counter.

- **Brand logo SVG filtering is a blocklist, not a structural sanitiser**
  (`src/app/api/brands/[slug]/logo/route.ts`). Admin-supplied `logoPath` is handed to
  sharp/librsvg with doctypes, entities, scripts, event handlers, external
  `href`/`src`, `<style>`, `@import` and non-fragment `url()` refused. Enumerating
  badness over markup handed to a parser cannot be proven complete. A structural
  allowlist would be stronger and must be validated against all 44 live logo
  documents before it can ship — every naive rule tried so far breaks real logos
  (all 44 contain `http://` in xmlns declarations; 22 use `style=`; 5 use `url(#…)`).
- **`<image>` and `<use href="#…">` are refused on that route** even though both are
  legitimate in real logo SVGs. Zero rows use them today, so this fails closed for a
  future upload rather than breaking a current one.
