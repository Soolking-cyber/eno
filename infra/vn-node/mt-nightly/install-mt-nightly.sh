#!/bin/bash
# Installs eno-mt-nightly on the VN box (owner, 2026-11-13: "a bigger model on the box ... translating once a day in low
# visit hour", then "yes"). Idempotent. Needs the model at /opt/eno/models (fetched here, sha256-checked) and the
# llama.cpp server image. Run from the repo checkout on the box: bash infra/vn-node/mt-nightly/install-mt-nightly.sh
set -euo pipefail
cd "$(dirname "$0")"
MODEL=/opt/eno/models/gemma-4-E4B-it-Q4_0.gguf
SHA=a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2
mkdir -p /opt/eno/models
if ! echo "$SHA  $MODEL" | sha256sum -c - >/dev/null 2>&1; then
  curl -sL --fail -o "$MODEL.part" https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf
  # ⚠️ Not `check && mv`: under set -e a failing command left of && does not stop the script, and a bad download would
  # still enable a timer that can never start its model.
  if ! echo "$SHA  $MODEL.part" | sha256sum -c -; then echo "model checksum mismatch: not installed" >&2; rm -f "$MODEL.part"; exit 1; fi
  mv "$MODEL.part" "$MODEL"
fi
docker image inspect ghcr.io/ggml-org/llama.cpp:server >/dev/null 2>&1 || docker pull ghcr.io/ggml-org/llama.cpp:server
install -D -m 0755 eno-mt-nightly.py /opt/eno/bin/eno-mt-nightly.py
install -m 0644 eno-mt-nightly.service eno-mt-nightly.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now eno-mt-nightly.timer
systemctl list-timers eno-mt-nightly.timer --no-pager
