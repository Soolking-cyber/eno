#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · nightly OFF-BOX copy of the Supabase Storage volume (+ the roles dump)
#
# Canonical copy is the repo. Deploy with:
#   install -m 755 /opt/eno/app/infra/vn-node/eno-storage-backup.sh /opt/eno/bin/eno-storage-backup.sh
# Schedule: eno-storage-backup.service / .timer, committed beside this script.
# Remotes:  ENO_BACKUP_REMOTE (plain, shared with eno-backup.sh) and ENO_BACKUP_CRYPT_REMOTE (an
#           rclone crypt remote), both from /etc/default/eno-backup.
# Restore:  eno-storage-restore.sh, also beside this script. Runbook: eno-backup.README.md.
#
# ⛔ WHY THIS EXISTS. Until 2026-09-23 the only thing that left the box was the database dump.
# The 32 GB storage volume — every listing photo, every video, every visa document and business
# verification — and the roles dump existed ONCE, on the same disk as everything else. The DB
# dump without them restores a marketplace whose every image 404s and whose roles do not exist.
#
# ⛔ THE BYTES ARE NOT THE WHOLE OBJECT. The file backend keeps each object's content-type and
# cache-control ONLY in extended attributes (user.supabase.content-type / cache-control). Copy
# the bytes without them and every object 500s (ENODATA) — which is exactly what happened after
# the 2026-09-20 box migration. rclone cannot carry them to Bizfly: `-M` is refused with 403
# AccessDenied. So the bytes go up with plain rclone and the xattrs go up as a SEPARATE
# compressed manifest (relative path → user.* attributes); a restore copies the bytes back and
# re-applies the manifest. Neither half is a backup without the other.
#
# ⚠️ A BACKUP THAT FAILS SILENTLY IS WORSE THAN NO BACKUP. Every failure exits non-zero (the
# oneshot unit then shows in `systemctl --failed`) and writes its OWN marker file — a SIGKILL
# (OOM, timeout) cannot run the trap, so the unit's ExecStopPost writes the marker for those. Not the
# database backup's .last-failure: eno-backup.sh deletes that file on every success, so it would
# erase a storage failure within 24 hours.
set -Eeuo pipefail

# Overridable only so the whole cycle can be rehearsed against a scratch volume and a scratch
# remote prefix (the unit sets neither).
SRC="${ENO_STORAGE_SRC:-/opt/eno/supabase/volumes/storage}"
STATE="${ENO_STORAGE_STATE:-/opt/eno/backups}"
MARKER="$STATE/.last-storage-failure"
OK_FILE="$STATE/.last-storage-ok"
COUNT_FILE="$STATE/.storage-last-count"
ORPHANS="$STATE/.storage-orphans.tsv"   # remote-only path <TAB> stamp it first went missing
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$STATE"

# Problems that must fail the run but must NOT stop the rest of it (manifest, verification, orphan
# bookkeeping) — collected here and reported in §8.
DEFERRED=''
defer() { DEFERRED="${DEFERRED:+$DEFERRED; }$*"; printf 'DEFERRED FAILURE: %s\n' "$*" >&2; }
fail() { printf 'STORAGE BACKUP FAILED: %s\n' "$*" >&2; { date -u +%FT%TZ; echo "$*"; } > "$MARKER"; exit 1; }
# ⚠️ -E + an ERR trap: anything set -e would kill WITHOUT a marker goes through fail() instead.
trap 'fail "unexpected error on line $LINENO"' ERR

# ⚠️ ONE RUN AT A TIME. The first run moves 32 GB and can outlast a night; a timer firing into
# it would run two uploads against the same bucket. Skipping is exit 0 on purpose — the running
# job reports its own outcome.
exec 9>"${ENO_STORAGE_LOCK:-/run/eno-storage-backup.lock}"
flock -n 9 || { echo "skipped: a previous storage backup is still running"; exit 0; }

# ⛔ UNLIKE eno-backup.sh, NO REMOTE IS A FAILURE HERE, NOT A WARNING. An off-box copy is this
# script's only job; "nothing configured" must not look like success.
# ⚠️ Read the box defaults when run BY HAND (the documented overrides are manual runs, and without
# this they died on "remote unset"). Only the two remotes are taken, and only where unset: sourcing
# the whole file would clobber an operator's own ENO_STORAGE_* on the command line.
# ⛔ A REHEARSAL MUST SET ENO_BACKUP_DEFAULTS=/dev/null. Otherwise a test that leaves a remote unset
# inherits the REAL one from this file — on 2026-09-23 a "refuses without a crypt remote" test did
# exactly that and wrote four fake objects into the production crypt remote (found and purged).
DEFAULTS="${ENO_BACKUP_DEFAULTS:-/etc/default/eno-backup}"
for v in ENO_BACKUP_REMOTE ENO_BACKUP_CRYPT_REMOTE; do
  if [ -z "${!v:-}" ] && [ -f "$DEFAULTS" ]; then
    printf -v "$v" '%s' "$(. "$DEFAULTS"; printf '%s' "${!v:-}")"
  fi
