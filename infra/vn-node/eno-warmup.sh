#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · post-deploy cache warm-up (SEO wave B, H4). Called by eno-deploy.sh step 11.
#
#   bash eno-warmup.sh --sha=<sha> --since=<vn container StartedAt>     · what the deploy runs
#   bash eno-warmup.sh --vn=127.0.0.1:3250 --forum=127.0.0.1:3251 --dir=/tmp/w   · against a local build
#   … --dry-run      · the rent index, the sitemaps and /c/rentals only; the pages are listed, not fetched
#   … --stop-file=<path>   · stop sending when it exists (default /opt/eno/deploy-incomplete; empty = never)
#
# ⛔ ADVISORY, AND IT CAN NEVER FAIL A DEPLOY. It runs after step 9's probe and after the
# deploy-incomplete marker is removed, so nothing here can reach restore(). Every miss is a yellow
# `[!!]` line, never a red `[XX]` one, and the script exits 0 whatever it met (2 only for a bad flag).
#
# WHY IT EXISTS. The ISR cache is keyed by BUILD_ID (cache-handler.cjs), so every deploy starts
# cold: the first visitor, or the first crawler, to each page and language pays the full render.
# This pays it instead, once, from the box, and logs what each cold render cost — the per-deploy
# number the owner asked for.
#
# ⛔ THE ORDER IS THE POINT: THE RENT INDEX FIRST, THEN THE SITEMAPS, THEN THE PAGES.
# The rent snapshot is computed on the first request after a deploy, and /hcmc-rent-index, its CSV
# and (from D3) pages.xml read ONE cache entry (the pinned key in load-rent-index.ts). Warming the
# page and then waiting for the CSV to show a snapshot computed after the swap means pages.xml's
# first render reads that snapshot instead of meeting a cold one. A sitemap fetched first would
# start the computation itself, or (D3) throw until it finished. Keep this order in any change.
#
# ⚠️ WHAT IT WARMS, AND WHAT IT CANNOT. Requests go to the container port with the public Host
# header, which hits the same ISR entries as public traffic (eno-cron.sh uses the same pattern).
# Each page is sent with Accept-Language en-US and then vi-VN: src/proxy.ts renders one URL in two
# languages, and they are separate ISR entries. It does NOT fill the Cloudflare edge — nothing from
# the box can — and it only ever requests URLs a sitemap lists, plus the rentals district links:
# own listings only (submittedListingWhere), never the 25,000 imports.
# ⚠️ ABOUT 1,200 PAGE REQUESTS AT CONCURRENCY 4: 293 eno.vn + 305 eno.forum paths (sitemap URLs plus
# the 24 district links) × 2 languages, measured on local production builds on 2026-09-29.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SHA=manual; SINCE=""; DIR=/opt/eno/warmup; DRY=0; STOP=/opt/eno/deploy-incomplete
VN=127.0.0.1:3001; FORUM=127.0.0.1:3002
VN_HOST=eno.vn; FORUM_HOST=www.eno.forum
CONC=4; PAGE_MAX=30; RENT_MAX=180; RETRIES=3; BUDGET=840
# 65 s: the loader answers `known: false` for 60 s after a failed read (FAILURE_HOLD_MS in
# load-rent-index.ts), so an earlier retry could only read the held failure. Tests shorten it.
RETRY_WAIT=${ENO_WARMUP_RETRY_WAIT:-65}
for a in "$@"; do case "$a" in
  --sha=*) SHA=${a#*=};; --since=*) SINCE=${a#*=};; --dir=*) DIR=${a#*=};;
  --vn=*) VN=${a#*=};; --forum=*) FORUM=${a#*=};; --budget=*) BUDGET=${a#*=};;
  --stop-file=*) STOP=${a#*=};; --dry-run) DRY=1;;
  *) printf 'eno-warmup: unknown argument %s\n' "$a" >&2; exit 2;;
