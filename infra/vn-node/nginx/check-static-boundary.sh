#!/bin/bash
# repo: infra/vn-node/nginx/check-static-boundary.sh — READ-ONLY. Run on the box BEFORE every
# `nginx -t && systemctl reload nginx` that touches eno.conf or the eno-static-*.conf snippets.
# ⛔ The licensing boundary is the server_name → port mapping (eno.conf header). This proves that the static
# directory a server{} serves from disk belongs to the SAME edition as the app it proxies to.
# Usage: check-static-boundary.sh [<eno.conf>] [<snippet dir>]. Exit 1 on any crossed or missing pairing.
CONF=${1:-/etc/nginx/sites-enabled/eno.conf}; SN=${2:-/etc/nginx/snippets}; rc=0
awk '
  { sub(/#.*/, "") }                                   # comments never count
  /^[ \t]*server[ \t]*\{/ && depth == 0 { in_s = 1; name = ""; p1 = 0; p2 = 0; im = 0; is = 0; start = NR }
  in_s && /server_name/ { name = $0; gsub(/^[ \t]*server_name[ \t]*|;.*/, "", name) }
  in_s && /proxy_pass http:\/\/127\.0\.0\.1:3001/ { p1++ }
  in_s && /proxy_pass http:\/\/127\.0\.0\.1:3002/ { p2++ }
  in_s && /include[ \t]+\/etc\/nginx\/snippets\/eno-static-marketplace\.conf;/ { im++ }
  in_s && /include[ \t]+\/etc\/nginx\/snippets\/eno-static-services\.conf;/ { is++ }
  { n = gsub(/\{/, "{"); m = gsub(/\}/, "}"); depth += n - m }
  in_s && depth == 0 {
    ok = (p1 && !p2 && im == 1 && is == 0) || (p2 && !p1 && is == 1 && im == 0) || (!p1 && !p2 && !im && !is)
    printf "%s line %d [%s] :3001=%d :3002=%d mkt=%d svc=%d\n", ok ? "OK " : "BAD", start, name, p1, p2, im, is
    if (!ok) bad = 1; in_s = 0 }
  END { exit bad }' "$CONF" || rc=1
# Each edition snippet names only its own directory and port (it proxies twice: the static miss and /_next/image).
grep -qE '3002|/services' "$SN/eno-static-marketplace.conf" && { echo "BAD marketplace snippet names services"; rc=1; }
grep -qE '3001|/marketplace' "$SN/eno-static-services.conf" && { echo "BAD services snippet names marketplace"; rc=1; }
[ "$(grep -c 'proxy_pass http://127.0.0.1:3001;' "$SN/eno-static-marketplace.conf")" -ge 1 ] || { echo "BAD marketplace snippet proxies nowhere"; rc=1; }
[ "$(grep -c 'proxy_pass http://127.0.0.1:3002;' "$SN/eno-static-services.conf")" -ge 1 ] || { echo "BAD services snippet proxies nowhere"; rc=1; }
sed 's/#.*//' "$SN/eno-static-common.conf" | grep -qE '^[[:space:]]*(proxy_pass|root|alias|try_files)[[:space:]]|300[12]|marketplace|services' && { echo "BAD common snippet carries an edition token"; rc=1; }
exit $rc
