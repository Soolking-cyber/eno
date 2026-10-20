# eno · Laya engine (teacher job DMs)

The second reader of a job post. The teacher job-DM matcher (`src/lib/teachers/job-dms/laya.ts`) asks it typed
questions about each post — what kind of post it is, who wrote it, what it requires — and gets a probability per answer.
**It decides nothing**: measured zero-shot on 270 blind-labelled posts (2026-10-20) its reading of what a post is was right
40% of the time, and as a veto it held 32 good posts and no bad one — so the app RECORDS its answers beside the rules'
(src/lib/teachers/job-dms/facts.ts `LAYA_ROLE = 'record'`) for a later calibration, and the rules decide alone.
`server.py`'s header has the HTTP contract.

⛔ **The licence is part of the model choice.** `convaiinnovations/laya-multilingual` is Apache-2.0 and its encoder,
`jhu-clsp/mmBERT-base`, is MIT — both fine on a commercial marketplace. Never swap in a non-commercial (CC-BY-NC)
checkpoint, however good it looks (the eno-mt story, `../mt-server/server.py`).

| | |
|---|---|
| image | `eno-laya:local`, built on the box from this folder; model **baked in** at build (`Dockerfile`) |
| model | `convaiinnovations/laya-multilingual` @ `1720e3e3357cfe1e281542e223f8273b0890ca34`, weights checked by sha256 |
| container | `eno-laya`, from `../jobs.compose.yml` (compose project `eno-jobs`), network `supabase_default`, **no published port** |
| limits | 3 CPUs, 4 GB RAM hard (no swap), `oom_score_adj` 500, read-only root, non-root user, all capabilities dropped |
| caller | `eno-vn-app` only, as `http://eno-laya:8790` (`LAYA_ENGINE_URL` in `../apps.compose.yml`) |
| engine id | `convaiinnovations/laya-multilingual@1720e3e3357cfe1e281542e223f8273b0890ca34` — from the baked `REVISION` / `MODEL_ID` files, never the network |

⚠️ **No published port, ever.** The server has no authentication — the Docker network is the boundary — and Docker
publishes past ufw, so a `ports:` line would put an unauthenticated endpoint on the internet. Everything below talks to
it from inside the network.

## Build and start (on the box)

```bash
cd /opt/eno/app                       # the deploy checkout, at the commit you mean to run
SHA=$(git rev-parse HEAD)
# Keep the image the container is SERVING — and serving HEALTHY — as the rollback: not whatever :local holds (a build
# that may never have started), and never a container a failed install left unhealthy (job-dms/install.sh does the
# same — opus, gate 6g). Skipped on the very first build: no container yet.
RUNNING=$(docker inspect eno-laya --format '{{.Image}}' 2>/dev/null) \
  && [ "$(docker inspect eno-laya --format '{{.State.Health.Status}}')" = healthy ] && docker tag "$RUNNING" eno-laya:prev
DOCKER_BUILDKIT=1 docker build --progress=plain --label "vn.eno.git-sha=$SHA" \
  -t eno-laya:local infra/vn-node/laya-server
docker compose -f infra/vn-node/jobs.compose.yml up -d --force-recreate
```

The build takes several minutes: torch and the model (~640 MB) download from download.pytorch.org, pypi.org and
huggingface.co, and the model is then loaded twice as a test (~2.5 GB of RAM and a few cores for about a minute
each). Run it outside a deploy — `eno-docker-prune` already skips while a `docker build` runs. **The build fails, and
`eno-laya:local` keeps the old image, if** torch is not the CPU wheel, the downloaded weights do not match their
sha256 pins, the model cannot load with the network off as the runtime user, or the engine id does not come from the
baked files.

To tell whether the running container is current — it needs rebuilding only when this folder changes:

```bash
BUILT=$(docker inspect eno-laya --format '{{index .Config.Labels "vn.eno.git-sha"}}')
git -C /opt/eno/app diff --quiet "$BUILT" HEAD -- infra/vn-node/laya-server \
  && echo "eno-laya is current" || echo "laya-server changed since $BUILT: rebuild"
```

## Check it

```bash
docker ps --filter name=eno-laya --format '{{.Names}}  {{.Status}}'   # "Up … (healthy)" once the model has loaded (1–3 min)
docker logs eno-laya 2>&1 | grep -E 'laya_loaded|laya_revision_unknown'   # want laya_loaded, revision 1720e3e…, no laya_revision_unknown
docker inspect eno-laya --format 'ports={{json .HostConfig.PortBindings}} readonly={{.HostConfig.ReadonlyRootfs}} user={{.Config.User}}'
                                                                      # want: no port bindings ({} or null), readonly=true, user=laya
docker run --rm --network supabase_default curlimages/curl -s http://eno-laya:8790/healthz
docker run --rm --network supabase_default curlimages/curl -s -X POST http://eno-laya:8790/v1/predict \
  -H 'content-type: application/json' \
  -d '{"states":[{"post":"URGENT: cover teacher needed tomorrow 6-8pm, District 7, teens, 450k/hour. PM me."}],"questions":{"kind":{"type":"choice","instructions":"What is this Facebook group post?","criteria":["a school or centre hiring a teacher","an urgent cover or substitute lesson request","a teacher looking for work","something else"]}}}'
docker stats --no-stream eno-laya                                     # MEM USAGE well under the 4GiB LIMIT, CPU at most 300%
```