esac; done
case "$SHA" in *[!A-Za-z0-9._-]*|'') printf 'eno-warmup: bad --sha\n' >&2; exit 2;; esac
case "$BUDGET" in *[!0-9]*|'') printf 'eno-warmup: bad --budget\n' >&2; exit 2;; esac
# --since is the vn container's StartedAt (RFC 3339, UTC). Anything else is dropped, loudly, rather
# than compared: a malformed floor would pass every snapshot or none.
if [ -n "$SINCE" ] && ! [[ "$SINCE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]]; then
  printf '  \033[33m[!!]\033[0m --since=%s is not an RFC 3339 UTC time; snapshot freshness not checked\n' "$SINCE"; SINCE=""
fi

say(){  printf '  %s\n' "$*"; }
warn(){ printf '  \033[33m[!!]\033[0m %s\n' "$*"; }

# ⚠️ AN INTERNAL BUDGET UNDER THE DEPLOY'S `timeout 900`, so the summary still prints when the cap
# is reached: once it runs out no new request starts, and the log says how many were not sent.
DEADLINE=$(( $(date +%s) + BUDGET ))
TMP=$(mktemp -d "${TMPDIR:-/tmp}/eno-warmup.XXXXXX") || { warn "mktemp failed; warm-up skipped"; exit 0; }
trap 'rm -rf "$TMP"' EXIT
if mkdir -p "$DIR" 2>/dev/null && : > "$DIR/$SHA.tsv" 2>/dev/null; then TSV=$DIR/$SHA.tsv
else warn "cannot write $DIR/$SHA.tsv; logging to a temporary file"; TSV=$TMP/warmup.tsv; : > "$TSV"; fi
printf 'url\tlang\thttp_code\ttime_starttransfer\ttime_total\tkind\n' >> "$TSV"
UA='eno-warmup/1 (post-deploy cache warm-up)'
export TSV UA PAGE_MAX DEADLINE STOP

# ⛔ IT STOPS WHEN A NEWER DEPLOY STARTS SWAPPING. eno-deploy.sh releases its lock before this step,
# so a rollback is never refused for 15 minutes, which means another deploy CAN start meanwhile.
# That deploy touches /opt/eno/deploy-incomplete before it touches a container (its step 7), and the
# marker never exists during this deploy's own step 11 (removed once step 9's probe passed; a
# leftover one makes step 3 refuse the deploy before it gets here). So from the moment it
# appears, nothing more is sent: no load on the new build's probe, no rows for another build's
# pages under this sha, and that deploy's own step 11 warms its build. (A bare `--rollback` touches
# no marker; it can only mislabel the rest of this advisory log.)
halted(){ [ "$(date +%s)" -ge "$DEADLINE" ] || { [ -n "$STOP" ] && [ -e "$STOP" ]; }; }
why_halted(){ if [ -n "$STOP" ] && [ -e "$STOP" ]; then printf 'a newer deploy started (%s exists)' "$STOP"; else printf 'time budget spent'; fi; }

# One timed GET: http://<addr><path> as Host <host>, one TSV row, the status code on stdout.
# lang `-` sends no Accept-Language (sitemaps and the CSV have no language). Writes the body to $6.
# ⚠️ ONE printf PER ROW WITH >>: an O_APPEND write under PIPE_BUF is atomic, so four workers
# appending at once cannot interleave within a row.
# ⚠️ NO REQUEST OUTLIVES THE BUDGET: each one's --max-time is cut to what is left of it, and past it
# (or once halted) nothing is sent (no row, `skip` on stdout). So the summary always prints before
# the deploy's cap, and when the cap's SIGTERM would leave xargs' workers behind (`--foreground`
# signals only this script), they are already done: none can run past the deadline.
# `-g`: a path is sent as written, never expanded as a curl glob ([], {}).
fetch(){
  local addr=$1 host=$2 path=$3 lang=$4 kind=$5 out=${6:-/dev/null} max=${7:-$PAGE_MAX} w left
  halted && { printf skip; return 0; }
  left=$(( DEADLINE - $(date +%s) ))
  [ "$left" -gt 0 ] || { printf skip; return 0; }
  [ "$max" -le "$left" ] || max=$left
  local -a al=()
  [ "$lang" != - ] && al=(-H "Accept-Language: $lang")
  w=$(curl -sg -o "$out" --max-time "$max" -A "$UA" -H "Host: $host" "${al[@]+"${al[@]}"}" \
        -w '%{http_code}\t%{time_starttransfer}\t%{time_total}' "http://$addr$path" 2>/dev/null)
  case "$w" in [0-9][0-9][0-9]$'\t'*) ;; *) w=$'000\t0\t0' ;; esac
  [ "$lang" = - ] || lang=${lang%%-*}
  printf 'https://%s%s\t%s\t%s\t%s\n' "$host" "$path" "$lang" "$w" "$kind" >> "$TSV"
  printf '%s' "${w%%$'\t'*}"
}
# The worker xargs runs, four at a time. Past the deadline fetch sends nothing.
page(){ fetch "$1" "$2" "$4" "$3" page >/dev/null; }
export -f fetch page halted

