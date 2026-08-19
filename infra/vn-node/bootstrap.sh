#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE VIETNAM COMPLIANCE NODE — COMPLETE BUILD, FROM A BARE UBUNTU 24.04 BOX
#
#   scp bootstrap.sh root@NEW_IP:/root/ && ssh root@NEW_IP 'bash /root/bootstrap.sh'
#
# Target: 4 GB RAM / 40 GB SSD, replacing the 2 GB trial box when its 7 days end.
#
# It serves eno.vn from a Vietnamese IP (the MOIT licence's server condition, imported from the
# social-network regime in Decree 147/2024) and holds a daily copy of the production database
# (Decree 53/2022 Art. 26(3) data residency).
#
# ⚠️ EVERY GUARD BELOW COST A FAILED RUN ON 2026-08-19. Nine attempts, eight distinct causes. Read
# the comments before "simplifying" any of them — each one looks removable and is not.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive

ORIGIN_IP="${ORIGIN_IP:-8.232.86.0}"        # the GCLB in front of Cloud Run
PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-eno.vn}"
# ⚠️ READ IT, DO NOT ASSUME IT. iNET images listen on 24700, but a rebuilt box may not — and
# `ufw enable` with the wrong port allowed locks you out of the machine you are provisioning.
# ⛔ awk EXITS 0 WHEN IT MATCHES NOTHING, so `awk ... || echo 22` never fires and SSH_PORT ends up
# EMPTY — `ufw allow /tcp` then fails and `set -e` kills the script mid-provision, or worse allows
# nothing and the box is unreachable. Ubuntu ships `#Port 22` commented, so the no-match case is the
# NORMAL one, not the edge case. Caught in review; test the value, never the exit status.
SSH_PORT="${SSH_PORT:-}"
# ⛔ ASK sshd, DO NOT GREP ITS FILE. Ubuntu 24.04's sshd_config begins with
# `Include /etc/ssh/sshd_config.d/*.conf`, and providers put the real port there (or in a
# ssh.socket override), so grepping the main file matches nothing and silently yields 22 — then
# `ufw enable` locks you out of the box. `sshd -T` resolves includes; the port we arrived on is
# the last-resort truth.
[ -n "$SSH_PORT" ] || SSH_PORT="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}')"
# ⚠️ :- BECAUSE `set -u` MAKES AN UNSET SSH_CONNECTION FATAL — provisioning from the provider's
# web console has no SSH session, and the script would die here instead of falling through to 22.
[ -n "$SSH_PORT" ] || SSH_PORT="${SSH_CONNECTION:-}"
SSH_PORT="${SSH_PORT##* }"
[ -n "$SSH_PORT" ] || SSH_PORT=22
case "$SSH_PORT" in ''|*[!0-9]*) echo "refusing to enable ufw with SSH_PORT='$SSH_PORT'"; exit 1 ;; esac

# ⛔ THIS NODE EXISTS FOR THE LICENSED MARKETPLACE AND MUST NEVER SERVE THE SERVICES EDITION.
# PRIMARY_DOMAIN is an override, so nothing stopped someone running this with eno.forum and
# proxying visa and PayPal from the licensed company's Vietnamese server — the licensing breach
# this whole two-edition architecture exists to prevent. Assert it rather than trust it.
# ⚠️ THE APEX ONLY. Accepting www.eno.vn here looked harmless and was not: the config derives the
# www name as www.${PRIMARY_DOMAIN}, so it would have built www.www.eno.vn, stopped serving the
# apex, and sent real traffic to the 444 block. Introduced by the previous round's fix.
case "${PRIMARY_DOMAIN}" in
  eno.vn) ;;
  *) echo "refusing: this node serves eno.vn only, got '${PRIMARY_DOMAIN}'"; exit 1 ;;
esac

PG_MAJOR=17                                  # ⛔ NOT 16 — see step 3

