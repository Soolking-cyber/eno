# eno · classroom speech server

The eno Classroom tutor's ears and voice, self-hosted on the VN box: NVIDIA Parakeet TDT 0.6B v2 for speech-to-text and
Gradium Phonon 31M for the avatar's voice. Open models, commercial licences, CPU only, $0 a minute. Owner, 2026-10-26:
*"use best for current box to mvp with up to 10 users if works fresh box for this task only"*.

⛔ **Read `server.py`'s header before changing a model.** It records what was measured, what lost (Kokoro: too slow on
this CPU; Parakeet 110M: twice the errors; Whisper: rewrites learners' grammar) and the licence traps (Phonon **40m** is
non-commercial; only `phonon-31m-en` may ship).

## What the app sends, and what stays here

- `POST /stt`: one learner turn, a 16 kHz mono WAV of 45 s or less. The answer is `{text, status: ok|silence}`. Decoded in
  memory and dropped; never written, never logged.
- `POST /tts`: `{text, voice, rate: natural|slow}`. The answer is MP3, 24 kHz mono, ~7 KB a second. `voice` must be one of
  the nine in `server.py` `VOICES`, which is the same list as `src/lib/classroom/voices.ts` and `fetch_models.py`
  (`voices.test.ts` fails when they differ).
- `GET /health`: the models, the voices, and the peak RSS.

The app calls this server with `x-speech-key` on every request (`src/lib/classroom/speech-local.ts`). There is no
fallback to a hosted service: when this server is down, the classroom says "try again". Azure is used for one thing only:
scoring repeat-after-me drills, and only while `AZURE_SPEECH_KEY` is set.

## Build (once, at a quiet hour, never during a deploy)

```bash
cd /opt/eno/app/infra/vn-node/classroom-speech
docker build -t eno-classroom-speech:local .     # ~5 min: ~600 MB of models, each checked against its SHA-256
```

A build on another amd64 machine works the same: `docker save eno-classroom-speech:local | gzip` there, then
`gunzip | docker load` here.

## Run

```bash
# the shared key, made once; the container (user nobody) reads it through a read-only mount
install -m 644 /dev/null /opt/eno/secrets/classroom-speech-key
openssl rand -base64 36 | tr -d '\n' > /opt/eno/secrets/classroom-speech-key

docker run -d --name eno-classroom-speech --restart unless-stopped \
  --network supabase_default \
  --cpus 4 -m 2500m --memory-swap 2500m --oom-score-adj 1000 \
  --read-only --tmpfs /tmp:size=64m --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 \
  -v /opt/eno/secrets/classroom-speech-key:/run/speech-key:ro -e SPEECH_KEY_FILE=/run/speech-key \
  eno-classroom-speech:local
```

⚠️ The key goes in as a mounted file, not `-e SPEECH_KEY=…`: `docker inspect` prints every environment variable.
`/opt/eno/secrets` is root-only (0700), so the file can be 0644: only root on the host and this container read it.

What each flag protects:

- **`--cpus 4`**: the box has 12 vCPUs, and the sites, Postgres and two translation servers live on the rest.
- **`-m 2500m --memory-swap 2500m`**: a hard memory cap. The container measured 1.2 GB at start and 1.7 GB at peak:
  a 45 s turn, a 1,190-character reply, and 12 parallel replies.
- **`--oom-score-adj 1000`**: if the whole box ever runs out of memory, the kernel kills this container first, before
  Postgres or a site.
- **No `-p`**: no published port. Docker publishes past ufw (memory: eno-docker-bypasses-ufw). The app reaches the server at
  `http://eno-classroom-speech:8090` on `supabase_default`, the network `eno-mt` uses. The key is the second lock,
  because Supabase's containers share that network.
- **`--read-only`, `--cap-drop ALL`, `--pids-limit`**: the server writes nothing and needs no privileges.

⛔ **`eno-deploy.sh` STOPS this container while it builds the apps** and starts it again afterwards (step 5). A Next.js
build is the biggest memory peak the box sees, the box has no swap, and the container holds 1.2–1.7 GB. An EXIT trap
starts it again even if the deploy is killed mid-build: bash 5.2.21, the box's version, runs the EXIT trap on HUP, INT
and TERM (measured 2026-10-26 in ubuntu:24.04). If it is ever found stopped anyway, run
`docker start eno-classroom-speech`.
⚠️ For those ~10 minutes, learners in a live session get "try again" while the session's minutes, and Spatius's
connected minutes, keep running. Deploy outside practice hours, or close the classroom first with `classroom-off.sh`.

## Wire the app (eno.vn's env file, then a deploy)

```
CLASSROOM_SPEECH_URL=http://eno-classroom-speech:8090
CLASSROOM_SPEECH_KEY=<the contents of /opt/eno/secrets/classroom-speech-key>
```

Leave either unset and the classroom answers `speech_unavailable`. Nothing else in the app changes.

## Verify (from inside the network)

```bash
docker run --rm --network supabase_default -e SPEECH_URL=http://eno-classroom-speech:8090 \
  -v /opt/eno/secrets/classroom-speech-key:/run/speech-key:ro --entrypoint sh eno-classroom-speech:local \
  -c 'SPEECH_KEY=$(cat /run/speech-key) exec python -I /app/test_server.py'
docker logs --tail 20 eno-classroom-speech      # route, ms, seconds; never words
```

`test_server.py` checks the key, every refusal, silence, the stalled-body timeout and the 503 under load. It ends
`ALL PASS` or names what failed.

## Measured (2026-10-26)

| | i9-9980HK, native | same CPU, this image under `--cpus 4` (Docker VM) | the box |
|---|---|---|---|
| STT, ~5 s turn | 0.33 s | 0.76–1.2 s | **to measure** |
| STT, 45 s turn | — | 5.1 s | **to measure** |
| TTS, a 78-character reply (~5 s of audio) | ~1.2 s | 1.4–1.5 s | **to measure** |
| RSS at start / peak | — | 1.2 / 1.7 GB | **to measure** |

The box measured ~1.5× slower than the i9 per core on a CPU test. Both CPUs have AVX2 and FMA and neither has AVX-512,
so they take the same code paths. Word error rate on 120 speechocean762 clips (Mandarin-L1 learners reading aloud):
children 12.7%, adults 6.5%. Not yet measured on Vietnamese learners speaking freely; the pilot's consented clips are
that test.

## Rollback

Unset `CLASSROOM_SPEECH_URL` in the env file and deploy; the classroom then answers `speech_unavailable`, and
`classroom-off.sh` closes it entirely. Then run `docker rm -f eno-classroom-speech`. Nothing else depends on it.

## Licences

| Part | Licence | Owed |
|---|---|---|
| Parakeet TDT 0.6B v2 weights (NVIDIA) | CC-BY-4.0 | Credit NVIDIA, link the licence, note the int8 conversion. Only owed if the weights are shared, which they never are: the server keeps them. Credit it anyway on any open-source notices page. |
| sherpa-onnx 2.0.0 | Apache-2.0 | — (2.0.0 is the first release without GPL espeak-ng) |
| Phonon 31M en: weights, tokenizer, voices | Apache-2.0 | — (⛔ the 40m models are CC BY-NC) |
| ptts 0.4.2 runtime | MIT OR Apache-2.0 | — |
