#!/usr/bin/env bash
#
# eno · nightly edge purge of photos: /_next/image variants (tag eno-img, both zones) and sb.eno.vn storage
# objects (host purge, eno.vn zone).
#
# ⛔ THIS IS AN ERASURE AND TAKEDOWN BOUND, NOT HOUSEKEEPING (speed plan item 2, 2026-10-16). Until then every
# deploy ran purge_everything several times a day, and that purge was — incidentally — the only thing that ever
# removed a deleted photo from Cloudflare: storage deletes, the StorageTombstone sweep, PDPL erasure and listing
# takedowns all delete at the ORIGIN and never touch the edge (storage-purge.ts, storage-tombstones-sweep, the
# video GC, media.ts), while the edge holds those objects for up to a YEAR (cache-control max-age=31536000).
# Deploys now purge only HTML (tags eno-html, eno-public), so without this an erased photo could stay public at
# the edge for months. Once a night bounds it to a day — no worse than a day with no deploy before.
# ⚠️ STILL A BOUND, NOT A PURGE. A real takedown needs its own URLs/tags purged at once; see
# infra/vn-node/image-serving.md ("takedown purge still owed"). Do not let this timer be the excuse not to.
# ⚠️ /_next/image ALSO KEEPS AN ON-BOX COPY FOR UP TO 7 DAYS (eno-image-cache-prune.sh), so after this purge the
# edge can refetch a deleted photo's variant from the origin's own cache until that ages out — the origin-side
# bound is that script's MAX_AGE_DAYS, unchanged by this one.
#
# Cost: the next morning's first views of each photo refill from the origin (on-box optimizer cache + local
# storage) — the same refill every deploy used to cause several times a day, now once, at 04:10 ICT.
# Token: /opt/eno/secrets/cf-token (Cache Purge scope; never printed, never in argv — curl reads it on stdin).
set -euo pipefail

TOKEN_FILE=${CF_TOKEN_FILE:-/opt/eno/secrets/cf-token}
[ -r "$TOKEN_FILE" ] || { echo "eno-edge-nightly-purge: no readable $TOKEN_FILE" >&2; exit 1; }
VN=55e558b62f68a44f8177d7d98cb5369e     # eno.vn (also holds sb.eno.vn)
FO=cc81e3ff1d792c0aa5384e8feab21efa     # eno.forum

purge() {   # $1 zone, $2 JSON body, $3 label
  local out try
  for try in 1 2 3; do
    out=$(printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" | \
      curl -sS --config - -X POST "https://api.cloudflare.com/client/v4/zones/$1/purge_cache" \
        -H "Content-Type: application/json" --data "$2" 2>&1) || true
    if grep -q '"success":[[:space:]]*true' <<<"$out"; then echo "purged $3 on $1"; return 0; fi
    sleep 20   # tag/host purges share a 5-per-minute account bucket on Free
  done
  echo "eno-edge-nightly-purge: FAILED $3 on $1: $(printf '%s' "$out" | head -c 300)" >&2
  return 1
}

rc=0
purge "$VN" '{"tags":["eno-img"]}' "tag eno-img" || rc=1
purge "$FO" '{"tags":["eno-img"]}' "tag eno-img" || rc=1
purge "$VN" '{"hosts":["sb.eno.vn"]}' "host sb.eno.vn" || rc=1
exit $rc
