#!/usr/bin/env bash
# Give GoTrue (Supabase Auth) a database connection pool on the VN box (speed plan item 6; owner: "Yes, apply it").
#   bash infra/vn-node/apply-gotrue-db-pool.sh             preflight, write, recreate auth, verify — and on a failure put
#                                                          the override back and recreate auth again, in the same run;
#                                                          if someone ELSE edited the override meanwhile, it does not
#                                                          erase their edit — it says so and leaves the merge to a person
#   DRY_RUN=1 bash infra/vn-node/apply-gotrue-db-pool.sh   every check and the exact change, nothing written
# ⚠️ ONE-SHOT, NO UNDO MODE (gate review, four rounds): a general "remove the settings later" mode kept meeting new edge
# cases (hand-edited blocks, keys that predated it, later edits a whole-file restore would erase). Undoing a pool that
# works is a deliberate act with context: delete the four lines this prints, then
# `cd /opt/eno/supabase && docker compose up -d --no-deps auth`.
#   ENO_SSH_KEY=… points at the box key. The run itself is detached ON THE BOX (setsid) and logs to
#   /var/log/eno-gotrue-pool.log, which this script follows: a dropped connection cannot stop it half-way — and
#   Ctrl-C only stops the FOLLOWING, not the run; read that log for how it ended.
# ⚠️ RECREATING AUTH IS A SIGN-IN BLIP (~5 s, up to 60 s before a rollback): an OTP verify or a token refresh in that
# window fails and is retried by the client. Run it off-peak.
#
# ⛔ MEASURED 2026-10-16 — WHY THIS EXISTS. GoTrue v2.189 logged at startup
#   {"config_max_pool_size":0,"config_max_idle_pool_size":0,"config_conn_max_idle_time":"0s","config_conn_max_lifetime":"0s",
#    "limit_max_open_conns":0,"limit_max_idle_conns":0,"limit_conn_max_idle_time":"0s","limit_conn_max_lifetime":"0s",
#    "limit_strategy":"fixed","server_max_conns":100,"msg":"applying connection limits to db using the \"fixed\" strategy"}
# — Supabase's compose sets no GOTRUE_DB_* pool keys, and internal/storage/dial.go then calls
# sql.DB.SetMaxIdleConns(0): GoTrue kept NO idle connection, so every query opened a fresh Postgres connection (TCP,
# startup, SCRAM, a backend with Supabase's preload libraries) and closed it. pg_stat_activity showed zero
# supabase_auth_admin backends between requests, ~8 new sessions per auth request; GoTrue's own log: GET /user p50 119 ms
# / p95 149 ms, POST /token p50 183 ms — while each of its queries takes ~0.1 ms (pg_stat_statements). Every sign-in,
# token refresh and getUser() paid it, web and native alike. (dial.go logs the durations with .String(): "10m0s".)
#
# ⚠️ UP TO 5 KEPT IDLE — AND NO NEW CAP ON OPEN CONNECTIONS. Up to 5 idle connections serve GoTrue's ~1 ms queries
# thousands of times a second; that is the whole fix. The open count stays as unbounded as it is today (gate review): GoTrue
# sends a sign-in email or SMS while holding its transaction, so ANY cap turns a burst of slow or hung sends into every
# getUser() and refresh queueing behind them on both sites — a failure mode this change must not add. max_connections is
# 100 (3 reserved); ~33 client backends at rest, a deploy build adds up to ~45 (src/lib/db.ts) — the preflight requires
# room for the 5 kept connections and a build.
# ⚠️ IDLE TIME AND LIFETIME TOO (plan review): a connection held forever survives a Postgres restart as a dead socket, and
# the first query on it fails; 10 minutes idle and 1 hour total recycle them (and the 5 close overnight when idle).
set -euo pipefail
POOL_IDLE=5
# KEY=VALUE, all non-secret, pinned in the override (the .env holds the secrets; these hold none). No MAX_POOL_SIZE: 0 = no
# cap, as today (see above).
SETTINGS=(GOTRUE_DB_MAX_IDLE_POOL_SIZE=$POOL_IDLE GOTRUE_DB_CONN_MAX_IDLE_TIME=10m GOTRUE_DB_CONN_MAX_LIFETIME=1h)
# ⛔ DRY_RUN is 0 or 1, nothing else (gate review): `DRY_RUN=true` must never be read as "not a dry run" and change prod.
case "${DRY_RUN:-0}" in 0|1) ;; *) echo "DRY_RUN must be 0 or 1 (got '${DRY_RUN}')"; exit 2 ;; esac
NOTE='# GoTrue keeps NO idle DB connection without these (infra/vn-node/apply-gotrue-db-pool.sh)'

