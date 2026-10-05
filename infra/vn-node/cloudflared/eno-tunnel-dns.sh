#!/usr/bin/env bash
# eno-tunnel-dns.sh — move eno hostnames between their A records and the Cloudflare Tunnel.
#   selftest                     read the token exactly as every subcommand does, verify it, read both zones (no writes) — P1 gate
#   save                         snapshot both zones → /opt/eno/tunnel/dns-backup-<UTC>.json; the FIRST good save (both zones OK,
#                                exactly EXPECT=47 records) also becomes dns-backup-pre-tunnel.json, which is never overwritten
#   show                         what every stage name points at now
#   precheck <stage>             read-only: both replicas /ready, nginx :8181 answers each name, right edition (cut runs it first)
#   cut <0|0b|1g|1|2|2b|3|4>     A → proxied CNAME <uuid>.cfargotunnel.com, same record id (MODE=batch: delete+post in one /batch)
#   rollback <stage|all>         CNAME → the saved A (PATCH, settings:{} explicit), then verify; NAMES="a b" limits a stage
#   verify <stage>               compare each name's live record with its backup, field by field; prints what to do on ✗/⚠
#   fixmeta <stage>              PUT the saved record onto an A that already routes right but differs in ttl/comment/settings/tags
#   watch <stage> <seconds>      log each name's record (id type content modified_on) once a second — the API side of a gap probe
#   gap-create | gap-delete      the throwaway proxied A gap.tunnel-check.eno.vn for the Stage 1 gap probe (only after Stage 0)
# ⛔ Token: read from a 0600 file into a 0600 header file in /dev/shm — never argv, never stdout.
# ⛔ Guards on TYPE and NAME (a name-only filter matches the apex MX/TXT). A NAMES filter that matches nothing is refused.
set -uo pipefail
ACCT=c91cf27edd31b01aba677ac9e007d569
declare -A ZONE=([vn]=55e558b62f68a44f8177d7d98cb5369e [forum]=cc81e3ff1d792c0aa5384e8feab21efa)
ORIGIN_IP=162.4.176.233; DIR=/opt/eno/tunnel; API=https://api.cloudflare.com/client/v4
NEW_NAMES=" tunnel-check.eno.vn tunnel-sb.eno.vn "          # created by the tunnel, never had an A record
GAP=gap.tunnel-check.eno.vn                                 # Stage 1 gap probe: no wildcard covers it once tunnel-check exists
HDR=$(mktemp -p /dev/shm eno-cf.XXXXXX) || exit 1; trap 'rm -f "$HDR"' EXIT; chmod 600 "$HDR"
# ⛔ `read` returns 1 at EOF when the file has no trailing newline even though TOKEN is filled — so test the VALUE, never rc.
IFS= read -r TOKEN < /opt/eno/secrets/cf-tunnel-token; [ -n "${TOKEN:-}" ] || { echo "⛔ token file missing or empty"; exit 1; }
printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$TOKEN" > "$HDR"; unset TOKEN
api(){ curl -sS --max-time 30 -H @"$HDR" "$@"; }
cmd=${1:-}; STAGE=${2:-}

stage_names(){ case "$1" in
  0) echo "vn tunnel-check.eno.vn";;  0b) echo "vn tunnel-sb.eno.vn";;  1g) echo "vn $GAP";;  1) echo "vn teacher.eno.vn";;
  2) printf '%s\n' "forum eno.forum" "forum www.eno.forum";;  2b) echo "forum *.eno.forum";;
  3) printf '%s\n' "vn www.eno.vn" "vn *.eno.vn" "vn eno.vn";;  4) echo "vn sb.eno.vn";;
  *) return 1;; esac | { if [ -n "${NAMES:-}" ]; then while read -r z n; do if [[ " $NAMES " == *" $n "* ]]; then echo "$z $n"; fi; done; else cat; fi; }; }
