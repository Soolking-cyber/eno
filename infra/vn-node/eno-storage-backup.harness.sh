#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · OFFLINE harness for eno-storage-backup.sh — no box, no bucket, no network.
#
# Runs the real script against a scratch volume and two LOCAL-backend remotes (a plain directory and
# an rclone crypt remote over another directory) inside a throwaway container with the box's rclone
# (Ubuntu 24.04 ships the same v1.60.1-DEV). From a Mac or any docker host:
#
#   docker run --rm --network none -v "$PWD/infra/vn-node:/s:ro" eno-rclone-harness bash /s/eno-storage-backup.harness.sh
#   (image: FROM ubuntu:24.04 + apt-get install rclone python3 util-linux coreutils findutils gzip attr)
#
# ⛔ SEALED: --network none, RCLONE_CONFIG points at an empty file, ENO_BACKUP_DEFAULTS=/dev/null.
# Nothing here can reach Bizfly even if a variable is left unset. It refuses to run outside a container.
# What it proves: the streamed path+size comparison uploads new and changed files, skips everything
# already in the bucket (untouched — same mtime), finds a file an mtime-based incremental pass would
# miss, survives a file deleted between listing and upload, a stalled rclone call fails ITS step fast,
# and steps 3-8 (manifest, roles, samples, retention, orphans, floors) still behave.
# The on-box, real-bucket rehearsal remains eno-storage-rehearsal.sh.
set -u
[ -f /.dockerenv ] || { echo "run me inside the container (see header)"; exit 2; }
S=${HARNESS_SCRIPT:-/s/eno-storage-backup.sh}
H=$(mktemp -d /tmp/eno-harness.XXXXXX); mkdir -p $H/state $H/remote
: > $H/rclone.conf
export RCLONE_CONFIG=$H/rclone.conf ENO_BACKUP_DEFAULTS=/dev/null
export ENO_STORAGE_SRC=$H/vol ENO_STORAGE_STATE=$H/state ENO_STORAGE_LOCK=$H/lock
R=$H/remote/plain; export ENO_BACKUP_REMOTE=$R
export RCLONE_CONFIG_HCRYPT_TYPE=crypt RCLONE_CONFIG_HCRYPT_REMOTE=$H/remote/crypt
export RCLONE_CONFIG_HCRYPT_PASSWORD=$(rclone obscure "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')")
export RCLONE_CONFIG_HCRYPT_PASSWORD2=$(rclone obscure "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')")
export ENO_BACKUP_CRYPT_REMOTE=hcrypt:
echo 'eno key canary v1' | rclone rcat hcrypt:.key-canary
V=$H/vol/stub/stub
setct() { setfattr -n user.supabase.content-type -v "$2" "$1"; setfattr -n user.supabase.cache-control -v max-age=3600 "$1"; }
mk() { mkdir -p "$(dirname "$V/$1")"; head -c "$3" /dev/urandom > "$V/$1"; setct "$V/$1" "$2"; }
for i in $(seq 1 300); do mk listings/p$i.webp/v$i image/webp $((1000 + i)); done
mk listing-videos/vid.mp4/v1 video/mp4 9000
for i in $(seq 1 30); do mk business-verification/b$i/d.jpg/v$i image/jpeg 500; done
mk visa-documents/app/passport.jpg/v1 image/jpeg 3000
mk visa-documents/app/listings/nested.jpg/v1 image/jpeg 2000   # "listings" deeper in a PRIVATE path
echo roles | gzip > $H/state/globals-20260930T181525Z.sql.gz
PASSED=0; FAILED=0
ok() { if [ "$1" = "$2" ]; then echo "  PASS $3"; PASSED=$((PASSED+1)); else echo "  FAIL $3 (got '$1', want '$2')"; FAILED=$((FAILED+1)); fi; }
upl() { grep -o '[0-9]* to upload' "$1" | cut -d' ' -f1; }
plainn() { find $R/storage -type f | wc -l; }
mt() { stat -c %Y "$R/storage/stub/stub/$1"; }

