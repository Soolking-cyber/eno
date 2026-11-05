#!/usr/bin/env bash
# Import from Facebook on the box, run from this Mac.
#   bash infra/vn-node/apply-fb-import.sh                 before the deploy: tables, worker token, AI key
#   bash infra/vn-node/apply-fb-import.sh --after-deploy  after it: the hourly timer, the reader image, the worker
#   bash infra/vn-node/apply-fb-import.sh --login         a person logs in to the reading account in the box's own browser (also after a wall)
#   bash infra/vn-node/apply-fb-import.sh --stop          stops the worker; nothing reads Facebook
# Prints no secret. Undo all of it: --stop, then on the box: docker rm eno-fb-worker; docker rmi eno-fb-reader; docker network rm eno-fb; rm -rf /opt/eno/fb-reader
# ⛔ The session is typed in by a person on the box. Never copied here: that locked an account (2026-11-04). A wall stops the worker until --login. Nothing answers Facebook.
set -euo pipefail
MODE="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="$HOME/.ssh/CS-Linux-20260920135129228.pem"; HOST=root@162.4.176.233; PORT=24700
OPTS=(-o IdentitiesOnly=yes -o BatchMode=yes -i "$KEY")
box() { ssh "${OPTS[@]}" -p "$PORT" "$HOST" "$@"; }
HOME_DIR=/opt/eno/fb-reader/home
RUN="docker run --init --cpus=1.5 --memory=2g --memory-swap=2g --shm-size=512m --security-opt no-new-privileges --network eno-fb --user pwuser -v $HOME_DIR:/home/pwuser/eno-fb-import"

build_image() {
  # Its user inside the container is 1001: a folder left to root stops every job at its first page count.
  box 'umask 077; mkdir -p /opt/eno/fb-reader/build '"$HOME_DIR"'/secrets '"$HOME_DIR"'/state; chown -R 1001:1001 '"$HOME_DIR"
  tar -C "$ROOT/scripts/fb-import-worker" -cf - Dockerfile package.json login.mjs worker.mjs reader.mjs start-login.sh | box 'tar -C /opt/eno/fb-reader/build -xf -'
  box 'cd /opt/eno/fb-reader/build && nice -n 19 docker build -q -t eno-fb-reader . >/dev/null && echo "  reader image built ✅"; docker network inspect eno-fb >/dev/null 2>&1 || docker network create eno-fb >/dev/null'
}

case "$MODE" in
"")
  echo "=== Tables ==="
  { echo 'SET ROLE postgres;'; cat "$ROOT/scripts/fb-import-ddl.sql"; } | box 'DBC=$(cd /opt/eno/supabase && docker compose ps -q db | head -1); [ -n "$DBC" ] || { echo "  ⛔ no database container"; exit 3; }; docker exec -i "$DBC" psql -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres --single-transaction; docker exec "$DBC" psql -tA -U supabase_admin -d postgres -c "select count(*) from pg_class where relname in ('"'"'FacebookImportJob'"'"','"'"'FacebookImportItem'"'"') and relrowsecurity" </dev/null | grep -qx 2 && echo "  both tables there, row security on ✅" || { echo "  ⛔ tables or row security missing"; exit 3; }'
  echo "=== Accounts that may never read ==="
  # login.mjs refuses to start without this list: it is what keeps the leads account out.
  NEVER="$HOME/eno-fb-import/secrets/never-read-as.txt"
  [ -s "$NEVER" ] || { echo "  ⛔ $NEVER must name the leads account, one name a line. Stop."; exit 3; }
  box 'umask 077; mkdir -p '"$HOME_DIR"'/secrets; cat > '"$HOME_DIR"'/secrets/never-read-as.txt' < "$NEVER"
  echo "  list on the box ✅"
  echo "=== Worker token and AI key ==="
  box 'set -e; E=/opt/eno/secrets/eno-vn.env; umask 077; mkdir -p '"$HOME_DIR"'/secrets; grep -q "^FB_IMPORT_WORKER_TOKEN=" "$E" || { cp -p "$E" "$E.bak-fbimport-$(date +%Y%m%d%H%M)"; printf "\nFB_IMPORT_WORKER_TOKEN=%s\n" "$(openssl rand -hex 32)" >> "$E"; echo "  worker token created ✅"; }; grep -m1 "^FB_IMPORT_WORKER_TOKEN=" "$E" | cut -d= -f2- | tr -d "\n" > '"$HOME_DIR"'/secrets/worker.token; chown -R 1001:1001 '"$HOME_DIR"'; echo "  worker has the token ✅"; grep -q "^OPENAI_API_KEY=sk-" "$E" && echo "  OPENAI_API_KEY already on the box ✅" || echo "  ⛔ OPENAI_API_KEY is not on the box: import falls back to Gemini until it is"'
  # Every connected Facebook adds to the sign-in cookie: without the larger limit, pages answer 400 until cookies are cleared.
  box 'test -f /etc/nginx/conf.d/eno-header-buffers.conf && echo "  nginx header limit in place ✅" || { echo "  ⛔ /etc/nginx/conf.d/eno-header-buffers.conf is missing: copy infra/vn-node/nginx/eno-header-buffers.conf there and reload nginx. Stop."; exit 3; }'
  echo "=== DONE. Now deploy, then: bash infra/vn-node/apply-fb-import.sh --after-deploy ==="
  ;;
