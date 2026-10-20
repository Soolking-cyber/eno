"""
eno · the Laya decision engine on the VN box — the second reader of a teacher job post (CPU, no published port).

WHAT IT ANSWERS. convaiinnovations/laya-multilingual (322M parameters, a jhu-clsp/mmBERT-base encoder) answers TYPED
questions about a text — `choice`, `score`, `noul` — with a probability per option: one batched forward pass per state,
one sequence per question (so the cost of a request is states x questions x the post's length).
The only caller is src/lib/teachers/job-dms/laya.ts (LAYA_ENGINE_URL=http://eno-laya:8790 in apps.compose.yml, eno.vn
only), which asks what a job post is, who wrote it and what it requires.

⛔ IT IS NEVER THE DECIDER. Measured zero-shot it is uncalibrated and below the majority baseline on typed decisions
(it scored a landlord ad p=1.0000 as a seeker), so the app only RECORDS its answers beside what its own rules read
(src/lib/teachers/job-dms/facts.ts, LAYA_ROLE = 'record'): an answer never holds a post and never sends one — they are
kept to be measured against graded posts before Laya is given any say. This server's contract is "answer, or fail
loudly" — it does not threshold, smooth or second-guess the model, so the caller can always tell an answer from a
refusal.

⛔ THE LICENCE IS PART OF THE MODEL CHOICE (the eno-mt precedent, ../mt-server/server.py). The checkpoint is Apache-2.0
and its encoder, jhu-clsp/mmBERT-base, is MIT — both usable on a commercial marketplace. Never swap in a
non-commercial (CC-BY-NC) checkpoint, however good its benchmarks look.

⛔ THE ENGINE ID COMES FROM FILES BAKED BESIDE THE WEIGHTS, NEVER FROM THE HUB AT BOOT. The caller stores
`<model>@<revision>#q<questions sha>` with every answer, so each recorded answer names the model and the questions
behind it (nothing is re-asked when it changes — run.ts re-reads posts only on a rules-version change). The lead
pipeline's copy of this server asked huggingface.co for the repo's CURRENT sha at every start — and upstream README
commits move that sha without touching the weights (the owner's Mac holds three snapshots of this repo, 052592a,
e4e9ddf and 1720e3e, all three pointing at ONE weights blob), so its id moved whenever upstream committed, splitting one
model's answers under several names; and a boot that needs the network is a boot that fails whenever the box's egress
does. The Dockerfile
writes REVISION (the pinned commit) and MODEL_ID next to the weights. An absent or malformed REVISION is 'unknown',
logged at boot — never a network call.

⚠️ NO REQUEST BODIES IN LOGS. States are third-party posts from Facebook groups, LinkedIn alerts and chats the team
forwards (the app keeps them privately, in ExternalJobPost). The log carries method, path, status and counts; an
error is logged by its exception TYPE, never its message, and no handler ever logs a state or a question.

⚠️ ONE FORWARD PASS AT A TIME (LOCK). CPU inference is compute-bound and LAYA_THREADS already spends the container's
whole CPU quota, so a second pass in parallel only makes both slower. MAX_QUEUED bounds how many requests may wait for
it; past that the answer is 503 `busy`, which the caller — like any non-200 — reads as "Laya not available".

⚠️ A CALLER THAT HAS GIVEN UP IS NOT WORKED FOR. Measured on 3 threads (README.md): the app's five questions cost ~4.5 s
per short post and ~36 s per 3,000-character one, so a request can outlast the caller's timeout. A server that kept
going would hold the lock for minutes on answers nobody reads while the caller's next request queued behind it and
timed out in turn. So the connection is checked before every state and while waiting for the lock: once the caller
has closed it, the request stops (`predict_abandoned`), and at most the one state already in the model is wasted.

⚠️ NO AUTHENTICATION: the network is the boundary. It is reachable only on supabase_default, never on a published
port (README.md).

    GET  /healthz     -> {"ok": true, "model": "<name>", "revision": "<sha>", "engine": "<name>@<sha>", ...}
    POST /v1/predict  {"states": [<state>, ...], "questions": {<qid>: <question>}}
                      -> {"engine": "<name>@<sha>", "results": [{"answers": {...}, "usage": {...}}, ...],
                          "ms": <ms in the model>, "wait_ms": <ms waiting for it>}
  A state is a string, an object (the app sends {"post": "..."}) or a list of turns; its strings are clipped to
  MAX_CHARS. A question is laya's own shape — {"type": "choice", "instructions": "...", "criteria": {<option>: <text>}}
  (or a list of options), {"type": "score", "instructions": "...", "criteria": [<level>, ...]} or
  {"type": "noul", "instructions": "..."} — and is passed to the model untouched; one it rejects is a 422 that names
  the exception's TYPE only (its message can quote the post — opus, gate 6c).

Environment: LAYA_MODEL (a checkpoint dir; default /models/laya, the copy baked into the image), LAYA_DEVICE (cpu),
LAYA_HOST / LAYA_PORT (127.0.0.1:8790 — the image sets 0.0.0.0 so the app containers can reach it), LAYA_THREADS
(torch intra-op threads; the image sets 3, the container's CPU quota).
"""
import json
import os
import re
import select
import signal
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Bounds on an unauthenticated internal service. The first three are the lead pipeline's; the last two are new here.
MAX_STATES = 64  # states per request (the app sends chunks of 16)
MAX_BODY = 2_000_000  # bytes, judged from Content-Length BEFORE anything is read
MAX_CHARS = 6000  # per string inside a state (the app sends at most 3000)
MAX_QUESTIONS = 16  # per request (the app asks 5); every question is one more sequence per state in the pass
MAX_QUEUED = 4  # /v1/predict requests admitted at once: one in the model, the rest waiting for LOCK

