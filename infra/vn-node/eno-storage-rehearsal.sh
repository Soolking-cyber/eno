#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · rehearsal for eno-storage-backup.sh + eno-storage-restore.sh — run ON THE BOX, as root:
#   bash /opt/eno/app/infra/vn-node/eno-storage-rehearsal.sh      (expects the two scripts in /root/)
#
# Builds a scratch volume under /opt/eno/rehearsal, a scratch prefix in the real bucket
# (eno-offsite:eno/_rehearsal-20260923) and a throwaway crypt key, then drives every guard: refusals
# (no crypt remote, a plain remote, a rotated key, an unreachable remote), orphan windows and expiry,
# restores (whole, older manifest, every prefix shape), tampering in either half, both floors, both
# delete caps, both orphan alarms, stale roles, suspect manifests, locking. Prints PASS/FAIL per check.
#
# ⛔ SEALED FROM PRODUCTION: ENO_BACKUP_DEFAULTS=/dev/null, so nothing can inherit the real remotes
# from /etc/default/eno-backup (on 2026-09-23 an unsealed version wrote four fake objects into the
# production crypt remote). The last check asserts the production bucket listing is unchanged.
# Copy the scripts under test to /root/ first:
#   cp /opt/eno/app/infra/vn-node/eno-storage-{backup,restore}.sh /root/
set -u
B=/opt/eno/rehearsal; rm -rf $B; mkdir -p $B/state
export ENO_BACKUP_DEFAULTS=/dev/null   # never inherit the real remotes
export ENO_STORAGE_SRC=$B/vol ENO_STORAGE_STATE=$B/state ENO_STORAGE_LOCK=$B/lock
R=eno-offsite:eno/_rehearsal-20260923
export ENO_BACKUP_REMOTE=$R
export RCLONE_CONFIG_REHEARSALCRYPT_TYPE=crypt RCLONE_CONFIG_REHEARSALCRYPT_REMOTE=$R/crypt
export RCLONE_CONFIG_REHEARSALCRYPT_PASSWORD=$(rclone obscure "$(openssl rand -hex 32)") RCLONE_CONFIG_REHEARSALCRYPT_PASSWORD2=$(rclone obscure "$(openssl rand -hex 32)")
export ENO_BACKUP_CRYPT_REMOTE=rehearsalcrypt:
# ⛔ HOLD THE PRODUCTION LOCK for the whole run: the nightly backup writes to the same bucket, and
# its legitimate writes would read as a seal breach in the final fingerprint. If it is running now,
# do not start (a nightly run that finds the lock held skips itself, exit 0).
exec 8>/run/eno-storage-backup.lock
flock -n 8 || { echo "the real storage backup is running — not rehearsing now"; exit 2; }
rclone purge $R 2>/dev/null
# ⛔ The production fingerprint: path + size + modtime of every object outside the scratch prefix, so
# an OVERWRITE shows too, not just a new name — and a listing that fails aborts rather than hashing
# empty output (two failed listings would otherwise "match").
# --files-only: rclone gives an S3 "directory" the time of the LISTING as its modtime (measured), so
# including directories makes two listings of an untouched bucket differ.
real_fingerprint() { local l; l=$(rclone lsf -R --files-only --format=pst eno-offsite:eno) || { echo "LISTING FAILED" >&2; return 1; }; printf '%s\n' "$l" | grep -v "^_rehearsal" | sort | md5sum; }
REAL_BEFORE=$(real_fingerprint) || { echo "cannot fingerprint the production bucket — not running"; exit 2; }
# Scratch state goes away however the run ends (Ctrl-C, set -u abort): never left in the real bucket.
trap 'rclone purge "$R" >/dev/null 2>&1; rm -rf "$B"' EXIT
V=$B/vol/stub/stub
setct() { python3 -c 'import os,sys; os.setxattr(sys.argv[1],"user.supabase.content-type",sys.argv[2].encode()); os.setxattr(sys.argv[1],"user.supabase.cache-control",b"max-age=3600")' "$1" "$2"; }
mk() { mkdir -p "$(dirname "$V/$1")"; head -c "$3" /dev/urandom > "$V/$1"; setct "$V/$1" "$2"; }
mk listings/obj1.webp/v1 image/webp 40000
mk listings/obj2.jpg/v2 image/jpeg 50000
mk listing-videos/vid.mp4/v3 video/mp4 90000
mk visa-documents/app/passport.jpg/v4 image/jpeg 30000
mk business-verification/p/id.jpg/v5 image/jpeg 20000
for i in $(seq 1 400); do mk listings/filler$i.webp/f$i image/webp 2000; done
for i in $(seq 1 30); do mk business-verification/bvfill$i/d.jpg/f$i image/jpeg 500; done   # a private half big enough for its floor
mkdir -p $V/listings/noct.png; head -c 1000 /dev/urandom > $V/listings/noct.png/v9   # no xattrs: 500s live
echo roles | gzip > $B/state/globals-20260922T181525Z.sql.gz
S=/root/eno-storage-backup.sh; RS=/root/eno-storage-restore.sh
PASSED=0; FAILED=0
ok()  { if [ "$1" = "$2" ]; then echo "  PASS $3"; PASSED=$((PASSED+1)); else echo "  FAIL $3 (got '$1', want '$2')"; FAILED=$((FAILED+1)); fi; }
plain() { rclone lsf -R --files-only $R/storage 2>/dev/null | grep -v -e filler -e noct | sort | tr '\n' ' '; }
priv()  { rclone lsf -R --files-only rehearsalcrypt:storage 2>/dev/null | grep -v bvfill | sort | tr '\n' ' '; }