log(){ printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

log "1/7 · base packages"
apt-get update -qq
# `sudo` is not guaranteed on a minimal image and every postgres step below uses it.
apt-get install -y -qq sudo nginx ufw curl ca-certificates unattended-upgrades gnupg >/dev/null

log "2/7 · firewall"
# ⚠️ SSH FIRST, ON ITS REAL PORT. `ufw enable` with only 22 allowed, while sshd listens on 24700,
# locks you out of the box you are provisioning. The port is not 22 on iNET's images.
ufw allow "${SSH_PORT}/tcp" comment 'ssh'
ufw allow 80/tcp  comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable
ufw status | sed 's/^/    /'

log "3/7 · PostgreSQL ${PG_MAJOR} from PGDG"
# ⛔ UBUNTU 24.04 SHIPS POSTGRESQL 16 AND THAT IS THE WRONG ONE. Supabase runs 17.6, and a dump
# taken by pg_dump 17 CANNOT be restored into a 16 server. Installing the distro default produces
# a node that looks correct and fails every single sync at the restore step.
install -d /usr/share/postgresql-common/pgdg
curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
# ⚠️ pgvector is NOT optional. The source database carries an HNSW index on ListingImageHash
# (image-hash dedup); without the extension the restore dies on "access method hnsw does not exist".
apt-get install -y -qq "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}" "postgresql-${PG_MAJOR}-pgvector" >/dev/null
# Ubuntu's 16 cluster may have been created by a dependency; it only wastes RAM here.
pg_dropcluster --stop 16 main >/dev/null 2>&1 || true
systemctl enable --now "postgresql@${PG_MAJOR}-main" >/dev/null 2>&1 || systemctl enable --now postgresql
sudo -u postgres psql -tAc "select 1 from pg_database where datname='eno_replica'" | grep -q 1 \
  || sudo -u postgres createdb eno_replica
echo "    $(sudo -u postgres psql -tAc 'select version()' | cut -c1-60)"

log "4/7 · nginx as the origin for ${PRIMARY_DOMAIN}"
cat > /etc/nginx/conf.d/eno.conf <<EOF
# ⚠️ THE ORIGIN IS THE LOAD BALANCER, NOT run.app. Both Cloud Run services are
# internal-and-cloud-load-balancing, so their *.run.app hostnames refuse public traffic entirely.
upstream eno_origin { server ${ORIGIN_IP}:443; keepalive 32; }

# ⚠️ AN ALLOWLIST, NOT \$host AND NOT A HARDCODED APEX. Passing \$host through lets a request
# steer the upstream at another edition; hardcoding the apex meant www.${PRIMARY_DOMAIN} was
# matched by server_name and then silently proxied as the apex, so the origin never saw www and
# could not redirect it. Map the two names we serve, and default the rest to the apex.
# ⚠️ WITHOUT THIS, EVERY WEBSOCKET DIES. `Connection ""` is right for keepalive to the upstream
# and fatal for an upgrade handshake — realtime chat is the most-used surface on this app, and it
# would have failed silently the moment DNS moved here.
map \$http_upgrade \$eno_connection_upgrade {
    default upgrade;
    ''      '';
}

map \$host \$eno_upstream_host {
    default            ${PRIMARY_DOMAIN};
    ${PRIMARY_DOMAIN}      ${PRIMARY_DOMAIN};
    www.${PRIMARY_DOMAIN}  www.${PRIMARY_DOMAIN};
}

server {
    listen 80;
    listen [::]:80;
    server_name ${PRIMARY_DOMAIN} www.${PRIMARY_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    # ⚠️ HTTP REDIRECTS, IT DOES NOT PROXY. Proxying on :80 while asserting
    # X-Forwarded-Proto: https tells the app a plaintext request was secure, which is how you get
    # Secure cookies issued over cleartext. Raised in review and correct.
    location / { return 301 https://\$host\$request_uri; }
}

# ⛔ REFUSE EVERY HOSTNAME EXCEPT THIS ONE, AND THIS BLOCK IS A LICENSING CONTROL.
# The HTTPS server below was nginx's DEFAULT virtual host while proxying Host: \$host straight
# through. A request arriving here with `Host: eno.forum` would therefore have been forwarded to the
# GCLB as eno.forum — serving the SERVICES edition, visa and PayPal included, from the licensed
# company's Vietnamese server. That is the exact boundary the two-edition architecture exists to
# hold, and it would have been a licensing breach rather than a bug. Caught in review.
server {
    listen 80  default_server;
    listen 443 ssl default_server;
    listen [::]:80  default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;
    return 444;   # close without a response; nothing else is served from this node
}

server {
    # ⛔ `http2 on;` IS NGINX 1.25.1+, AND UBUNTU 24.04 SHIPS 1.24.0. On the target OS that
    # directive is unknown, `nginx -t` fails — and because the failure sat on the LEFT of
    # `nginx -t && systemctl reload`, `set -e` never fired: the script printed 7/7, exited 0, and
    # left an nginx that would not start after reboot. Found at cutover, by all three reviewers.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${PRIMARY_DOMAIN} www.${PRIMARY_DOMAIN};

    # Replaced by the real certificate before cutover (see the closing notes). A self-signed cert
    # is correct for a node nothing points at yet, and it means :443 EXISTS from the first boot —
    # the previous version listened only on :80, so HTTPS would have failed outright after cutover.
    ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass https://eno_origin;
        proxy_http_version 1.1;

        # ⚠️ HOST *AND* SNI. The GCLB routes on both; either one wrong and a perfectly healthy
        # origin answers 404, which reads as a broken backend rather than a header mistake.
        # ⚠️ THE LITERAL DOMAIN, NOT \$host. Even inside a server_name-matched block, pinning it
        # means no request can ever steer this node's upstream at another edition.
        proxy_set_header Host \$eno_upstream_host;
        proxy_ssl_server_name on;
        proxy_ssl_name        \$eno_upstream_host;

        # ⛔ THE UPSTREAM IS VERIFIED. This said \`proxy_ssl_verify off\`, which left the
        # Vietnam-to-Google hop unauthenticated — anyone able to intercept it could read or alter
        # passport data, payments and auth traffic, and the padlock would still be green. Flagged
        # by two reviewers. Verification works against an IP because the SNI/Host say the domain.
        proxy_ssl_verify              on;
        proxy_ssl_verify_depth        3;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;

        # ⚠️ \$remote_addr, NOT \$proxy_add_x_forwarded_for. This node IS the edge, so appending to
        # a client-supplied header lets anyone forge their own address into the rate limiter and
        # into compliance_audit. Overwrite it; never extend it.
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        \$eno_connection_upgrade;

        client_max_body_size 30m;   # visa uploads: the app accepts 25 MiB intake
        proxy_connect_timeout 10s;
        proxy_read_timeout    60s;
    }
}
EOF
mkdir -p /etc/nginx/ssl
[ -f /etc/nginx/ssl/selfsigned.crt ] || openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/selfsigned.key -out /etc/nginx/ssl/selfsigned.crt \
  -subj "/CN=${PRIMARY_DOMAIN}" >/dev/null 2>&1
rm -f /etc/nginx/sites-enabled/default
# ⚠️ ON ITS OWN LINE. `nginx -t && systemctl reload` hides a failed test from `set -e`.
nginx -t
# ⚠️ RESTART, NOT RELOAD. nginx was started by apt with the stock config listening only on :80;
# a reload will not bind a :443 socket the running master never opened.
systemctl restart nginx

log "5/7 · the daily database copy"
mkdir -p /etc/eno && chmod 700 /etc/eno
cat > /usr/local/bin/eno-db-sync <<'SYNC'
#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C LANG=C
# ⚠️ THE CREDENTIAL NEVER REACHES THE COMMAND LINE. Passing a URL containing the password as an
# argv element publishes it in /proc/<pid>/cmdline, where any local process can read a BYPASSRLS
# credential for production. libpq's PG* environment variables carry it privately instead.
# ⚠️ AND PGSSLMODE IS verify-full. libpq defaults to `prefer`, which verifies NO certificate and
# silently accepts plaintext — an unauthenticated nightly hop carrying the whole database.
source /etc/eno/sync.env          # PGHOST= PGPORT= PGUSER= PGPASSWORD= PGDATABASE=
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
export PGSSLMODE="${PGSSLMODE:-verify-full}"
PGBIN=/usr/lib/postgresql/__PGMAJOR__/bin
SCRATCH=eno_replica_new
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
fail(){ echo "${STAMP} FAILED ${1}" >> /var/log/eno-db-sync.log; exit 1; }
# ⚠️ ANY unhandled failure still writes a line. A missing or malformed sync.env, a failed scratch
# drop, an extension error — each of those exited leaving the log completely silent, which is the
# single most expensive failure mode of this whole build: three rounds were lost today to an error
# that had been thrown away rather than recorded.
trap 'echo "${STAMP} FAILED unexpected-at-line-${LINENO}" >> /var/log/eno-db-sync.log' ERR

sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS ${SCRATCH}"
sudo -u postgres createdb "${SCRATCH}" || fail create-scratch
# The dump carries its own CREATE SCHEMA public, so clear the default one first, then put the
# vector extension in place BEFORE the restore reaches the HNSW index that needs it.
sudo -u postgres psql -q -d "${SCRATCH}" -c "DROP SCHEMA IF EXISTS public CASCADE"
sudo -u postgres psql -q -d "${SCRATCH}" -c "CREATE SCHEMA public"
sudo -u postgres psql -q -d "${SCRATCH}" -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public"

# ⛔ NEVER JUDGE THIS PIPELINE BY ITS EXIT CODE. pg_restore returns non-zero whenever it IGNORES an
# error, and it always ignores a few here (Supabase's service_role grants do not exist locally).
# A '|| fail' on this line discarded a complete 1.6 GB restore seven times in a row. The checks
# below are the real gate, and they are stricter than the exit code ever was.
"${PGBIN}/pg_dump" --no-owner --no-privileges --schema=public --format=custom \
  2>>/var/log/eno-db-sync.err \
  | sudo -u postgres "${PGBIN}/pg_restore" --no-owner --no-privileges --dbname="${SCRATCH}" \
  2>>/var/log/eno-db-sync.err || true

TABLES=$(sudo -u postgres psql -tAd "${SCRATCH}" -c \
  "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)
[ "${TABLES:-0}" -ge "${MIN_TABLES:-60}" ] || fail "only-${TABLES}-tables"

# ⚠️ TABLES ALONE IS NOT PROOF. The schema transfers even when the rows do not, so a structure-only
# restore would log "ok" while the node held nothing — and Decree 53 is about the DATA being here.
# ⚠️ `|| echo 0` — under `set -e` a failing psql inside $( ) kills the script outright, so the
# friendly "only-N-rows" refusal would never be written and the log would show nothing at all.
ROWS=$(sudo -u postgres psql -tAd "${SCRATCH}" -c \
  'select coalesce((select count(*) from public."Profile"),0)+coalesce((select count(*) from public."Listing"),0)' 2>/dev/null || echo 0)
[ "${ROWS:-0}" -ge "${MIN_ROWS:-5}" ] || fail "only-${ROWS}-rows-in-${TABLES}-tables"

# ⚠️ An auditor or local reader connected to eno_replica makes RENAME fail. Disconnect readers
# first — this database exists to be copied into, and a held session must not block the swap.
sudo -u postgres psql -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('eno_replica','eno_replica_old') and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
# ⛔ THE OLD COPY IS NOT DROPPED UNTIL THE NEW ONE IS IN PLACE. The previous order renamed
# eno_replica to _old, then promoted the scratch — and if that second rename failed, NO database
# called eno_replica existed, while the next night's run began by dropping _old. Two failures and
# the only copy in Vietnam was gone. Roll back instead, and only then discard.
# ⚠️ ONLY DISCARD _old WHEN A LIVE eno_replica EXISTS. If a previous promotion AND its rollback
# both failed, _old is the ONLY copy in Vietnam — dropping it here would complete the loss.
if sudo -u postgres psql -tAc "select 1 from pg_database where datname='eno_replica'" | grep -q 1; then
  sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS eno_replica_old"
fi
sudo -u postgres psql -q -c "ALTER DATABASE eno_replica RENAME TO eno_replica_old" 2>/dev/null || true
if ! sudo -u postgres psql -q -c "ALTER DATABASE ${SCRATCH} RENAME TO eno_replica"; then
  sudo -u postgres psql -q -c "ALTER DATABASE eno_replica_old RENAME TO eno_replica" 2>/dev/null || true
  fail swap-failed-rolled-back
fi
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS eno_replica_old"

SIZE=$(sudo -u postgres psql -tAc "select pg_size_pretty(pg_database_size('eno_replica'))")
echo "${STAMP} ok tables=${TABLES} rows=${ROWS} size=${SIZE}" >> /var/log/eno-db-sync.log
SYNC
# ⛔ THE HEREDOC IS QUOTED ('SYNC') SO NOTHING EXPANDS AT BUILD TIME. It was unquoted, which
# collapsed every \" into a bare " and broke the generated SQL's quoting — `public."Profile"`
# terminated the surrounding string, so EVERY nightly sync would have aborted. Only the Postgres
# major version needs substituting, and it is done explicitly here.
sed -i "s#__PGMAJOR__#${PG_MAJOR}#g" /usr/local/bin/eno-db-sync
chmod 750 /usr/local/bin/eno-db-sync

cat > /etc/systemd/system/eno-db-sync.service <<'UNIT'
[Unit]
Description=Daily copy of the production database into Vietnam
After=network-online.target postgresql.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/eno-db-sync
TimeoutStartSec=1800
UNIT

cat > /etc/systemd/system/eno-db-sync.timer <<'UNIT'
[Unit]
Description=Daily database copy
[Timer]
OnCalendar=*-*-* 19:00:00 UTC
Persistent=true
RandomizedDelaySec=900
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
# `enable` alone arms it for the NEXT boot; --now starts the timer today.
systemctl enable --now eno-db-sync.timer >/dev/null 2>&1

log "6/7 · log rotation, then unattended security updates"
# ⚠️ A DAILY RESTORE THAT ERRORS WRITES TO eno-db-sync.err EVERY NIGHT. Unrotated, that fills the
# disk and stops PostgreSQL — the sync would take down the thing it exists to protect.
cat > /etc/logrotate.d/eno-db-sync <<'ROT'
/var/log/eno-db-sync.log /var/log/eno-db-sync.err {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
ROT

printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
  > /etc/apt/apt.conf.d/20auto-upgrades

log "7/7 · what is left, and it is not optional"
cat <<EOF
    CREDENTIAL — the sync cannot run without it:

      umask 077
      cat > /etc/eno/sync.env <<'ENV'
      PGHOST=aws-1-ap-southeast-1.pooler.supabase.com
      PGPORT=5432
      PGUSER=eno_vn_replica.PROJECTREF
      PGPASSWORD=...        # ⚠️ sourced as shell — use alphanumerics only, or quote it
      PGDATABASE=postgres
      PGSSLMODE=verify-full
      ENV
      chmod 600 /etc/eno/sync.env

    ⚠️ THE USERNAME MUST BE role.PROJECTREF. Supabase's pooler takes the tenant from the username;
       a bare role name is refused with "ENOIDENTIFIER: no tenant identifier provided" BEFORE
       authentication, so a correct password makes no difference.

    ⚠️ THE ROLE NEEDS FOUR GRANTS, NOT ONE. Run on the source, as postgres:
         grant usage on schema public to eno_vn_replica;
         grant select on all tables in schema public to eno_vn_replica;
         grant select on all sequences in schema public to eno_vn_replica;   -- pg_dump reads them
         alter role eno_vn_replica with bypassrls;   -- pg_dump REFUSES RLS-filtered tables
       and the default privileges so new tables are covered:
         alter default privileges in schema public grant select on tables to eno_vn_replica;
         alter default privileges in schema public grant select on sequences to eno_vn_replica;

    ⚠️ DO NOT ADD --schema=auth. Supabase will not grant usage on it (the grant reports success and
       has_schema_privilege stays false), and it is unnecessary: public."Profile" mirrors every
       account's email and phone. Excluding it also keeps password hashes and refresh tokens off
       this box. Re-verify after any schema change:
         select (select count(*) from auth.users), (select count(*) from public."Profile");

    TLS — Let's Encrypt HTTP-01 needs ${PRIMARY_DOMAIN} to resolve HERE, and it resolves to
    Cloudflare until cutover. Issue via DNS-01 against the Cloudflare zone BEFORE moving DNS.

    Then:  systemctl start eno-db-sync && tail -f /var/log/eno-db-sync.log
EOF
