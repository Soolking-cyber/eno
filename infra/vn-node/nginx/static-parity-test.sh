#!/bin/bash
# GET-only proof that nginx serves /_next/static from disk with the app's headers, per edition, never crossed.
# Run ON THE BOX as root after `nginx -t && systemctl reload nginx` and after the edition dirs are seeded.
# 127.0.0.1:8181 = the Cloudflare Tunnel listener (plain HTTP, loopback, no AOP). Do NOT test via --resolve …:443:
# ssl_verify_client on (snippets/eno-ssl.conf) answers 400 to any request without Cloudflare's client cert.
set -u
M=/var/www/eno-static/marketplace; S=/var/www/eno-static/services; fail=0
bad(){ printf 'FAIL %s\n' "$*"; fail=1; }
ngx(){ curl -sS -o /dev/null -D - -H "Host: $1" -H "Accept-Encoding: $3" "http://127.0.0.1:8181$2"; }   # through nginx
app(){ curl -sS -o /dev/null -D - -H "Host: $1" -H "Accept-Encoding: $4" "http://127.0.0.1:$3$2"; }    # the container, no nginx
# names lower-cased, values verbatim; drop per-server fields, the document-only headers nginx omits by design, and
# cache-tag (nginx adds eno-static for an operator purge; Cloudflare uses it, browsers never see a difference)
norm(){ tr -d '\r' | awk -F': ' 'NF>1{ $1=tolower($1); print }' OFS=': ' | grep -vE \
  '^(date|etag|last-modified|server|connection|keep-alive|content-length|transfer-encoding|content-security-policy|permissions-policy|x-frame-options|referrer-policy|x-dns-prefetch-control|reporting-endpoints|cache-tag): ' | sort; }
code(){ head -1 | awk '{print $2}'; }
hdr(){ tr -d '\r' | grep -i "^$1:" | cut -d' ' -f2-; }
files(){ (cd "$1" && find _next/static -type f ! -name '*.gz' ! -name '*.br' | sort); }

# 1. header parity + served-from-disk, one file per type of the RUNNING build of each edition
for ed in "marketplace eno.vn 3001 eno-vn-app" "services www.eno.forum 3002 eno-forum-app"; do
  set -- $ed; E=$1; H=$2; P=$3; C=$4; D=/var/www/eno-static/$E
  BID=$(docker exec "$C" cat /app/.next/BUILD_ID) || { bad "$C: no BUILD_ID"; continue; }
  [ -d "$D/_next/static/$BID" ] || bad "$E: running build $BID is not on disk"
  for f in $(docker exec "$C" sh -c 'cd /app/.next && for x in js css woff2 svg ico png; do find static -type f -name "*.$x" | head -1; done'); do
    u=/_next/$f
    for ae in gzip identity; do
      d=$(diff <(app "$H" "$u" "$P" "$ae" | norm) <(ngx "$H" "$u" "$ae" | norm)) && echo "PARITY $E $ae $u" || { bad "$E $ae $u"; echo "$d"; }
    done
    case "$(ngx "$H" "$u" gzip | hdr etag)" in W/*|"") bad "$E $u answered by the APP (weak/no ETag), not disk";; esac
    case "$u" in *.js|*.css|*.svg|*.ico) [ "$(ngx "$H" "$u" gzip | hdr content-encoding)" = gzip ] || bad "$E $u: no .gz sibling served";; esac
  done
done

# 2. the licensing boundary: an edition-only file 404s on every host of the other edition; build dirs never mix
OM=$(comm -23 <(files $M) <(files $S) | head -1); OS=$(comm -13 <(files $M) <(files $S) | head -1)
[ -n "$OM" ] && [ -n "$OS" ] || bad "no edition-only file to probe (empty dir?)"
for h in eno.forum www.eno.forum probe.eno.forum; do [ "$(ngx $h "/$OM" gzip | code)" = 404 ] || bad "$h served marketplace-only /$OM"; done
for h in eno.vn www.eno.vn probe.eno.vn teacher.eno.vn; do [ "$(ngx $h "/$OS" gzip | code)" = 404 ] || bad "$h served services-only /$OS"; done
for b in $(ls "$S/_next/static"); do case $b in chunks|media) ;; *) [ -e "$M/_next/static/$b" ] && bad "services build $b in marketplace dir";; esac; done
for b in $(ls "$M/_next/static"); do case $b in chunks|media) ;; *) [ -e "$S/_next/static/$b" ] && bad "marketplace build $b in services dir";; esac; done
bash "$(dirname "$0")/check-static-boundary.sh" /etc/nginx/sites-enabled/eno.conf /etc/nginx/snippets || bad "config pairing"

# 3. misses fall back to the app's own 404 (no-store, so Cloudflare never caches it)
r=$(ngx eno.vn "/_next/static/chunks/zz-missing-$RANDOM.js" gzip)
[ "$(code <<<"$r")" = 404 ] && hdr cache-control <<<"$r" | grep -q '^private, no-cache, no-store' || bad "missing file: not the app's no-store 404"

# 4. underscore host still reaches the app (308 to the de-underscored host, src/proxy.ts:564)
u=/_next/$(docker exec eno-vn-app sh -c 'cd /app/.next && find static -type f -name "*.js" | head -1')
[ "$(ngx sdc_store.eno.vn "$u" gzip | code)" = 308 ] || bad "underscore host answered from disk"

# 5. licensing routes unchanged (nginx/README.md "Verifying a change", via 8181)
[ "$(ngx eno.vn /visa gzip | code)" = 404 ] || bad "eno.vn/visa"; [ "$(ngx eno.vn /itinerary gzip | code)" = 404 ] || bad "eno.vn/itinerary"
[ "$(ngx www.eno.forum /itinerary gzip | code)" = 200 ] || bad "www.eno.forum/itinerary"

# 6. filesystem hygiene: no symlinks, everything world-readable, www-data can read
[ -z "$(find $M $S -type l)" ] || bad "symlink under /var/www/eno-static"
[ -z "$(find $M $S ! -perm -o=r)" ] || bad "entry not world-readable"
sudo -u www-data test -r "$(find $M/_next/static -type f | head -1)" || bad "www-data cannot read"
grep -E 'eno-static.*failed' /var/log/nginx/error.log | tail -3

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILED"; exit 1; }