`/healthz` should name `convaiinnovations/laya-multilingual` at revision `1720e3e3357cfe1e281542e223f8273b0890ca34`;
the predict should put "an urgent cover or substitute lesson request" far ahead (0.9996 for this text, measured locally).

⚠️ **Re-measure memory on the box after the first real matcher run** (long posts are the expensive case):
`docker stats --no-stream eno-laya` and `docker inspect eno-laya --format 'oomkilled={{.State.OOMKilled}} restarts={{.RestartCount}}'`
(want `false` / `0`). If it was killed, raise `mem_limit` and `memswap_limit` together in `../jobs.compose.yml`.

Its log (`docker logs eno-laya`) is one JSON line per event and never carries post or question text:
`laya_loading` / `laya_loaded` (revision, load time) and `listening` at boot, `laya_revision_unknown` if the baked
REVISION is missing; then per request `predict` (counts, ms), `predict_failed` (a question the model rejected: 422),
`predict_busy` (more than 4 requests at once: 503), `predict_abandoned` (the caller gave up; the rest was skipped),
`http` (every request but the 30-second health probe), and `stopped` on `docker stop`.

## Wiring it to the app

`LAYA_ENGINE_URL=http://eno-laya:8790` is set on `eno-vn` in `../apps.compose.yml` — **eno.vn only**: teachers live on
the marketplace, so eno-forum has no such line. Container env is read at create time, so it reaches `eno-vn-app` with
the next `eno-deploy.sh` run (which recreates it from that file); nothing else to do. Either side may go first: until
`eno-laya` answers, the app treats Laya as **not available** — the rules run and decide as always; the posts are simply
stored without Laya's answers.

## Rollback

```bash
# Laya off. Unset nothing: the app keeps LAYA_ENGINE_URL and reads an unreachable engine as "not available".
docker compose -f /opt/eno/app/infra/vn-node/jobs.compose.yml down
# …or back to the image that was serving before the last build:
docker tag eno-laya:prev eno-laya:local && docker compose -f /opt/eno/app/infra/vn-node/jobs.compose.yml up -d --force-recreate
```

`down` removes only `eno-laya`: the file is its own compose project (`name: eno-jobs`), so it can never touch the app
containers, and an external network is never removed by `down`. Both `eno-laya` tags survive the nightly prune, which
removes dangling images only.

## Why it is not in eno-deploy.sh

- **Its own lifecycle.** The model and runtime are pinned; nothing here changes when app code does. Building it in
  every deploy would add minutes, a 640 MB download and ~2.5 GB of build RAM to a deploy that already builds two
  editions — and three more outside services (pypi.org, download.pytorch.org, huggingface.co) that could fail a
  deploy — to produce an identical image.
- **The app never waits for it.** Unreachable is "not available" (the rules decide alone; answers are not recorded), so a deploy has
  nothing to health-check here and nothing to roll back.
- **The precedent.** eno-mt is built and run the same way, by hand (`../mt-server/README.md`).

## Changing the model or the runtime

Bump `LAYA_REVISION` (a full 40-hex commit — the build refuses a branch name) and, if the weights changed, the two
sha256 `ARG`s in the same commit; or change a pin in `requirements.txt`. Either way, re-measure first (below), then
rebuild. A new revision changes the engine id that every recorded answer carries, so two models' answers are never
mixed up when they are measured. Nothing is re-asked on a change: the app asks Laya only about the posts a run reads
(new ones — or every kept one after a rules-version change, run.ts), within a 4-minute budget per run (laya.ts).

## Local run (no Docker)

With a Python 3.11 venv holding `requirements.txt` and a local checkpoint directory:

```bash
LAYA_MODEL=/path/to/checkpoint LAYA_PORT=8799 LAYA_THREADS=3 OMP_NUM_THREADS=3 PYTHONDONTWRITEBYTECODE=1 \
  .venv/bin/python -B server.py         # a directory without REVISION reports revision "unknown" and logs it
python3 -B test_server.py               # the HTTP contract against a stub model: no torch needed (also run by vitest)
```

## Measured (2026-10-20, the owner's Mac — re-measure on the box)

Intel i9-9980HK, `LAYA_THREADS=3`, the pins above (the lead pipeline's venv), the weights baked here. ⚠️ The Mac was
shared with other jobs (load average 230–300 by the last run), so treat these as rough upper bounds: a third run, made
while a whole-repo typecheck ran beside it, loaded in 193 s and answered about 7x slower — with the same answers.

| | |
|---|---|
| load (process start → serving) | 54 s and 81 s (193 s on the overloaded run) |
| memory right after load | `ps` RSS 2.17 GB |
| memory at peak (load plus all the requests below) | physical footprint 2.3 GB; idle afterwards 2.0 GB, while `ps` RSS read 3.3 GB — it also counts freed pages macOS had not reclaimed yet |
| 2 questions, short posts (176–234 tokens per post across both) | 1.25–1.38 s per post |
| the app's 5 questions, short posts | 4.4–4.5 s per post; one 16-post chunk 70 s |
| the app's 5 questions, 3,000-char posts (770 tokens per question) | 36 s per post; 4 posts 143 s |
| `/healthz` while a 143 s predict ran | at most 8.5 ms |

Cost is posts × questions × length, so a caller sizes its requests and timeouts from these numbers; a request whose
caller gives up is dropped between posts (`predict_abandoned` in the log), not finished for nobody.
