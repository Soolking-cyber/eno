# syntax=docker/dockerfile:1
# eno · the Laya decision engine (CPU) — the second reader of a teacher job post. server.py says what it answers and
# why it is never the decider; README.md has the box commands.
#
# ⛔ THE MODEL IS BAKED IN AT BUILD, NOT DOWNLOADED AT BOOT (the eno-mt precedent, ../mt-server/Dockerfile). A
# container that fetches 640 MB from huggingface.co on every start is a restart that fails whenever the box's egress
# to HF is slow or blocked. The download happens once, here, at a pinned commit, and the build then proves — with the
# network switched OFF, as the runtime user — that the model loads from the baked files alone.
#
# ⚠️ PINNED, AND THE PINS ARE THE ONES MEASURED WORKING (requirements.txt says why Python 3.11 and torch 2.2.2). An
# unpinned rebuild months from now could install a different runtime or fetch different weights and answer
# differently from the same commit, with nothing in git to explain it. ⚠️ The pins are the TOP-LEVEL packages and the
# weights (by sha256); their own dependencies (filelock, regex, tqdm, …) still resolve when the image is built — no
# hash lock, which needs a Linux resolve to write (opus, gate 6e) — and the base tag below moves with its security
# patches (codex, gate 6f). So a rebuild is a new runtime: the build's offline load and install.sh's real prediction
# catch one that breaks the model, and a rebuild goes only with a re-measurement (README).

# ⛔ convaiinnovations/laya-multilingual is Apache-2.0 and its encoder, jhu-clsp/mmBERT-base, is MIT — both usable on
# a commercial marketplace. This is the line where a licence violation would come in: never point it at a
# non-commercial (CC-BY-NC) checkpoint, however good its benchmarks (../mt-server/server.py tells that story).
ARG LAYA_REPO=convaiinnovations/laya-multilingual
# ⛔ A FULL COMMIT SHA, NEVER A BRANCH. Upstream README commits move `main` without touching the weights; a pinned
# commit is what makes REVISION — and so the engine id the app stores with every answer — mean one set of weights.
ARG LAYA_REVISION=1720e3e3357cfe1e281542e223f8273b0890ca34
# ⛔ AND THE WEIGHTS THEMSELVES, BY CONTENT: the sha256 of the two large files the pipeline measured (its Mac cache names
# them by these; upstream commits 052592a, e4e9ddf and 1720e3e all carry the same two). New weights fail the build here
# until these change in the same commit — together with a re-measurement (README.md, "Local run").
ARG LAYA_WEIGHTS_SHA256=9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204
ARG LAYA_TOKENIZER_SHA256=609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f

# ---------- the runtime's Python packages (shared by the model stage and the image that runs) ----------
FROM python:3.11-slim AS runtime-deps
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore
COPY requirements.txt /tmp/requirements.txt
# torch first, from the CPU index (requirements.txt explains). The version check fails the build if the CUDA wheel —
# and its ~2.5 GB of nvidia-* libraries — ever slipped in instead.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.2.2 \
 && pip install -r /tmp/requirements.txt \
 && python -c "import sys, torch; sys.exit(0 if torch.__version__ == '2.2.2+cpu' else 'expected torch 2.2.2+cpu, got ' + torch.__version__)" \
 && pip check \
 && rm /tmp/requirements.txt