--after-deploy)
  echo "=== Reader ==="
  build_image
  box "docker rm -f eno-fb-worker >/dev/null 2>&1; rm -rf $HOME_DIR/out; rm -f $HOME_DIR/profile/Singleton*; $RUN -d --name eno-fb-worker --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 -e ENO_API=https://eno.vn -e TZ=Asia/Ho_Chi_Minh eno-fb-reader node /app/worker.mjs >/dev/null && echo '  worker running ✅'"
  echo "=== Hourly timer ==="
  box 'ENO_CRON_ONLY=fb-import bash /opt/eno/app/infra/vn-node/cron/install-cron-timers.sh >/dev/null && systemctl enable --now eno-cron-fb-import.timer >/dev/null 2>&1 && echo "  timer on ✅" || echo "  ⚠️ check the fb-import timer"'
  echo "=== First minute of the worker ==="
  sleep 70
  box 'docker ps --filter name=eno-fb-worker --format "{{.Status}}"; docker logs eno-fb-worker 2>&1 | tail -5 | cut -c1-160; A=$(docker inspect -f "{{.RestartCount}}" eno-fb-worker); echo "restarts: $A"'
  ;;
--login)
  build_image
  box "docker stop eno-fb-worker >/dev/null 2>&1 || true; docker rm -f eno-fb-login >/dev/null 2>&1; rm -f $HOME_DIR/profile/Singleton*; $RUN -d --name eno-fb-login -p 127.0.0.1:6080:6080 eno-fb-reader /app/start-login.sh >/dev/null"
  ssh "${OPTS[@]}" -p "$PORT" -N -L 16080:127.0.0.1:6080 "$HOST" & T=$!
  trap 'kill $T 2>/dev/null || true' EXIT
  sleep 3
  open 'http://localhost:16080/vnc.html?autoconnect=1&resize=scale'
  echo "A tab is open: log in to the READING account there, and answer anything Facebook asks."
  box 'docker wait eno-fb-login >/dev/null; docker logs eno-fb-login 2>&1 | grep -E "LOGIN SAVED|REFUSED|NOT SAVED|NOT STARTED" | cut -c1-120; docker rm eno-fb-login >/dev/null; docker start eno-fb-worker >/dev/null 2>&1 || true'
  ;;
--stop) box 'docker stop eno-fb-worker >/dev/null && echo "  worker stopped: nothing reads Facebook ✅"' ;;
*) echo "unknown: $MODE"; exit 2 ;;
esac