REVISION_FILE = "REVISION"
MODEL_ID_FILE = "MODEL_ID"
# A full commit sha in practice (the Dockerfile refuses anything else); a hand-made checkpoint dir may carry its own tag.
_REVISION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$")
_MODEL_ID_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._/-]{0,127}$")

LOG = sys.stdout  # test_server.py points this at a buffer to prove what never reaches the log


_LOG_LOCK = threading.Lock()


def log(event, **fields):
    """One JSON line per event on stdout (the container's json-file log keeps 3 x 10 MB) — whole lines: the handler
    threads write under one lock, so two events never interleave (opus, gate 6e)."""
    line = json.dumps(dict(event=event, **fields), ensure_ascii=False, default=str) + "\n"
    with _LOG_LOCK:
        LOG.write(line)
        LOG.flush()


def _first_line(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.readline(256).strip()
    except (OSError, UnicodeDecodeError):
        return None


def engine_identity(model):
    """(name, revision, problem) for the checkpoint in `model`, read from the files baked beside it — no network.

    name is MODEL_ID's first line, else `model` itself (it names what was loaded). revision is REVISION's first line,
    else 'unknown' with `problem` saying why ('revision_missing' / 'revision_malformed'), which main() logs.
    """
    name = _first_line(os.path.join(model, MODEL_ID_FILE))
    if not name or not _MODEL_ID_RE.match(name):
        name = model
    raw = _first_line(os.path.join(model, REVISION_FILE))
    if raw is None:
        return name, "unknown", "revision_missing"
    if not _REVISION_RE.match(raw):
        return name, "unknown", "revision_malformed"
    return name, raw, None


MAX_DEPTH = 6  # a post is {"post": "..."}, a chat a list of turns; nothing real nests deeper


def clip_state(state, depth=0):
    """The state with EVERY string it carries cut to MAX_CHARS — at any depth, object keys too (codex, gate 6g: one level
    let {"post": {"text": <2 MB>}} through to the model) — or BadRequest past MAX_DEPTH levels."""
    if depth > MAX_DEPTH:
        raise BadRequest(400, {"error": "bad_request", "detail": "a state nests too deep"})
    if isinstance(state, str):
        return state[:MAX_CHARS]
    if isinstance(state, dict):
        return {str(k)[:MAX_CHARS]: clip_state(v, depth + 1) for k, v in state.items()}
    if isinstance(state, list):
        return [clip_state(t, depth + 1) for t in state]
    return state


class BadRequest(Exception):
    def __init__(self, status, payload):
        super().__init__(payload["error"])
        self.status, self.payload = status, payload


def parse_request(raw):
    """(states, questions) from a /v1/predict body, or BadRequest. A refusal never quotes the body back."""
    try:
        req = json.loads(raw)
    except (ValueError, RecursionError):  # JSONDecodeError and UnicodeDecodeError are both ValueErrors
        raise BadRequest(400, {"error": "bad_request", "detail": "body is not JSON"}) from None
    if not isinstance(req, dict):
        raise BadRequest(400, {"error": "bad_request", "detail": "body must be an object"})
    states, questions = req.get("states"), req.get("questions")
    if not isinstance(states, list) or not states:
        raise BadRequest(400, {"error": "bad_request", "detail": "states must be a non-empty list"})
    if len(states) > MAX_STATES:
        raise BadRequest(413, {"error": "too_many_states", "max": MAX_STATES})
    if not all(isinstance(s, (str, dict, list)) for s in states):
        raise BadRequest(400, {"error": "bad_request", "detail": "a state is a string, an object or a list"})
    if not isinstance(questions, dict) or not questions:
        raise BadRequest(400, {"error": "bad_request", "detail": "questions must be a non-empty object"})
    if len(questions) > MAX_QUESTIONS:
        raise BadRequest(413, {"error": "too_many_questions", "max": MAX_QUESTIONS})
    if not all(isinstance(q, dict) for q in questions.values()):
        raise BadRequest(400, {"error": "bad_request", "detail": "a question is an object"})
    return [clip_state(s) for s in states], questions


class Busy(Exception):
    pass


class PredictFailed(Exception):
    """The model rejected the input. Carries the exception's TYPE only: its message can quote the post."""

    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


class Abandoned(Exception):
    """The caller closed the connection; `answered` states had been through the model by then."""

    def __init__(self, answered):
        super().__init__(answered)
        self.answered = answered


class Engine:
    """The loaded model behind one lock. `agent` is anything with laya's predict(state, questions) -> {answers, usage}."""

    def __init__(self, agent, name, revision, device="cpu", threads=None, runtime=None, max_queued=MAX_QUEUED):
        self.agent = agent
        self.name, self.revision = name, revision
        self.id = "%s@%s" % (name, revision)
        self.device, self.threads, self.runtime = device, threads, dict(runtime or {})
        self.lock = threading.Lock()  # one forward pass at a time — see the header
        self.admitted = threading.BoundedSemaphore(max_queued)

    def health(self):
        return {"ok": True, "model": self.name, "revision": self.revision, "engine": self.id,
                "device": self.device, "threads": self.threads, "runtime": self.runtime}

    def predict(self, states, questions, gone=lambda: False):
        """([{answers, usage}] per state in order, ms in the model, ms waiting for it).

        Busy past MAX_QUEUED, PredictFailed when the model rejects the input, Abandoned once `gone()` says the caller
        has left — asked while waiting for the lock and before every state, never in the middle of one.
        """
        if not self.admitted.acquire(blocking=False):
            raise Busy()
        try:
            queued = time.perf_counter()
            while not self.lock.acquire(timeout=1.0):
                if gone():
                    raise Abandoned(0)
            try:
                start = time.perf_counter()
                results = []
                for state in states:
                    if gone():
                        raise Abandoned(len(results))
                    try:
                        out = self.agent.predict(state, questions)
                        results.append({"answers": out["answers"], "usage": out.get("usage")})
                    except Exception as e:  # a question the model rejects must not take the server down
                        raise PredictFailed(type(e).__name__) from None
                done = time.perf_counter()
            finally:
                self.lock.release()
        finally:
            self.admitted.release()
        return results, round((done - start) * 1000, 1), round((start - queued) * 1000, 1)


class Handler(BaseHTTPRequestHandler):
    server_version = "eno-laya/1"
    sys_version = ""  # the Server header need not advertise the Python build
    timeout = 60  # seconds a client that stalls mid-request may hold its thread

    def _send(self, code, payload):
        try:
            body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except ValueError:  # NaN/inf would be JSON the caller cannot parse — refuse instead of sending it
            code, body = 500, b'{"error":"non_finite"}'
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_request(self, code="-", size="-"):
        status = int(code) if isinstance(code, int) else str(code)
        path = (getattr(self, "path", "") or "")[:200]
        if path == "/healthz" and status == 200:
            return  # the image's HEALTHCHECK, every 30 s
        log("http", method=getattr(self, "command", None), path=path, status=status)

    def log_message(self, fmt, *args):  # reached via send_error on a malformed request line; never a body
        log("http_error", detail=(fmt % args)[:200])

    def _caller_gone(self):
        """True once the caller has closed its end (it timed out and gave up): nobody is left to read the answer.

        The whole body has been read by now, so a readable socket means end-of-stream (or a reset), not more request.
        (An HTTP client does not half-close while it waits for its response — Node's fetch, curl and urllib do not —
        so a socket at end-of-stream is a caller that has left.)
        """
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            return bool(readable) and self.connection.recv(1, socket.MSG_PEEK) == b""
        except (OSError, ValueError):  # a reset connection, or a socket already closed under us
            return True

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, self.server.engine.health())
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/predict":
            return self._send(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            return self._send(400, {"error": "bad_request", "detail": "content-length"})
        if length <= 0 or length > MAX_BODY:
            return self._send(413, {"error": "body_size", "max": MAX_BODY})
        raw = self.rfile.read(length)
        if len(raw) < length:
            return  # the client went away mid-body; there is nobody to answer
        try:
            states, questions = parse_request(raw)
        except BadRequest as e:
            return self._send(e.status, e.payload)
        engine = self.server.engine
        try:
            results, ms, wait_ms = engine.predict(states, questions, gone=self._caller_gone)
        except Abandoned as e:
            log("predict_abandoned", states=len(states), questions=len(questions), answered=e.answered)
            self.close_connection = True
            return  # the caller has gone; there is no one to answer
        except Busy:
            log("predict_busy", states=len(states), questions=len(questions))
            return self._send(503, {"error": "busy", "max_queued": MAX_QUEUED})
        except PredictFailed as e:
            log("predict_failed", error=e.kind, states=len(states), questions=len(questions))
            return self._send(422, {"error": "predict_failed", "kind": e.kind})
        log("predict", states=len(states), questions=len(questions), ms=ms, wait_ms=wait_ms)
        self._send(200, {"engine": engine.id, "results": results, "ms": ms, "wait_ms": wait_ms})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, engine):
        self.engine = engine
        super().__init__(address, Handler)

    def handle_error(self, request, client_address):
        # The default prints a traceback, and an exception's message can quote what it choked on: the type only.
        log("handler_error", error=type(sys.exc_info()[1]).__name__)