echo "== night 1: empty bucket (the 'directory not found' path) → everything goes up"
bash $S > $H/n1.log 2>&1; ok $? 0 "exit"; tail -1 $H/n1.log
ok "$(upl $H/n1.log)" 301 "all 301 public files listed as to-upload"
ok "$(plainn)" 301 "all 301 public files in the plain half"
ok "$(rclone lsf -R --files-only hcrypt:storage | wc -l)" 32 "32 private files in the crypt half"
ok "$(rclone lsf -R --files-only hcrypt:storage | grep -c 'visa-documents/app/listings/nested.jpg')" 1 "a private path containing /listings/ is encrypted…"
ok "$(find $R -type f | grep -ciE 'passport|visa|business|nested')" 0 "…and no private name is in the clear"
ok "$(grep -c 'xattr manifest: 333 files, all with a content-type' $H/n1.log)" 1 "§3 manifest built"
ok "$(rclone lsf hcrypt:storage-xattrs | wc -l)" 1 "§3 manifest uploaded"
ok "$(rclone lsf hcrypt:globals)" "globals-20260930T181525Z.sql.gz" "§4 roles uploaded"
ok "$(grep -c 'sample check (public): 20 random files match' $H/n1.log)" 1 "§5 public sample"
ok "$(grep -c 'sample check (private): 20 random files match' $H/n1.log)" 1 "§5 private sample"
ok "$(grep -c '^orphans: 0 deleted' $H/n1.log)" 1 "§7 no orphans"
ok "$(test -f $H/state/.last-storage-ok && echo y)" y "§8 marked ok"

echo "== night 2: nothing changed → nothing uploaded, nothing touched"
before=$(mt listings/p1.webp/v1); sleep 1.1
bash $S > $H/n2.log 2>&1; ok $? 0 "exit"
ok "$(upl $H/n2.log)" 0 "0 to upload"
ok "$(mt listings/p1.webp/v1)" "$before" "existing object not rewritten"

echo "== night 3: new photo, a photo restored with an OLD mtime and missing off-box, a short remote copy"
mk listings/new.webp/vn image/webp 4321
touch -d '2020-01-01' $V/listings/p2.webp/v2; rm $R/storage/stub/stub/listings/p2.webp/v2
head -c 10 /dev/urandom > $R/storage/stub/stub/listings/p3.webp/v3
before=$(mt listings/p4.webp/v4); sleep 1.1
bash $S > $H/n3.log 2>&1; ok $? 0 "exit"
ok "$(upl $H/n3.log)" 3 "exactly 3 to upload"
ok "$(cmp -s $V/listings/new.webp/vn $R/storage/stub/stub/listings/new.webp/vn && echo same)" same "new photo uploaded"
ok "$(cmp -s $V/listings/p2.webp/v2 $R/storage/stub/stub/listings/p2.webp/v2 && echo same)" same "old-mtime file missing off-box uploaded (a --max-age pass would skip it)"
ok "$(cmp -s $V/listings/p3.webp/v3 $R/storage/stub/stub/listings/p3.webp/v3 && echo same)" same "size-mismatched remote copy replaced"
ok "$(mt listings/p4.webp/v4)" "$before" "untouched objects still untouched"

echo "== rclone 1.60.1: a --files-from entry deleted before the upload is skipped, not an error"
mkdir -p $H/race/a; echo x > $H/race/a/here; printf 'a/here\na/gone\n' > $H/race/list
rclone copy $H/race $H/race-dst --files-from-raw $H/race/list --no-check-dest > $H/race.log 2>&1; ok $? 0 "exit 0"
ok "$(find $H/race-dst -type f | wc -l)" 1 "the present file copied"

echo "== rclone 1.60.1 refuses --filter beside --files-from (why the script re-checks its list itself)"
printf 'stub/stub/listings/p1.webp/v1\n' > $H/mixed
rclone copy $H/vol $H/filt-dst --files-from-raw $H/mixed --no-check-dest --filter '- **' > $H/filt.log 2>&1; ok $? 1 "rclone refuses the combination"

