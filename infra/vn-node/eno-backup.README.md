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

## The storage volume — `eno-storage-backup.sh` (off-box since 2026-09-23)

Until 2026-09-23 **only the database dump left the box.** The 32 GB storage volume (555,849
files: every listing photo and video, every visa document and business verification) and the
roles dump existed once, on the same disk. A DB restore without them is a site whose images all
404 and whose Supabase roles do not exist.

Nightly at 01:45 via `eno-storage-backup.timer`, under nice 19 / idle IO / a 20 MiB/s upload cap:

| what | where | kept |
|---|---|---|
| listing photos + videos (public) | `eno-offsite:eno/storage/` — plain | superset: a deletion leaves 14 days later |
| visa-documents, business-verification, evidence | `eno-offsite-crypt:storage/` — **encrypted** | mirrored: an erasure is an erasure |
| content-type + cache-control xattrs (names every file) | `eno-offsite-crypt:storage-xattrs/` — **encrypted** | 16 days (by age, never fewer than 2) |
| roles (`pg_dumpall --globals-only`, SCRAM verifiers) | `eno-offsite-crypt:globals/` — **encrypted** | 2, like the dumps |
| the orphan list (which bucket photos were DELETED on the box) | `eno-offsite-crypt:storage-state/` — **encrypted** | 16 days |