# refuse an unknown stage, and a NAMES filter that leaves nothing to do (a typo must not "succeed" silently)
need_names(){ local s out=""
  [ $# -gt 0 ] && [ -n "${1:-}" ] || { echo "usage: eno-tunnel-dns.sh $cmd <stage>   stages: 0 0b 1g 1 2 2b 3 4$([ "$cmd" = rollback ] && echo ' all')$([ "$cmd" = watch ] && echo '  then <seconds>')"; exit 1; }
  for s in "$@"; do stage_names "$s" >/dev/null || { echo "⛔ unknown stage '$s'"; exit 1; }; out+=$(stage_names "$s"); done
  [ -n "$out" ] || { echo "⛔ NAMES=\"${NAMES:-}\" matches no name in stage(s) $* — refusing"; exit 1; }; }

# exactly one record of TYPE at NAME → JSON on stdout; rc 1 = none, rc 2 = API/token error or ambiguous
get(){ local out; out=$(api --get --data-urlencode "type=$2" --data-urlencode "name=$3" "$API/zones/${ZONE[$1]}/dns_records") || return 2
  [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ] || { jq -c .errors <<<"$out" >&2 2>/dev/null; return 2; }
  case "$(jq '.result|length' <<<"$out")" in 0) return 1;; 1) jq -c '.result[0]' <<<"$out";; *) echo "⛔ >1 $2 record for $3" >&2; return 2;; esac; }
REFUSED="API/token refused (expired, revoked, IP lock, network) — nothing changed by this script; if this is a rollback, go to §7 now"

ready(){ for i in 1 2; do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:2024$i/ready)" = 200 ] || return 1; done; }
# ⛔ eno-deploy.sh RE-EXECS from a temp copy (bash /tmp/eno-deploy.XXXXXX.sh --expect=<sha>), so a pattern naming
#    /opt/eno/app/infra/vn-node/eno-deploy misses a deploy started without a wrapper. `eno-deploy.` matches both
#    paths, with or without --expect; its only false positive (say, an editor open on the script) refuses a cut.
deploying(){ [ -e /opt/eno/deploy-incomplete ] || pgrep -f '[e]no-deploy[.]' >/dev/null; }

# ⛔ /ready IS THE EDGE SIDE ONLY. A name is cut only when nginx :8181 also answers its Host with an HTTP status
#    (gate review 2026-10-05): a restored eno.conf without the 8181 listens would send it to the 444 default, and
#    every visitor of that name would get 502. 444/000 = no 8181 listen on its vhost; 5xx = its upstream is down.
#    A wildcard is probed through a name only the wildcard can answer; tunnel-sb is sent as sb.eno.vn (ingress rewrite).
origin_host(){ case "$1" in tunnel-sb.eno.vn) echo sb.eno.vn;; '*.'*) echo "tunnel-precheck.${1#\*.}";; *) echo "$1";; esac; }
origin_ok(){ local h code body; h=$(origin_host "$1")
  body=$(curl -s --max-time 10 -H "Host: $h" -w $'\n%{http_code}' http://127.0.0.1:8181/); code=${body##*$'\n'}; body=${body%$'\n'*}
  case "$1" in   # the non-app hosts must give THEIR answer: an app answer under the wildcard would hide a missing vhost
    tunnel-check.eno.vn) [ "$code" = 200 ] && [[ "$body" == "tunnel ok host=tunnel-check.eno.vn "* ]] && { echo "  ✓ $1: the nginx probe vhost answers"; return 0; }
      echo "  ⛔ $1: answered $code, not the probe vhost's \"tunnel ok\" (is eno-tunnel.conf installed?) — refusing"; return 1;;
    partner.eno.vn)   # its vhost's own header: the marketplace wildcard answers with s-maxage=…, never this
      [ "$code" = 200 ] && curl -s -o /dev/null -D - --max-time 10 -H "Host: $h" http://127.0.0.1:8181/ | tr -d '\r' | grep -qix 'cache-control: public, max-age=300' \
        && { echo "  ✓ $1: the static partner vhost answers (200, its Cache-Control)"; return 0; }
      echo "  ⛔ $1: answered $code without the partner vhost's Cache-Control (vhost or /var/www/partner.eno.vn/index.html missing?) — refusing"; return 1;;
    sb.eno.vn|tunnel-sb.eno.vn)   # the Supabase gateway's key check: the marketplace wildcard answers this path with 404
      code=$(curl -s -o /dev/null --max-time 10 -H "Host: $h" -w '%{http_code}' http://127.0.0.1:8181/auth/v1/health)
      [ "$code" = 401 ] && { echo "  ✓ $1: the Supabase gateway answers (401 without an API key)"; return 0; }
      echo "  ⛔ $1: /auth/v1/health answered $code, want the gateway's 401 (is sb.eno.vn's vhost there?) — refusing"; return 1;;
  esac
  case "$code" in [234][0-9][0-9]) echo "  ✓ $1: nginx :8181 answers Host $h with $code"; return 0;; esac
  echo "  ⛔ $1: nginx :8181 answered ${code:-nothing} for Host $h — refusing (444/000: no 8181 listen on its vhost; 5xx: upstream down)"; return 1; }
