"""
server.py's HTTP contract against a stub model — no torch, no laya, nothing beyond 127.0.0.1.

    python3 -B infra/vn-node/laya-server/test_server.py      (src/lib/laya-infra.test.ts runs it in the vitest suite)

What it holds: the engine id comes from the files baked beside the weights (and is 'unknown' without them, never a
network call); every bound answers before any model work; one forward pass at a time behind a bounded queue; a question
the model rejects is a 422, not a dead server; and no state or question text ever reaches the log.
"""
import http.client
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest

sys.dont_write_bytecode = True  # never leave a __pycache__ behind in the checkout
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402

SHA = "1720e3e3357cfe1e281542e223f8273b0890ca34"
NAME = "convaiinnovations/laya-multilingual"
# Stands in for third-party post text (a phone number and a name): it must never appear in the log.
MARKER = "Call Ms Lan 0909 123 456"
QUESTIONS = {
    "kind": {"type": "choice", "instructions": "What is `post`?",
             "criteria": {"hiring": "a school hiring", "cover": "a cover request", "other": "anything else"}},
    "native": {"type": "choice", "instructions": "Native speakers only?", "criteria": ["required", "not stated"]},
}


class StubAgent:
    """laya's predict(state, questions) -> {"answers": {qid: ...}, "usage": ...}; optionally slow, gated or failing."""

    def __init__(self, fail=None, gate=None, delay=0.0, value=None):
        self.fail, self.gate, self.delay, self.value = fail, gate, delay, value
        self.calls = []
        self.active = self.max_active = 0
        self._mu = threading.Lock()

    def predict(self, state, questions):
        with self._mu:
            self.calls.append(state)
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self.gate is not None:
                self.gate.wait(10)
            if self.delay:
                time.sleep(self.delay)
            if self.fail is not None:
                raise self.fail
            answers = {}
            for qid, q in questions.items():
                options = list(q.get("criteria") or [])
                p = self.value if self.value is not None else round(1.0 / max(1, len(options)), 4)
                answers[qid] = {"type": "choice", "choice": options[0] if options else None,
                                "probabilities": {o: p for o in options}}
            return {"model": "stub", "answers": answers, "usage": {"input_tokens": 7, "output_tokens": 0}}
        finally:
            with self._mu:
                self.active -= 1