done
[ -n "${ENO_BACKUP_REMOTE:-}" ] || fail "ENO_BACKUP_REMOTE unset — set it in /etc/default/eno-backup"
REMOTE_BASE="${ENO_BACKUP_REMOTE%/}"
DEST="$REMOTE_BASE/storage"           # public media, plain

# ⛔ PASSPORTS NEVER LEAVE THE BOX IN PLAINTEXT (owner, 2026-09-23: "Encrypt private + roles").
# visa-documents, business-verification, evidence, the roles dump (SCRAM verifiers) and the xattr
# manifest (which names every private file) go through an rclone CRYPT remote: content AND names
# are encrypted client-side, so a leaked Bizfly key exposes nothing. Its key lives in the box's
# rclone.conf and is escrowed in the owner's ~/eno-vault as `eno-offsite-crypt` — without that
# escrow a box loss would take the key with it and every encrypted object would be noise.
# ⛔ REFUSE ANYTHING THAT IS NOT A CRYPT REMOTE. A typo pointing this at the plain bucket would
# otherwise upload every passport in the clear while looking like success. rclone describes a
# crypt remote as "Encrypted drive …", env-defined or not.
[ -n "${ENO_BACKUP_CRYPT_REMOTE:-}" ] \
  || fail "ENO_BACKUP_CRYPT_REMOTE unset — refusing to upload identity documents unencrypted"
# ⚠️ Errors are SHOWN, not discarded: a Bizfly or DNS outage must read as an outage, not as "wrong
# key" — the documented response to a wrong key (re-escrow, rewrite the canary) is the worst thing
# to do during an outage.
features=$(rclone backend features "$ENO_BACKUP_CRYPT_REMOTE" 2>&1) \
  || fail "cannot query the crypt remote (outage? config?): $(printf '%s' "$features" | tail -n 3)"
printf '%s' "$features" | grep -q '"String": "Encrypted drive' \
  || fail "ENO_BACKUP_CRYPT_REMOTE='$ENO_BACKUP_CRYPT_REMOTE' is not an rclone crypt remote — refusing"
join() { case "$1" in *:) printf '%s%s' "$1" "$2" ;; *) printf '%s/%s' "${1%/}" "$2" ;; esac; }
CRYPT_BASE="$ENO_BACKUP_CRYPT_REMOTE"
CDEST=$(join "$CRYPT_BASE" storage)   # private buckets, encrypted
# ⛔ …AND REFUSE A CRYPT REMOTE WITH A DIFFERENT KEY. "Is it crypt" passes for any password: rebuild
# the box, recreate the remote with a new one, and every run would succeed while writing objects the
# escrowed key cannot read. `.key-canary` was written once with the escrowed key; a different key
# cannot even decrypt its name. It is never re-created by this script — re-create it by hand only
# after escrowing the key in use (runbook).
KEY_CANARY='eno key canary v1'
# The root listing reaches the bucket either way; with a different key the canary's NAME fails to
# decrypt and it is simply absent — so "cannot list" is an outage, "listed but no canary" is a key.
root_list=$(rclone lsf "$CRYPT_BASE" 2>&1) \
  || fail "cannot reach the crypt remote (outage? config?): $(printf '%s' "$root_list" | tail -n 3)"
printf '%s\n' "$root_list" | grep -qx '.key-canary' \
  || fail "the crypt remote does not show .key-canary — its key is NOT the escrowed one (or the canary was never written); refusing"
[ "$(rclone cat "$(join "$CRYPT_BASE" .key-canary)" 2>&1)" = "$KEY_CANARY" ] \
  || fail "the key canary reads back wrong — refusing"
[ -d "$SRC" ] || fail "storage volume missing at $SRC"