# The override edit, shared by the box run and the local test (`_merge <file>`). Line-level, inside the ONE
# services.auth.environment mapping (the shape apply-google/apple/linkedin-signin.sh keep): every other byte kept — the
# trailing newlines included — anything ambiguous refused, never guessed. Exit 0 = written, 10 = already set to these
# values, 4 = refused.
read -r -d '' EDIT_PY <<'PYEOF' || true
import re, sys
p, note_text, settings = sys.argv[1], sys.argv[2], [a.split('=', 1) for a in sys.argv[3:]]
def die(m): print('  ⛔ override: ' + m); sys.exit(4)
text = open(p).read()
if '\r' in text or '\t' in text: die('CRLF or tabs — edit by hand')
body_text = text.rstrip('\n')
tail = text[len(body_text):]  # the file's own trailing newlines, written back exactly
lines = body_text.split('\n')
ind = lambda l: len(l) - len(l.lstrip(' '))
sig = lambda l: l.strip() and not l.strip().startswith('#')
svc = [i for i, l in enumerate(lines) if re.match(r'^services\s*:\s*(#.*)?$', l)]
if len(svc) != 1: die(f'expected one top-level services:, found {len(svc)}')
end_of = lambda start, base: next((j for j in range(start + 1, len(lines)) if sig(lines[j]) and ind(lines[j]) <= base), len(lines))
s_end = end_of(svc[0], 0)
first = next((i for i in range(svc[0] + 1, s_end) if sig(lines[i])), None)
if first is None: die('services: is empty')
si = ind(lines[first])  # a SERVICE is a direct child of services: — this indent exactly, never a key nested deeper
auth = [i for i in range(svc[0] + 1, s_end) if ind(lines[i]) == si and re.match(r'^ +auth\s*:\s*(#.*)?$', lines[i])]
if len(auth) != 1: die(f'expected one services.auth, found {len(auth)} — edit by hand')
a0 = auth[0]; ai = ind(lines[a0]); a_end = end_of(a0, ai)
af = next((i for i in range(a0 + 1, a_end) if sig(lines[i])), None)
if af is None: die('services.auth is empty')
env = [i for i in range(a0 + 1, a_end) if ind(lines[i]) == ind(lines[af]) and re.match(r'^ +environment\s*:\s*(#.*)?$', lines[i])]
if len(env) != 1: die(f'expected one services.auth.environment block mapping, found {len(env)}')
e0 = env[0]; ei = ind(lines[e0]); e_end = end_of(e0, ei)
body = [i for i in range(e0 + 1, e_end) if sig(lines[i])]
if not body: die('services.auth.environment is empty')
ki = ind(lines[body[0]])
if any(lines[i].lstrip().startswith('-') for i in body): die('services.auth.environment is a list, expected KEY: value')
if any(ind(lines[i]) != ki for i in body): die('services.auth.environment has mixed indentation — edit by hand')
have = {}
for i in body:
    m = re.match(r'^ *([A-Z0-9_]+)\s*:\s*(.*?)\s*(#.*)?$', lines[i])
    if not m: continue
    if m.group(1) in have: die(f'{m.group(1)} appears twice in services.auth.environment — edit by hand')
    have[m.group(1)] = m.group(2).strip('"\'')
for k, v in settings:
    if k in have and have[k] != v: die(f'{k} is already {have[k]!r} — change it by hand, or re-run with that value')
add = [f'{" " * ki}{k}: "{v}"' for k, v in settings if k not in have]
if not add: print('  compose override: GoTrue pool settings already in place'); sys.exit(10)
out = lines[:body[-1] + 1] + [' ' * ki + note_text] + add + lines[body[-1] + 1:]
open(p, 'w').write('\n'.join(out) + tail)
print(f'  compose override: {len(add)} GoTrue pool setting(s) added to services.auth.environment')
PYEOF

case "${1:-}" in
  _merge) exec python3 -c "$EDIT_PY" "$2" "$NOTE" "${SETTINGS[@]}" ;;
  '') ;;
  # Anything else is a mistake (--dry-run, -n, --help): never let it fall through to a real change (gate review).
  *) echo "usage: [DRY_RUN=1] bash infra/vn-node/apply-gotrue-db-pool.sh   (no arguments; see the header)"; exit 2 ;;
