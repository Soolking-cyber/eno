#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · restore the Supabase Storage volume from the off-box copy — INTO A STAGING DIR
#
#   eno-storage-restore.sh <staging-dir> [--prefix <path under the volume>] [--manifest <name>]
#
#   e.g. a whole-volume restore:
#     eno-storage-restore.sh /opt/eno/supabase/volumes/storage.restore
#   e.g. one listing's photos, to prove the backup round-trips:
#     eno-storage-restore.sh /opt/eno/restore-test --prefix stub/stub/listings/1787901983738-hp11bz-hdecececc96b2a199.webp
#
# Counterpart of eno-storage-backup.sh. Bytes come back with rclone; content-type and
# cache-control come back from the xattr manifest, because the bucket cannot hold them (see the
# backup script). A restored file WITHOUT user.supabase.content-type is served as a 500, so this
# script fails if any file in the restored scope lacks one.
#
# ⛔ IT NEVER TOUCHES THE LIVE VOLUME. It refuses a staging dir that is, or is inside, the live
# volume, and a staging dir that is not empty. The swap is printed, for a human to run, because
# it needs the storage container stopped and is the one step that cannot be undone by re-running.
#
# ⚠️ WHAT GETS DROPPED. The public half of the bucket is a superset: a listing photo deleted on the
# box stays there for 14 days (backup script §7). The backup uploads the list of those orphans every
# night, and a restore drops EXACTLY those — never "whatever a manifest does not list", which would
# also drop every photo uploaded after that manifest. `--manifest <older>` narrows the drop: orphans
# that older manifest lists come back, i.e. it UNDOES the deletions made since that night while
# keeping everything uploaded since. The private half is a mirror of last night: never dropped.
# xattrs come from the newest clean manifest, overlaid by --manifest; a file neither covers gets a
# content-type inferred from its object name, and is reported.
set -euo pipefail

LIVE=/opt/eno/supabase/volumes/storage
# The caller's ENO_BACKUP_REMOTE wins (a rehearsal against a scratch prefix must never be
# silently re-aimed at the real bucket); the box default fills it only when unset.
# (ENO_BACKUP_DEFAULTS=/dev/null seals a rehearsal off from the real remotes — see the backup script.)
DEFAULTS="${ENO_BACKUP_DEFAULTS:-/etc/default/eno-backup}"
for v in ENO_BACKUP_REMOTE ENO_BACKUP_CRYPT_REMOTE; do
  if [ -z "${!v:-}" ] && [ -f "$DEFAULTS" ]; then
    printf -v "$v" '%s' "$(. "$DEFAULTS"; printf '%s' "${!v:-}")"
  fi
done
[ -n "${ENO_BACKUP_REMOTE:-}" ] || { echo "ENO_BACKUP_REMOTE unset (see /etc/default/eno-backup)" >&2; exit 1; }
# ⛔ The manifest, the roles dump and the private buckets are ENCRYPTED; restoring them needs the
# crypt remote, whose key is in rclone.conf — or, after losing the box, in ~/eno-vault as
# `eno-offsite-crypt` (paste that section into the new box's rclone.conf).
[ -n "${ENO_BACKUP_CRYPT_REMOTE:-}" ] || { echo "ENO_BACKUP_CRYPT_REMOTE unset — the key is escrowed in ~/eno-vault as eno-offsite-crypt" >&2; exit 1; }
REMOTE_BASE="${ENO_BACKUP_REMOTE%/}"
join() { case "$1" in *:) printf '%s%s' "$1" "$2" ;; *) printf '%s/%s' "${1%/}" "$2" ;; esac; }
CRYPT_BASE="$ENO_BACKUP_CRYPT_REMOTE"
MANIFESTS=$(join "$CRYPT_BASE" storage-xattrs)

