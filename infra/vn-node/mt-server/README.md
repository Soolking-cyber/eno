# eno · in-box translation server

Replaces Google Cloud Translation for the bulk EN↔VI (and 9 other language) work.

⛔ **The model is `facebook/m2m100_418M` (MIT) and the licence is load-bearing.** NLLB-200 wins
most public benchmarks and is CC-BY-NC-4.0 — unusable on a commercial marketplace. Model choice,
the measured comparison, and the known failure mode are at the top of `server.py`; read it
before changing anything here, and never swap in a non-commercial model.

## Build and run on the box

```bash
cd /opt/eno/app/infra/vn-node/mt-server
docker build -t eno-mt:local .            # ~10 min: downloads + converts m2m100_418M
docker run -d --name eno-mt --restart unless-stopped \
  --network supabase_default --cpus 4 -m 3g \
  -e MT_INTRA_THREADS=4 eno-mt:local
curl -s http://localhost:8088/health      # only if you publish a port; see below
```

⚠️ **No published port.** The server has no authentication, so it must stay on the Docker
network where only the app containers can reach it — `http://eno-mt:8088`. Publishing it
would put an unauthenticated translation endpoint on the internet, which is both an open
proxy for someone else's compute and the exact class of mistake that once left the Supabase
pooler exposed (see `eno-docker-bypasses-ufw`: Docker publishes past ufw).

Verify from inside the network instead:

```bash
docker run --rm --network supabase_default curlimages/curl \
  -s -X POST http://eno-mt:8088/translate \
  -H 'Content-Type: application/json' \
  -d '{"texts":["Màn hình Gaming ViewSonic 27 inch"],"source":"vi","target":"en"}'
```

## Wiring it to the app

Set on BOTH containers (this is the per-site config trap CLAUDE.md warns about — eno.vn and
eno.forum each have their own env file, and doing it once is the usual failure):

```
MT_LOCAL_URL=http://eno-mt:8088
```

`src/lib/translate.ts` then prefers it over Google automatically. Unset it and the app falls
straight back to the paid providers, which is the rollback.