# <loc> values of an XML file, one per line, entity-decoded (a loc only ever carries &amp;).
locs(){ grep -o '<loc>[^<]*</loc>' "$1" | sed -e 's#^<loc>##' -e 's#</loc>$##' -e 's#&amp;#\&#g' || true; }
# The path of every loc on https://<host>; a loc on another origin is dropped and counted.
own_paths(){ local host=$1 u p n=0
  while IFS= read -r u; do
    case "$u" in "https://$host"|"https://$host/"*) p=${u#"https://$host"}; printf '%s\n' "${p:-/}";; *) n=$((n+1));; esac
  done
  [ "$n" = 0 ] || warn "$n sitemap loc(s) not on https://$host were skipped" >&2; }

# ── 1. THE RENT INDEX (eno.vn only; the services edition answers 404 there) ─────────────────────
# Fresh means: the CSV answers 200 and its snapshot_utc is no earlier than the container's start.
# Both are ISO-8601 UTC, so the first 19 characters compare as strings — no date arithmetic, which
# differs between GNU and BSD `date`.
rent_index(){ local addr=$1 host=$2 try code t snap why first
  first=$(date -u +%Y-%m-%dT%H:%M:%S)
  for try in $(seq 0 "$RETRIES"); do
    if [ "$try" -gt 0 ]; then
      [ $(( $(date +%s) + RETRY_WAIT )) -lt "$DEADLINE" ] || { warn "rent index: out of time budget"; return 1; }
      warn "rent index not ready ($why); retry $try of $RETRIES in ${RETRY_WAIT}s"
      sleep "$RETRY_WAIT"
    fi
    code=$(fetch "$addr" "$host" /hcmc-rent-index en-US rent-index /dev/null "$RENT_MAX")
    [ "$code" = skip ] && { warn "rent index: not sent: $(why_halted)"; return 1; }
    t=$(tail -1 "$TSV" | cut -f5)
    # ⛔ THE COLD SNAPSHOT TIME, ON ITS OWN LINE: this first request computes it (the cache is per
    # build). D3's gate compares it with R1's loader, so it is printed whatever else happens.
    [ "$try" = 0 ] && say "rent-index-cold ${t}s (HTTP $code)"
    code=$(fetch "$addr" "$host" /hcmc-rent-index.csv - rent-index-csv "$TMP/rent.csv" "$RENT_MAX")
    [ "$code" = skip ] && { warn "rent index: CSV not sent: $(why_halted)"; return 1; }
    if [ "$code" != 200 ]; then why="CSV HTTP $code"; continue; fi
    snap=$(sed -n '2p' "$TMP/rent.csv" | cut -d, -f1)
    if ! [[ "$snap" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2} ]]; then why="no snapshot_utc in the CSV"; continue; fi
    if [ -n "$SINCE" ] && [[ "${snap:0:19}" < "${SINCE:0:19}" ]]; then why="snapshot $snap predates $SINCE"; continue; fi
    # R1 adds a rules_version column; until then this prints nothing.
    local rv; rv=$(awk -F, 'NR==1{for(i=1;i<=NF;i++) if($i=="rules_version") c=i} NR==2&&c{print $c}' "$TMP/rent.csv" | tr -d '\r')
    if [ -n "$SINCE" ]; then say "rent index: snapshot $snap from this build${rv:+, rules_version $rv} (container up since ${SINCE:0:19}Z)"
    else say "rent index: snapshot $snap${rv:+, rules_version $rv} (freshness not checked: no --since)"; fi
    # ⚠️ A snapshot older than this warm-up's first request was computed by someone else (a crawler,
    # a visitor) between the swap and this step, so the number above timed a cache read, not a cold
    # computation. Said here, because D3's gate reads that number.
    [[ "${snap:0:19}" < "$first" ]] && warn "rent-index-cold above is NOT a cold time: the snapshot predates this warm-up ($first)"
    return 0
  done
  warn "rent index: no snapshot from this build after $RETRIES retries ($why)"
  return 1
}

