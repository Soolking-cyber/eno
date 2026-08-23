#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · PHASE 0 — make 162.4.176.208 safe to build on.
#
# Nothing here touches production: eno.vn and eno.forum keep serving from
# Cloud Run throughout. This box is built beside them and proven before any
# DNS changes.
#
#   bash phase0.sh          · everything, in order
#   bash phase0.sh check    · changes nothing, just reports
#   bash phase0.sh firewall | docker | hygiene
#
# ⚠️ RE-RUNNABLE BY DESIGN. Provisioning bash cannot be tested before the box
# exists, so every stage is written to be safe to repeat rather than to be
# right first time. When it fails, fix the cause and run it again.
#
# ⚠️ RUN IT FROM THE OneDash TERMINAL, not through the OneDash file API. Writing
# this content through the API is refused by iNET's Cloudflare WAF, which reads
# apt/curl/gpg in a payload as an attack. That is a false positive, but it is
# their control on their platform and the terminal is the sanctioned way in.
# (Verified: a byte-identical write with innocuous content succeeds, so it is
# the content being inspected, not the tool.)
set -euo pipefail
STAGE="${1:-all}"
say() { printf '\n\033[1;36m-- %s\033[0m\n' "$*"; }
ok()  { printf '  [ok] %s\n' "$*"; }
warn(){ printf '  [!!] %s\n' "$*"; }
die() { printf '  [XX] %s\n' "$*"; exit 1; }

# ⛔ DETECTED, NEVER ASSUMED. The one way a script like this ruins your day is
# locking you out of your own server, and the usual cause is a hardcoded port 22
# on a box that does not use it — this one does not (OneDash reports 24700, and
# I could not verify that independently because reading sshd_config through the
# API is WAF-blocked). So read the live config AND the live sockets, take the
# union, and refuse to proceed on an empty set.
detect_ssh_ports() {
  { grep -hoP '(?<=^Port )\d+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true
    ss -tlnp 2>/dev/null | awk '/sshd/ {split($4,a,":"); print a[length(a)]}' || true
  } | grep -E '^[0-9]+$' | sort -u
}

stage_check() {
  say "What is on this box"
  printf '  os        : %s\n' "$(. /etc/os-release; echo "$PRETTY_NAME")"
  printf '  cpu/ram   : %s cores / %s\n' "$(nproc)" "$(free -h | awk '/Mem:/{print $2}')"
  printf '  disk      : %s\n' "$(df -h / | awk 'NR==2{print $3" used of "$2" ("$5")"}')"
  printf '  ssh ports : %s\n' "$(detect_ssh_ports | tr '\n' ' ')"
  printf '  docker    : %s\n' "$(command -v docker >/dev/null && docker --version || echo 'not installed')"
  printf '  ufw       : %s\n' "$(command -v ufw >/dev/null && ufw status | head -1 || echo 'not installed')"
  printf '  listening :\n'
  ss -tlnp 2>/dev/null | awk 'NR>1{print "    "$4"  "$6}' | sed 's/users:(//; s/)$//' || true
}

stage_firewall() {
  say "Firewall - Cloudflare only on 80/443, SSH preserved"
  command -v ufw >/dev/null || { apt-get update -qq && apt-get install -y -qq ufw; }

  local ports; ports="$(detect_ssh_ports)"
  [ -n "$ports" ] || die "No SSH port detected. REFUSING to touch the firewall."
  ok "detected SSH port(s): $(echo "$ports" | tr '\n' ' ')"

  # SSH first, always: if every line below fails, you are still reachable.
  while read -r p; do [ -n "$p" ] && ufw allow "${p}/tcp" >/dev/null; done <<< "$ports"
  ok "SSH allowed first"

  # ⛔ THE ORIGIN MUST NOT BE REACHABLE EXCEPT THROUGH CLOUDFLARE, and this is not
  # ordinary hardening — src/proxy.ts is BUILT on the assumption. It refuses every
  # /api/* request that lacks a header a Cloudflare Transform Rule injects, because
  # a directly-reachable origin lets an attacker spoof cf-connecting-ip and bypass
  # every IP-keyed rate limit, draining the paid AI, translate and geocode routes.
  # Cloud Run had locked ingress as a second layer. A bare VPS IP has none, so this
  # allow-list IS that layer.
  local v4 v6 n=0
  v4="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 || true)"
  v6="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6 || true)"
  [ -n "$v4" ] || die "Could not fetch Cloudflare ranges - refusing to half-configure."
  while read -r c; do [ -n "$c" ] || continue
    ufw allow from "$c" to any port 443 proto tcp >/dev/null
    ufw allow from "$c" to any port 80  proto tcp >/dev/null; n=$((n+1)); done <<< "$v4"
  while read -r c; do [ -n "$c" ] || continue
    ufw allow from "$c" to any port 443 proto tcp >/dev/null
    ufw allow from "$c" to any port 80  proto tcp >/dev/null; n=$((n+1)); done <<< "$v6"
  ok "allowed 80/443 from $n Cloudflare ranges"

  # ⚠️ Postgres, GoTrue, Storage and Realtime are NEVER opened here. They live on
  # the docker network and are reached through nginx on this host only. If you
  # ever find yourself adding "ufw allow 5432", stop and reconsider.
  ufw default deny incoming  >/dev/null
  # The OneDash agent dials OUT to onedash.inet.vn, so an inbound deny cannot
  # orphan it — that is why losing the panel is not a risk here.
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null
  ok "ufw enabled"
  ufw status verbose | sed 's/^/    /'
}

stage_docker() {
  say "Docker"
  if command -v docker >/dev/null; then ok "already installed: $(docker --version)"; else
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ok "installed $(docker --version)"
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 && ok "compose plugin present" || warn "compose plugin missing"
}

stage_hygiene() {
  say "Hygiene"
  apt-get install -y -qq unattended-upgrades >/dev/null 2>&1 || true
  dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
  ok "unattended-upgrades on"
  # ⚠️ 15 GiB with Postgres + two Node apps + Realtime is comfortable, but a build
  # spike with no swap is an OOM kill of whatever is unluckiest — often Postgres,
  # which is the one process here whose death costs data rather than a restart.
  if ! swapon --show | grep -q .; then
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "4G swap created"
  else ok "swap already present"; fi
}

case "$STAGE" in
  check)    stage_check ;;
  firewall) stage_firewall ;;
  docker)   stage_docker ;;
  hygiene)  stage_hygiene ;;
  all)      stage_check; stage_docker; stage_hygiene; stage_firewall; say "Phase 0 done"; stage_check ;;
  *)        die "unknown stage: $STAGE (check|firewall|docker|hygiene|all)" ;;
esac