⛔ **The encryption key is escrowed, and the escrow is what makes it a backup.** `eno-offsite-crypt`
is an rclone crypt remote (content and names encrypted client-side, wrapping
`eno-offsite:eno/crypt`). Its section of `/root/.config/rclone/rclone.conf` is the key; a copy
lives in the owner's `~/eno-vault` as **`eno-offsite-crypt`** (owner, 2026-09-23: *"Encrypt
private + roles"*). Lose both and every encrypted object is noise. On a new box: `vault.sh get
eno-offsite-crypt`, append it to the new box's `rclone.conf`, set `ENO_BACKUP_CRYPT_REMOTE`. The
backup refuses to run unless that variable names a real crypt remote, so a typo cannot upload a
passport in the clear — and unless that remote can read `eno-offsite-crypt:.key-canary`, so a
remote recreated with a NEW key cannot quietly write backups the escrowed key cannot open. Write the
canary only after escrowing the key in use: `echo 'eno key canary v1' | rclone rcat eno-offsite-crypt:.key-canary`.

⛔ **The xattrs are half the object.** The file backend stores content-type ONLY as
`user.supabase.content-type`; a file restored without it is served as a 500. rclone cannot carry
xattrs to Bizfly (`-M` → 403), so they travel as a manifest and the restore re-applies them.

⚠️ **Policy, stated:** a listing photo deleted on the box — including by an account deletion — stays
in the plain bucket for 14 more days before the backup deletes it. That is the recovery window for
photo-deleting bugs, and it rests on the owner's call that listing photos are public content
(2026-09-23). Identity documents get no such window.

⚠️ **Public and private buckets back up differently, on purpose.** `listings` / `listing-videos` are
`rclone copy`'d: a photo deleted on the box stays in the bucket for 14 days (tracked in
`/opt/eno/backups/.storage-orphans.tsv`), so a bug that deletes photos is recoverable.
`visa-documents` / `business-verification` / `evidence` are `rclone sync`'d: their deletions are
erasures under the retention policy, and a backup that kept a deleted passport for two weeks
would breach it. ⛔ `rclone sync --backup-dir` would have been simpler and does not work:
Bizfly returns `501 NotImplemented` for server-side copy.

Guards — each one exercised by `infra/vn-node/eno-storage-rehearsal.sh` (scratch volume, scratch bucket
prefix, scratch key; fingerprints the production bucket before and after; exits non-zero if any
check fails — all passed on 2026-09-23):
refuses to run if the volume shrank >10% since the last good run, or the private half (mirrored,
no orphan window) holds under half of what its backup holds (or none at all) — measured against the
bucket, so a fresh box with an unrestored private half cannot erase the backup of it (`ENO_STORAGE_ALLOW_SHRINK=1` once, by hand, for a
deliberate mass delete; `ENO_STORAGE_ALLOW_PRIVATE_SHRINK=1` for the private half); caps identity-document erasures at `ENO_STORAGE_MAX_DELETE` (25/run — a day's retention sweep, not the bucket size) and
orphan-photo expiry separately at `ENO_STORAGE_MAX_EXPIRE` (2,000/run — normal expiry is ~0); fails a sample check that verified nothing ("hashes could not be checked", or an empty public sample); fails (after finishing
everything else) when the roles dump is missing or over 2 days old, or when more than
`ENO_STORAGE_MAX_NEW_ORPHANS` (1,000) photos were deleted on the box since the night before — the
orphans are recorded and nothing is deleted off-box, so that alarm leaves 14 days to restore them;
reports an unreachable bucket as an outage, never as a wrong key; verifies 20 random files from each half every night — `rclone check` (MD5) on the plain
half, `rclone cryptcheck` on the encrypted one; a tampered object in either fails the run; refuses
to start without a crypt remote; one run at a time (`flock`). Measured on the real volume: the
xattr scan takes 38 s and the manifest is 23 MB. Failures exit non-zero and write
`/opt/eno/backups/.last-storage-failure` — a separate marker, because `eno-backup.sh` deletes
its own on every success.

When a run fails on purpose — each failure names its own override, run ONCE by hand:

| message says | meaning | after checking it was intended |
|---|---|---|
| store shrank | the volume lost >10% of its files | `ENO_STORAGE_ALLOW_SHRINK=1 /opt/eno/bin/eno-storage-backup.sh` |
| private half: … private sync SKIPPED | identity documents fell below half of the week's high; everything else still ran | `ENO_STORAGE_ALLOW_PRIVATE_SHRINK=1 …` — its own switch, on purpose; it also resets the week's high so it is needed once |
| sync of private buckets stopped | more identity documents erased tonight than the cap (25) | `ENO_STORAGE_MAX_DELETE=<n> …` |
| orphans due … exceeds | more than 2,000 expired photos to delete off-box in one night (normal is ~0) | check they were meant to go, then `ENO_STORAGE_MAX_EXPIRE=<n> …` |
| N photos were deleted on the box | a bulk delete (e.g. an import rollback) — nothing is lost yet | nothing: it fires once; restore within 14 days if it was NOT intended |
| N photos are deleted … and the number is growing | a slow leak (>100 more a night past 5,000), or a rebuilt box whose volume was restored incompletely | find the cause; the oldest orphans expire within 14 days. If it is intended, it goes quiet once growth stops (or raise `ENO_STORAGE_MAX_ORPHANS`) |
| cannot reach the crypt remote | an outage | wait; do NOT touch the key or the canary |
| does not show .key-canary / decrypts to something else | the key in use is not the escrowed one | compare the box's `[eno-offsite-crypt]` section with `vault.sh get eno-offsite-crypt`; restore the escrowed one. ⛔ Never rewrite the canary to silence this — that blesses whatever key is on the box |
| cannot read the key canary | a transient read failure, a damaged canary, or the wrong key | re-run once; if it persists, treat it as the row above |


Install (root, once):

```bash
# /etc/default/eno-backup must carry BOTH lines:
#   ENO_BACKUP_REMOTE=eno-offsite:eno
#   ENO_BACKUP_CRYPT_REMOTE=eno-offsite-crypt:
install -m 755 /opt/eno/app/infra/vn-node/eno-storage-backup.sh  /opt/eno/bin/eno-storage-backup.sh
install -m 755 /opt/eno/app/infra/vn-node/eno-storage-restore.sh /opt/eno/bin/eno-storage-restore.sh
install -m 0644 /opt/eno/app/infra/vn-node/eno-storage-backup.{service,timer} /etc/systemd/system/
# FIRST EVER setup of a bucket+key only (NOT on a new box restoring an existing key — the canary is
# already in the bucket): escrow the key in ~/eno-vault, THEN write the canary with it.
#   echo 'eno key canary v1' | rclone rcat eno-offsite-crypt:.key-canary
systemctl daemon-reload && systemctl enable --now eno-storage-backup.timer
systemctl start --no-block eno-storage-backup.service   # the first run uploads all 32 GB
journalctl -u eno-storage-backup.service -f
```

Restore — always into a staging dir; the script never touches the live volume and prints the
swap for a human to run:

```bash
# prove it round-trips on one object
eno-storage-restore.sh /opt/eno/restore-test --prefix stub/stub/listings/<object>
# whole volume, as of last night (staging on the SAME filesystem, so the swap is a rename)
eno-storage-restore.sh /opt/eno/supabase/volumes/storage.restore
# undo a deletion from N days ago: name a manifest from before it
rclone lsf eno-offsite-crypt:storage-xattrs
eno-storage-restore.sh /opt/eno/restore-old --manifest xattrs-<stamp>.jsonl.gz
```

A restore drops exactly the photos the box had deleted (the nightly orphan list) and nothing
else — every photo uploaded since any manifest is kept. `--manifest <older>` brings back the ones
deleted since that night. The private half is a mirror of last night: an erased document is simply
absent, never resurrected. A file no manifest covers gets its content-type inferred from its
object name, and is listed.

To undo a deletion without swapping the whole volume, restore just that object and copy it in —
`cp -a` keeps the xattrs:

```bash
eno-storage-restore.sh /opt/eno/restore-one --manifest xattrs-<before>.jsonl.gz --prefix stub/stub/listings/<object>
cp -a /opt/eno/restore-one/stub/stub/listings/<object> /opt/eno/supabase/volumes/storage/stub/stub/listings/
```

A manifest named `*.suspect.jsonl.gz` failed the ≥99% content-type check the night it was made. It
is never picked by default; pass it with `--manifest` only on purpose.

Roles, for a fresh cluster — BEFORE `pg_restore` of the dump (errors for roles the image already
creates, such as `postgres` or `anon`, are expected):

```bash
rclone lsf eno-offsite-crypt:globals
F=globals-<stamp>.sql.gz     # the exact newest name from the listing above — never a glob
rclone copyto "eno-offsite-crypt:globals/$F" "/opt/eno/restore-roles/$F"
zcat "/opt/eno/restore-roles/$F" | docker exec -i supabase-db psql -U postgres -d postgres
```