# ── 2 + 3. SITEMAPS, THEN PAGES, FOR ONE SITE ─────────────────────────────────────────────────────
warm_site(){ local addr=$1 host=$2 code child n=0 paths
  paths=$TMP/$host.paths   # ⚠️ not in the `local` line: its expansions run before `host` is set
  : > "$paths"
  code=$(fetch "$addr" "$host" /sitemap.xml - sitemap "$TMP/index.xml")
  [ "$code" = skip ] && code="nothing ($(why_halted))"
  if [ "$code" != 200 ]; then warn "$host: /sitemap.xml answered $code; its pages were not warmed"; return 0; fi
  while IFS= read -r child; do
    code=$(fetch "$addr" "$host" "$child" - sitemap "$TMP/child.xml")
    if [ "$code" = 200 ]; then locs "$TMP/child.xml" | own_paths "$host" >> "$paths"; n=$((n+1))
    else warn "$host: $child answered $code; its URLs were not warmed"; fi
  done < <(locs "$TMP/index.xml" | own_paths "$host")
  # /c/rentals first among the pages: its HTML names the district pages, which are warmed with the
  # rest, and it warms H1b's hourly rentals headline.
  code=$(fetch "$addr" "$host" /c/rentals en-US page "$TMP/rentals.html")
  fetch "$addr" "$host" /c/rentals vi-VN page >/dev/null
  [ "$code" = 200 ] && { grep -o 'href="/c/rentals/[a-z0-9-]*"' "$TMP/rentals.html" | cut -d'"' -f2 >> "$paths" || true; }
  # ⛔ THE LONG TAIL FIRST, THE PAGES THAT MATTER MOST LAST — BECAUSE THE CACHE CANNOT HOLD THEM ALL.
  # cache-handler.cjs keeps pages in an in-process LRU capped at 96 MB (L1_MAX_BYTES), and the warm
  # set is twice that. MEASURED on a local production build of eno.vn (2026-09-29, the cache
  # handler instrumented): the warm-up wrote 213 MB in 383 entries and 176 were evicted. Warmed in
  # sitemap order, 0 of the 97 home, category, district and sitemap entries were still cached
  # afterwards; warmed in this order, 97 of 97. So: listings, then guides and other pages, then
  # the category subpages and districts, then the categories, then home.
  LC_ALL=C sort -u "$paths" | grep -vx '/c/rentals' | grep -E '^/[^[:space:]]*$' \
    | awk '{ r = $0 == "/" ? 4 : $0 ~ /^\/c\/[^\/]+$/ ? 3 : $0 ~ /^\/c\// ? 2 : $0 ~ /^\/listings\// ? 0 : 1; print r "\t" $0 }' \
    | LC_ALL=C sort -s -t$'\t' -k1,1n | cut -f2- > "$paths.u" || true
  local total; total=$(wc -l < "$paths.u" | tr -d ' ')
  say "$host: $n sitemap file(s), $total pages to warm (+ /c/rentals), en then vi"
  if [ "$DRY" = 1 ]; then
    cp "$paths.u" "${TSV%.tsv}.$host.plan" 2>/dev/null
    say "dry run: would send $((total * 2)) page requests; list in ${TSV%.tsv}.$host.plan"
    return 0
  fi
  # NUL-separated (lang, path) pairs, so no path is ever split or unquoted by xargs. Never on an
  # empty list: GNU xargs would still run the worker once, with no path.
  [ "$total" -gt 0 ] && { while IFS= read -r p; do printf 'en-US\0%s\0vi-VN\0%s\0' "$p" "$p"; done < "$paths.u" \
    | xargs -0 -n 2 -P "$CONC" bash -c 'page "$@"' _ "$addr" "$host" \
    || warn "$host: a page worker failed (see the TSV)"; }
  local sent; sent=$(awk -F'\t' -v h="https://$host/" '$6 == "page" && index($1, h) == 1' "$TSV" | wc -l | tr -d ' ')
  [ "$sent" -ge $((total * 2 + 2)) ] || warn "$host: $(why_halted); $(( total * 2 + 2 - sent )) page request(s) not sent"
  # ⚠️ AND THE FIRST WRITES ARE READ AGAIN LAST, so they are the most recently used when the flood
  # ends: /c/rentals, the sitemaps, and on eno.vn the rent snapshot (its CSV reads the one cache
  # entry the page and pages.xml share). A hit costs a cache read; an evicted one is simply rebuilt.
  halted && return 0
  fetch "$addr" "$host" /c/rentals en-US retouch >/dev/null
  fetch "$addr" "$host" /c/rentals vi-VN retouch >/dev/null
  fetch "$addr" "$host" /sitemap.xml - retouch >/dev/null
  while IFS= read -r child; do fetch "$addr" "$host" "$child" - retouch >/dev/null; done < <(locs "$TMP/index.xml" | own_paths "$host" 2>/dev/null)
  [ "$host" = "$VN_HOST" ] && fetch "$addr" "$host" /hcmc-rent-index.csv - retouch >/dev/null
  return 0
}

