#!/usr/bin/env bash
# ⛔ THE CANONICAL COPY IS THE REPO, AND IT WAS NOT UNTIL 2026-08-23. This lived only at
# /opt/eno/bin/eno-backup.sh — unversioned, unreviewed, undiffable — which is exactly the
# gap eno-build.sh had. A backup script nobody can diff is a backup nobody can audit.
# Deploy it with:
#   install -m 755 /opt/eno/app/infra/vn-node/eno-backup.sh /opt/eno/bin/eno-backup.sh
#
# ⚠️ THE SCHEDULE AND THE REMOTE LIVE OUTSIDE THIS FILE, ON PURPOSE:
#   · eno-backup.service / .timer  — unit committed beside this script
#   · /etc/default/eno-backup      — ENO_BACKUP_REMOTE=eno-offsite:eno (not a secret)
#   · /root/.config/rclone/rclone.conf — the Bizfly keys (⛔ never in git)
# The off-box copy silently did nothing until 2026-08-23 because that /etc/default file
# had never been created: the unit reads it with a leading `-` (optional), so its absence
# was not an error, and the script's own "no remote configured" warning went to a journal
# nobody was reading. A warning nobody reads is not a safeguard.
# ─────────────────────────────────────────────────────────────────────────────
# eno · nightly database backup
#
# ⛔ WHY THIS EXISTS ALONGSIDE iNET'S SNAPSHOT. iNET takes a weekly whole-VM
# snapshot and keeps ONE copy. That is a floor, not a database backup:
#   · weekly      → worst-case loss is 7 days
#   · one copy    → Sunday overwrites the only good one, so corruption on
#                   Saturday is unrecoverable by 02:00 Sunday
#   · whole-VM    → restoring the DB means rolling back the entire server
#   · same host   → an iNET incident takes server and backup together
#   · live PG     → a VM snapshot is crash-consistent, not transaction-consistent
# Hosted Supabase gave point-in-time recovery. This does not replace that, but it
# takes worst-case loss from a week to a day, and makes the DB restorable alone.
#
# ⚠️ A BACKUP THAT FAILS SILENTLY IS WORSE THAN NO BACKUP, because it buys false
# confidence. Every failure path here exits non-zero and leaves a marker file the
# monitoring can see; the systemd unit surfaces the failure rather than swallowing it.
set -euo pipefail
STACK=/opt/eno/supabase
OUT=/opt/eno/backups
KEEP_DAYS=14
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MARKER=/opt/eno/backups/.last-failure
mkdir -p "$OUT"

fail() { printf 'BACKUP FAILED: %s\n' "$*" >&2; date -u +%FT%TZ > "$MARKER"; echo "$*" >> "$MARKER"; exit 1; }

cd "$STACK" || fail "stack dir missing"

# ⚠️ GLOBALS SEPARATELY. pg_dump does NOT capture roles, and Supabase's roles
# (authenticator, supabase_admin, supabase_storage_admin, anon, authenticated…)
# are what make the restored database usable rather than merely present.
docker compose exec -T db pg_dumpall -U postgres --globals-only > "$OUT/globals-$STAMP.sql" \
  || fail "pg_dumpall globals"
[ -s "$OUT/globals-$STAMP.sql" ] || fail "globals dump is empty"

# ⛔ THE WHOLE DATABASE, EVERY SCHEMA. Not just `public`: the users live in `auth`,
# the object index in `storage`, and Realtime's authorization RLS policies in
# `realtime`. A public-only dump restores a site nobody can log into.
# ⛔ EVERY SCHEMA, BUT NOT THE ISR CACHE. public.next_cache was 1,585 MB of a 1,616 MB
# database — 98% of every dump was Next.js's rendered-page cache. It is DERIVED data:
# regenerated on demand, expiring on its own `expires_at`, and declared UNLOGGED, which
# means Postgres itself truncates it after an unclean shutdown. Backing up a table the
# database does not promise to keep is work with no possible payoff.
#
# Measured 2026-08-23: 818 MB → 3.0 MB, a 99.6% reduction, with all 127 TABLE DATA
# entries still present (Listing, Translation, auth.users…). That is also why the dumps
# looked identical yet stored in full every time — the cache churns constantly, so every
# byte-level comparison differed while nothing of value had changed.
#
# ⚠️ --exclude-table-data, NOT --exclude-table. The table DEFINITION stays in the archive
# (7 TOC entries: table, indexes, constraints), so a restore recreates it empty and the
# app fills it on first request. Excluding the table entirely would restore a database
# whose cache layer has nowhere to write.
docker compose exec -T db pg_dump -U postgres -d postgres -Fc --no-owner --no-privileges \
  --exclude-table-data='public.next_cache' \
  > "$OUT/eno-$STAMP.dump" || fail "pg_dump"
SIZE=$(stat -c %s "$OUT/eno-$STAMP.dump")
# ⚠️ FLOOR LOWERED WITH THE CACHE REMOVED. It was 100000 when a dump was ~820 MB, so it
# would have caught nothing anyway; against a 3 MB dump it is now a real guard. Do not
# raise it back without measuring — a threshold above the true size fails every run, and
# a threshold far below it never fires.
[ "$SIZE" -gt 500000 ] || fail "dump suspiciously small: $SIZE bytes"

# ⛔ PROVE IT PARSES. A file of the right size can still be truncated garbage;
# pg_restore --list reads the table of contents and fails on a corrupt archive.
# This is the difference between "a backup ran" and "a backup exists".
# ⚠️ ON THE HOST, AGAINST THE FILE — not piped into the container. A custom-format
# archive must be SEEKABLE, so `pg_restore --list` reading from a pipe returns
# nothing and reports a perfectly good backup as corrupt. The dump is already a
# file here; read it as one. (This exact mistake failed the first run, which is
# what the check is for.)
COUNT=$(pg_restore --list "$OUT/eno-$STAMP.dump" 2>/dev/null | grep -c ';' || true)
[ "${COUNT:-0}" -gt 50 ] || fail "dump did not parse — only $COUNT TOC entries"

gzip -f "$OUT/globals-$STAMP.sql"
printf 'ok %s  dump=%s bytes  toc=%s entries\n' "$STAMP" "$SIZE" "$COUNT"

# Retention. -mtime is days; nothing is deleted until a NEW backup has verified.
find "$OUT" -name 'eno-*.dump'      -mtime "+$KEEP_DAYS" -delete
find "$OUT" -name 'globals-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
rm -f "$MARKER"

# ⚠️ OFF-BOX COPY IS NOT CONFIGURED YET, AND THAT IS DELIBERATE RATHER THAN
# FORGOTTEN. Backups hold the same personal data as the database, so under Decree
# 53 they should stay in Vietnam — which points at Bizfly Simple Storage HCM1.
# Until those credentials exist, every copy lives on the same disk as the database
# it protects, which does NOT survive losing this box. Set ENO_BACKUP_REMOTE and
# this block starts working.
if [ -n "${ENO_BACKUP_REMOTE:-}" ]; then
  rclone copy "$OUT/eno-$STAMP.dump" "$ENO_BACKUP_REMOTE" 2>/dev/null || fail "off-box copy"
  echo "off-box copy ok"
else
  echo "WARNING: no off-box copy — ENO_BACKUP_REMOTE unset (single point of failure)"
fi
