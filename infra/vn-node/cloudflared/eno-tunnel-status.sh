#!/usr/bin/env bash
# One screen of tunnel health. Metric names as of cloudflared 2026.9 — if a field is empty:
#   curl -s 127.0.0.1:20241/metrics | grep '^cloudflared_tunnel'
for i in 1 2; do p=2024$i; m=$(curl -s --max-time 3 http://127.0.0.1:$p/metrics)
  printf 'replica %s: %-8s ready=%s ha_conns=%s requests=%s errors=%s restarts=%s colos=%s\n' "$i" \
    "$(systemctl is-active eno-cloudflared@$i)" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:$p/ready)" \
    "$(awk '/^cloudflared_tunnel_ha_connections /{print $2}' <<<"$m")" "$(awk '/^cloudflared_tunnel_total_requests /{print $2}' <<<"$m")" \
    "$(awk '/^cloudflared_tunnel_request_errors /{print $2}' <<<"$m")" "$(systemctl show -p NRestarts --value eno-cloudflared@$i)" \
    "$(grep -o 'edge_location="[^"]*' <<<"$m" | cut -d'"' -f2 | sort | uniq -c | tr -s ' \n' ' ')"; done
echo "8181 bound to: $(ss -tlnH '( sport = :8181 )' | awk '{print $4}' | tr '\n' ' ')   (want 127.0.0.1:8181 only)"
echo "route_localnet≠0 on: $(grep -L '^0$' /proc/sys/net/ipv4/conf/*/route_localnet | tr '\n' ' ')(want nothing)"
journalctl -u 'eno-cloudflared@*' --since -1h -p warning --no-pager -q | tail -5
