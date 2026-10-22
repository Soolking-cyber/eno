#!/usr/bin/env bash
# READ-ONLY exposure check for the VN box (security review 2026-10-22, item 15). RUN IT FROM YOUR OWN MACHINE, NOT THE BOX:
#   bash infra/vn-node/check-exposed-ports.sh
# ⚠️ WHY OFF-BOX: a probe the box sends to its own public IP hairpins through the local chains, never the path an attacker's
# packet takes — it would report Docker-published ports as open even where the DOCKER-USER rules drop them from outside.
#
# WHAT IT GUARDS. Postgres, the pooler, the Supabase gateway and the apps are kept off the internet by `DOCKER-USER` rules
# that were made by hand and are not in this repo (apple-signin.md: "Kong's :8000 was once open on 0.0.0.0"). ufw does NOT
# filter ports Docker publishes, so a Docker or iptables reinstall — or a box rebuilt from these scripts — silently reopens
# them: a direct hit on :8000 then reaches GoTrue without the nginx /authorize guard, and 5432/6543 face the internet.
# The durable fix is to bind every Supabase `ports:` entry to 127.0.0.1 in the box's compose override (runbook); this
# script is how you PROVE the result, and how you notice if it ever regresses. It changes nothing.
#
# Two checks:
#   1. from here, a TCP connect to each sensitive port on the box's public address — every one must be refused/filtered;
#   2. over ssh, Docker's own list of published ports — none of the sensitive ones may be bound to 0.0.0.0 or [::].
# :443 is expected open (Cloudflare origin pulls; nginx enforces authenticated origin pulls), so it is not probed.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"
IP="${ENO_PUBLIC_IP:-${HOST#*@}}"
# Postgres, Supavisor pooler, Supabase gateway (Kong/envoy) http+https, Studio, GoTrue, Realtime, Storage, the two apps, :80.
SENSITIVE=(5432 6543 8000 8443 3000 9999 4000 5000 3001 3002 80)

FAILED=0
echo "== 1. off-box TCP probe of $IP (each must NOT connect) =="
for p in "${SENSITIVE[@]}"; do
  if timeout 4 bash -c "exec 3<>/dev/tcp/$IP/$p" 2>/dev/null; then
    printf '  \033[31mOPEN\033[0m  %s:%s — reachable from the internet; bind it to 127.0.0.1 or drop it in DOCKER-USER\n' "$IP" "$p"
    FAILED=1
  else
    printf '  \033[32mclosed\033[0m %s:%s\n' "$IP" "$p"
  fi
done

echo "== 2. Docker's published ports on the box (sensitive ones must be loopback-only) =="
pubs=$(ssh -i "$KEY" -p "$PORT" -o StrictHostKeyChecking=accept-new "$HOST" "docker ps --format '{{.Names}}\t{{.Ports}}'" 2>/dev/null) \
  || { echo "  cannot list containers over ssh ($HOST) — check 2 not run"; exit 2; }
while IFS=$'\t' read -r name ports; do
  [ -n "$name" ] || continue
  for p in "${SENSITIVE[@]}"; do
    # "0.0.0.0:5432->5432/tcp" or ":::5432->…" / "[::]:5432->…" = bound on every interface.
    if printf '%s' "$ports" | grep -qE "(0\.0\.0\.0|\[?::\]?):$p->"; then
      printf '  \033[31mALL-INTERFACES\033[0m  %s publishes :%s on every interface (%s)\n' "$name" "$p" "$ports"
      FAILED=1
    fi
  done
done <<<"$pubs"

echo
[ "$FAILED" = 0 ] && { echo "No sensitive port is reachable or published on every interface."; exit 0; }
echo "Exposure found — see above. Bind the port to 127.0.0.1 in the compose override (or drop it in DOCKER-USER), then re-run."
exit 1