esac

KEY="${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"
{ printf 'GP_DRY=%q\nGP_IDLE=%q\nGP_SETTINGS=%q\nGP_NOTE=%q\nEDIT_PY=%q\n' \
    "${DRY_RUN:-0}" "$POOL_IDLE" "${SETTINGS[*]}" "$NOTE" "$EDIT_PY"; cat <<'REMOTE'
set -euo pipefail
rm -f -- "$0" # this copy of the script: nothing is left behind in /tmp, whatever happens to the connection (gate review)
cd /opt/eno/supabase
OV=docker-compose.override.yml
# Temporary copies of the override never outlive the run, however it ends (gate review).
T=""; SNAP=""; WROTE=""
cleanup() { rm -f -- ${T:+"$T"} ${SNAP:+"$SNAP"} ${WROTE:+"$WROTE"}; }
trap cleanup EXIT
# One run at a time (gate review): two would race the override and the recreate, and one's rollback could undo the other.
exec 9>/run/lock/eno-gotrue-pool.lock
flock -n 9 || { echo "  ⛔ another apply-gotrue-db-pool run holds the lock"; exit 3; }
# Every command gets </dev/null: none of them has any business reading input (an interactive docker exec once ate the
# rest of an earlier draft that still ran from ssh's stdin).
psqlx() { docker exec "$(docker compose ps -q db </dev/null | head -1)" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA "$@" </dev/null; }
authc() { docker compose ps -q auth </dev/null | head -1; }
# GoTrue's own startup line: the limits it actually applied (config values only — no secret is in it).
# ⚠️ `|| true` (gate review): under pipefail a grep that finds no line would fail the function, and set -e would end the
# run right there, silently — a missing line must print "None None None None" instead.
limits() {
  { docker logs "$1" </dev/null 2>&1 | grep '"applying connection limits' || true; } | tail -1 \
    | python3 -c 'import json,sys; o=json.loads(sys.stdin.read() or "{}"); print(o.get("limit_max_open_conns"), o.get("limit_max_idle_conns"), o.get("limit_conn_max_idle_time"), o.get("limit_conn_max_lifetime"))'
}
# The FIRST network's address: a container on two networks would otherwise print both run together (gate review).
healthy() {
  local ip
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$1" </dev/null | awk '{print $1}')
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$ip:9999/health" </dev/null || true
}
# Recreate and wait for a HEALTHY auth container — whichever id it has (what proves the settings took is the limits
# check after, not a new id).
recreate() {
  # ⛔ --no-deps: a plain `up -d auth` also recreates any dependency whose config drifted (the db!).
  # Its own exit status, explicitly (gate review): this runs inside `x=$(recreate) || …`, where set -e is suspended, and a
  # failed up must never pass because the OLD container is still healthy.
  docker compose up -d --no-deps auth </dev/null >/dev/null || return 1
  local c="" i
  for i in $(seq 1 30); do
    c=$(authc); [ -n "$c" ] && [ "$(healthy "$c")" = "200" ] && { echo "$c"; return 0; }
    sleep 2
  done
  return 1
}
WANT="0 $GP_IDLE 10m0s 1h0m0s"
edit() { python3 -c "$EDIT_PY" "$1" "$GP_NOTE" $GP_SETTINGS </dev/null; }
gateway() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8000/auth/v1/.well-known/jwks.json </dev/null || true; }
# After a recreate the gateway can answer from a stale upstream for a moment (gate review): poll ~20 s before deciding.
gateway_ok() { local i; for i in $(seq 1 10); do [ "$(gateway)" = "200" ] && return 0; sleep 2; done; return 1; }
# A request that makes GoTrue QUERY POSTGRES through the new pool, with no secret and no write (gate review): a PKCE
# exchange with an invented code — GoTrue looks the flow up and answers 404 flow_state_not_found. Straight to the container
# (no gateway key needed). A broken pool answers 500.
db_probe() {
  local ip
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$1" </dev/null | awk '{print $1}')
  curl -s --max-time 10 -X POST -H 'content-type: application/json' -d '{"auth_code":"eno-pool-probe","code_verifier":"eno-pool-probe"}' \
    "http://$ip:9999/token?grant_type=pkce" </dev/null | grep -o 'flow_state_not_found' | head -1 || true
}

OLD=$(authc); [ -n "$OLD" ] || { echo "  ⛔ cannot find the running GoTrue (auth) container"; exit 3; }
echo "  GoTrue limits now (open idle idle-time lifetime): $(limits "$OLD")"