echo "== a photo deleted on the box: orphan kept, then expired after 14 days (§7)"
rm -rf $V/listings/p5.webp
bash $S > $H/n4.log 2>&1; ok $? 0 "exit"; grep '^orphans:' $H/n4.log
ok "$(cut -f1 $H/state/.storage-orphans.tsv)" "stub/stub/listings/p5.webp/v5" "tracked as orphan"
ok "$(test -f $R/storage/stub/stub/listings/p5.webp/v5 && echo kept)" kept "still in the bucket"
ok "$(upl $H/n4.log)" 0 "an orphan is not re-uploaded"
sed -i 's/\t.*/\t20200101T000000Z/' $H/state/.storage-orphans.tsv
bash $S > $H/n5.log 2>&1; ok $? 0 "exit"; grep deleted $H/n5.log
ok "$(test -f $R/storage/stub/stub/listings/p5.webp/v5 && echo kept || echo gone)" gone "expired orphan deleted off-box"
ok "$(plainn)" 301 "nothing else deleted"

echo "== §7 mass-deletion alarm still fires (orphan list now comes from the streamed listing)"
rm -rf $V/listings/p1[0-9].webp
ENO_STORAGE_MAX_NEW_ORPHANS=5 bash $S > $H/n6.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'FAILED: .*photos were deleted on the box since last night' $H/n6.log)" 1 "alarm names the deletion"
ok "$(plainn)" 301 "nothing deleted off-box"
bash $S > /dev/null 2>&1; ok $? 0 "next night quiet"

echo "== §6 retention: a 2020 manifest is pruned"
echo x | gzip | rclone rcat hcrypt:storage-xattrs/xattrs-20200101T000000Z.jsonl.gz
bash $S > $H/n7.log 2>&1; ok $? 0 "exit"
ok "$(rclone lsf hcrypt:storage-xattrs | grep -c 20200101)" 0 "old manifest pruned"

echo "== §1 floors still refuse"
mv $V/listings $H/aside; bash $S > $H/n8.log 2>&1; ok $? 1 "store collapse refused"; mv $H/aside $V/listings
ok "$(grep -c 'store shrank' $H/n8.log)" 1 "…with the floor message"
mv $V/business-verification $H/bv; bash $S > $H/n9.log 2>&1; ok $? 1 "private collapse refused"; mv $H/bv $V/business-verification
ok "$(rclone lsf -R --files-only hcrypt:storage | wc -l)" 32 "private copies not erased"

echo "== a STALLED rclone call fails its own step, fast, by name"
# The shims below `exec $(command -v …)`: that expands WHILE THE SHIM IS WRITTEN (unquoted heredoc),
# before the shim's directory is on PATH, so it bakes in /usr/bin/… — the shims do not call themselves.
mkdir -p $H/bin; cat > $H/bin/rclone <<EOF
#!/bin/bash
[ -e /proc/self/fd/9 ] && echo inherited >> $H/fd9
case "\$*" in *"--format ps"*) sleep 600 ;; esac
exec $(command -v rclone) "\$@"
EOF
chmod +x $H/bin/rclone
t0=$(date +%s); PATH=$H/bin:$PATH ENO_STORAGE_LIST_TIMEOUT=3s bash $S > $H/n10.log 2>&1; rc=$?; t1=$(date +%s)
ok "$rc" 1 "exit 1"; ok "$([ $((t1 - t0)) -lt 60 ] && echo fast)" fast "failed in $((t1 - t0))s, not at the unit timeout"
ok "$(grep -c 'rclone lsf: still running after 3s' $H/n10.log)" 1 "names the stalled call"
ok "$(grep -c 'STORAGE BACKUP FAILED: listing the public part of the bucket' $H/n10.log)" 1 "marker names the step"
ok "$(grep -c 'listing the public part' $H/state/.last-storage-failure)" 1 "failure marker written"
ok "$(test -f $H/fd9 && echo inherited || echo closed)" closed "rclone does not inherit the run lock (fd 9)"
bash $S > /dev/null 2>&1; ok $? 0 "next normal night succeeds and clears it"
ok "$(test -f $H/state/.last-storage-failure && echo left || echo cleared)" cleared "marker cleared"