echo "== guards: no crypt remote / a plain remote posing as one"
ENO_BACKUP_CRYPT_REMOTE= bash $S > $B/g1.log 2>&1; ok $? 1 "refuses with crypt remote unset"; grep -o "refusing.*" $B/g1.log
ENO_BACKUP_CRYPT_REMOTE=$R/crypt bash $S > $B/g2.log 2>&1; ok $? 1 "refuses a plain remote"; grep -o "is not an rclone crypt.*" $B/g2.log
ok "$(rclone lsf -R $R 2>/dev/null | wc -l)" 0 "nothing uploaded by a refused run"

echo 'eno key canary v1' | rclone rcat rehearsalcrypt:.key-canary
echo "== a crypt remote with a DIFFERENT key (same place) is refused"
export RCLONE_CONFIG_WRONGCRYPT_TYPE=crypt RCLONE_CONFIG_WRONGCRYPT_REMOTE=$R/crypt
export RCLONE_CONFIG_WRONGCRYPT_PASSWORD=$(rclone obscure "$(openssl rand -hex 32)") RCLONE_CONFIG_WRONGCRYPT_PASSWORD2=$(rclone obscure "$(openssl rand -hex 32)")
ENO_BACKUP_CRYPT_REMOTE=wrongcrypt: bash $S > $B/g3.log 2>&1; ok $? 1 "refuses a rotated key"; grep -o "does not show .key-canary.*" $B/g3.log
ok "$(rclone lsf -R --files-only $R | wc -l)" 1 "nothing uploaded by it (only the canary exists)"
echo "== an UNREACHABLE crypt remote reads as an outage, not as a wrong key"
export RCLONE_CONFIG_DEADS3_TYPE=s3 RCLONE_CONFIG_DEADS3_PROVIDER=Other RCLONE_CONFIG_DEADS3_ENDPOINT=http://127.0.0.1:9 RCLONE_CONFIG_DEADS3_ACCESS_KEY_ID=x RCLONE_CONFIG_DEADS3_SECRET_ACCESS_KEY=y
export RCLONE_CONFIG_DEADCRYPT_TYPE=crypt RCLONE_CONFIG_DEADCRYPT_REMOTE=deads3:nobucket RCLONE_CONFIG_DEADCRYPT_PASSWORD=$(rclone obscure x) RCLONE_CONFIG_DEADCRYPT_PASSWORD2=$(rclone obscure y)
ENO_BACKUP_CRYPT_REMOTE=deadcrypt: RCLONE_LOW_LEVEL_RETRIES=1 RCLONE_RETRIES=1 bash $S > $B/g4.log 2>&1; ok $? 1 "refuses"
ok "$(grep -c "cannot reach the crypt remote" $B/g4.log)" 1 "message says OUTAGE"; ok "$(grep -c "NOT the escrowed" $B/g4.log)" 0 "…and not wrong key"
echo "== run 1 (fresh)"; bash $S > $B/r1.log 2>&1; ok $? 0 "exit"; tail -1 $B/r1.log; grep WARNING $B/r1.log
ok "$(plain)" "stub/stub/listing-videos/vid.mp4/v3 stub/stub/listings/obj1.webp/v1 stub/stub/listings/obj2.jpg/v2 " "public media in the plain half"
ok "$(priv)" "stub/stub/business-verification/p/id.jpg/v5 stub/stub/visa-documents/app/passport.jpg/v4 " "private buckets in the crypt half"
ok "$(rclone lsf -R $R | grep -ciE 'passport|visa|business|globals|xattrs')" 0 "bucket shows NO private name in the clear"
ok "$(rclone lsf rehearsalcrypt:globals)" "globals-20260922T181525Z.sql.gz" "roles dump encrypted"
ok "$(rclone cat rehearsalcrypt:globals/globals-20260922T181525Z.sql.gz | zcat)" roles "roles dump decrypts"
M1=$(rclone lsf rehearsalcrypt:storage-xattrs | head -1); echo "  manifest1=$M1"
sleep 2
echo "== run 2 (a photo and a passport deleted on the box)"
rm -rf $V/listings/obj1.webp $V/visa-documents/app/passport.jpg
bash $S > $B/r2.log 2>&1; ok $? 0 "exit"; grep orphans: $B/r2.log
ok "$(plain)" "stub/stub/listing-videos/vid.mp4/v3 stub/stub/listings/obj1.webp/v1 stub/stub/listings/obj2.jpg/v2 " "photo kept (orphan)"
ok "$(priv)" "stub/stub/business-verification/p/id.jpg/v5 " "passport erased off-box at once"
ok "$(cut -f1 $B/state/.storage-orphans.tsv)" "stub/stub/listings/obj1.webp/v1" "photo tracked as orphan"