# ---------- the model: fetched once at the pinned commit, checked by content, loaded once with the network off ----------
FROM runtime-deps AS model
ARG LAYA_REPO
ARG LAYA_REVISION
ARG LAYA_WEIGHTS_SHA256
ARG LAYA_TOKENIZER_SHA256
# Only what laya's own loader reads (its allow-list in laya/agent.py) plus the model card and licence — never a whole-
# repo snapshot, which would carry whatever else upstream ever adds to the repo into the image.
RUN echo "$LAYA_REVISION" | grep -Eq '^[0-9a-f]{40}$' \
      || { echo "LAYA_REVISION must be a full 40-hex commit sha, got '$LAYA_REVISION'" >&2; exit 1; } \
 && python -c "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], revision=sys.argv[2], local_dir='/models/laya', allow_patterns=['rl_agent_config.json', 'model.safetensors', 'tokenizer/*', 'encoder/*', 'README.md', 'LICENSE*'])" "$LAYA_REPO" "$LAYA_REVISION" \
 && printf '%s  %s\n' "$LAYA_WEIGHTS_SHA256" /models/laya/model.safetensors "$LAYA_TOKENIZER_SHA256" /models/laya/tokenizer/tokenizer.json | sha256sum -c - \
 && printf '%s\n' "$LAYA_REVISION" > /models/laya/REVISION \
 && printf '%s\n' "$LAYA_REPO" > /models/laya/MODEL_ID \
 && rm -rf /models/laya/.cache
# ⚠️ THIS FIRST LOAD IS WHAT MAKES THE MODEL LOADABLE IN THE CONTAINER AT ALL — it is not only a test. laya REWRITES
# tokenizer/tokenizer_config.json on its first load when the file is in the form transformers 5 writes, which 4.57
# cannot read (laya/agent.py _fix_tokenizer_config); the pipeline's cached copy on the owner's Mac no longer matches
# its own upstream hash, and holds exactly what that rewrite produces. The rewrite has to happen HERE, where /models is
# writable: in the container the root filesystem is read-only, the rewrite fails SILENTLY, and the tokenizer then
# refuses to load — measured locally, a read-only copy in that form fails with "Tokenizer class TokenizersBackend does
# not exist". --network=none: the build fails if anything in the load still reaches for the network.
RUN --network=none HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 python -c 'import laya; laya.load("/models/laya")' \
 && chmod -R a+rX,go-w /models

# ---------- the image that runs ----------
FROM runtime-deps
ARG LAYA_REPO
ARG LAYA_REVISION
LABEL vn.eno.laya.model="$LAYA_REPO" vn.eno.laya.revision="$LAYA_REVISION"
COPY --from=model /models /models
COPY server.py /app/server.py
# Non-root and owning nothing: /models and /app stay root's, and jobs.compose.yml adds a read-only root filesystem.
RUN useradd --system --uid 10001 --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin laya
# LAYA_THREADS / OMP_NUM_THREADS = the container's CPU quota (jobs.compose.yml `cpus: 3`): torch would otherwise start a
# thread per HOST core and spend the quota fighting itself. HF_HOME on /tmp: nothing writes there offline, and if
# anything ever does it lands on the tmpfs instead of failing against the read-only root.
ENV LAYA_MODEL=/models/laya \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HOME=/tmp/hf \
    LAYA_THREADS=3 \
    OMP_NUM_THREADS=3 \
    LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8790
USER laya
# The runtime's load once more, the way the container does it — as `laya`, offline, network off, nothing under /models
# writable — and the engine id it will report, which must come from the baked files (a missing or malformed REVISION
# exits non-zero). This proves the weights load offline with this image's packages — NOT inference under the running
# container's limits (read-only root, a 64 MB noexec /tmp, 4 GB, no capabilities): job-dms/install.sh proves that with one
# real prediction through the started container (opus, gate 6c).
RUN --network=none python -c 'import laya; laya.load("/models/laya")' \
 && python -c 'import sys; sys.path.insert(0, "/app"); import server; name, rev, problem = server.engine_identity("/models/laya"); print("engine id: %s@%s" % (name, rev)); sys.exit(problem)'
WORKDIR /app
EXPOSE 8790
# This image has python (eno-mt's has no curl, so it has no healthcheck). /healthz answers only once the model is loaded
# — 54 and 81 s on 3 threads of the owner's i9 Mac, 193 s when that machine was heavily overloaded (2026-10-20), hence
# the generous start period — and it never waits for the inference lock: measured, it answered in at most 8.5 ms during
# a 143-second predict.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD ["python", "-c", "import os, sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('LAYA_PORT', '8790'), timeout=4).status == 200 else 1)"]
CMD ["python", "/app/server.py"]