echo "== an upload that silently skips a file is caught by the post-upload listing"
mkdir -p $H/skiprc; cat > $H/skiprc/rclone <<EOF
#!/bin/bash
case "\$*" in *"--files-from-raw"*) exit 0 ;; esac   # pretends to upload, uploads nothing
exec $(command -v rclone) "\$@"
EOF
chmod +x $H/skiprc/rclone
mk listings/skipped.webp/vs image/webp 777
PATH=$H/skiprc:$PATH bash $S > $H/n17.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'FAILED: 1 of tonight.s 1 public uploads are still not in the bucket at their size' $H/n17.log)" 1 "named"
bash $S > /dev/null 2>&1; ok $? 0 "a real upload next night clears it"
mkdir -p $H/shortrc; cat > $H/shortrc/rclone <<EOF
#!/bin/bash
case "\$*" in *"--files-from-raw"*) while read -r f; do mkdir -p "$R/storage/\$(dirname "\$f")"; head -c 3 /dev/zero > "$R/storage/\$f"; done < "\${@: -2:1}"; exit 0 ;; esac
exec $(command -v rclone) "\$@"
EOF
chmod +x $H/shortrc/rclone
mk listings/short.webp/vs image/webp 999
PATH=$H/shortrc:$PATH bash $S > $H/n18.log 2>&1; ok $? 1 "an upload that lands at the WRONG size fails"
ok "$(grep -c 'FAILED: .*still not in the bucket at their size (e.g. stub/stub/listings/short.webp/vs)' $H/n18.log)" 1 "…naming it"
bash $S > /dev/null 2>&1; ok $? 0 "next real night fixes it"
ok "$(cmp -s $V/listings/short.webp/vs $R/storage/stub/stub/listings/short.webp/vs && echo same)" same "…with the right bytes"

echo "== the run BUDGET caps a call's own limit"
t0=$(date +%s); PATH=$H/bin:$PATH ENO_STORAGE_BUDGET_TIMEOUT=185s bash $S > $H/n11.log 2>&1; rc=$?; t1=$(date +%s)
ok "$rc" 1 "exit 1"; ok "$([ $((t1 - t0)) -lt 60 ] && echo fast)" fast "LIST is 90m but the 185s budget ended it in $((t1 - t0))s"
ok "$(grep -c 'rclone lsf: still running after [0-9]s' $H/n11.log)" 1 "named as a stall at the capped limit"
ENO_STORAGE_BUDGET_TIMEOUT=5x bash $S > $H/n12.log 2>&1; ok $? 1 "a malformed duration is refused"
ok "$(grep -c "ENO_STORAGE_BUDGET_TIMEOUT='5x' is not a duration" $H/n12.log)" 1 "…by name"

echo "== an rclone SIGKILLed early (OOM) is NOT reported as a stall"
mkdir -p $H/oom; cat > $H/oom/rclone <<EOF
#!/bin/bash
case "\$*" in *"--format ps"*) kill -9 \$\$ ;; esac
exec $(command -v rclone) "\$@"
EOF
chmod +x $H/oom/rclone
PATH=$H/oom:$PATH bash $S > $H/n13.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'SIGKILLed after [0-9]*s, before its deadline' $H/n13.log)" 1 "labelled as a kill from outside"
ok "$(grep -c 'still running after' $H/n13.log)" 0 "…not as a stall"

echo "== find errors on the volume fail the night instead of dropping files"
mkdir -p $H/badfind; cat > $H/badfind/find <<EOF
#!/bin/bash
echo "find: '/h/vol/stub/stub/listings/p7.webp': Input/output error" >&2
exec $(command -v find) "\$@"
EOF
chmod +x $H/badfind/find
PATH=$H/badfind:$PATH bash $S > $H/n14.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'STORAGE BACKUP FAILED: walking the volume for the public half' $H/n14.log)" 1 "named"
mkdir -p $H/spewfind; cat > $H/spewfind/find <<EOF
#!/bin/bash
for i in \$(seq 1 2000); do echo "find: '/h/vol/stub/stub/listings/d\$i': Input/output error" >&2; done
exec $(command -v find) "\$@"
EOF
chmod +x $H/spewfind/find
PATH=$H/spewfind:$PATH bash $S > $H/n14b.log 2>&1; ok $? 1 "2,000 errors (the SIGPIPE case) still fail the night"
mkdir -p $H/hangfind; cat > $H/hangfind/find <<EOF
#!/bin/bash
case "\$*" in *"%s"*) sleep 600 ;; esac   # only the walk that decides the upload (§1's counts are not bounded)
exec $(command -v find) "\$@"
EOF
chmod +x $H/hangfind/find
t0=$(date +%s); PATH=$H/hangfind:$PATH ENO_STORAGE_LIST_TIMEOUT=3s bash $S > $H/n14c.log 2>&1; rc=$?; t1=$(date +%s)
ok "$rc" 1 "a hung volume walk fails"; ok "$([ $((t1 - t0)) -lt 60 ] && echo fast)" fast "…in $((t1 - t0))s"
ok "$(grep -c 'find: still running after 3s' $H/n14c.log)" 1 "…named as a stalled find"
mkdir -p $H/gonefind; cat > $H/gonefind/find <<EOF
#!/bin/bash
echo "find: '/h/vol/stub/stub/listings/zz': No such file or directory" >&2
exec $(command -v find) "\$@"
EOF
chmod +x $H/gonefind/find
PATH=$H/gonefind:$PATH bash $S > $H/n15.log 2>&1; ok $? 0 "a file vanishing mid-walk is NOT an error"