echo "== restore, newest manifest: deleted photo DROPPED, both halves back, xattrs back"
bash $RS $B/rs-new > $B/rs1.log 2>&1; ok $? 0 "exit"; grep -E "dropped|restored files" $B/rs1.log
ok "$(cd $B/rs-new && find . -type f | grep -v -e filler -e noct -e bvfill | sort | tr '\n' ' ')" "./stub/stub/business-verification/p/id.jpg/v5 ./stub/stub/listing-videos/vid.mp4/v3 ./stub/stub/listings/obj2.jpg/v2 " "exactly the live set"
ok "$(cmp -s $B/rs-new/stub/stub/business-verification/p/id.jpg/v5 $V/business-verification/p/id.jpg/v5; echo $?)" 0 "private bytes identical after decrypt"
ok "$(test -d $B/rs-new/stub/stub/listings/obj1.webp && echo left || echo gone)" gone "a dropped orphan leaves no empty object directory"
ok "$(python3 -c 'import os,sys;print(os.getxattr(sys.argv[1],"user.supabase.content-type").decode())' $B/rs-new/stub/stub/listings/obj2.jpg/v2)" image/jpeg "content-type restored"
echo "== restore, run-1 manifest: deleted photo BACK, erased passport NOT"
bash $RS $B/rs-old --manifest "$M1" > $B/rs2.log 2>&1; ok $? 0 "exit"
ok "$(test -f $B/rs-old/stub/stub/listings/obj1.webp/v1 && echo yes)" yes "deleted photo restorable from before"
ok "$(test -f $B/rs-old/stub/stub/visa-documents/app/passport.jpg/v4 && echo yes || echo no)" no "erased passport not resurrected"
echo "== prefix restores: public dir, public file, private dir, span-both"
bash $RS $B/p1 --prefix stub/stub/listings/obj2.jpg > /dev/null 2>&1; ok $? 0 "public dir exit"; ok "$(cd $B/p1 && find . -type f)" "./stub/stub/listings/obj2.jpg/v2" "public dir"
bash $RS $B/p2 --prefix stub/stub/listings/obj2.jpg/v2 > /dev/null 2>&1; ok $? 0 "public file exit"; ok "$(cd $B/p2 && find . -type f)" "./stub/stub/listings/obj2.jpg/v2" "public file not nested"
bash $RS $B/p3 --prefix stub/stub/business-verification > /dev/null 2>&1; ok $? 0 "private dir exit"; ok "$(cd $B/p3 && find . -type f | grep -v bvfill)" "./stub/stub/business-verification/p/id.jpg/v5" "private dir from crypt"
bash $RS $B/p7 --prefix stub/stub/business-verification/p/id.jpg/v5 > /dev/null 2>&1; ok $? 0 "private file exit"; ok "$(cd $B/p7 && find . -type f)" "./stub/stub/business-verification/p/id.jpg/v5" "private file not nested"
bash $RS $B/p4 --prefix stub > /dev/null 2>&1; ok $? 0 "span exit"; ok "$(cd $B/p4 && find . -type f | grep -v -e filler -e noct -e bvfill | wc -l)" 3 "prefix above buckets restores both halves"
echo "== restore without the key refuses"
ENO_BACKUP_CRYPT_REMOTE= bash $RS $B/nk > $B/rs5.log 2>&1; ok $? 1 "no key → refuses"; head -1 $B/rs5.log
echo "== a prefix in neither half says so"
bash $RS $B/p8 --prefix stub/stub/listings/nope.webp > $B/rs11.log 2>&1; ok $? 1 "exit"; ok "$(grep -c "in neither half" $B/rs11.log)" 1 "clear message"
echo "== restore refuses the live volume and a non-empty dir"
bash $RS /opt/eno/supabase/volumes/storage/x >/dev/null 2>&1; ok $? 1 "refuses inside live volume"
bash $RS $B/rs-new >/dev/null 2>&1; ok $? 1 "refuses non-empty staging"

