#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · eno-photon: first install on the box (README.md). Idempotent: re-running re-checks the jar and rebuilds the index.
#
# ⛔ THE JAR IS PINNED BY SHA-256: komoot/photon's official 1.3.0 release (GitHub API digest, 2026-11-12). A different file
# is refused — bump VERSION and SHA256 together, from the release page, never from the download itself.
set -euo pipefail

VERSION=1.3.0
SHA256=a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5
DIR=/opt/eno/photon
HERE=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$DIR"
if ! echo "$SHA256  $DIR/photon.jar" | sha256sum -c --status 2>/dev/null; then
  curl -fsSL --max-time 600 -o "$DIR/photon.jar.part" "https://github.com/komoot/photon/releases/download/$VERSION/photon-$VERSION.jar"
  echo "$SHA256  $DIR/photon.jar.part" | sha256sum -c - || { rm -f "$DIR/photon.jar.part"; exit 1; }
  mv "$DIR/photon.jar.part" "$DIR/photon.jar"
fi

# The timer runs the script from the repo checkout (eno-photon-refresh.service), so a deploy carries its fixes.
"$HERE/photon-refresh.sh"

install -m 0644 "$HERE/eno-photon-refresh.service" "$HERE/eno-photon-refresh.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now eno-photon-refresh.timer
# The refresh skips (exit 0) while a deploy runs: never report an install that is not serving (commit gate, opus).
[ "$(docker inspect -f '{{.State.Running}}' eno-photon 2>/dev/null)" = "true" ] || { echo "eno-photon is NOT running — run install.sh again (after any deploy)"; exit 1; }
echo "eno-photon installed and serving $(readlink /opt/eno/photon/data)"