STAGING="${1:-}"; shift || true
PREFIX=''; MANIFEST=''
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)   PREFIX="${2:?--prefix needs a path}"; shift 2 ;;
    --manifest) MANIFEST="${2:?--manifest needs a name}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$STAGING" ] || { sed -n '4,10p' "$0" >&2; exit 2; }
PREFIX="${PREFIX#/}"; PREFIX="${PREFIX%/}"
case "/$PREFIX/" in */../*|*/./*) echo "prefix must not contain . or .. segments" >&2; exit 2 ;; esac

mkdir -p "$STAGING"
STAGING=$(cd "$STAGING" && pwd -P)
live_real=$(cd "$LIVE" 2>/dev/null && pwd -P || echo "$LIVE")
case "$STAGING/" in "$live_real"/*) echo "refusing: $STAGING is the live volume or inside it" >&2; exit 1 ;; esac
[ -z "$(ls -A "$STAGING")" ] || { echo "refusing: $STAGING is not empty" >&2; exit 1; }

CLEAN_RE='^xattrs-[0-9]{8}T[0-9]{6}Z\.jsonl\.gz$'
# ⚠️ An outage must read as an outage, not as a wrong key (see the backup script).
manifest_list=$(rclone lsf "$MANIFESTS" 2>&1) \
  || { echo "cannot reach the crypt remote (outage? config?): $(printf '%s' "$manifest_list" | tail -n 3)" >&2; exit 1; }
NEWEST=$(printf '%s\n' "$manifest_list" | grep -E "$CLEAN_RE" | sort | tail -n 1 || true)
# Only suspect manifests exist (every recent scan failed): the one named with --manifest must serve.
[ -n "$NEWEST" ] || NEWEST="$MANIFEST"
[ -n "$NEWEST" ] || { echo "no clean xattr manifest in $MANIFESTS (wrong key? a crypt remote with the wrong password lists nothing) — name one with --manifest" >&2; exit 1; }
STATES=$(join "$CRYPT_BASE" storage-state)
ORPHAN_STATE=$(rclone lsf "$STATES" 2>/dev/null | grep -E '^orphans-[0-9]{8}T[0-9]{6}Z\.tsv\.gz$' | sort | tail -n 1 || true)
TMP_NEWEST=$(mktemp --suffix=.jsonl.gz); TMP_CHOSEN=$(mktemp --suffix=.jsonl.gz); TMP_ORPHANS=$(mktemp)
trap 'rm -f "$TMP_NEWEST" "$TMP_CHOSEN" "$TMP_ORPHANS"' EXIT
rclone copyto "$MANIFESTS/$NEWEST" "$TMP_NEWEST"
if [ -n "$MANIFEST" ]; then rclone copyto "$MANIFESTS/$MANIFEST" "$TMP_CHOSEN"; else cp "$TMP_NEWEST" "$TMP_CHOSEN"; fi
if [ -n "$ORPHAN_STATE" ]; then
  rclone cat "$STATES/$ORPHAN_STATE" | gzip -dc > "$TMP_ORPHANS"
else
  echo "WARNING: no orphan list in $STATES — deleted photos still in the bucket will be restored too"
fi
echo "xattrs: $NEWEST${MANIFEST:+ + $MANIFEST}  ·  orphans: ${ORPHAN_STATE:-none}"

# ── room first ──
# ⛔ A RESTORE NEEDS ~ITS SOURCE'S SIZE FREE ON THE STAGING FILESYSTEM, and the README puts staging
# beside the live volume on the ROOT fs — filling it mid-incident would take Postgres and both
# editions down on top of whatever is being restored. Checked for EVERY restore (a prefix such as
# stub/stub/listings is nearly the whole volume), before a byte is copied; refuses without 10%.
need_bytes() { rclone size --json "$1" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("bytes", 0))' 2>/dev/null || echo 0; }
check_room() {  # <bytes needed>
  local free; free=$(df --output=avail -B1 "$STAGING" | tail -n 1 | tr -d ' ')
  if [ "$free" -lt $(( $1 + $1 / 10 )) ]; then
    echo "refusing: this restore is $(( $1 / 1024 / 1024 )) MiB and $STAGING has only $(( free / 1024 / 1024 )) MiB free (need +10%)" >&2
    exit 1
  fi
}

# ── bytes ──
# Two halves: public media plain under storage/, private buckets encrypted under the crypt remote.
# A prefix inside one half restores from that half only; no prefix restores both.
# ⛔ ON S3, rclone CALLS EVERY MISSING PATH AN EMPTY DIRECTORY (measured 2026-09-23, rclone 1.60):
# `lsjson --stat` exits 0 with IsDir, and `lsf` exits 0 with no output. So "exists" means: it is a
# file, or it lists at least one entry. (`head -n 1` stops the listing after the first page.)
exists_in() {
  rclone lsjson --stat "$1" 2>/dev/null | grep -q '"IsDir": *false' && return 0
  [ -n "$(rclone lsf "$1" 2>/dev/null | head -n 1)" ]
}
restore_from() {  # <remote root>
  local src dst
  src="$1${PREFIX:+/$PREFIX}"
  dst="$STAGING${PREFIX:+/$PREFIX}"
  check_room "$(need_bytes "$src")"
  echo "copying $src → $dst"
  # ⚠️ A prefix can name one FILE (…/<object>/<version-uuid>) as well as a directory. `rclone copy`
  # of a file into "$dst" would nest it as $dst/<name> — so a file goes through copyto instead.
  # `lsjson --stat` asks about the prefix itself — listing its parent would walk all 555k objects.
  if [ -n "$PREFIX" ] && rclone lsjson --stat "$src" 2>/dev/null | grep -q '"IsDir": *false'; then
    mkdir -p "${dst%/*}"
    rclone copyto "$src" "$dst"
  else
    rclone copy "$src" "$dst" --transfers 8 --checkers 16 --fast-list --stats 5m --stats-one-line --stats-log-level NOTICE
  fi
}
# ⚠️ ROUTED BY WHAT THE BUCKET HOLDS, NOT BY A COPY OF THE BACKUP'S BUCKET LIST. The backup derives
# its public/private split from one list; restating it here meant a bucket added there would route
# here to the wrong half and "restore nothing". A prefix that exists in the plain half is public;
# otherwise it is private. A prefix ABOVE the buckets ("stub", "stub/stub") spans both.
if [ -z "$PREFIX" ] || case "stub/stub/" in "$PREFIX"/*) true ;; *) false ;; esac; then
  restore_from "$REMOTE_BASE/storage"
  restore_from "$(join "$CRYPT_BASE" storage)"
elif exists_in "$REMOTE_BASE/storage/$PREFIX"; then
  restore_from "$REMOTE_BASE/storage"
elif exists_in "$(join "$CRYPT_BASE" storage)/$PREFIX"; then
  restore_from "$(join "$CRYPT_BASE" storage)"
else
  echo "--prefix $PREFIX is in neither half of the backup (a typo, or a photo that already expired off-box)" >&2
  exit 1
fi

# ── xattrs, then prove every restored file has a content-type ──
python3 - "$STAGING" "$TMP_NEWEST" "$TMP_CHOSEN" "$TMP_ORPHANS" "$PREFIX" <<'PY'
import base64, gzip, json, mimetypes, os, sys
staging, newest_f, chosen_f, orphans_f, prefix = sys.argv[1:6]
CT = "user.supabase.content-type"
scope = os.path.join(staging, prefix) if prefix else staging
def files_in(scope):
    if os.path.isfile(scope):  # a prefix that names one file
        yield scope
        return
    for dirpath, _, filenames in os.walk(scope):
        for name in filenames:
            yield os.path.join(dirpath, name)
def load(path):
    out = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            rel = os.path.normpath(e["p"])
            if rel.startswith("..") or os.path.isabs(rel):
                sys.exit(f"manifest entry escapes the staging dir: {e['p']!r}")
            out[rel] = e["x"]
    return out
chosen = load(chosen_f)
listed = load(newest_f)
listed.update(chosen)  # the chosen night's xattrs win for the files it lists (they never change anyway)
with open(orphans_f, encoding="utf-8") as f:
    orphans = {line.split("\t", 1)[0] for line in f if line.strip()}
drop = orphans - set(chosen)  # --manifest <older> brings back what was deleted since that night
dropped = applied = inferred_n = 0
inferred = []
for p in list(files_in(scope)):
    rel = os.path.relpath(p, staging)
    if rel in drop:  # the orphan list only ever holds public-half paths
        os.remove(p)
        dropped += 1
        # …and the <object>/ directory it leaves empty, up to (never including) the scope root.
        d = os.path.dirname(p)
        while d != scope and d.startswith(staging + os.sep) and not os.listdir(d):
            os.rmdir(d)
            d = os.path.dirname(d)
        continue
    attrs = listed.get(rel)
    if attrs is None:
        # In the bucket, in no manifest: uploaded after the last clean one. Its object name
        # (<name>.<ext>/<version>) still says what it is — better than a guaranteed 500.
        obj = os.path.basename(os.path.dirname(rel))
        # no-cache: what the live private buckets carry, and never wrong for a public file either.
        attrs = {CT: mimetypes.guess_type(obj)[0] or "application/octet-stream",
                 "user.supabase.cache-control": "no-cache"}
        inferred.append(rel)
    for k, v in attrs.items():
        os.setxattr(p, k, base64.b64decode(v["b64"]) if isinstance(v, dict) else v.encode("utf-8"))
    applied += 1
# ⚠️ TWO KINDS OF "NO CONTENT-TYPE", AND ONLY ONE IS A RESTORE FAILURE. A file the box ALREADY had
# no content-type for (the backup tolerates <1% of those, and they 500 live too) is restored exactly
# as it was. A file the manifests HAD a content-type for that still lacks one is a failed re-apply.
missing, preexisting, total = [], [], 0
for p in files_in(scope):
    total += 1
    rel = os.path.relpath(p, staging)
    try:
        os.getxattr(p, CT)
    except OSError:
        (missing if CT in listed.get(rel, {}) else preexisting).append(rel)
print(f"xattrs applied to {applied} files; dropped {dropped} photos deleted on the box")
if inferred:
    print(f"{len(inferred)} files were in no manifest — content-type inferred from the object name:")
    for m in inferred[:10]:
        print(f"  inferred: {m}")
print(f"restored files: {total}; without content-type: {len(preexisting)} as on the box, {len(missing)} lost in restore")
for m in preexisting[:10]:
    print(f"  no content-type on the box either (500s live, restored as-is): {m}")
for m in missing[:10]:
    print(f"  CONTENT-TYPE LOST IN RESTORE (would 500): {m}")
if total == 0:
    if dropped:
        sys.exit(f"everything in scope ({dropped} files) had been deleted on the box by last night — to undo that, pass --manifest with a manifest from before the deletion")
    sys.exit("nothing was restored")
if missing:
    sys.exit(f"{len(missing)} restored files lost the content-type the box had — do not swap this in")
PY

cat <<EOF

✅ Restored into $STAGING — the live volume is untouched.
To put it live (only for a WHOLE-volume restore, staging on the same filesystem as the volume).
Ownership: the live volume was root:root, files 644 (measured 2026-09-23), which is what this restore
writes; if the storage container ever runs as another user, chown the staging dir to match first.
The replaced volume is kept beside it — delete it once the site is verified, or the disk fills:
  cd /opt/eno/supabase && docker compose stop storage
  mv $LIVE $LIVE.replaced-\$(date -u +%Y%m%dT%H%M%SZ)
  mv $STAGING $LIVE
  docker compose start storage
  curl -sI https://sb.eno.vn/storage/v1/object/public/listings/<a known object>   # expect 200 + its content-type
EOF