# ⛔ THE LICENSING BOUNDARY, PER NAME, BEFORE A CUT (gate review 2026-10-05): /api/v1/status names the build that
#    answered and is exempt from the edge-header gate, so it answers on loopback. eno.vn names must reach the
#    marketplace build and eno.forum names the services build.
#    www.eno.vn is different: BOTH builds answer it with a 308 to the same path on https://eno.vn (measured 2026-10-05,
#    /visa and /itinerary included), so a redirect proves nothing about the build behind it. What protects the boundary
#    there is that www.eno.vn serves NOTHING itself, so the check is exactly that: every probed path, a services-only one
#    included, redirects to the apex. The apex's own edition is checked in the same stage (3).
#    sb, tunnel-sb and tunnel-check are not app hosts: origin_ok is their whole check.
want_edition(){ case "$1" in tunnel-check.eno.vn|tunnel-sb.eno.vn|sb.eno.vn|partner.eno.vn) echo "";; eno.forum|*.eno.forum) echo services;; *) echo marketplace;; esac; }
edition_ok(){ local want h out tail code loc body ed p; want=$(want_edition "$1"); [ -n "$want" ] || return 0; h=$(origin_host "$1")
  if [ "$1" = www.eno.vn ]; then
    for p in /api/v1/status /visa /itinerary; do
      out=$(curl -s -o /dev/null --max-time 10 -H "Host: $h" -w '%{http_code} %{redirect_url}' "http://127.0.0.1:8181$p")
      [[ "${out%% *}" == 30[178] ]] && [ "${out#* }" = "https://eno.vn$p" ] || { echo "  ⛔ $1: $p answered $out, want a redirect to https://eno.vn$p — LICENSING BOUNDARY, refusing"; return 1; }
    done
    echo "  ✓ $1: serves nothing itself, every probed path redirects to the apex (whose edition this stage checks)"; return 0; fi
  out=$(curl -s --max-time 10 -H "Host: $h" -w $'\n%{http_code} %{redirect_url}' http://127.0.0.1:8181/api/v1/status)
  tail=${out##*$'\n'}; body=${out%$'\n'*}; code=${tail%% *}; loc=${tail#* }
  ed=$(jq -r '.edition // empty' <<<"$body" 2>/dev/null)
  [ "$code" = 200 ] && [ "$ed" = "$want" ] && { echo "  ✓ $1: edition $want"; return 0; }
  echo "  ⛔ $1: /api/v1/status for Host $h answered $code ${ed:+edition=$ed }(want edition $want) — LICENSING BOUNDARY, refusing"; return 1; }

# ⛔ STAGE-LEVEL GUARDS (gate review 2026-10-05), run by precheck and cut before any name:
#  - 8181 bound to 127.0.0.1 only, route_localnet 0 everywhere. 8181 skips AOP and trusts CF-Connecting-IP, which is
#    safe only while nothing off-box can reach it (Docker sets route_localnet=1 on a bridge when userland-proxy is off).
#  - Stage 3 puts *.eno.vn on the tunnel, and that wildcard then carries every eno.vn name in config.yml's ingress,
#    the Stage 0b rule included: it would serve the Supabase gateway as tunnel-sb.eno.vn, past every Cloudflare rule
#    keyed on sb.eno.vn (the OTP rate limits among them). Stage 3 refuses while that rule is still in config.yml.
#  - partner.eno.vn has no DNS record of its own (measured 2026-10-05): it rides *.eno.vn, so Stage 3 probes it too.
stage_ok(){ local rc=0 b ln m t i stale=""
  # cloudflared reads config.yml only when it starts: a rule deleted from the file keeps running until each replica restarts.
  # ⚠️ ctime, not mtime: cp -p, rsync -a and scp -p carry an OLD mtime onto a new file; nothing can backdate ctime.
  m=$(stat -c %Z /etc/cloudflared/config.yml)
  for i in 1 2; do t=$(systemctl show -p ActiveEnterTimestamp --value eno-cloudflared@$i); t=$([ -n "$t" ] && date -d "$t" +%s || echo 0)
    [ "$t" -ge "$m" ] || stale+=" @$i"; done
  if [ -z "$stale" ]; then echo "  ✓ both replicas started after the last config.yml edit"
  else echo "  ⛔ replica(s)$stale started before the last config.yml edit and still run the old ingress: restart them one at a time"; rc=1; fi
  b=$(ss -tlnH '( sport = :8181 )' | awk '{print $4}' | sort -u | tr '\n' ' ')
  if [ "$b" = "127.0.0.1:8181 " ]; then echo "  ✓ 8181 bound to 127.0.0.1 only"; else echo "  ⛔ 8181 bound to: ${b:-nothing} (want 127.0.0.1:8181 only)"; rc=1; fi
  ln=$(grep -L '^0$' /proc/sys/net/ipv4/conf/*/route_localnet | tr '\n' ' ')
  if [ -z "$ln" ]; then echo "  ✓ route_localnet 0 on every interface"; else echo "  ⛔ route_localnet≠0 on: $ln— off-box hosts could reach 127.0.0.1:8181"; rc=1; fi
  if [ "$1" = 3 ]; then
    if grep -qE '^[[:space:]]*-[[:space:]]*hostname:[[:space:]]*"?tunnel-sb\.eno\.vn' /etc/cloudflared/config.yml; then
      echo "  ⛔ config.yml still routes tunnel-sb.eno.vn: after Stage 3 the *.eno.vn wildcard would serve the Supabase gateway"
      echo "     under that name, past every rule keyed on sb.eno.vn. Remove the rule, restart the replicas one at a time, then cut 3"; rc=1; fi
    origin_ok partner.eno.vn || rc=1; fi
  return $rc; }

selftest(){ local v z out
  # ⚠️ ACCOUNT-OWNED TOKEN (2026-10-05: created under Manage account → Account API tokens): /user/tokens/verify
  #    answers "Invalid API Token" for it, /accounts/$ACCT/tokens/verify answers active. Ask the account endpoint
  #    first and fall back to the user one, so a user-owned replacement token passes too.
  v=$(api "$API/accounts/$ACCT/tokens/verify" | jq -r '.result.status // empty' 2>/dev/null)
  [ -n "$v" ] || v=$(api "$API/user/tokens/verify" | jq -r '.result.status // "refused"' 2>/dev/null)
  echo "token read OK, verify=${v:-refused}   (want active)"
  [ "$v" = active ] || exit 1
  for z in vn forum; do out=$(api --get --data-urlencode per_page=1 "$API/zones/${ZONE[$z]}/dns_records")
    [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ] || { echo "✗ dns read $z refused"; exit 1; }; echo "dns read $z OK"; done; }

save(){ local f="$DIR/dns-backup-$(date -u +%Y%m%dT%H%M%SZ).json" parts out z n; install -d -m 700 "$DIR"
  parts=$(mktemp -p "$DIR") || exit 1
  for z in vn forum; do
    out=$(api --get --data-urlencode per_page=5000 "$API/zones/${ZONE[$z]}/dns_records") || { echo "✗ $z: request failed — nothing saved"; rm -f "$parts"; exit 1; }
    [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ] || { echo "✗ $z: $(jq -c .errors <<<"$out" 2>/dev/null) — nothing saved"; rm -f "$parts"; exit 1; }
    [ "$(jq '.result|length' <<<"$out")" = "$(jq '.result_info.total_count // (.result|length)' <<<"$out")" ] || { echo "✗ $z: result is paged — nothing saved"; rm -f "$parts"; exit 1; }
    jq --arg z "$z" '[.result[] | . + {zone:$z}]' <<<"$out" >> "$parts"; done
  jq -s add "$parts" > "$f" && rm -f "$parts" || { rm -f "$parts" "$f"; exit 1; }
  chmod 600 "$f"; n=$(jq length "$f")
  echo "saved $n records → $f"; jq -r --arg ip "$ORIGIN_IP" '.[] | select(.content==$ip) | "  \(.zone)\t\(.type)\t\(.name)\tproxied=\(.proxied)"' "$f"
  [ -e "$DIR/dns-backup-pre-tunnel.json" ] && return 0
  [ "$n" = "${EXPECT:-47}" ] || { echo "⛔ $n records, expected ${EXPECT:-47}: dns-backup-pre-tunnel.json NOT written. Find out why; if $n is right, re-run with EXPECT=$n"; exit 1; }
  cp -p "$f" "$DIR/dns-backup-pre-tunnel.json" && echo "pre-tunnel backup written (never overwritten)"; }

# the A record a name rolls back to: the pre-tunnel snapshot, or (gap probe only) its own file
saved_rec(){ local f="$DIR/dns-backup-pre-tunnel.json"; [ "$1" = "$GAP" ] && f="$DIR/dns-backup-gap.json"
  jq -c --arg n "$1" '[.[] | select(.type=="A" and .name==$n)] | if length==1 then .[0] else empty end' "$f" 2>/dev/null; }

TID=""; TARGET=""
need_tid(){ TID=$(cat "$DIR/tunnel-id" 2>/dev/null) || { echo "no $DIR/tunnel-id"; exit 1; }; TARGET="$TID.cfargotunnel.com"; }

cut_one(){ local z=$1 n=$2 rec r id body out cm="eno tunnel stage $STAGE $(date -u +%F); rollback: eno-tunnel-dns.sh rollback $STAGE"
  rec=$(get "$z" CNAME "$n"); r=$?
  [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }
  if [ $r -eq 0 ]; then
    if [ "$(jq -r .content <<<"$rec")" = "$TARGET" ]; then
      [ "$(jq -r .proxied <<<"$rec")" = true ] && { echo "  = $n already → tunnel"; return 0; }
      echo "  ⛔ $n has a CNAME to the tunnel that is NOT proxied: no visitor reaches the tunnel through it. Set it to proxied (dashboard) or roll back"; return 1; fi
    echo "  ⛔ $n has a foreign CNAME"; return 1; fi
  if [[ "$NEW_NAMES" == *" $n "* ]]; then
    for t in A AAAA; do get "$z" $t "$n" >/dev/null; r=$?; [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }; [ $r -eq 0 ] && { echo "  ⛔ $n has an $t record"; return 1; }; done
    body=$(jq -nc --arg n "$n" --arg c "$TARGET" --arg cm "$cm" '{type:"CNAME",name:$n,content:$c,proxied:true,ttl:1,comment:$cm}')
    out=$(api -X POST --data "$body" "$API/zones/${ZONE[$z]}/dns_records")
  else
    rec=$(get "$z" A "$n"); r=$?
    [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }
    [ $r -eq 1 ] && { echo "  ⛔ no A record for $n — refusing"; return 1; }
    [ "$(jq -r .content <<<"$rec")" = "$ORIGIN_IP" ] && [ "$(jq -r .proxied <<<"$rec")" = true ] || { echo "  ⛔ $n A is not proxied $ORIGIN_IP"; return 1; }
    [ -n "$(saved_rec "$n")" ] || { echo "  ⛔ $n has no backup to roll back to — refusing"; return 1; }
    id=$(jq -r .id <<<"$rec")
    body=$(jq -nc --arg c "$TARGET" --arg cm "$cm" '{type:"CNAME",content:$c,proxied:true,ttl:1,comment:$cm}')
    if [ "${MODE:-patch}" = batch ]; then
      out=$(api -X POST --data "$(jq -nc --arg id "$id" --arg n "$n" --argjson r "$body" '{deletes:[{id:$id}],posts:[$r+{name:$n}]}')" "$API/zones/${ZONE[$z]}/dns_records/batch")
    else out=$(api -X PATCH --data "$body" "$API/zones/${ZONE[$z]}/dns_records/$id"); fi
  fi
  [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ] && echo "  ✓ $n → tunnel at $(date -u +%T)Z" || { echo "  ✗ $n: $(jq -c .errors <<<"$out" 2>/dev/null) — nothing changed for $n; stop this stage here"; return 1; }; }

# rc 0 = identical to backup · rc 1 = NOT routing on the saved A, or cannot tell (act now) · rc 2 = routes right, metadata differs
verify_one(){ local z=$1 n=$2 cur saved bad route r
  if [[ "$NEW_NAMES" == *" $n "* ]]; then   # no A to compare: report its CNAME instead (gate review 2026-10-05)
    cur=$(get "$z" CNAME "$n"); r=$?
    [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }
    [ $r -eq 1 ] && { echo "  = $n has no record (not cut yet, or rolled back)"; return 0; }
    [ "$(jq -r .content <<<"$cur")" = "$TARGET" ] && [ "$(jq -r .proxied <<<"$cur")" = true ] && { echo "  ✓ $n → tunnel, proxied"; return 0; }
    echo "  ✗ $n CNAME → $(jq -r .content <<<"$cur") proxied=$(jq -r .proxied <<<"$cur"): not this tunnel, or not proxied"; return 1; fi
  saved=$(saved_rec "$n"); [ -n "$saved" ] || { echo "  ⛔ $n not uniquely in its backup"; return 1; }
  cur=$(get "$z" A "$n"); r=$?; [ $r -eq 1 ] && { cur=$(get "$z" CNAME "$n"); r=$?; }
  [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }
  [ $r -eq 1 ] && { echo "  ✗ $n has neither an A nor a CNAME: it now resolves only through a wildcard, or not at all."
    echo "     NEXT: re-create it now with §7 M2 (owner, dashboard: Add record → A, $ORIGIN_IP, Proxied, TTL Auto, comment from the §7 table)."
    echo "           M1 does not create records; after the add, run verify $STAGE (an id-only difference is then expected)."; return 1; }
  bad=$(jq -rn --argjson a "$cur" --argjson b "$saved" '["id","name","type","content","proxied","ttl","comment","settings","tags"] | map(select($a[.] != $b[.])) | join(",")')
  route=$(jq -rn --argjson a "$cur" --argjson b "$saved" '["type","content","proxied"] | map(select($a[.] != $b[.])) | join(",")')
  if [ -z "$bad" ]; then echo "  ✓ $n identical to backup (id type content proxied ttl comment settings tags)"; return 0; fi
  # an id-only difference is NOT a defect: MODE=batch and a dashboard delete+add always mint a new id. Pass, and say so.
  if [ "$bad" = id ]; then
    echo "  ✓ $n identical to backup except the record id ($(jq -r .id <<<"$saved") → $(jq -r .id <<<"$cur")) — expected after MODE=batch or a delete+add;"
    echo "     record the new id in §1.1 and the §7 table (M1 finds records by name, so it keeps working either way)."; return 0; fi
  if [ -n "$route" ]; then
    echo "  ✗ $n is NOT back on the A path (differs: $bad; now $(jq -r '"\(.type) \(.content) proxied=\(.proxied)"' <<<"$cur"))."
    echo "     NEXT: (1) NAMES=\"$n\" eno-tunnel-dns.sh rollback $STAGE once more; (2) still ✗ → §7 M1 (Claude, MCP PATCH id $(jq -r .id <<<"$cur")) or M2 (owner, dashboard);"
    echo "           (3) cut nothing else; tell the owner."; return 1; fi
  echo "  ⚠ $n routes on the A path (type/content/proxied = backup) but differs in: $bad. Traffic is fine."
  echo "     NEXT: NAMES=\"$n\" eno-tunnel-dns.sh fixmeta $STAGE, then verify $STAGE. Record the diff in §2.3."; return 2; }

rollback_one(){ local z=$1 n=$2 cur saved id out body r
  cur=$(get "$z" CNAME "$n"); r=$?
  [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }
  if [ $r -eq 1 ]; then
    echo "  = $n has no CNAME — nothing to roll back"
    [[ "$NEW_NAMES" == *" $n "* ]] && return 0; verify_one "$z" "$n"; return; fi
  [ "$(jq -r .content <<<"$cur")" = "$TARGET" ] || { echo "  ⛔ $n CNAME is not the tunnel — refusing"; return 1; }
  id=$(jq -r .id <<<"$cur")
  if [[ "$NEW_NAMES" == *" $n "* ]]; then out=$(api -X DELETE "$API/zones/${ZONE[$z]}/dns_records/$id")
  else
    saved=$(saved_rec "$n"); [ -n "$saved" ] || { echo "  ⛔ $n not uniquely in its backup"; return 1; }
    # ⛔ settings:{} EXPLICIT: an A must not inherit CNAME-only settings (flatten_cname). All 8 saved A records have
    #    settings {} and tags [] (measured 2026-10-04). Tags are not sent: the cut never sets them.
    body=$(jq -c '{type,name,content,proxied,ttl,comment,settings:{}}' <<<"$saved")
    if [ "${MODE:-patch}" = batch ]; then
      out=$(api -X POST --data "$(jq -nc --arg id "$id" --argjson b "$body" '{deletes:[{id:$id}],posts:[$b]}')" "$API/zones/${ZONE[$z]}/dns_records/batch")
    else out=$(api -X PATCH --data "$body" "$API/zones/${ZONE[$z]}/dns_records/$id"); fi
  fi
  if [ "$(jq -r .success <<<"$out" 2>/dev/null)" != true ]; then
    echo "  ✗ $n: API refused at $(date -u +%T)Z: $(jq -c .errors <<<"$out" 2>/dev/null)"
    echo "     $n is STILL on the tunnel. NEXT: tunnel healthy (eno-tunnel-status.sh: both /ready 200) → no hurry, retry once"
    echo "     with MODE=batch NAMES=\"$n\". Tunnel unhealthy → §7 now (M1 Claude/MCP, else M2 owner/dashboard)."; return 1; fi
  echo "  ✓ $n rolled back at $(date -u +%T)Z"
  [[ "$NEW_NAMES" == *" $n "* ]] && return 0
  sleep 1; verify_one "$z" "$n"; }

fixmeta_one(){ local z=$1 n=$2 cur saved out r
  saved=$(saved_rec "$n"); [ -n "$saved" ] || { echo "  ⛔ $n not uniquely in its backup"; return 1; }
  cur=$(get "$z" A "$n"); r=$?
  [ $r -eq 2 ] && { echo "  ✗ $n: $REFUSED"; return 1; }
  [ $r -eq 1 ] && { echo "  ⛔ $n has no A — fixmeta only touches an A that already routes right; use rollback"; return 1; }
  [ "$(jq -c '{type,content,proxied}' <<<"$cur")" = "$(jq -c '{type,content,proxied}' <<<"$saved")" ] || { echo "  ⛔ $n routing differs — use rollback, not fixmeta"; return 1; }
  out=$(api -X PUT --data "$(jq -c '{type,name,content,proxied,ttl,comment,settings:{}}' <<<"$saved")" "$API/zones/${ZONE[$z]}/dns_records/$(jq -r .id <<<"$cur")")
  [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ] || { echo "  ✗ $n PUT refused: $(jq -c .errors <<<"$out" 2>/dev/null). Routing is fine; leave it and tell the owner."; return 1; }
  verify_one "$z" "$n"; }

# the API side of a gap probe: proves the change LANDED (type flip + new modified_on) inside the dig window
watch_names(){ local secs=${1:-60} end z n r out rc; end=$((SECONDS+secs))
  while [ $SECONDS -lt $end ]; do
    while read -r z n; do
      out=$(api --get --data-urlencode "name=$n" "$API/zones/${ZONE[$z]}/dns_records"); rc=$?
      if [ $rc -ne 0 ]; then r="CURL-ERROR rc=$rc (no answer from the API — this second proves nothing)"
      elif [ "$(jq -r .success <<<"$out" 2>/dev/null)" != true ]; then r="API-ERROR $(jq -c .errors <<<"$out" 2>/dev/null)"
      else r=$(jq -r '[.result[]|select(.type=="A" or .type=="CNAME")|"\(.id) \(.type) \(.content) \(.modified_on)"]|join(" | ")' <<<"$out"); r=${r:-NONE}; fi
      echo "$(date -u +%T) $n $r"; done < <(stage_names "$STAGE")
    sleep 1; done; }

gap_create(){ local out rec r
  get vn CNAME tunnel-check.eno.vn >/dev/null; r=$?
  [ $r -eq 2 ] && { echo "✗ $REFUSED"; exit 1; }
  [ $r -eq 1 ] && { echo "⛔ Stage 0 first: without tunnel-check.eno.vn the *.eno.vn wildcard answers for $GAP and hides any gap"; exit 1; }
  rec=$(get vn A "$GAP"); r=$?
  [ $r -eq 2 ] && { echo "✗ $REFUSED"; exit 1; }
  [ $r -eq 0 ] && [[ "$(jq -r '.comment // ""' <<<"$rec")" != "eno tunnel"* ]] && { echo "⛔ an A record at $GAP that this script did not create — refusing to adopt it"; exit 1; }
  if [ $r -eq 1 ]; then
    out=$(api -X POST --data "$(jq -nc --arg n "$GAP" --arg ip "$ORIGIN_IP" '{type:"A",name:$n,content:$ip,proxied:true,ttl:1,comment:"eno tunnel Stage 1 gap probe (throwaway): eno-tunnel-dns.sh gap-delete"}')" "$API/zones/${ZONE[vn]}/dns_records")
    [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ] || { echo "✗ create refused: $(jq -c .errors <<<"$out" 2>/dev/null)"; exit 1; }
    rec=$(get vn A "$GAP") || exit 1; fi
  jq -c '[. + {zone:"vn"}]' <<<"$rec" > "$DIR/dns-backup-gap.json"; chmod 600 "$DIR/dns-backup-gap.json"
  echo "gap probe $GAP id=$(jq -r .id <<<"$rec") → $DIR/dns-backup-gap.json"; }
gap_delete(){ local t rec r out want rc=0; need_tid
  # ⛔ ONLY THE PROBE'S OWN RECORDS (gate review 2026-10-05): an A on the origin IP or a CNAME on this tunnel. Anything
  #    else at that name is not ours to delete; and a refused DELETE is a failure, not a line of output.
  for t in A CNAME; do rec=$(get vn $t "$GAP"); r=$?; [ $r -eq 2 ] && { echo "✗ $REFUSED"; exit 1; }; [ $r -eq 1 ] && continue
    want=$ORIGIN_IP; [ $t = CNAME ] && want=$TARGET
    [ "$(jq -r .content <<<"$rec")" = "$want" ] && [[ "$(jq -r '.comment // ""' <<<"$rec")" == "eno tunnel"* ]] || { echo "⛔ $GAP $t → $(jq -r .content <<<"$rec") \"$(jq -r '.comment // ""' <<<"$rec")\": not the probe this script made, left alone"; rc=1; continue; }
    out=$(api -X DELETE "$API/zones/${ZONE[vn]}/dns_records/$(jq -r .id <<<"$rec")")
    if [ "$(jq -r .success <<<"$out" 2>/dev/null)" = true ]; then echo "deleted $t $GAP"; else echo "✗ delete $t $GAP refused: $(jq -c .errors <<<"$out" 2>/dev/null)"; rc=1; fi
  done; exit $rc; }

# run f on every name of $STAGE; rc 1 if any name failed, else 2 if any warned, else 0
each(){ local f=$1 rc=0 r; while read -r z n; do "$f" "$z" "$n"; r=$?; [ $r -eq 1 ] && rc=1; [ $r -eq 2 ] && [ $rc -eq 0 ] && rc=2; done < <(stage_names "$STAGE"); return $rc; }

case "$cmd" in
  selftest) selftest ;;
  save) save ;;
  show) need_tid; for s in 0 0b 1g 1 2 2b 3 4; do while read -r z n; do
          r=$(api --get --data-urlencode "name=$n" "$API/zones/${ZONE[$z]}/dns_records" | jq -r '[.result[]|select(.type=="A" or .type=="CNAME")|"\(.type) \(.content) proxied=\(.proxied)"]|join(", ")')
          printf '%-3s %-24s %s\n' "$s" "$n" "${r:-(none)}"; done < <(stage_names $s); done ;;
  cut)  need_names "$STAGE"; need_tid
        deploying && { echo "⛔ a deploy is running or incomplete — refusing"; exit 1; }
        ready || { echo "⛔ both replicas must be /ready — refusing"; exit 1; }
        rc=0; stage_ok "$STAGE" || rc=1
        while read -r z n; do origin_ok "$n" && edition_ok "$n" || rc=1; done < <(stage_names "$STAGE"); [ $rc -eq 0 ] || exit 1
        rc=0; while read -r z n; do
          deploying && { echo "  ⛔ a deploy started mid-stage — no further writes; $n and later names stay as they are"; rc=1; break; }
          cut_one "$z" "$n" || { rc=1; break; }; done < <(stage_names "$STAGE"); exit $rc ;;
  rollback) [ "$STAGE" = all ] && list="3 4 2 2b 1" || list=$STAGE; need_names $list
        need_tid; [ -s "$DIR/dns-backup-pre-tunnel.json" ] || { echo "no pre-tunnel backup"; exit 1; }; rc=0
        for s in $list; do STAGE=$s; each rollback_one; r=$?; [ $r -eq 1 ] && rc=1; [ $r -eq 2 ] && [ $rc -eq 0 ] && rc=2; done; exit $rc ;;
  precheck) need_names "$STAGE"; rc=0; if ready; then echo "  ✓ both replicas /ready"; else echo "  ⛔ a replica is not /ready"; rc=1; fi
        stage_ok "$STAGE" || rc=1
        while read -r z n; do origin_ok "$n" && edition_ok "$n" || rc=1; done < <(stage_names "$STAGE"); exit $rc ;;
  verify)  need_names "$STAGE"; need_tid; each verify_one; exit $? ;;
  fixmeta) need_names "$STAGE"; each fixmeta_one; exit $? ;;
  watch)   need_names "$STAGE"; watch_names "${3:-60}" ;;
  gap-create) gap_create ;;
  gap-delete) gap_delete ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
