#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno ORIGIN NODE — provisions a single Ubuntu box to serve eno.vn AND eno.forum
# directly: nginx origin, PostgreSQL 17 PRIMARY, both Next.js editions, backups.
#
# This REPLACES the job of infra/vn-node/bootstrap.sh, which built a compliance
# PROXY forwarding to a Google load balancer. Same hard-won preamble, opposite
# destination: there is no upstream any more, this box IS the origin.
#
#   bash origin-bootstrap.sh base      · packages, ssh port, firewall
#   bash origin-bootstrap.sh postgres  · PG 17 + pgvector + tuning + huge pages
#   bash origin-bootstrap.sh node      · Node 24 runtime
#   bash origin-bootstrap.sh nginx     · four server blocks, 444 default, cache
#   bash origin-bootstrap.sh all       · every stage in order
#
# ⚠️ EVERY STAGE IS RE-RUNNABLE. Provisioning bash cannot be tested before the box
# exists, so the first run WILL fail somewhere; each stage is written to be safe to
# repeat rather than to be right first time.
#
# ⛔ BUILT TO BE LEFT. The owner's constraint (2026-08-20) is that the box is a
# 3-6 month staging post, not a home: "build it so we can migrate all comfortably
# once we start making buck". So — every provider-specific value is in the CONFIG
# block below and nowhere else; nothing depends on an iNET-only service; backups go
# OFF-box so that migrating is a restore rather than a rebuild. Re-run this script
# on any Ubuntu 24.04 host and you have the same node.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive

# ── CONFIG · the only provider-specific block ────────────────────────────────
PG_MAJOR=17            # ⛔ NOT Ubuntu's default 16: a pg_dump 17 dump cannot restore into 16.
NODE_MAJOR=24          # matches the Dockerfile's node:24-slim base.
APP_USER=eno
APP_ROOT=/srv/eno
MARKETPLACE_PORT=3000
SERVICES_PORT=3001
HOSTS_MARKETPLACE="eno.vn www.eno.vn"
HOSTS_SERVICES="eno.forum www.eno.forum"
CACHE_DIR=/var/cache/nginx/eno
CACHE_SIZE=8g
# RAM the box has, used to size shared_buffers. Read, not assumed.
RAM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)