positive_int() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$((10#$1))" -ge 1 ]; }
# ⚠️ TWO CAPS FOR TWO DIFFERENT DELETIONS. One knob used to gate both, so raising it to let a bulk
# photo expiry through also licensed that many identity-document erasures in the same run.
# The private cap sits near a day's retention sweep (a few documents), NOT near the bucket size: a
# bug that erases 30 passports must stop here, because the private half has no orphan window.
MAX_DELETE="${ENO_STORAGE_MAX_DELETE:-25}"      # private sync: identity documents erased off-box per run
MAX_EXPIRE="${ENO_STORAGE_MAX_EXPIRE:-10000}"   # public: expired orphan photos deleted off-box per run
positive_int "$MAX_DELETE" || fail "ENO_STORAGE_MAX_DELETE='$MAX_DELETE' is not a positive integer"
positive_int "$MAX_EXPIRE" || fail "ENO_STORAGE_MAX_EXPIRE='$MAX_EXPIRE' is not a positive integer"
MAX_DELETE=$((10#$MAX_DELETE)); MAX_EXPIRE=$((10#$MAX_EXPIRE))
BWLIMIT="${ENO_STORAGE_BWLIMIT:-20M}"
SAMPLE_N="${ENO_STORAGE_SAMPLE:-20}"
positive_int "$SAMPLE_N" || fail "ENO_STORAGE_SAMPLE='$SAMPLE_N' is not a positive integer"
ORPHAN_DAYS=14      # how long a photo deleted on the box stays restorable from the bucket
# ⚠️ MANIFESTS ARE KEPT BY AGE, NOT COUNT. Undoing a deletion needs the manifest from the night
# BEFORE it, for as long as the orphan is still in the bucket — ORPHAN_DAYS. A count ("keep 15")
# silently shrinks that window every time a run is added: a manual run, a catch-up after downtime.
# (A multi-day outage still narrows it for photos deleted during the outage: their pre-deletion
# manifest is as old as the last run before it.)
MANIFEST_DAYS=$(( ORPHAN_DAYS + 2 ))
KEEP_GLOBALS=2      # matches the dumps: a roles file is only useful beside a dump

# Everything before the upload is on the far side of this file's mtime, so the sample check
# below never picks a file the upload could not have seen.
START_REF=$(mktemp); TMP_MANIFEST=$(mktemp --suffix=.jsonl.gz); SAMPLE=$(mktemp)
REMOTE_LIST=$(mktemp); LOCAL_LIST=$(mktemp); DUE=$(mktemp)
trap 'rm -f "$START_REF" "$TMP_MANIFEST" "$SAMPLE" "$REMOTE_LIST" "$LOCAL_LIST" "$DUE"' EXIT

# ── 1. floor check — BEFORE anything is mirrored ────────────────────────────
# ⛔ A SYNC MIRRORS LOSS AS FAITHFULLY AS IT MIRRORS DATA. If the volume is unmounted, emptied
# or half-restored, the private-bucket sync would delete the bucket to match and every photo
# would start its orphan countdown. Refuse when the store has shrunk by more than 10% since the
# last good run. A deliberate mass delete runs once by hand with ENO_STORAGE_ALLOW_SHRINK=1.
# ⚠️ `|| true` on the find: a photo deleted while find walks its directory makes find exit 1, and
# under pipefail that would abort the run. A genuinely unreadable volume still shows up — as a
# count far below the floor.
now_count=$( { find "$SRC" -type f 2>/dev/null || true; } | wc -l)
[ "$now_count" -gt 0 ] || fail "storage volume holds no files — refusing to mirror an empty store"
if [ -s "$COUNT_FILE" ]; then
  prev_count=$(cat "$COUNT_FILE")
  if positive_int "$prev_count" && [ "${ENO_STORAGE_ALLOW_SHRINK:-0}" != 1 ] \
     && [ "$now_count" -lt $(( 10#$prev_count * 9 / 10 )) ]; then
    fail "store shrank from $prev_count to $now_count files — refusing to mirror it (ENO_STORAGE_ALLOW_SHRINK=1 to override once)"
  fi
fi
# ⛔ AND A FLOOR FOR THE PRIVATE HALF ON ITS OWN. It is ~75 files of 555k, so the whole-volume floor
# cannot see it vanish — yet it is the half that is MIRRORED, with no orphan window: an emptied
# visa-documents dir would erase every encrypted copy at the next sync. Retention sweeps delete a
# few documents a day legitimately, so this trips only on a collapse.
# ⚠️ MEASURED AGAINST THE BUCKET, NOT A LOCAL COUNT FILE. The bucket's private half IS last good
# night's count, and it survives a new box — a local file would not, and a fresh box with an
# unrestored private half would then erase the backup of it.
# ONE list decides the split; every filter and pattern below is derived from it. The volume's buckets
# (measured 2026-09-23): listings, listing-videos | business-verification, evidence, visa-documents.
# A NEW bucket lands on the private side (encrypted, mirrored, erasure-capped) until listed here.
PUBLIC_BUCKETS=(listings listing-videos)
PUBLIC_RE="^stub/stub/($(IFS='|'; echo "${PUBLIC_BUCKETS[*]}"))/"
PUBLIC=(); PRIVATE=()
for b in "${PUBLIC_BUCKETS[@]}"; do PUBLIC+=(--filter "+ /stub/stub/$b/**"); PRIVATE+=(--filter "- /stub/stub/$b/**"); done
PUBLIC+=(--filter '- **'); PRIVATE+=(--filter '+ **')
private_count=$( { find "$SRC" -type f -printf '%P\n' 2>/dev/null || true; } | { grep -cvE "$PUBLIC_RE" || true; } )
remote_private_list=$(rclone lsf -R --files-only "$CDEST" 2>&1) || {
  case "$remote_private_list" in *"directory not found"*) remote_private_list='' ;;
    *) fail "cannot list the private half of the bucket: $(printf '%s' "$remote_private_list" | tail -n 3)" ;; esac; }
remote_private=$(printf '%s\n' "$remote_private_list" | grep -c . || true)
# ⚠️ AGAINST THE HIGHEST OF THE LAST 7 NIGHTS, not just last night. Last night's bucket shrinks in
# step with the loss this guard exists to catch, so a bug erasing 25 a night (the cap) would walk
# straight through it: 75 → 50 passes, 50 → 25 passes. The history is local (a new box starts with
# only the bucket's count, which is still right for that case).
PRIVATE_HISTORY="$STATE/.storage-private-history"   # "<stamp> <count>" per good night
private_ref=$remote_private
if [ -s "$PRIVATE_HISTORY" ]; then
  week_ago=$(date -u -d '-7 days' +%Y%m%dT%H%M%SZ)
  high=$(awk -v c="$week_ago" '$1 >= c && $2 ~ /^[0-9]+$/ { if ($2 > m) m = $2 } END { print m + 0 }' "$PRIVATE_HISTORY")
  if [ "$high" -gt "$private_ref" ]; then private_ref=$high; fi
fi
# ⚠️ Its OWN override: lifting the whole-volume floor for a planned photo purge must not also
# license erasing the identity-document backup.
# ⚠️ A REFUSAL SKIPS ONLY THE PRIVATE SYNC. Failing here used to abort the whole night — the 32 GB
# public half, the manifest, the roles, verification — and the 7-day high-water repeated that every
# night for a week. Now the rest runs and the run fails at the end (§8).
# The override also RESETS the history, so a deliberate large erasure is accepted once, not nightly.
PRIVATE_BLOCKED=''
if [ "${ENO_STORAGE_ALLOW_PRIVATE_SHRINK:-0}" = 1 ]; then
  : # accepted for tonight; the week's history is reset in §8, only if the whole run succeeds
elif [ "$private_ref" -gt 0 ]; then
  if [ "$private_count" -eq 0 ] || { [ "$private_ref" -ge 10 ] && [ "$private_count" -lt $(( private_ref / 2 )) ]; }; then
    PRIVATE_BLOCKED="private half: $private_count files here vs up to $private_ref backed up this week — private sync SKIPPED tonight (restore first, or ENO_STORAGE_ALLOW_PRIVATE_SHRINK=1 once if the erasure was intended)"
  fi
fi

# ── 2. the bytes ─────────────────────────────────────────────────────────────
# --size-only: the file backend never rewrites a path — every upload lands in a fresh
# <object>/<version-uuid> file — so size is a sufficient change test, and it spares ~555k HEAD
# requests a night that an mtime compare costs on S3. Corruption is the sample check's job (§5).
# MEASURED, not assumed (2026-09-23): storage-api's file backend writes every object to
# withOptionalVersion(`${bucket}/${key}`, version), and of 555,849 files not one object directory
# holds a second version file. If that ever changes, `--size-only` must go.
#
# Two passes, because the two kinds of bucket want opposite things from a deletion:
#   · listings, listing-videos — public marketplace media. COPIED, never synced: the bucket stays
#     a superset, and a photo deleted on the box leaves the bucket only ORPHAN_DAYS later (§7).
#     A bug that deletes photos is then a restore, not a loss.
#   · everything else — visa-documents, business-verification, evidence: identity documents.
#     ENCRYPTED (above), and SYNCED: their deletions are ERASURES (retention sweeps, account
#     deletion, StorageTombstone), mirrored at the next run and not kept. A 14-day shadow copy of a
#     passport the retention policy has destroyed is a retention breach. The private floor (§1) and
#     --max-delete are the guards.
# An unknown new bucket falls into the second pass: mirrored, erasure honoured.
#
# ⛔ NOT `rclone sync --backup-dir`, THE OBVIOUS TOOL, BECAUSE IT CANNOT WORK HERE. Bizfly answers
# server-side copy with `501 NotImplemented` (measured 2026-09-23), --backup-dir is built on it,
# and rclone then refuses every deletion "as there were IO errors" — a nightly failure.
# --s3-upload-cutoff 1G: every object goes up in ONE part, so its ETag is its MD5 and §5 can verify
# it — a multipart ETag is not an MD5 and would read as "could not be checked" (a red night).
# Largest object today: 7 MB (measured 2026-09-23).
RCLONE_COMMON=(--size-only --transfers 4 --checkers 8 --bwlimit "$BWLIMIT" --s3-upload-cutoff 1G
               --stats 15m --stats-one-line --stats-log-level NOTICE)

# ⚠️ --fast-list only where it pays: listing 555k objects in pages of 1,000 is ~560 calls instead of
# one per directory (every object is its own directory here), at ~1 KB of RAM per object.
rclone copy "$SRC" "$DEST" "${RCLONE_COMMON[@]}" "${PUBLIC[@]}" --fast-list \
  || fail "copy of listings/listing-videos (rclone exit $?)"
# ⚠️ DEFERRED, not fatal: a retention sweep bigger than the cap is a question for a person, not a
# reason to skip tonight's manifest, verification and orphan bookkeeping for 555k public files.
# rclone still uploads everything new; it only stops deleting at the cap.
if [ -n "$PRIVATE_BLOCKED" ]; then
  defer "$PRIVATE_BLOCKED"
else rclone sync "$SRC" "$CDEST" "${RCLONE_COMMON[@]}" "${PRIVATE[@]}" --max-delete "$MAX_DELETE" \
  || defer "sync of private buckets stopped (rclone exit $?) — if more than $MAX_DELETE identity documents were erased on purpose tonight, re-run once by hand with ENO_STORAGE_MAX_DELETE=<n>"
fi
echo "bytes backed up: $now_count files on the volume"

# ── 3. the xattrs — AFTER the upload, so every uploaded blob is in the manifest ──
read -r m_total m_ct < <(python3 - "$SRC" "$TMP_MANIFEST" <<'PY'
import base64, gzip, json, os, sys
root, out = sys.argv[1], sys.argv[2]
total = with_ct = 0
with gzip.open(out, "wt", encoding="utf-8", compresslevel=6) as f:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            p = os.path.join(dirpath, name)
            try:
                attrs = {}
                for k in os.listxattr(p, follow_symlinks=False):
                    if not k.startswith("user."):
                        continue
                    try:
                        v = os.getxattr(p, k, follow_symlinks=False)
                    except OSError:
                        continue  # attribute removed between list and read — skip it, not the run
                    try:
                        attrs[k] = v.decode("utf-8")
                    except UnicodeDecodeError:
                        attrs[k] = {"b64": base64.b64encode(v).decode("ascii")}
            except FileNotFoundError:
                continue  # deleted mid-walk — it becomes an orphan (§7) like any other deletion
            f.write(json.dumps({"p": os.path.relpath(p, root), "x": attrs},
                               ensure_ascii=False, separators=(",", ":")) + "\n")
            total += 1
            with_ct += "user.supabase.content-type" in attrs
print(total, with_ct)
PY
) || fail "xattr manifest scan"
[ "${m_total:-0}" -gt 0 ] || fail "xattr manifest is empty"
# ⛔ UPLOAD FIRST, JUDGE SECOND — BUT LABEL IT. The bytes above are already in the bucket, so a manifest
# withheld for looking wrong would leave tonight's uploads with no xattrs anywhere. One that FAILS
# the check below goes up as `.suspect`: kept for a human to use deliberately, never picked by a
# restore's default, so a broken scan cannot quietly become the authority for the next restore.
# ⚠️ A blob without a content-type 500s on the LIVE site today — a production bug to fix, not a
# reason to fail tonight's backup, unless it is widespread enough to mean the scan is broken.
MANIFESTS=$(join "$CRYPT_BASE" storage-xattrs)
if [ $(( m_ct * 100 )) -lt $(( m_total * 99 )) ]; then
  rclone copyto "$TMP_MANIFEST" "$MANIFESTS/xattrs-$STAMP.suspect.jsonl.gz" || true
  fail "only $m_ct of $m_total files carry user.supabase.content-type — scan or volume is broken (uploaded as .suspect)"
fi
rclone copyto "$TMP_MANIFEST" "$MANIFESTS/xattrs-$STAMP.jsonl.gz" || fail "manifest upload (rclone exit $?)"
if [ "$m_ct" -eq "$m_total" ]; then
  echo "xattr manifest: $m_total files, all with a content-type"
else
  echo "WARNING: $(( m_total - m_ct )) of $m_total files have NO content-type — they 500 live today"
fi

# ── 4. the roles dump ────────────────────────────────────────────────────────
# pg_dump does not carry roles, and eno-backup.sh keeps its globals file on the box. The newest
# one goes up beside the dumps; only eno-backup.sh's own naming is eligible.
# ⚠️ A PROBLEM HERE IS DEFERRED, NOT FATAL ON THE SPOT. It is eno-backup.sh's output, and failing
# immediately used to skip verification, retention and orphan expiry for as long as THAT job was
# broken. The run still ends non-zero (§8) — and also when the newest roles file is stale, which is
# what a failing eno-backup.sh actually looks like from here.
globals=$(find "$STATE" -maxdepth 1 -name 'globals-*.sql.gz' -printf '%f\n' \
          | grep -E '^globals-[0-9]{8}T[0-9]{6}Z\.sql\.gz$' | sort | tail -n 1 || true)
if [ -z "$globals" ]; then
  defer "no globals-*.sql.gz in $STATE — has eno-backup.sh been failing?"
elif ! rclone copyto "$STATE/$globals" "$(join "$CRYPT_BASE" globals)/$globals"; then
  defer "roles dump upload failed"
else
  echo "roles dump uploaded: $globals"
  if [ -n "$(find "$STATE/$globals" -mmin +$(( 2 * 24 * 60 )))" ]; then
    defer "newest roles dump $globals is over 2 days old — eno-backup.sh is not producing new ones"
  fi
fi

# ── 5. prove a sample round-trips ────────────────────────────────────────────
# An upload that exits 0 has not proven the bucket holds the right bytes. SAMPLE_N random files
# that predate this run are compared against the bucket, from each half:
#   · public: `rclone check`, MD5 on both sides (every object is under the multipart cutoff, so its
#     S3 ETag is its MD5). Measured 2026-09-23: a tampered object makes this exit non-zero.
#   · private: `rclone cryptcheck`, which encrypts the local file with the remote's nonce and
#     compares that hash — the only way to verify content the bucket cannot read.
{ find "$SRC" -type f ! -newer "$START_REF" -printf '%P\n' 2>/dev/null || true; } > "$SAMPLE"
sample_check() {  # <public|private> <rclone subcommand> <dest>
  local picked out; picked=$(mktemp)
  if [ "$1" = public ]; then
    { grep -E "$PUBLIC_RE" "$SAMPLE" || true; } | shuf -n "$SAMPLE_N" > "$picked"
  else
    { grep -vE "$PUBLIC_RE" "$SAMPLE" || true; } | shuf -n "$SAMPLE_N" > "$picked"
  fi
  # ⚠️ AN EMPTY PUBLIC SAMPLE IS A FAILURE, NOT A SKIP: the volume holds 555k public files, so
  # picking none means the listing or the pattern broke — and a check of nothing passes.
  if [ ! -s "$picked" ]; then
    rm -f "$picked"
    [ "$1" = private ] && return 0
    defer "sample check (public): no files to sample — listing or pattern is broken"; return 0
  fi
  # ⚠️ "HASHES COULD NOT BE CHECKED" EXITS 0. It is what rclone says when an object has no usable
  # hash (e.g. a multipart ETag), and a check that verified nothing must not read as a pass.
  # ⚠️ DEFERRED like every other verdict, so the orphan bookkeeping and §8's full list of reasons
  # still happen — a fatal abort here used to hide, e.g., the "private sync SKIPPED" reason.
  if ! out=$(rclone "$2" "$SRC" "$3" --one-way --files-from "$picked" 2>&1); then
    rm -f "$picked"; printf '%s\n' "$out" >&2
    defer "sample $2 ($1): bucket does not match the volume"; return 0
  fi
  if printf '%s\n' "$out" | grep -q 'could not be checked'; then
    rm -f "$picked"; printf '%s\n' "$out" >&2
    defer "sample $2 ($1): some hashes could not be checked — the sample verified nothing for them"; return 0
  fi
  echo "sample check ($1): $(wc -l < "$picked") random files match"
  rm -f "$picked"
}
sample_check public  check      "$DEST"
# Skipped when tonight's private sync was: files it never uploaded would "mismatch" by design.
[ -n "$PRIVATE_BLOCKED" ] || sample_check private cryptcheck "$CDEST"

# ── 6. retention of the manifests and roles dumps ────────────────────────────
# Strict-name like eno-backup.sh, and only if tonight's file is visible in the listing — a listing
# that cannot see what was just uploaded is not a listing to delete from. Roles dumps by count
# (only the newest matters), manifests by age (see MANIFEST_DAYS).
prune_keep_newest() {  # <remote dir> <name regex> <tonight's name> <keep>
  local dir="$1" re="$2" current="$3" keep="$4" names stale
  names=$(rclone lsf "$dir" 2>/dev/null | grep -E "$re" | sort || true)
  if ! printf '%s\n' "$names" | grep -qFx "$current"; then
    echo "WARNING: $dir listing does not show $current — skipping its retention"
    return 0
  fi
  names=$(printf '%s\n' "$names" | awk -v c="$current" '$0 != "" && $0 < c')
  stale=$(printf '%s\n' "$names" | head -n "-$(( keep - 1 ))")
  printf '%s\n' "$stale" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    if rclone deletefile "$dir/$f" 2>/dev/null; then echo "pruned $dir/$f"; else echo "WARNING: could not prune $dir/$f"; fi
  done
}
# By age: only names older than the cutoff, and never the newest two of the kind. A listing that
# fails returns nothing and so deletes nothing — the age rule needs no "tonight is visible" guard.
prune_older_than() {  # <remote dir> <name regex> <cutoff name>
  local dir="$1" re="$2" cutoff="$3"
  { rclone lsf "$dir" 2>/dev/null | grep -E "$re" || true; } | sort | head -n -2 \
    | awk -v c="$cutoff" '$0 != "" && $0 < c' | while IFS= read -r f; do
      if rclone deletefile "$dir/$f" 2>/dev/null; then echo "pruned $dir/$f"; else echo "WARNING: could not prune $dir/$f"; fi
    done
}
AGE_CUTOFF=$(date -u -d "-$MANIFEST_DAYS days" +%Y%m%dT%H%M%SZ)
prune_older_than "$MANIFESTS" '^xattrs-[0-9]{8}T[0-9]{6}Z(\.suspect)?\.jsonl\.gz$' "xattrs-$AGE_CUTOFF"
prune_older_than "$(join "$CRYPT_BASE" storage-state)" '^orphans-[0-9]{8}T[0-9]{6}Z\.tsv\.gz$' "orphans-$AGE_CUTOFF"
prune_keep_newest "$(join "$CRYPT_BASE" globals)" '^globals-[0-9]{8}T[0-9]{6}Z\.sql\.gz$' "$globals" "$KEEP_GLOBALS"

# ── 7. photos deleted on the box leave the bucket ORPHAN_DAYS later ──────────
# Orphan = in the public part of the bucket, not on the volume. The state file remembers the
# night each one first went missing; only those missing for ORPHAN_DAYS are deleted. Re-uploaded
# or restored in the meantime → no longer an orphan → dropped from the state, nothing deleted.
# A failed delete leaves them orphaned with their original stamp, so the next night retries.
# ⚠️ Losing the state file (a new box) only restarts the clock: every orphan waits 14 more days.
# ⛔ Count-capped (MAX_EXPIRE, its own knob): more than that due at once is not housekeeping, it
# is something for a person to look at, so nothing is deleted and the run fails.
rclone lsf -R --files-only --fast-list "${PUBLIC[@]}" "$DEST" > "$REMOTE_LIST" \
  || fail "listing the public part of the bucket (rclone exit $?)"
{ find "$SRC" -type f -printf '%P\n' 2>/dev/null || true; } \
  | { grep -E "$PUBLIC_RE" || true; } > "$LOCAL_LIST"
cutoff=$(date -u -d "-$ORPHAN_DAYS days" +%Y%m%dT%H%M%SZ)
had_orphan_state=no; [ -f "$ORPHANS" ] && had_orphan_state=yes
read -r n_orphans n_due n_new < <(python3 - "$REMOTE_LIST" "$LOCAL_LIST" "$ORPHANS" "$STAMP" "$cutoff" "$DUE" <<'PY'
import os, sys
remote_f, local_f, state_f, stamp, cutoff, due_f = sys.argv[1:7]
def paths(f):
    with open(f, encoding="utf-8") as fh:
        return {line.rstrip("\n") for line in fh if line.strip()}
orphans = paths(remote_f) - paths(local_f)
old = {}
if os.path.exists(state_f):
    with open(state_f, encoding="utf-8") as fh:
        for line in fh:
            path, _, first = line.rstrip("\n").partition("\t")
            if path and first:
                old[path] = first
state = {p: old.get(p, stamp) for p in orphans}
due = sorted(p for p, first in state.items() if first < cutoff)
with open(state_f + ".tmp", "w", encoding="utf-8") as fh:
    fh.writelines(f"{p}\t{state[p]}\n" for p in sorted(state))
os.replace(state_f + ".tmp", state_f)
with open(due_f, "w", encoding="utf-8") as fh:
    fh.writelines(p + "\n" for p in due)
print(len(orphans), len(due), sum(1 for first in state.values() if first == stamp))
PY
) || fail "orphan bookkeeping"
echo "orphans: $n_orphans deleted on the box but kept in the bucket ($n_new new tonight); $n_due past $ORPHAN_DAYS days"
# ⛔ A MASS DELETION IS ESCALATED THE NIGHT IT HAPPENS, not 14 days later when its photos expire
# off-box. Between the 10% floor (~55k files) and the expiry cap (10k) there was no alarm at all, so
# a bug deleting 8,000 photos would expire silently. The orphans are already recorded and nothing
# is deleted tonight, so this fails the run (deferred, §8) while leaving 14 days to act.
# Measured 2026-09-23: ZERO storage deletions in the previous 30 days, so this fires on bulk
# operations (an import rollback) — exactly when a person should confirm it was meant.
# ⚠️ Not on a box's first run: with no orphan state yet, every existing orphan looks "new".
MAX_NEW_ORPHANS="${ENO_STORAGE_MAX_NEW_ORPHANS:-1000}"
if [ "$had_orphan_state" = yes ] && [ "$n_new" -gt "$MAX_NEW_ORPHANS" ]; then
  defer "$n_new photos were deleted on the box since last night (alarm at $MAX_NEW_ORPHANS) — they expire off-box in $ORPHAN_DAYS days; restore them before then if unintended"
fi
# ⛔ THE ORPHAN LIST GOES OFF-BOX TOO. It is the only record of which photos in the bucket were
# DELETED rather than simply newer than a manifest — without it a restore can only guess, and
# guessing by manifest membership dropped every photo uploaded after the chosen night.
gzip -c "$ORPHANS" | rclone rcat "$(join "$CRYPT_BASE" storage-state)/orphans-$STAMP.tsv.gz" \
  || fail "orphan state upload (rclone exit $?)"
if [ "$n_due" -gt "$MAX_EXPIRE" ]; then
  fail "$n_due orphans due for deletion exceeds ENO_STORAGE_MAX_EXPIRE=$MAX_EXPIRE — nothing deleted. If that bulk delete was intended, run once by hand: ENO_STORAGE_MAX_EXPIRE=$n_due $0"
elif [ "$n_due" -gt 0 ]; then
  rclone delete "$DEST" --files-from "$DUE" || fail "deleting $n_due expired orphans (rclone exit $?)"
  echo "deleted $n_due orphans older than $ORPHAN_DAYS days"
fi

# ── 8. done ──────────────────────────────────────────────────────────────────
# ⚠️ THE BASELINES MOVE ONLY ON A FULLY GOOD NIGHT. Recording tonight's counts before the deferred
# verdict let a failed night (a bulk delete, a capped erasure) become the next night's floor.
[ -z "$DEFERRED" ] || fail "$DEFERRED (everything else in this run completed)"
echo "$now_count" > "$COUNT_FILE"
# A deliberate large erasure (ENO_STORAGE_ALLOW_PRIVATE_SHRINK=1) restarts the week's history here,
# after the run proved good — not up front, where a mistaken override would destroy the evidence.
if [ "${ENO_STORAGE_ALLOW_PRIVATE_SHRINK:-0}" = 1 ]; then rm -f "$PRIVATE_HISTORY"; fi
{ [ -f "$PRIVATE_HISTORY" ] && tail -n 30 "$PRIVATE_HISTORY"; echo "$STAMP $private_count"; } > "$PRIVATE_HISTORY.tmp" \
  && mv "$PRIVATE_HISTORY.tmp" "$PRIVATE_HISTORY"
date -u +%FT%TZ > "$OK_FILE"
rm -f "$MARKER"
echo "ok $STAMP  files=$now_count  manifest=$m_total  orphans=$n_orphans  globals=$globals (encrypted)"