class Harness:
    def __init__(self, agent, max_queued=server.MAX_QUEUED):
        self.max_queued = max_queued
        self.engine = server.Engine(agent, NAME, SHA, threads=3, runtime={"laya": "stub"}, max_queued=max_queued)
        self.srv = server.Server(("127.0.0.1", 0), self.engine)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def admitted(self):
        """Requests admitted right now (in the model or waiting for it) — counted, so no test has to sleep and hope."""
        return self.max_queued - self.engine.admitted._value

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()

    def request(self, method, path, body=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode("utf-8"))
        conn.request(method, path, body=data, headers={"content-type": "application/json"} if data else {})
        r = conn.getresponse()
        payload = r.read()
        conn.close()
        return r.status, (json.loads(payload) if payload else None)

    def hang_up_later(self, body):
        """Send a whole predict request on a raw socket and return it unread — the caller closes it to give up."""
        s = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        data = json.dumps(body).encode("utf-8")
        s.sendall(b"POST /v1/predict HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n"
                  % len(data) + data)
        return s

    def headers_only(self, content_length):
        """A POST that announces a body and never sends it — the bound must answer from the header alone."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        conn.putrequest("POST", "/v1/predict")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", content_length)
        conn.endheaders()
        r = conn.getresponse()
        payload = r.read()
        conn.close()
        return r.status, json.loads(payload)


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.log = io.StringIO()
        server.LOG = self.log
        self.harnesses = []

    def tearDown(self):
        for h in self.harnesses:
            h.close()
        server.LOG = sys.stdout

    def start(self, agent, **kw):
        h = Harness(agent, **kw)
        self.harnesses.append(h)
        return h

    def log_events(self):
        return [json.loads(line) for line in self.log.getvalue().splitlines() if line.strip()]

    def wait_for(self, predicate, seconds=5.0):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(0.02)
        return predicate()

    def abandoned(self):
        return [e for e in self.log_events() if e["event"] == "predict_abandoned"]

    # ---- the engine id: from the baked files, never the network ----

    def test_engine_id_comes_from_the_baked_files(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "REVISION"), "w") as f:
                f.write(SHA + "\n")
            with open(os.path.join(d, "MODEL_ID"), "w") as f:
                f.write(NAME + "\n")
            self.assertEqual(server.engine_identity(d), (NAME, SHA, None))

    def test_engine_id_is_unknown_without_a_revision_file(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(server.engine_identity(d), (d, "unknown", "revision_missing"))
            with open(os.path.join(d, "MODEL_ID"), "w") as f:
                f.write(NAME + "\n")
            self.assertEqual(server.engine_identity(d), (NAME, "unknown", "revision_missing"))

    def test_a_malformed_revision_is_unknown_too(self):
        for content in ("", "\n", "main branch\n", "../../etc\n", "x" * 80 + "\n"):
            with tempfile.TemporaryDirectory() as d:
                with open(os.path.join(d, "REVISION"), "w") as f:
                    f.write(content)
                self.assertEqual(server.engine_identity(d)[1:], ("unknown", "revision_malformed"), repr(content))

    def test_importing_the_server_loads_no_model_runtime_and_no_hub_client(self):
        # main() imports torch and laya; the module itself (and engine_identity) must not, and nothing may ask the hub.
        server.engine_identity(tempfile.gettempdir())
        for mod in ("torch", "laya", "transformers", "huggingface_hub"):
            self.assertNotIn(mod, sys.modules, mod)

    # ---- the API ----

    def test_healthz_reports_the_engine_id(self):
        h = self.start(StubAgent())
        status, body = h.request("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertEqual((body["ok"], body["model"], body["revision"]), (True, NAME, SHA))
        self.assertEqual(body["engine"], "%s@%s" % (NAME, SHA))

    def test_predict_answers_every_state_in_order(self):
        agent = StubAgent()
        h = self.start(agent)
        states = [{"post": "one"}, {"post": "two"}, "three"]
        status, body = h.request("POST", "/v1/predict", {"states": states, "questions": QUESTIONS})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["engine"], "%s@%s" % (NAME, SHA))
        self.assertEqual(len(body["results"]), 3)
        for r in body["results"]:
            self.assertEqual(set(r["answers"]), set(QUESTIONS))
            self.assertEqual(r["usage"], {"input_tokens": 7, "output_tokens": 0})
        self.assertEqual(agent.calls, states)
        self.assertGreaterEqual(body["ms"], 0)
        self.assertGreaterEqual(body["wait_ms"], 0)

    def test_every_string_in_a_state_is_clipped(self):
        agent = StubAgent()
        h = self.start(agent)
        long = "x" * (server.MAX_CHARS + 1000)
        states = [{"post": long, "n": 3}, long, [long, {"text": long}, 7]]
        status, _ = h.request("POST", "/v1/predict", {"states": states, "questions": QUESTIONS})
        self.assertEqual(status, 200)
        post, text, turns = agent.calls
        self.assertEqual((len(post["post"]), post["n"]), (server.MAX_CHARS, 3))
        self.assertEqual(len(text), server.MAX_CHARS)
        self.assertEqual((len(turns[0]), len(turns[1]["text"]), turns[2]), (server.MAX_CHARS, server.MAX_CHARS, 7))

    def test_strings_are_clipped_at_any_depth_and_deep_nesting_is_refused(self):
        # codex, gate 6g: one level of clipping let {"post": {"text": <2 MB>}} through to the model
        agent = StubAgent()
        h = self.start(agent)
        long = "x" * (server.MAX_CHARS + 1000)
        status, _ = h.request("POST", "/v1/predict", {"states": [{"post": {"text": long, long: [long, {"a": long}]}}], "questions": QUESTIONS})
        self.assertEqual(status, 200)
        (state,) = agent.calls
        def strings(v):
            if isinstance(v, str):
                yield v
            elif isinstance(v, dict):
                for k, x in v.items():
                    yield k
                    yield from strings(x)
            elif isinstance(v, list):
                for x in v:
                    yield from strings(x)
        self.assertEqual(max(len(s) for s in strings(state)), server.MAX_CHARS)
        deep = "s"
        for _ in range(server.MAX_DEPTH + 2):
            deep = [deep]
        status, body = h.request("POST", "/v1/predict", {"states": [deep], "questions": QUESTIONS})
        self.assertEqual((status, body["error"]), (400, "bad_request"))
        self.assertEqual(len(agent.calls), 1, "a refused request must not reach the model")

    def test_bounds_answer_before_any_model_work(self):
        agent = StubAgent()
        h = self.start(agent)
        q = QUESTIONS
        cases = [
            ({"states": ["s"] * (server.MAX_STATES + 1), "questions": q}, 413, "too_many_states"),
            ({"states": ["s"], "questions": {"q%d" % i: QUESTIONS["kind"] for i in range(server.MAX_QUESTIONS + 1)}},
             413, "too_many_questions"),
            ({"states": [], "questions": q}, 400, "bad_request"),
            ({"states": "s", "questions": q}, 400, "bad_request"),
            ({"states": [3], "questions": q}, 400, "bad_request"),
            ({"states": [None], "questions": q}, 400, "bad_request"),
            ({"states": ["s"], "questions": {}}, 400, "bad_request"),
            ({"states": ["s"], "questions": ["kind"]}, 400, "bad_request"),
            ({"states": ["s"], "questions": {"kind": "What is it?"}}, 400, "bad_request"),
            (["s"], 400, "bad_request"),
        ]
        for body, want_status, want_error in cases:
            status, got = h.request("POST", "/v1/predict", body)
            self.assertEqual((status, got["error"]), (want_status, want_error), json.dumps(body)[:120])
        self.assertEqual(h.headers_only(str(server.MAX_BODY + 1)), (413, {"error": "body_size", "max": server.MAX_BODY}))
        self.assertEqual(h.headers_only("0")[0], 413)
        self.assertEqual(h.headers_only("abc"), (400, {"error": "bad_request", "detail": "content-length"}))
        status, got = h.request("POST", "/v1/predict", raw=b'{"states": ["' + MARKER.encode() + b'"')
        self.assertEqual((status, got), (400, {"error": "bad_request", "detail": "body is not JSON"}))
        status, got = h.request("POST", "/v1/predict", raw=b"\xff\xfe not utf-8")
        self.assertEqual(status, 400)
        self.assertEqual(agent.calls, [], "a refused request must not reach the model")

    def test_a_question_the_model_rejects_is_a_422_and_the_server_lives_on(self):
        h = self.start(StubAgent(fail=ValueError("question 'kind' options exceed head_max_len=256 / " + MARKER)))
        status, body = h.request("POST", "/v1/predict", {"states": ["s"], "questions": QUESTIONS})
        # The exception's TYPE only: its message can quote the post (opus, gate 6c).
        self.assertEqual((status, body), (422, {"error": "predict_failed", "kind": "ValueError"}))
        self.assertEqual(h.request("GET", "/healthz")[0], 200)
        failed = [e for e in self.log_events() if e["event"] == "predict_failed"]
        self.assertEqual([(e["error"], e["states"], e["questions"]) for e in failed], [("ValueError", 1, 2)])

    def test_non_finite_answers_are_refused_not_sent_as_invalid_json(self):
        h = self.start(StubAgent(value=float("nan")))
        status, body = h.request("POST", "/v1/predict", {"states": ["s"], "questions": QUESTIONS})
        self.assertEqual((status, body), (500, {"error": "non_finite"}))

    def test_unknown_paths_and_methods(self):
        h = self.start(StubAgent())
        self.assertEqual(h.request("GET", "/v1/predict")[0], 404)
        self.assertEqual(h.request("POST", "/healthz", {"states": ["s"], "questions": QUESTIONS})[0], 404)
        self.assertEqual(h.request("GET", "/healthz?x=1")[0], 404)
        self.assertEqual(h.request("GET", "/")[0], 404)

    # ---- one forward pass at a time, a bounded queue ----

    def test_one_forward_pass_at_a_time(self):
        # Held by a gate and counted, never timed (opus, gate 6c: this runs inside vitest on a loaded machine): A sits in
        # the model until B and C are both admitted, and the gate opens only 0.4 s after that.
        gate = threading.Event()
        agent = StubAgent(gate=gate)
        h = self.start(agent)
        out = []

        def call(state):
            out.append(h.request("POST", "/v1/predict", {"states": [state, state + "2"], "questions": QUESTIONS}))

        first = threading.Thread(target=call, args=("a",))
        first.start()
        self.assertTrue(self.wait_for(lambda: agent.calls == ["a"], 15), "A is inside the model")
        rest = [threading.Thread(target=call, args=(s,)) for s in ("b", "c")]
        for t in rest:
            t.start()
        self.assertTrue(self.wait_for(lambda: h.admitted() == 3, 15), "B and C wait behind A")
        time.sleep(0.4)
        gate.set()
        for t in [first] + rest:
            t.join(20)
        self.assertEqual([s for s, _ in out], [200, 200, 200])
        self.assertEqual(agent.max_active, 1)
        self.assertGreater(max(b["wait_ms"] for _, b in out), 100, "the later requests waited for the lock")

    def test_past_the_queue_the_answer_is_busy(self):
        gate = threading.Event()
        agent = StubAgent(gate=gate)
        h = self.start(agent, max_queued=1)
        first = []
        t = threading.Thread(target=lambda: first.append(
            h.request("POST", "/v1/predict", {"states": ["held"], "questions": QUESTIONS})))
        t.start()
        deadline = time.time() + 10
        while not agent.calls and time.time() < deadline:
            time.sleep(0.01)
        self.assertEqual(agent.calls, ["held"], "the first request is inside the model")
        status, body = h.request("POST", "/v1/predict", {"states": ["late"], "questions": QUESTIONS})
        self.assertEqual((status, body["error"]), (503, "busy"))
        self.assertEqual(h.request("GET", "/healthz")[0], 200, "health never waits for the model")
        gate.set()
        t.join(10)
        self.assertEqual(first[0][0], 200)
        self.assertEqual(h.request("POST", "/v1/predict", {"states": ["after"], "questions": QUESTIONS})[0], 200)

    # ---- a caller that gave up is not worked for ----

    def test_a_caller_that_hangs_up_stops_the_work_between_states(self):
        agent = StubAgent(delay=0.2)
        h = self.start(agent)
        s = h.hang_up_later({"states": ["s%d" % i for i in range(10)], "questions": QUESTIONS})
        self.assertTrue(self.wait_for(lambda: len(agent.calls) >= 1, 15), "the request reached the model")
        s.close()  # the caller's timeout fires
        self.assertTrue(self.wait_for(lambda: self.abandoned(), 15), "the server noticed")
        (event,) = self.abandoned()
        self.assertLess(event["answered"], 10)
        self.assertLessEqual(len(agent.calls), event["answered"] + 1, "at most the state already in the model")
        status, body = h.request("POST", "/v1/predict", {"states": ["next"], "questions": QUESTIONS})
        self.assertEqual((status, body["wait_ms"] < 1000), (200, True), "the lock was released")

    def test_a_caller_that_hangs_up_while_queued_gives_its_place_back(self):
        gate = threading.Event()
        agent = StubAgent(gate=gate)
        h = self.start(agent, max_queued=2)
        out = {}
        a = threading.Thread(target=lambda: out.__setitem__("a", h.request(
            "POST", "/v1/predict", {"states": ["a"], "questions": QUESTIONS})))
        a.start()
        self.assertTrue(self.wait_for(lambda: agent.calls == ["a"], 15), "A is inside the model")
        s = h.hang_up_later({"states": ["b"], "questions": QUESTIONS})  # B: admitted, waiting for the lock
        self.assertTrue(self.wait_for(lambda: h.admitted() == 2, 15), "B is admitted")
        s.close()
        self.assertTrue(self.wait_for(lambda: self.abandoned(), 15), "B left the queue")
        self.assertEqual(self.abandoned()[0]["answered"], 0)
        self.assertEqual(h.admitted(), 1, "B gave its place back")
        c = threading.Thread(target=lambda: out.__setitem__("c", h.request(
            "POST", "/v1/predict", {"states": ["c"], "questions": QUESTIONS})))
        c.start()  # admitted only because B gave its place back (max_queued=2: A + C)
        self.assertTrue(self.wait_for(lambda: h.admitted() == 2, 15), "C is admitted while A still holds the model")
        gate.set()
        a.join(10)
        c.join(10)
        self.assertEqual((out["a"][0], out["c"][0]), (200, 200))
        self.assertEqual(agent.calls, ["a", "c"], "B never reached the model")

    # ---- the log ----

    def test_no_state_or_question_text_ever_reaches_the_log(self):
        h = self.start(StubAgent())
        secret_q = {"kind": {"type": "choice", "instructions": MARKER, "criteria": [MARKER, "other"]}}
        h.request("POST", "/v1/predict", {"states": [{"post": MARKER}], "questions": secret_q})
        h.request("POST", "/v1/predict", {"states": [MARKER] * (server.MAX_STATES + 1), "questions": secret_q})
        h.request("POST", "/v1/predict", raw=b'{"states": ["' + MARKER.encode() + b'"')
        h.request("POST", "/v1/predict", {"states": [{"post": MARKER}], "questions": {"kind": MARKER}})
        failing = self.start(StubAgent(fail=RuntimeError(MARKER)))
        self.assertEqual(failing.request("POST", "/v1/predict", {"states": [MARKER], "questions": secret_q})[0], 422)
        text = self.log.getvalue()
        self.assertTrue(text.strip(), "the requests were logged")
        self.assertNotIn(MARKER, text)
        self.assertNotIn("Lan", text)
        events = self.log_events()
        self.assertIn("predict", [e["event"] for e in events])

    def test_the_healthcheck_is_not_logged_but_everything_else_is(self):
        h = self.start(StubAgent())
        for _ in range(3):
            h.request("GET", "/healthz")
        h.request("GET", "/nope")
        http_lines = [e for e in self.log_events() if e["event"] == "http"]
        self.assertEqual([(e["method"], e["path"], e["status"]) for e in http_lines], [("GET", "/nope", 404)])

    # ---- configuration ----

    def test_env_ints_are_validated(self):
        saved = os.environ.get("LAYA_TEST_INT")
        try:
            os.environ.pop("LAYA_TEST_INT", None)
            self.assertIsNone(server._env_int("LAYA_TEST_INT", None))
            os.environ["LAYA_TEST_INT"] = " 3 "
            self.assertEqual(server._env_int("LAYA_TEST_INT", None), 3)
            for bad in ("0", "-2", "three", "2.5", "³"):
                os.environ["LAYA_TEST_INT"] = bad
                with self.assertRaises(SystemExit, msg=bad):
                    server._env_int("LAYA_TEST_INT", None)
        finally:
            if saved is None:
                os.environ.pop("LAYA_TEST_INT", None)
            else:
                os.environ["LAYA_TEST_INT"] = saved


if __name__ == "__main__":
    unittest.main(verbosity=1)