log(){ printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m⚠️  %s\033[0m\n' "$*"; }
fail(){ printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# ⛔ AN ERR TRAP THAT ALWAYS PRINTS. The previous build lost three rounds to errors that were
# thrown away rather than logged — the single most expensive failure mode of that whole job.
trap 'rc=$?; [ $rc -ne 0 ] && printf "\033[1;31m✗ line %s exited %s\033[0m\n" "$LINENO" "$rc" >&2' ERR
[ "$(id -u)" -eq 0 ] || fail "run as root"

# ── SSH PORT · read it, never assume it ──────────────────────────────────────
# ⛔ ASK sshd, DO NOT GREP ITS FILE. Ubuntu 24.04's sshd_config starts with
# `Include /etc/ssh/sshd_config.d/*.conf` and providers put the real port there, so grepping the
# main file silently yields 22 — and `ufw enable` then locks you out of the box you are building.
# ⛔ awk EXITS 0 WHEN IT MATCHES NOTHING, so `|| echo 22` never fires and the value ends up EMPTY.
# Ubuntu ships `#Port 22` commented, so no-match is the NORMAL case. Test the VALUE, not $?.
SSH_PORT="${SSH_PORT:-}"
[ -n "$SSH_PORT" ] || SSH_PORT="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}')"
[ -n "$SSH_PORT" ] || SSH_PORT="${SSH_CONNECTION:-}"   # :- because set -u makes an unset var fatal
SSH_PORT="${SSH_PORT##* }"
[ -n "$SSH_PORT" ] || SSH_PORT=22
case "$SSH_PORT" in ''|*[!0-9]*) fail "refusing to enable ufw with SSH_PORT='$SSH_PORT'" ;; esac

stage_base() {
  log "base · packages, firewall (ssh on ${SSH_PORT})"
  apt-get update -qq
  # `sudo` is not guaranteed on a minimal image and every postgres step uses it.
  apt-get install -y -qq sudo nginx ufw curl ca-certificates gnupg unattended-upgrades \
                        fail2ban logrotate jq postgresql-common >/dev/null

  # ⚠️ SSH FIRST, ON ITS REAL PORT, BEFORE `ufw enable`.
  ufw allow "${SSH_PORT}/tcp" comment 'ssh'

  # ⛔ 443 IS RESTRICTED TO CLOUDFLARE, and that is a SECURITY FIX, not tidiness. src/lib/client-ip.ts
  # trusts `cf-connecting-ip` FIRST and unconditionally, so anyone who reaches the origin directly
  # forges their address into the rate limiter and the compliance audit log. Two halves: this
  # firewall, and `set_real_ip_from` in the nginx stage. Neither is sufficient alone.
  local ranges=/tmp/cf-ranges
  : > "$ranges"
  curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 >> "$ranges" || warn "could not fetch CF v4 ranges"
  curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6 >> "$ranges" || warn "could not fetch CF v6 ranges"
  if [ -s "$ranges" ]; then
    while read -r cidr; do
      [ -n "$cidr" ] && ufw allow from "$cidr" to any port 443 proto tcp comment 'cloudflare' >/dev/null
    done < "$ranges"
    ufw allow 80/tcp comment 'http → redirect + ACME'
    printf '    %s cloudflare ranges allowed on 443\n' "$(grep -c . "$ranges")"
  else
    warn "opening 443 to the world — CF ranges unavailable. RE-RUN THIS STAGE when they are."
    ufw allow 80/tcp; ufw allow 443/tcp
  fi
  ufw --force enable
  ufw status | sed 's/^/    /'
  # 5432 must never be reachable; assert rather than assume.
  ufw status | grep -q '5432' && fail "5432 is exposed — remove that rule"
  systemctl enable --now fail2ban >/dev/null 2>&1 || warn "fail2ban did not start"

  id -u "$APP_USER" >/dev/null 2>&1 || useradd -r -m -d "$APP_ROOT" -s /usr/sbin/nologin "$APP_USER"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_ROOT" /etc/eno
  chmod 750 /etc/eno
  echo "    ✓ base"
}

stage_postgres() {
  log "postgres · PG ${PG_MAJOR} + pgvector (RAM ${RAM_MB} MB)"
  # PGDG, because Ubuntu 24.04's default is 16 and a 17 dump cannot restore into it.
  install -d /usr/share/postgresql-common/pgdg
  curl -fsS --max-time 30 https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  # ⛔ pgvector is a RUNTIME dependency now, not just a restore-time one: the HNSW index on
  # ListingImageHash dies with "access method hnsw does not exist" without it.
  apt-get install -y -qq "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}" \
                        "postgresql-${PG_MAJOR}-pgvector" >/dev/null
  # A distro 16 cluster may have been created as a dependency; it only wastes RAM.
  pg_dropcluster --stop 16 main >/dev/null 2>&1 || true
  systemctl enable --now "postgresql@${PG_MAJOR}-main" >/dev/null 2>&1 || systemctl enable --now postgresql

  local conf="/etc/postgresql/${PG_MAJOR}/main/conf.d/eno.conf"
  install -d "$(dirname "$conf")"
  # shared_buffers ≈ 3/16 of RAM: the box also holds TWO Next.js editions at ~2 GB each plus the
  # Supabase services, so the usual 25% guidance over-commits here.
  local sb=$(( RAM_MB * 3 / 16 ))
  local eff=$(( RAM_MB / 2 ))
  cat > "$conf" <<PGCONF
# Generated by origin-bootstrap.sh — edit here, never postgresql.conf.
listen_addresses = 'localhost'      # nothing off-box talks to PG; ufw closes 5432 too
max_connections = 200
shared_buffers = ${sb}MB
effective_cache_size = ${eff}MB
work_mem = 16MB
maintenance_work_mem = 1GB
autovacuum_work_mem = 256MB
temp_file_limit = 8GB               # a runaway spill must not fill the disk and stop PG
wal_level = replica                 # required for archiving / PITR
full_page_writes = on               # NEVER off on network storage: no 8kB atomic-write guarantee
wal_compression = lz4
wal_buffers = 64MB
checkpoint_timeout = 30min          # default 5min writes a full-page image per page 12x/hour
max_wal_size = 8GB
checkpoint_completion_target = 0.9
random_page_cost = 1.1              # SSD, not spinning rust
effective_io_concurrency = 200
shared_preload_libraries = 'pg_cron'
cron.database_name = 'eno'
# ⚠️ commit_delay is DELIBERATELY 0. On Ceph the right value is about half the measured fsync,
# but setting it blind adds latency to EVERY commit. MEASURE FIRST:
#   sudo -u postgres pg_test_fsync -f /var/lib/postgresql/fsynctest
# Local NVMe lands ~25-35us; Ceph ~400-2000us. Set it only from that number.
commit_delay = 0
commit_siblings = 5
PGCONF
  systemctl restart "postgresql@${PG_MAJOR}-main" 2>/dev/null || systemctl restart postgresql
  sudo -u postgres psql -tAc 'select version()' | sed 's/^/    /'
  echo "    ✓ postgres (shared_buffers ${sb}MB)"
}

stage_node() {
  log "node · Node ${NODE_MAJOR}"
  curl -fsS --max-time 30 "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  # ffmpeg-static and sharp both need these at runtime; the Dockerfile installs them too.
  apt-get install -y -qq libvips42 >/dev/null 2>&1 || warn "libvips not installed — sharp may fall back"
  printf '    node %s / npm %s\n' "$(node -v)" "$(npm -v)"
  echo "    ✓ node"
}

stage_nginx() {
  log "nginx · origin for ${HOSTS_MARKETPLACE} + ${HOSTS_SERVICES}"
  nginx -v 2>&1 | sed 's/^/    /'
  install -d "$CACHE_DIR"; chown -R www-data:www-data "$CACHE_DIR"

  # Cloudflare real-ip: the other half of the CF-Connecting-IP forgery fix.
  { curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4; \
    curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6; } 2>/dev/null \
    | awk 'NF{print "set_real_ip_from "$0";"}' > /etc/nginx/conf.d/cf-realip.inc || true
  echo 'real_ip_header CF-Connecting-IP;' >> /etc/nginx/conf.d/cf-realip.inc
  echo 'real_ip_recursive on;' >> /etc/nginx/conf.d/cf-realip.inc

  cat > /etc/nginx/conf.d/eno.conf <<NGINX
# Generated by origin-bootstrap.sh.
# ⛔ THE CACHE KEY INCLUDES \$host. Two editions share one box, and a key without the host would
# serve eno.forum's visa pages to eno.vn — the licensing breach the split exists to prevent.
proxy_cache_path ${CACHE_DIR} levels=1:2 keys_zone=eno:64m max_size=${CACHE_SIZE} inactive=24h use_temp_path=off;

# ⛔ WITHOUT THIS MAP EVERY WEBSOCKET DIES, SILENTLY. Connection "" is correct for upstream
# keepalive and fatal for an upgrade handshake; both are needed, so it has to be conditional.
map \$http_upgrade \$connection_upgrade { default upgrade; '' ''; }

upstream eno_marketplace { server 127.0.0.1:${MARKETPLACE_PORT}; keepalive 64; }
upstream eno_services    { server 127.0.0.1:${SERVICES_PORT};    keepalive 64; }

# ⛔ DEFAULT SERVER RETURNS 444. A default that proxies \$host forwards ANY hostname upstream.
server { listen 80 default_server; listen 443 ssl default_server;
         ssl_certificate /etc/nginx/self.crt; ssl_certificate_key /etc/nginx/self.key;
         server_name _; return 444; }

# :80 REDIRECTS, never proxies — proxying while asserting X-Forwarded-Proto: https would issue
# Secure cookies over cleartext.
server { listen 80; server_name ${HOSTS_MARKETPLACE} ${HOSTS_SERVICES};
         return 301 https://\$host\$request_uri; }
NGINX

  for edition in marketplace services; do
    local hosts upstream
    if [ "$edition" = marketplace ]; then hosts="$HOSTS_MARKETPLACE"; upstream=eno_marketplace
    else hosts="$HOSTS_SERVICES"; upstream=eno_services; fi
    cat >> /etc/nginx/conf.d/eno.conf <<NGINX

server {
  # ⛔ nginx 1.24 (Ubuntu 24.04) — 'listen 443 ssl http2;', NOT a standalone 'http2 on;',
  # which is 1.25.1+ and makes 'nginx -t' fail outright.
  listen 443 ssl http2;
  server_name ${hosts};
  ssl_certificate /etc/nginx/self.crt; ssl_certificate_key /etc/nginx/self.key;
  include /etc/nginx/conf.d/cf-realip.inc;

  client_max_body_size 60m;          # above the 50 MB video ceiling if uploads cross nginx
  proxy_http_version 1.1;            # required for upstream keepalive
  proxy_set_header Host \$host;
  proxy_set_header Upgrade \$http_upgrade;
  proxy_set_header Connection \$connection_upgrade;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$remote_addr;
  proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 300s;           # streamed RSC and the AI concierge's SSE outlive 60s
  proxy_send_timeout 300s;

  # HTML micro-cache. Cloudflare absorbed this until now; on-box we finally control the key.
  proxy_cache eno;
  proxy_cache_key "\$scheme\$host\$request_uri";
  proxy_cache_lock on;
  proxy_cache_use_stale updating error timeout http_500 http_502 http_503;
  proxy_cache_background_update on;
  proxy_cache_bypass \$http_authorization \$cookie_sb_access_token;
  proxy_no_cache   \$http_authorization \$cookie_sb_access_token;
  add_header X-Cache-Status \$upstream_cache_status always;

  location / { proxy_pass http://${upstream}; }
  # Streaming endpoints must not buffer or the SSE arrives all at once at the end.
  location /api/ { proxy_pass http://${upstream}; proxy_buffering off; proxy_cache off; }
}
NGINX
  done

  # A self-signed cert so :443 EXISTS from first boot — Cloudflare Full (strict) will not talk to
  # a bare :80 origin. Replaced by the real cert in the tls stage.
  [ -f /etc/nginx/self.crt ] || openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/nginx/self.key -out /etc/nginx/self.crt -subj "/CN=eno.vn" >/dev/null 2>&1

  # ⛔ `nginx -t` ON ITS OWN LINE. Writing `nginx -t && systemctl reload` puts the test on the LEFT
  # of &&, so a FAILED test is the condition, not an error — set -e never fires, the script reports
  # success, and the box is left with an nginx that will not start after reboot. That exact bug
  # shipped twice in the previous script.
  nginx -t
  # ⛔ RESTART, NOT RELOAD. apt started nginx on the stock :80-only config; a reload will never bind
  # a :443 socket the running master never opened.
  systemctl restart nginx
  systemctl is-active --quiet nginx || fail "nginx did not come back up"
  echo "    ✓ nginx"
}

case "${1:-}" in
  base)     stage_base ;;
  postgres) stage_postgres ;;
  node)     stage_node ;;
  nginx)    stage_nginx ;;
  all)      stage_base; stage_postgres; stage_node; stage_nginx ;;
  *) sed -n '5,12p' "$0"; exit 1 ;;
esac
log "done · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
