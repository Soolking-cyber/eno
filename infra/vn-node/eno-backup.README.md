# Backups — what runs, and what to check when it matters

`eno-backup.sh` runs nightly via `eno-backup.timer`. It dumps every schema with
`pg_dump -Fc`, verifies the archive parses, prunes past `KEEP_DAYS=14`, and copies the
dump to Bizfly Simple Storage (`eno-offsite:eno`, VN-resident for Decree 53).

## ⛔ The dump excludes `public.next_cache`, and that is the whole story of its size

Until 2026-08-23 every dump was **~818 MB**. Measured that day:

| relation | size |
|---|---|
| `public.next_cache` | **1,585 MB** |
| `public.Translation` | 12 MB |
| `public.Listing` | 1 MB |
| everything else | < 1 MB each |

98% of every backup was Next.js's rendered-page cache. It is derived data with its own
`expires_at`, and it is declared **UNLOGGED** — Postgres truncates unlogged tables after
an unclean shutdown, so the database does not promise to keep it either. Excluding its
data took the dump to **3.0 MB**, a 99.6% reduction.

⚠️ It also explains a symptom that looked like a backup bug: the dumps appeared to repeat
the same data yet stored in full every night. The cache churns constantly, so every dump
genuinely differed — while nothing worth keeping had changed.

⚠️ `--exclude-table-data`, never `--exclude-table`. The table DEFINITION stays in the
archive, so a restore recreates it empty and the app refills it on first request.
Excluding the table outright restores a database whose cache layer has nowhere to write.

## Restoring — the part worth rehearsing before you need it

```bash
DUMP=$(ls -1t /opt/eno/backups/eno-*.dump | head -1)
docker exec supabase-db psql -U postgres -d postgres -c 'create database restore_test;'
docker exec -i supabase-db pg_restore -U postgres -d restore_test --no-owner --no-privileges < "$DUMP"
```

Verified 2026-08-23 against production: `Listing 30=30`, `Profile 8=8`, `Seller 3=3`,
`Message 47=47`, `Conversation 4=4`, `Translation 37009=37009`, `auth.users 8=8`,
`next_cache 0` — and **zero data-affecting errors**.

⚠️ **8 errors are expected in that test and are NOT data loss**: `pg_cron` can only be
installed in the database named `postgres`, and Supabase's `vault.secrets` and
`log_min_messages` need cluster superuser. They are artifacts of restoring into a
database with a different NAME.

⛔ **The real disaster-recovery path — a fresh cluster, restoring into `postgres` — has
NOT been rehearsed.** The scratch-database test above proves the DATA is intact and
nothing more. Extensions and roles are a separate concern: `globals-*.sql.gz` beside each
dump carries the roles (`pg_dump` does not), and pg_cron would need reinstating. Rehearse
it before you need it, not during.

## When the off-box copy is silent

`ENO_BACKUP_REMOTE` comes from `/etc/default/eno-backup`. The unit reads that file with a
leading `-`, so if it is missing systemd does not complain — the script warns and carries
on. That is how the off-box copy did nothing at all until 2026-08-23.

```bash
systemctl start eno-backup.service && journalctl -u eno-backup.service -n 5 --no-pager
rclone ls eno-offsite:eno
```

Expect `off-box copy ok` in the journal and a new object in the bucket. ⚠️ Bizfly requires
**AWS Signature v2** for writes (`v2_auth = true` in the rclone config). A v4 PUT returns
`ServiceUnavailable` with an empty message while reads keep working, which reads as a
provider outage rather than an auth mismatch.

⚠️ The Bizfly account was on a trial ending **29/08/2026**.
