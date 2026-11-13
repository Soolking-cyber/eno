#!/bin/bash
# Removes the nightly Gemma translation job from the VN box (owner, 2026-11-14: "remove gemma go back to haiku daily translation";
# the listings are now translated by Claude Haiku in eno Reach, src/lib/mt-job.ts). Undoes infra/vn-node/mt-nightly/install-mt-nightly.sh
# (git history): the timer and unit, the script, the container, the llama.cpp image and the 4.6 GB model. Idempotent; run as root.
# Kept: /var/log/eno-mt-nightly.log (the record), the rows Gemma wrote ("Translation".id 'gemma1_…', redone by Haiku), and
# /opt/eno/mt-nightly.hold if it exists (another session's maintenance marker: it removes it itself).
set -uo pipefail
systemctl disable --now eno-mt-nightly.timer 2>/dev/null
systemctl stop eno-mt-nightly.service 2>/dev/null
rm -f /etc/systemd/system/eno-mt-nightly.timer /etc/systemd/system/eno-mt-nightly.service
systemctl daemon-reload
systemctl reset-failed eno-mt-nightly.service 2>/dev/null
docker rm -f eno-gemma >/dev/null 2>&1
docker image rm ghcr.io/ggml-org/llama.cpp:server >/dev/null 2>&1
rm -f /opt/eno/bin/eno-mt-nightly.py /opt/eno/models/gemma-4-E4B-it-Q4_0.gguf
rmdir /opt/eno/models 2>/dev/null
rm -rf /var/lib/eno-mt-nightly
# What is left, so the person running this sees it is gone.
echo "timer: $(systemctl list-unit-files 'eno-mt-nightly*' --no-legend 2>/dev/null | wc -l) unit files"
echo "container: $(docker ps -a --filter name=eno-gemma -q | wc -l), image: $(docker image ls -q ghcr.io/ggml-org/llama.cpp:server | wc -l)"
echo "script: $(ls /opt/eno/bin/eno-mt-nightly.py 2>/dev/null | wc -l), model: $(ls /opt/eno/models/gemma-4-E4B-it-Q4_0.gguf 2>/dev/null | wc -l)"