def _env_int(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    if not re.fullmatch(r"[0-9]+", raw) or int(raw) < 1:  # not isdigit(): it accepts "³", which int() refuses
        sys.exit("%s must be a positive integer (got %r)" % (name, raw))
    return int(raw)


def _stop(signum, _frame):
    raise KeyboardInterrupt  # unwinds the model load or serve_forever, in the main thread


def main():
    # ⚠️ PID 1 IN A CONTAINER IGNORES SIGTERM UNLESS IT INSTALLS A HANDLER — without this, `docker stop` and
    # `compose down` would wait out their 10 s and SIGKILL.
    signal.signal(signal.SIGTERM, _stop)
    # Never the network at boot, even outside the image (which sets these too): a model not on disk is an error here.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    model = os.environ.get("LAYA_MODEL", "/models/laya")
    device = os.environ.get("LAYA_DEVICE", "cpu")
    host = os.environ.get("LAYA_HOST", "127.0.0.1")
    port = _env_int("LAYA_PORT", 8790)
    threads = _env_int("LAYA_THREADS", None)

    name, revision, problem = engine_identity(model)
    if problem:
        log("laya_revision_unknown", reason=problem, expected=os.path.join(model, REVISION_FILE),
            note="engine id is %s@unknown: answers recorded under it cannot say which revision gave them" % name)
    log("laya_loading", model=name, revision=revision, path=model, device=device, threads=threads)
    t0 = time.perf_counter()
    # Deferred imports: everything above (and the whole HTTP layer) runs without torch — test_server.py relies on it.
    from importlib.metadata import version

    import torch

    if threads:
        torch.set_num_threads(threads)
    import laya

    agent = laya.load(model, device=device)
    runtime = {pkg: version(pkg) for pkg in ("laya", "torch", "transformers", "tokenizers")}
    engine = Engine(agent, name, revision, device=str(agent.device), threads=torch.get_num_threads(), runtime=runtime)
    log("laya_loaded", model=name, revision=revision, device=engine.device, threads=engine.threads,
        load_s=round(time.perf_counter() - t0, 1), runtime=runtime)
    srv = Server((host, port), engine)
    log("listening", host=host, port=port)
    try:
        srv.serve_forever()
    finally:
        srv.server_close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped")