# ── SUMMARY: count, codes and time to first byte (p50 / p95 / max) per site and page type ─────────
summary(){
  awk -F'\t' 'NR > 1 && $6 == "page" {
      site = $1; sub(/^https:\/\//, "", site); sub(/\/.*/, "", site)
      p = $1; sub(/^https:\/\/[^\/]*/, "", p)
      t = (p == "" || p == "/") ? "home" : p ~ /^\/c\/rentals\/[^\/]+$/ ? "district" : p ~ /^\/c\/[^\/]+$/ ? "category" \
        : p ~ /^\/c\// ? "category-sub" : p ~ /^\/listings\// ? "listing" : p ~ /^\/help\// ? "help" : "other"
      codes[site] = codes[site] " " $3
      if ($3 != "000") { print site "\tall\t" $4; print site "\t" t "\t" $4 }
    }
    END { for (s in codes) print s "\t!codes\t" codes[s] }' "$TSV" \
  | LC_ALL=C sort -t$'\t' -k1,1 -k2,2 -k3,3n \
  | awk -F'\t' '
    function flush(   i50, i95) {
      if (g == "") return
      i50 = int(n * 0.50); if (i50 < n * 0.50) i50++; if (i50 < 1) i50 = 1
      i95 = int(n * 0.95); if (i95 < n * 0.95) i95++; if (i95 < 1) i95 = 1
      printf "  %-15s %-13s n=%-4d ttfb p50 %.3fs  p95 %.3fs  max %.3fs\n", s, k, n, v[i50], v[i95], v[n]
    }
    $2 == "!codes" {   # "!" sorts before every page type, so the codes lead each site
      flush(); g = ""
      m = split($3, c, " "); delete h; line = ""
      for (i = 1; i <= m; i++) h[c[i]]++
      for (x in h) line = line " " x "x" h[x]
      printf "  %-15s HTTP%s\n", $1, line; next
    }
    { key = $1 "\t" $2; if (key != g) { flush(); g = key; s = $1; k = $2; n = 0 } v[++n] = $3 + 0 }
    END { flush() }'
  local bad; bad=$(awk -F'\t' 'NR > 1 && $6 == "page" && $3 != "200" { print "    " $3 " " $2 " " $1 }' "$TSV" | head -5)
  [ -z "$bad" ] || { warn "page requests that did not answer 200 (first 5):"; printf '%s\n' "$bad"; }
}

t0=$(date +%s)
say "log: $TSV"
if [ -n "$VN" ]; then
  if rent_index "$VN" "$VN_HOST"; then warm_site "$VN" "$VN_HOST"
  else
    # ⛔ NO SITEMAP FETCH WITHOUT A SNAPSHOT: from D3, pages.xml throws until the snapshot works and
    # Next caches nothing on a cold throw, so each fetch would only start another failing read.
    warn "$VN_HOST: sitemaps and pages NOT warmed, because the rent index has no snapshot from this build"
  fi
fi
[ -n "$FORUM" ] && warm_site "$FORUM" "$FORUM_HOST"
say "warm-up took $(( $(date +%s) - t0 ))s"
summary
exit 0
