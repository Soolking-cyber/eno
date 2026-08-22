#!/usr/bin/env bash
# Move one zone's A records to the VN origin, then purge that zone.
#
#   CF_TOKEN=... bash infra/vn-node/flip-dns.sh forum
#   CF_TOKEN=... bash infra/vn-node/flip-dns.sh vn
#
# ⛔ FORUM FIRST, AND VERIFY BEFORE THE SECOND. eno.forum is the smaller surface and
# is not the licensed marketplace, so a mistake there costs less. Run the checks the
# script prints before flipping `vn`.
#
# ⛔ ROLLBACK IS THE SAME COMMAND WITH ROLLBACK=1. Cloud Run stays running and warm
# throughout — nothing is stopped, scaled to zero or deleted — so going back is a DNS
# edit, not a redeploy. The one thing it cannot undo is writes that landed on the box
# after the flip; dump those first (see cutover.md).
set -euo pipefail
: "${CF_TOKEN:?set CF_TOKEN (needs Zone:DNS:Edit + Cache Purge)}"
WHICH="${1:?forum|vn}"
NEW=162.4.176.208; OLD=8.232.86.0
[ "${ROLLBACK:-0}" = "1" ] && { TARGET=$OLD; echo "⚠️  ROLLBACK: moving back to $OLD"; } || TARGET=$NEW

case "$WHICH" in
  forum) ZONE=cc81e3ff1d792c0aa5384e8feab21efa; NAMES=("eno.forum" "www.eno.forum") ;;
  vn)    ZONE=55e558b62f68a44f8177d7d98cb5369e; NAMES=("eno.vn" "www.eno.vn") ;;
  *) echo "forum|vn"; exit 1 ;;
esac
api() { curl -sS --fail -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" "$@"; }

for n in "${NAMES[@]}"; do
  id=$(api "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=A&name=$n" | jq -r '.result[0].id')
  cur=$(api "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$id" | jq -r '.result.content')
  [ "$id" != "null" ] || { echo "⛔ no A record for $n"; exit 1; }
  echo "  $n: $cur -> $TARGET"
  api -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$id" \
    --data "{\"content\":\"$TARGET\",\"comment\":\"cutover 2026-08-22; rollback to $OLD, Cloud Run still warm\"}" \
    | jq -r '"    ok=" + (.success|tostring) + " now=" + .result.content'
done

# ⛔ PURGE IN THE SAME MINUTE AS THE FLIP. `/` is cached 6h, so without this the
# cutover is invisible — and so is anything wrong with it. This is also step 1 of any
# rollback, for the same reason in reverse.
api -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  --data '{"purge_everything":true}' | jq -r '"  purged: " + (.success|tostring)'

echo
echo "Verify BEFORE flipping the other zone:"
if [ "$WHICH" = forum ]; then
  echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://eno.forum/          # 200"
  echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://eno.forum/itinerary # 200"
else
  echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://eno.vn/             # 200"
  echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://eno.vn/visa         # 404  ⛔ licensing"
  echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://eno.vn/itinerary    # 404  ⛔ licensing"
fi