echo "== a FAILED upload is deferred: steps 3-8 still run, the night still fails"
mkdir -p $H/failrc; cat > $H/failrc/rclone <<EOF
#!/bin/bash
case "\$*" in *"--files-from-raw"*) exit 7 ;; esac
exec $(command -v rclone) "\$@"
EOF
chmod +x $H/failrc/rclone
mk listings/later.webp/vl image/webp 555
mb=$(rclone lsf hcrypt:storage-xattrs | wc -l)
PATH=$H/failrc:$PATH bash $S > $H/n21.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'FAILED: upload of 1 listings/listing-videos files stopped (rclone exit 7)' $H/n21.log)" 1 "named"
ok "$(grep -c '^orphans:' $H/n21.log)" 1 "§7 still ran"; ok "$(rclone lsf hcrypt:storage-xattrs | wc -l)" "$((mb + 1))" "§3 manifest still uploaded"
bash $S > /dev/null 2>&1; ok $? 0 "next night re-sends it"
ok "$(cmp -s $V/listings/later.webp/vl $R/storage/stub/stub/listings/later.webp/vl && echo same)" same "…and it is off-box"

echo "== a photo still being WRITTEN when §2 listed it is not a false alarm"
mkdir -p $H/growrc; cat > $H/growrc/rclone <<EOF
#!/bin/bash
# Supabase finishes writing the file after §2's walk, before the upload reads it.
case "\$*" in *"--files-from-raw"*) head -c 5000 /dev/urandom >> $V/listings/grow.webp/vg ;; esac
exec $(command -v rclone) "\$@"
EOF
chmod +x $H/growrc/rclone
mk listings/grow.webp/vg image/webp 100
PATH=$H/growrc:$PATH bash $S > $H/n20.log 2>&1; ok $? 0 "a file that grew mid-run: night stays green"
ok "$(cmp -s $V/listings/grow.webp/vg $R/storage/stub/stub/listings/grow.webp/vg && echo same)" same "…and the full file is off-box"

echo "== the VOLUME vanishing between §1 and the walk is not 'a file vanished'"
mkdir -p $H/rootgone; cat > $H/rootgone/find <<EOF
#!/bin/bash
case "\$*" in *"%s"*) mv $H/vol $H/vol.away; echo "find: '$H/vol': No such file or directory" >&2; exit 1 ;; esac
exec $(command -v find) "\$@"
EOF
chmod +x $H/rootgone/find
PATH=$H/rootgone:$PATH bash $S > $H/n19.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'the volume .* is gone' $H/n19.log)" 1 "named"; mv $H/vol.away $H/vol

echo "== a path with a TAB is refused, not mis-split"
T="$V/listings/ta"$'\t'"b.webp"
mkdir -p "$T"; head -c 100 /dev/urandom > "$T/v1"; setct "$T/v1" image/webp
bash $S > $H/n16.log 2>&1; ok $? 1 "exit 1"
ok "$(grep -c 'public path with a tab or newline' $H/n16.log)" 1 "named"
rm -rf "$T"
bash $S > /dev/null 2>&1; ok $? 0 "clean again"

echo "== seal: nothing outside the scratch dir was configured"
ok "$(rclone listremotes | sort | tr '\n' ' ')" "hcrypt: " "the only remote is the scratch crypt"
echo "SUMMARY: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