echo "== run 2b: a NEW private document appears after run 1; restore with the OLD manifest keeps it"
mk business-verification/p2/new.jpg/v6 image/png 15000
mk listings/new.webp/v8 image/webp 12000      # a photo uploaded AFTER run 1
bash $S > $B/r2b.log 2>&1; ok $? 0 "exit"
bash $RS $B/rs-old2 --manifest "$M1" > $B/rs6.log 2>&1; ok $? 0 "exit"; grep -E "manifest:|dropped|kept" $B/rs6.log
ok "$(test -f $B/rs-old2/stub/stub/business-verification/p2/new.jpg/v6 && echo yes || echo no)" yes "private doc newer than the chosen manifest is KEPT"
ok "$(python3 -c 'import os,sys;print(os.getxattr(sys.argv[1],"user.supabase.content-type").decode())' $B/rs-old2/stub/stub/business-verification/p2/new.jpg/v6)" image/png "…with its content-type from the newest manifest"
ok "$(test -f $B/rs-old2/stub/stub/listings/obj1.webp/v1 && echo yes)" yes "old manifest brings back the photo deleted since"
ok "$(test -f $B/rs-old2/stub/stub/listings/new.webp/v8 && echo yes || echo no)" yes "…and KEEPS the photo uploaded since"
ok "$(test -f $B/rs-old2/stub/stub/visa-documents/app/passport.jpg/v4 && echo yes || echo no)" no "erased passport still not resurrected"
echo "== prefix = a whole public bucket goes to the plain half only"
bash $RS $B/p5 --prefix stub/stub/listings > $B/rs7.log 2>&1; ok $? 0 "exit"
ok "$(cd $B/p5 && find . -type f | grep -v -e filler -e noct -e bvfill | sort | tr '\n' ' ')" "./stub/stub/listings/new.webp/v8 ./stub/stub/listings/obj2.jpg/v2 " "listings prefix restores the live listings"
echo "== a public prefix + an OLDER manifest that predates the object still restores it"
bash $RS $B/p6 --manifest "$M1" --prefix stub/stub/listings/new.webp > $B/rs8.log 2>&1; ok $? 0 "exit"
ok "$(cd $B/p6 && find . -type f)" "./stub/stub/listings/new.webp/v8" "object newer than the manifest is not dropped"
echo "== manifest retention is by AGE"
echo x | gzip | rclone rcat rehearsalcrypt:storage-xattrs/xattrs-20200101T000000Z.jsonl.gz
before=$(rclone lsf rehearsalcrypt:storage-xattrs | wc -l)
echo "== run 3 (orphan aged past 14 days → deleted off-box)"
sed -i 's/\t.*/\t20200101T000000Z/' $B/state/.storage-orphans.tsv
bash $S > $B/r3.log 2>&1; ok $? 0 "exit"; grep -E "deleted" $B/r3.log
ok "$(plain)" "stub/stub/listing-videos/vid.mp4/v3 stub/stub/listings/new.webp/v8 stub/stub/listings/obj2.jpg/v2 " "expired orphan deleted"
ok "$(rclone lsf rehearsalcrypt:storage-xattrs | grep -c 20200101)" 0 "a manifest older than 16 days is pruned"
ok "$(rclone lsf rehearsalcrypt:storage-xattrs | wc -l)" "$before" "recent manifests all kept (old one out, tonight's in)"
echo "== run 4a (public object tampered, same size) → check must fail"
head -c 50000 /dev/urandom | rclone rcat $R/storage/stub/stub/listings/obj2.jpg/v2
ENO_STORAGE_SAMPLE=1000 bash $S > $B/r4.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r4.log
rclone copyto $V/listings/obj2.jpg/v2 $R/storage/stub/stub/listings/obj2.jpg/v2
echo "== run 4b (ENCRYPTED object tampered in the bucket) → cryptcheck must fail"
enc=$(rclone cryptdecode --reverse rehearsalcrypt: storage/stub/stub/business-verification/p/id.jpg/v5 | awk '{print $NF}')
sz=$(rclone size --json $R/crypt/$enc | python3 -c 'import json,sys;print(json.load(sys.stdin)["bytes"])')
head -c $sz /dev/urandom | rclone rcat $R/crypt/$enc
ENO_STORAGE_SAMPLE=1000 bash $S > $B/r4b.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r4b.log
rclone copyto $V/business-verification/p/id.jpg/v5 rehearsalcrypt:storage/stub/stub/business-verification/p/id.jpg/v5
echo "== the key canary's CONTENT damaged (name intact) → refuses with the read/decrypt message"
enc=$(rclone cryptdecode --reverse rehearsalcrypt: .key-canary | awk '{print $NF}')
rclone copyto $R/crypt/$enc $B/canary.bak
head -c 64 /dev/urandom | rclone rcat $R/crypt/$enc
bash $S > $B/rc.log 2>&1; ok $? 1 "exit"; ok "$(grep -c "cannot read the key canary\|decrypts to something else" $B/rc.log)" 1 "canary read/decrypt branch reached"
rclone copyto $B/canary.bak $R/crypt/$enc
echo "== run 5 (store collapsed) → floor must refuse"
mv $V/listings $B/listings.aside
bash $S > $B/r5.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r5.log
mv $B/listings.aside $V/listings
echo "== run 6 (orphan cap)"
rm -rf $V/listings/obj2.jpg $V/listing-videos/vid.mp4; bash $S >/dev/null 2>&1
sed -i 's/\t.*/\t20200101T000000Z/' $B/state/.storage-orphans.tsv
ENO_STORAGE_MAX_EXPIRE=1 bash $S > $B/r6.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r6.log
ok "$(plain | wc -w)" 3 "nothing deleted over the cap"
echo "== private half collapses (whole volume barely moves) → private floor must refuse"
mv $V/business-verification $B/bv.aside
bash $S > $B/r9.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r9.log
ok "$(rclone lsf -R --files-only rehearsalcrypt:storage | grep -c bvfill)" 30 "encrypted copies NOT erased"
mv $B/bv.aside $V/business-verification
echo "== a private erasure larger than MAX_DELETE is capped"
rm -rf $V/business-verification/bvfill1 $V/business-verification/bvfill2 $V/business-verification/bvfill3
mbefore=$(rclone lsf rehearsalcrypt:storage-xattrs | wc -l)
ENO_STORAGE_MAX_DELETE=2 bash $S > $B/r10.log 2>&1; ok $? 1 "exit"; grep -o "STORAGE BACKUP FAILED: sync of private.*" $B/r10.log | cut -c1-110
ok "$(rclone lsf rehearsalcrypt:storage-xattrs | wc -l)" "$((mbefore + 1))" "…but that night's manifest still went up (deferred, not aborted)"
bash $S > /dev/null 2>&1; ok $? 0 "default cap lets 3 retention-sized erasures through"
echo "== a SLOW private erasure (under the cap each night) is caught on night 2, not walked through"
mkdir -p $B/nightB
for i in $(seq 4 13); do rm -rf $V/business-verification/bvfill$i; done
bash $S > $B/rA.log 2>&1; ok $? 0 "night A (-10 of 29) passes"
for i in $(seq 14 21); do mv $V/business-verification/bvfill$i $B/nightB/; done
mb=$(rclone lsf rehearsalcrypt:storage-xattrs | wc -l)
bash $S > $B/rB.log 2>&1; ok $? 1 "night B (-8 more) refused against the week's high-water"; grep -o "private half: .*backed up this week" $B/rB.log
ok "$(rclone lsf rehearsalcrypt:storage-xattrs | wc -l)" "$((mb + 1))" "…yet the rest of the night ran (manifest uploaded)"
ok "$(rclone lsf -R --files-only rehearsalcrypt:storage | grep -c 'bvfill1[4-9]\|bvfill2[01]')" 8 "…and the private copies were NOT erased"
ENO_STORAGE_ALLOW_SHRINK=1 bash $S > $B/rB2.log 2>&1; ok $? 1 "the whole-volume override does NOT lift the private floor"
for i in $(seq 14 21); do mv $B/nightB/bvfill$i $V/business-verification/; done
bash $S > /dev/null 2>&1; ok $? 0 "back to normal once the files are back"
echo "== the overrides WORK when used (not only refuse when absent)"
mkdir -p $B/ovr; for i in $(seq 22 30); do mv $V/business-verification/bvfill$i $B/ovr/; done
bash $S > /dev/null 2>&1; ok $? 1 "private collapse refused without the override"
ENO_STORAGE_ALLOW_PRIVATE_SHRINK=1 bash $S > $B/ro1.log 2>&1; ok $? 0 "ENO_STORAGE_ALLOW_PRIVATE_SHRINK=1 lets the deliberate erasure through"
bash $S > /dev/null 2>&1; ok $? 0 "…and resets the week, so the next night passes without it"
for i in $(seq 22 30); do mv $B/ovr/bvfill$i $V/business-verification/; done
bash $S > /dev/null 2>&1
mkdir -p $B/fill.ovr; for i in $(seq 101 400); do [ -d $V/listings/filler$i.webp ] && mv $V/listings/filler$i.webp $B/fill.ovr/; done
bash $S > /dev/null 2>&1; ok $? 1 "volume collapse (300 photos gone) refused without the override"
ENO_STORAGE_ALLOW_SHRINK=1 bash $S > $B/ro2.log 2>&1; ok $? 0 "ENO_STORAGE_ALLOW_SHRINK=1 lets a deliberate purge through"; grep FAILED $B/ro2.log | head -2
for d in $B/fill.ovr/*; do mv "$d" $V/listings/; done
bash $S > /dev/null 2>&1; ok $? 0 "photos back → quiet night"
echo "== a STALE roles dump fails the run AFTER everything else completed"
touch -d '3 days ago' $B/state/globals-20260922T181525Z.sql.gz; okb=$(cat $B/state/.last-storage-ok)
bash $S > $B/r11.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r11.log; grep -c "orphans:" $B/r11.log | sed 's/^/  orphan step ran: /'
ok "$(cat $B/state/.last-storage-ok)" "$okb" "not marked ok"
touch $B/state/globals-20260922T181525Z.sql.gz
echo "== a private file in NO manifest restores with an inferred content-type"
echo pdfbytes > $B/scan; rclone copyto $B/scan rehearsalcrypt:storage/stub/stub/evidence/x/scan.pdf/v7
bash $RS $B/rs-inf > $B/rs9.log 2>&1; ok $? 0 "exit"; grep -A1 "in no manifest" $B/rs9.log | head -2
ok "$(python3 -c 'import os,sys;print(os.getxattr(sys.argv[1],"user.supabase.content-type").decode())' $B/rs-inf/stub/stub/evidence/x/scan.pdf/v7)" application/pdf "content-type inferred from the object name"
echo "== a scan below 99% content-types uploads as .suspect and is never the default"
for i in $(seq 1 10); do mkdir -p $V/listings/bare$i.jpg; head -c 500 /dev/urandom > $V/listings/bare$i.jpg/b$i; done
bash $S > $B/r8.log 2>&1; ok $? 1 "exit"; grep FAILED $B/r8.log
ok "$(rclone lsf rehearsalcrypt:storage-xattrs | grep -c suspect)" 1 "suspect manifest uploaded"
bash $RS $B/rs-sus > $B/rs10.log 2>&1; ok "$(grep -c suspect $B/rs10.log)" 0 "restore default ignores the suspect manifest"
rm -rf $V/listings/bare*
echo "== a MASS deletion is escalated the same night (and nothing is deleted off-box)"
rm -rf $V/listings/filler1.webp $V/listings/filler2.webp $V/listings/filler3.webp
cbefore=$(cat $B/state/.storage-last-count)
ENO_STORAGE_MAX_NEW_ORPHANS=2 bash $S > $B/r12.log 2>&1; ok $? 1 "exit"; grep -o "FAILED: .*photos were deleted.*alarm at 2)" $B/r12.log
ok "$(cat $B/state/.storage-last-count)" "$cbefore" "a failed night does NOT move the shrink baseline"
ok "$(rclone lsf -R --files-only $R/storage | grep -c 'filler[123]\.webp')" 3 "the deleted photos are still in the bucket"
ok "$(grep -c 'filler[123]\.webp' $B/state/.storage-orphans.tsv)" 3 "…and recorded as orphans"
bash $S > /dev/null 2>&1; ok $? 0 "next night is quiet again (alarm fires once)"
echo "== the TOTAL-orphans alarm: fires while growing past the cap, then goes quiet"
rm -rf $V/listings/filler4.webp
ENO_STORAGE_ORPHAN_GROWTH_NOISE=0 ENO_STORAGE_MAX_ORPHANS=3 bash $S > $B/r14.log 2>&1; ok $? 1 "4 orphans, growing past 3 → alarm"; grep -o "photos are deleted on the box.*growing" $B/r14.log | head -1
ENO_STORAGE_ORPHAN_GROWTH_NOISE=0 ENO_STORAGE_MAX_ORPHANS=3 bash $S > $B/r15.log 2>&1; ok $? 0 "not growing tonight → quiet"
mv $B/state/.storage-orphans.tsv $B/orphans.aside
ENO_STORAGE_MAX_NEW_ORPHANS=2 bash $S > $B/r13.log 2>&1; ok $? 0 "a fresh box's first run does not raise the alarm for old orphans"
echo "== run 7 (concurrent run skips)"
( flock 9; sleep 5 ) 9>$B/lock & sleep 1; bash $S > $B/r7.log 2>&1; ok $? 0 "exit"; cat $B/r7.log; wait
rclone purge $R; rm -rf $B; echo cleaned
ok "$(real_fingerprint || echo listing-failed)" "$REAL_BEFORE" "production bucket UNTOUCHED by the rehearsal (paths, sizes, modtimes)"
echo "SUMMARY: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