echo "=== PREFLIGHT (nothing is written unless every check passes) ==="
[ "$(healthy "$OLD")" = "200" ] || { echo "  ⛔ GoTrue /health is not 200 before the change — fix that first"; exit 3; }
# ⛔ NOTHING ELSE MAY RIDE ALONG (gate review): the recreate below rebuilds auth from the CURRENT compose files, so a
# pending change — an image tag bumped, a sign-in script's .env edit not yet applied — would go live with it, unreviewed.
# Compose stamps each container with its config hash; the running one must match the files exactly before we touch them.
WANT_HASH=$(docker compose config --hash auth </dev/null | awk '{print $2}')
RUN_HASH=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$OLD" </dev/null)
[ -n "$WANT_HASH" ] && [ "$WANT_HASH" = "$RUN_HASH" ] || { echo "  ⛔ auth's compose config already differs from the running container ($RUN_HASH → $WANT_HASH): another change is pending — apply or revert it first"; exit 3; }
echo "  auth runs exactly what its compose files say ✅"
GW=$(gateway)
[ "$GW" = "200" ] || { echo "  ⛔ the gateway's jwks answers $GW before the change — the check after it would mean nothing"; exit 3; }
read -r MAXC RES BUSY <<<"$(psqlx -F' ' -c "select current_setting('max_connections')::int, current_setting('superuser_reserved_connections')::int, (select count(*) from pg_stat_activity where backend_type = 'client backend')" || true)"
[[ "$MAXC" =~ ^[0-9]+$ && "$RES" =~ ^[0-9]+$ && "$BUSY" =~ ^[0-9]+$ ]] || { echo "  ⛔ could not read the connection counts from Postgres (psql) — nothing written"; exit 3; }
FREE=$((MAXC - RES - BUSY))
# ⚠️ Room for the 5 kept connections AND a deploy build (~45): the pool must never be what makes a build fail.
[ "$FREE" -ge $((GP_IDLE + 45)) ] || { echo "  ⛔ only $FREE connections free (max $MAXC, reserved $RES, open $BUSY) — GoTrue's $GP_IDLE kept connections plus a deploy build's ~45 would not fit"; exit 3; }
echo "  Postgres: $BUSY of $MAXC open, $FREE free for non-superusers ✅"
# The snapshot everything is derived from: the change is built from it, the backup IS it, and the write happens only if
# the override still equals it (gate review: a backup taken later could already contain another script's edit).
SNAP=$(mktemp); cp "$OV" "$SNAP"
T=$(mktemp); cp "$SNAP" "$T"
set +e; edit "$T"; RC=$?; set -e
# Only 0 (changed) and 10 (already there) go on: a refusal (4) or anything unexpected — a traceback — stops here.
[ "$RC" = "0" ] || [ "$RC" = "10" ] || { rm -f "$T" "$SNAP"; echo "  ⛔ the override edit stopped (exit $RC) — nothing written"; exit 3; }
if [ "$RC" = "10" ]; then
  rm -f "$T" "$SNAP"
  L=$(limits "$OLD")
  [ "$L" = "$WANT" ] && { echo "  nothing to do: the override and the running GoTrue already have the pool"; exit 0; }
  # A log line that shows OTHER limits means GoTrue runs these files and ignores the settings: that is a failure. Only a
  # MISSING line (the log rotated) is accepted — the config-hash check above says the container runs these files.
  [ "$L" = "None None None None" ] || { echo "  ⛔ the override has the pool but GoTrue reports '$L' — it is not applying it"; exit 1; }
  # The log rotated, so nothing here can PROVE the limits apply (the config hash proves the files, not GoTrue's reading
  # of them — gate review). Say so rather than claim it; a deliberate recreate prints the line again.
  echo "  ⚠️ the override already has the pool, but GoTrue's startup log no longer shows its limits — cannot verify."
  echo "     To check: cd /opt/eno/supabase && docker compose up -d --no-deps --force-recreate auth, then re-run DRY_RUN=1."
  exit 1
fi
echo "  the change to $OV:"; diff "$OV" "$T" </dev/null | sed 's/^/    /' || true
if [ "$GP_DRY" = "1" ]; then rm -f "$T" "$SNAP"; echo "=== DRY RUN: every check passed, nothing written ==="; exit 0; fi

