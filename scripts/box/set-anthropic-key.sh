#!/bin/bash
# Installs the owner's Anthropic API key from STDIN, never from an argument and never printed:
#   pbpaste | bash scripts/box/set-anthropic-key.sh
# Writes ANTHROPIC_API_KEY into the box's two app env files and into the local ~/eno.vn/.env used by local previews and
# probes. Each file is backed up first and REPLACED ATOMICALLY (a temp file, then mv): a failed step leaves the old file
# whole, never a truncated one. The containers read it on the next deploy.
set -euo pipefail
KEY=$(tr -d '\r\n[:space:]')
case "$KEY" in sk-ant-*) ;; *) echo "That is not an Anthropic API key (it should start with sk-ant-). Nothing was changed." >&2; exit 1 ;; esac
[ ${#KEY} -ge 40 ] || { echo "The key looks too short. Nothing was changed." >&2; exit 1; }

PEM=~/.ssh/CS-Linux-20260920135129228.pem
STAMP=$(date +%Y%m%d-%H%M%S)
printf '%s' "$KEY" | ssh -o IdentitiesOnly=yes -i "$PEM" -p 24700 root@162.4.176.233 "set -euo pipefail; umask 077; K=\$(cat)
for f in /opt/eno/secrets/eno-vn.env /opt/eno/secrets/eno-forum.env; do
  [ -s \"\$f\" ] || { echo \"box: \$f is missing or empty — left alone\" >&2; exit 1; }
  cp -p \"\$f\" \"\$f.bak-$STAMP-anthropic\"
  tmp=\$(mktemp \"\$f.XXXXXX\")
  { grep -v '^ANTHROPIC_API_KEY=' \"\$f\" || true; printf 'ANTHROPIC_API_KEY=%s\n' \"\$K\"; } > \"\$tmp\"
  [ \$(wc -l < \"\$tmp\") -ge \$(wc -l < \"\$f\") ] || { rm -f \"\$tmp\"; echo \"box: \$f — the new file came out shorter; left alone\" >&2; exit 1; }
  chmod 600 \"\$tmp\"; mv \"\$tmp\" \"\$f\"
  echo \"box: \$f — ANTHROPIC_API_KEY set\"
done"

LOCAL=~/eno.vn/.env
if [ -s "$LOCAL" ]; then
  cp -p "$LOCAL" "$LOCAL.bak-$STAMP-anthropic"
  tmp=$(mktemp "$LOCAL.XXXXXX")
  { grep -v '^ANTHROPIC_API_KEY=' "$LOCAL" || true; printf 'ANTHROPIC_API_KEY=%s\n' "$KEY"; } > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$LOCAL"
  echo "local: $LOCAL — ANTHROPIC_API_KEY set"
fi
echo "Done. The key was not printed anywhere."
