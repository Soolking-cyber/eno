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

## Accepted risks

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