echo "=== WRITE ==="
STAMP=$(date +%Y%m%d%H%M%S)
cp "$SNAP" "$OV.bak-gotrue-pool-$STAMP"
rollback() {
  trap - ERR INT TERM
  # Only if the override still holds exactly what THIS run wrote (gate review): an edit made meanwhile is not ours to erase.
  if [ -n "$WROTE" ] && ! cmp -s "$OV" "$WROTE"; then
    echo "  ⛔ $OV changed after this run wrote it — NOT restoring; compare it with $OV.bak-gotrue-pool-$STAMP by hand"
    return 0
  fi
  echo "  ↩ rolling back: $OV from $OV.bak-gotrue-pool-$STAMP"
  rm -f "$OV.tmp-gotrue-pool-$STAMP"
  cp "$OV.bak-gotrue-pool-$STAMP" "$OV.tmp-gotrue-pool-$STAMP" && mv -f "$OV.tmp-gotrue-pool-$STAMP" "$OV"
  # …and WAIT for a healthy GoTrue before saying anything (gate review): a rollback that leaves sign-in down must say so.
  local c
  # Healthy means the container AND the gateway users actually go through (gate review).
  if c=$(recreate) && gateway_ok; then echo "  auth healthy again through the gateway; limits (open idle idle-time lifetime): $(limits "$c")"
  else echo "  ⛔ auth is NOT healthy after the rollback — run: cd /opt/eno/supabase && docker compose up -d --no-deps auth; docker compose logs --tail=50 auth"
       echo "     If GoTrue's own /health is 200 but the gateway is not, the gateway still holds the old address: docker restart supabase-envoy"; fi
}
trap 'rollback' ERR
trap 'rollback; exit 1' INT TERM
# The override must still be the file we read (gate review): another script editing it in between would be overwritten.
cmp -s "$OV" "$SNAP" || { trap - ERR INT TERM; rm -f "$T" "$SNAP"; echo "  ⛔ $OV changed while this ran — nothing written"; exit 3; }
# The record of what this run writes exists BEFORE the write (gate review), so a rollback can always tell ours from theirs.
WROTE="$T.written"; cp "$T" "$WROTE"
# ATOMIC (gate review): a full copy beside the file, then a rename — the override is the old file or the new one, never a
# half-written one (a full disk mid-copy would otherwise leave compose a truncated YAML).
cp "$T" "$OV.tmp-gotrue-pool-$STAMP" && mv -f "$OV.tmp-gotrue-pool-$STAMP" "$OV"
rm -f "$T" "$SNAP"
NEW=$(recreate) || { echo "  ⛔ the new GoTrue did not answer /health within 60 s"; rollback; exit 1; }
echo "=== VERIFY ==="
L=$(limits "$NEW")
[ "$L" = "$WANT" ] || { echo "  ⛔ the new GoTrue applied limits '$L', not '$WANT'"; rollback; exit 1; }
echo "  GoTrue applied limits (open idle idle-time lifetime): $L ✅"
gateway_ok || { echo "  ⛔ the gateway's /auth/v1/.well-known/jwks.json did not answer 200 within ~20 s (last: $(gateway))"; rollback; exit 1; }
echo "  gateway -> GoTrue: /auth/v1/.well-known/jwks.json 200 ✅"
[ "$(db_probe "$NEW")" = "flow_state_not_found" ] || { echo "  ⛔ GoTrue did not answer a query that reads Postgres (a PKCE lookup)"; rollback; exit 1; }
echo "  GoTrue -> Postgres through the pool: a PKCE lookup answered flow_state_not_found ✅"
trap - ERR INT TERM
echo "  Done. Backup: $OV.bak-gotrue-pool-$STAMP. To undo deliberately: delete the four lines shown above from $OV,"
echo "  then: cd /opt/eno/supabase && docker compose up -d --no-deps auth"
REMOTE
} | ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ServerAliveInterval=30 -p "$PORT" "$HOST" \
  'f=$(mktemp /tmp/eno-gotrue-pool.XXXXXX); cat > "$f"; log=/var/log/eno-gotrue-pool.log; echo "── $(date -u +%FT%TZ)" >> "$log"
   # ⛔ DETACHED (gate review): setsid puts the run in its own session, so a dropped connection neither kills it nor breaks
   # its output (it writes to the log, not to this pipe); tail follows the log, from this run on, while the run lives.
   from=$(($(stat -c %s "$log") + 1))
   setsid bash "$f" >> "$log" 2>&1 </dev/null & pid=$!
   tail --pid="$pid" -c "+$from" -f "$log"; wait "$pid"; rc=$?; rm -f "$f"; exit "$rc"'
