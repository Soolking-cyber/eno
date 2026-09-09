"""
eno · self-hosted machine translation on the VN box.

⛔ WHY THIS EXISTS. Google Cloud Translation billed $56.69 for the 2.83M-character bilingual
backfill (11,831 rows). The Tiki import alone adds ~52,700 products — ~15M characters for the
Vietnamese column, and `warmTranslations` pushes every string into five more languages, so the
same job on the paid provider is ~90M characters ≈ $1,800. Owner, 2026-09-09: "we would need
permanent solution run in the box for it no api since its too costly". This is that provider.

⛔⛔ THE LICENCE IS PART OF THE MODEL CHOICE, AND IT DISQUALIFIED THE OBVIOUS WINNER.
NLLB-200-distilled-600M is the model every benchmark points at, and this file was built on it
first. It is distributed under **CC-BY-NC-4.0 — NON-COMMERCIAL**. eno.vn is a licensed
Vietnamese company operating a commercial marketplace; translating merchant listings with it is
a licence violation, and this codebase already carries a legal boundary (the eno.vn/eno.forum
edition split) precisely because that kind of exposure is not theoretical here. Caught in
review, verified against the HF model index (`license: cc-by-nc-4.0`), and rejected.
⚠️ DO NOT "UPGRADE" THIS TO NLLB. It will look like a free win on every quality table.

**facebook/m2m100_418M — MIT — is what ships, and it turned out to be better anyway.**
Benchmarked on the box against 300 real listing pairs pulled from prod (200 titles + 100
descriptions), scored with chrF++ against the Vietnamese the merchants actually wrote and the
English Google actually shipped:

  vi→en   opus-mt-vi-en   chrF 31.7 · entity 65.5% · 1103 ch/s ·   75MB · Apache-2.0
          nllb-600M       chrF 40.4 · entity 93.7% ·  248 ch/s ·  629MB · ⛔ CC-BY-NC
          nllb-1.3B       chrF 47.6 · entity 89.7% ·  124 ch/s · 1388MB · ⛔ CC-BY-NC
          m2m100_418M     chrF 41.6 · entity 99.6% ·  331 ch/s ·  493MB · ✅ MIT   ← chosen
  en→vi   opus-mt-en-vi   chrF 17.8 ·      —      ·  493 ch/s ·   75MB · Apache-2.0
          nllb-600M       chrF 42.4 · entity 98.8% ·  202 ch/s ·  629MB · ⛔ CC-BY-NC
          m2m100_418M     chrF 42.4 · entity 98.5% ·  406 ch/s ·  493MB · ✅ MIT   ← chosen

m2m100 beats NLLB-600M on vi→en quality, beats it decisively on entity preservation (99.6% vs
93.7%), is ~40% faster, is smaller, and is MIT. Opus-MT is 3x faster and unusable: at chrF 17.8
its en→vi output is not Vietnamese anyone would ship. NLLB-1.3B was not worth 2-3x the latency
even before the licence ruled it out — it scored WORSE than the 600M on entity preservation.
VietAI/envit5 could not be evaluated at all: its T5 tokenizer fails to convert under current
transformers ('dict' object is not an instance of 'Sequence'), from the hub and from a local
snapshot alike.

⚠️ THE HALLUCINATION CLASS NLLB HAD IS LARGELY GONE, BUT THE GATE STAYS. On short entity-dense
Vietnamese titles NLLB emitted fluent boilerplate unrelated to the input — "Máy lạnh Daikin
1.0HP 2025 (FTKB25ZVMV/RKB25ZVMV)" → "The cooling system is designed to be used in the
manufacture of refrigeration...". m2m100 renders those correctly (99.6% entity retention), but
99.6% is not 100%, the cache has no expiry, and a bad row is permanent. The caller's gate keys
on entity loss for exactly this — see `localTranslate` in src/lib/translate.ts. The gate is the
caller's job, not this server's: this server's contract is "translate, or fail loudly", and a
server that silently withheld suspicious output would leave the caller unable to tell a refusal
from a translation.

⚠️ GREEDY BEATS BEAM SEARCH HERE, which is the opposite of the usual advice. Measured on NLLB:
beam=1 scored chrF 40.68 vs beam=2's 40.40 on vi→en and ran 1.5x faster. Do not raise beam_size
without re-running the benchmark.

⚠️ AND 4 THREADS BEAT 8 ON AN 8-CORE BOX — 265 ch/s at 4 vs 240 at 8, because the other cores
are serving eno.vn, eno.forum and Postgres. This is a tenant on a production box, not a
dedicated inference host; INTRA_THREADS defaults to 4 for that reason.
"""
import os, re, json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ctranslate2
from transformers import AutoTokenizer

MODEL_DIR = os.environ.get("MT_MODEL_DIR", "/models/m2m100-418m-int8")
TOKENIZER = os.environ.get("MT_TOKENIZER", "/models/tokenizer")
# See the thread note above: 4 is a deliberate ceiling on a shared production box.
INTRA_THREADS = int(os.environ.get("MT_INTRA_THREADS", "4"))
MAX_BATCH_TOKENS = int(os.environ.get("MT_MAX_BATCH_TOKENS", "2048"))
# Matches MAX_CHARS-per-item expectations upstream; 480 leaves room for the language prefix.
MAX_INPUT_TOKENS = 480
# Bounds on an unauthenticated internal service — see do_POST.
MAX_BODY_BYTES = int(os.environ.get("MT_MAX_BODY_BYTES", str(8 * 1024 * 1024)))
MAX_TEXTS = int(os.environ.get("MT_MAX_TEXTS", "500"))

# ⚠️ m2m100 uses PLAIN ISO CODES, not NLLB's FLORES-200 tags ('vi', not 'vie_Latn'). The one
# mapping that is not identity is our internal `zh-Hans` → m2m100's `zh`; m2m100 emits
# Simplified for `zh`, which is what that code means here. Only the languages
# src/lib/i18n/langs.ts actually ships — all eleven are in m2m100's 100.
M2M_CODE = {
    "en": "en", "vi": "vi", "zh-Hans": "zh", "ko": "ko", "ja": "ja", "ru": "ru",
    "km": "km", "ms": "ms", "th": "th", "fr": "fr", "hi": "hi",
}

print(f"[mt] loading {MODEL_DIR} (threads={INTRA_THREADS})", flush=True)
_translator = ctranslate2.Translator(
    MODEL_DIR, device="cpu", inter_threads=1, intra_threads=INTRA_THREADS, compute_type="int8"
)
_tokenizer = AutoTokenizer.from_pretrained(TOKENIZER)
# ⛔ ONE LOCK COVERING TOKENIZATION *AND* TRANSLATION, not just translation.
# `_tokenizer.src_lang` is GLOBAL MUTABLE STATE and this is a ThreadingHTTPServer serving two
# app containers plus batch import jobs. An earlier version set src_lang outside the lock: a
# vi→en request could set `vie_Latn`, an en→vi request overwrite it with `eng_Latn`, and the
# first request then encode Vietnamese tagged as English. NLLB's source tag drives decoding, so
# the result is FLUENT, WRONG, passes every gate, and caches forever in a table with no expiry.
# All four review seats caught this independently. The lock also keeps INTRA_THREADS workers
# from being spawned by two batches at once — the contention that made 8 threads slower than 4.
class _FairLock:
    """
    FIFO ticket lock.

    ⛔ A PLAIN threading.Lock MAKES THE SLICING BELOW POINTLESS, and this was MEASURED, not
    reasoned about. Python's Lock is not fair: the thread that releases it usually reacquires
    it immediately, so a large batch releasing every MAX_SEGMENTS_PER_LOCK segments simply
    takes it straight back. A small request issued during a 120-string batch waited 14.4s of
    that batch's 15.4s — i.e. it waited for essentially the whole job, exactly as a reviewer
    predicted when they said releasing a non-fair lock "does not guarantee waiting requests a
    turn". With tickets the waiter is served in arrival order, so it waits at most the slice
    currently running.
    """

    def __init__(self):
        self._cv = threading.Condition()
        self._next_ticket = 0
        self._now_serving = 0

    def __enter__(self):
        with self._cv:
            ticket = self._next_ticket
            self._next_ticket += 1
            while ticket != self._now_serving:
                self._cv.wait()

    def __exit__(self, *_exc):
        with self._cv:
            self._now_serving += 1
            self._cv.notify_all()


_lock = _FairLock()
print("[mt] ready", flush=True)


# ⚠️ A CEILING ON HOW LONG ONE REQUEST CAN HOLD THE LOCK. Everything queues on `_lock`, so a
# 50-description import batch holding it for ~100s would stall a visitor's first uncached
# listing render — and ephemeral chat translation, which used to be a ~200ms Google call —
# behind it for minutes. Slicing lets a small request interleave between slices instead of
# waiting out the whole batch. It does not give chat priority; it bounds the worst case.
MAX_SEGMENTS_PER_LOCK = 24


def _hard_split(part):
    """Break one oversized run into encoder-sized pieces. Words first, characters as the floor."""
    pieces, buf = [], ""
    for word in part.split():
        candidate = f"{buf} {word}".strip() if buf else word
        if buf and len(_tokenizer.encode(candidate, add_special_tokens=False)) > MAX_INPUT_TOKENS:
            pieces.append(buf)
            buf = word
        else:
            buf = candidate
    if buf:
        pieces.append(buf)
    # ⛔ A WORD SPLIT IS NOT A FLOOR — Chinese, Japanese and Thai do not use spaces, so an
    # unspaced description is ONE "word" and the loop above returns it unchanged, still over
    # the window. It would then be silently truncated by `truncation=True`. Split on characters
    # as the last resort: a bad break beats a dropped tail.
    out = []
    for piece in pieces:
        if len(_tokenizer.encode(piece, add_special_tokens=False)) <= MAX_INPUT_TOKENS:
            out.append(piece)
            continue
        # ⚠️ RE-CHECKED, NOT ESTIMATED. Token density varies WITHIN a string (a run of Han
        # followed by a Latin model code), so a step derived from the whole piece's average can
        # still emit an over-length slice — which `truncation=True` would then silently clip.
        # Halve and retry until every slice actually fits (codex and astra caught the estimate
        # claiming a guarantee it did not provide).
        queue = [piece]
        while queue:
            chunk = queue.pop(0)
            if len(_tokenizer.encode(chunk, add_special_tokens=False)) <= MAX_INPUT_TOKENS:
                out.append(chunk)
            elif len(chunk) <= 1:
                out.append(chunk)  # cannot split a single character further
            else:
                mid = len(chunk) // 2
                queue.insert(0, chunk[mid:])
                queue.insert(0, chunk[:mid])
    return out or [part]


def _segment(text):
    """
    Split `text` into (segment, separator) pairs: sentences to translate, and the exact
    whitespace that followed each so the shape of the input can be rebuilt.

    ⛔ NLLB IS A SENTENCE-LEVEL MODEL AND SILENTLY DROPS CONTENT FROM PARAGRAPHS. This is the
    most damaging thing measured about it and it is invisible without a reference. An
    846-character Vietnamese description of eleven distinct sentences, sent as ONE string, came
    back 447 characters — ratio 0.53 — with five sentences simply gone, including the last. The
    same eleven sentences sent individually came back 852 characters, ratio 1.01, all present.
    The input was well UNDER the 480-token window, so this is not truncation and no token limit
    prevents it: the decoder stops early on long multi-sentence input because it was trained on
    single sentences. Nothing downstream can catch it — the survivor is fluent, keeps its model
    codes, and a 0.53 ratio sails past the gate's floor.

    ⛔ AND THE SEPARATOR IS CARRIED, NOT NORMALISED. An earlier version split on `\n+` and
    rejoined with a single space, which turned every bulleted or line-delimited description
    into one run-on paragraph — fluent, entities intact, ratio ~1.0, invisible to every gate
    (found by codex, astra and opus). Line structure is content on a product listing.

    ⚠️ SEGMENTS ARE RE-BATCHED, NOT SENT ONE PER REQUEST — `translate` flattens every segment of
    every input into shared translate_batch calls, so splitting costs no extra round trips.
    """
    # The capturing group keeps the separators, so pieces alternate content/separator.
    # ⛔ AN ASCII FULL STOP ONLY ENDS A SENTENCE WHEN WHITESPACE FOLLOWS IT. A zero-width
    # alternative here (`\s*`) split inside every decimal, model code and domain — MEASURED:
    # "Máy lạnh Daikin 1.0HP" became ["Máy lạnh Daikin 1.", "0HP"], "27.5 inch" became
    # ["27.", "5 inch"], and "eno.vn" became ["eno.", "vn"]. Each fragment was then translated
    # as an isolated sentence, destroying exactly the specifications the entity gate exists to
    # protect (agy, reviewing this diff — and it was my own regression from adding CJK support).
    #
    # ⚠️ CJK IS THE DELIBERATE EXCEPTION: 。！？ are full-width sentence marks that never appear
    # inside a number and are not followed by a space, so they DO split on their own.
    pieces = re.split(r"((?<=[.!?…])\s+|(?<=[。！？])|\n+)", text)
    units = []
    for i in range(0, len(pieces), 2):
        body = pieces[i]
        sep = pieces[i + 1] if i + 1 < len(pieces) else ""
        if not body.strip():
            # Whitespace-only content still has to carry its separator through.
            if units:
                units[-1] = (units[-1][0], units[-1][1] + body + sep)
            continue
        if len(_tokenizer.encode(body, add_special_tokens=False)) <= MAX_INPUT_TOKENS:
            units.append((body, sep))
        else:
            parts = _hard_split(body)
            for n, part in enumerate(parts):
                units.append((part, " " if n < len(parts) - 1 else sep))
    return units or [(text, "")]


def translate(texts, source, target):
    src, tgt_lang = M2M_CODE.get(source), M2M_CODE.get(target)
    if not src or not tgt_lang:
        raise ValueError(f"unsupported pair {source}->{target}")
    # m2m100 forces the target with a `__xx__` token as the first decoded token.
    tgt = _tokenizer.lang_code_to_token[tgt_lang]

    # ⛔ SEGMENTATION IS UNDER THE LOCK TOO. `_segment`/`_hard_split` call `_tokenizer.encode`
    # to measure length, and the tokenizer is shared mutable state whose `src_lang` another
    # thread rewrites inside the lock. Running segmentation outside it — which an earlier
    # revision of this file did — races the encoder against that mutation (astra and agy caught
    # the reintroduction). Cheap to hold: segmentation is pure string work, no inference.
    with _lock:
        flat, owner, seps = [], [], []
        for i, text in enumerate(texts):
            for body, sep in _segment(text):
                flat.append(body)
                owner.append(i)
                seps.append(sep)

    hyps = []
    # Sliced so one large batch cannot monopolise the single inference worker — see
    # MAX_SEGMENTS_PER_LOCK. Tokenization is inside the lock too, because `_tokenizer.src_lang`
    # is global mutable state and this is a ThreadingHTTPServer: two requests with different
    # sources would otherwise encode each other's text under the wrong language tag, producing
    # output that is fluent, wrong, passes every gate, and caches forever.
    for start in range(0, len(flat), MAX_SEGMENTS_PER_LOCK):
        window = flat[start:start + MAX_SEGMENTS_PER_LOCK]
        with _lock:
            _tokenizer.src_lang = src
            tokens = [_tokenizer.convert_ids_to_tokens(_tokenizer.encode(w)) for w in window]
            results = _translator.translate_batch(
                tokens,
                target_prefix=[[tgt]] * len(tokens),
                batch_type="tokens",
                max_batch_size=MAX_BATCH_TOKENS,
                beam_size=1,               # measured faster AND slightly better — see header
                repetition_penalty=1.1,
                max_decoding_length=512,
            )
            for res in results:
                hyp = res.hypotheses[0]
                # The target-language token is echoed back first; drop it or it renders as a
                # literal "vie_Latn" prefix on every string.
                if hyp and hyp[0] == tgt:
                    hyp = hyp[1:]
                hyps.append(_tokenizer.decode(_tokenizer.convert_tokens_to_ids(hyp), skip_special_tokens=True))

    # ⛔ ZIP TRUNCATES SILENTLY, AND THE CALLER CANNOT SEE IT. If translate_batch ever returns
    # fewer hypotheses than segments submitted, `zip` pairs the survivors with the WRONG owners
    # and separators — and the handler's own length check still passes, because `out` is sized
    # from `texts` rather than from the work actually done. The result is positionally shifted
    # translations cached permanently in a table with no expiry (codex, reviewing this diff).
    if len(hyps) != len(flat):
        raise RuntimeError(f"segment count mismatch: {len(hyps)} hypotheses for {len(flat)} segments")

    out = [""] * len(texts)
    for hyp, idx, sep in zip(hyps, owner, seps):
        out[idx] += hyp + sep
    return [o.strip() for o in out]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "langs": sorted(M2M_CODE)})
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/translate":
            return self._send(404, {"error": "not_found"})
        try:
            # ⛔ BOUNDED BEFORE READING. This server has no authentication — it is reachable by
            # anything on supabase_default (see README on why it must never be published) — and
            # one inference worker behind one lock is trivially monopolised. A malformed or
            # absent Content-Length would also leave the handler reading until the connection
            # closed. Reject early rather than allocate (codex, reviewing this diff).
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._send(400, {"error": "bad_content_length"})
            if n <= 0 or n > MAX_BODY_BYTES:
                return self._send(413, {"error": "body_too_large", "max_bytes": MAX_BODY_BYTES})
            req = json.loads(self.rfile.read(n) or b"{}")
            texts = req.get("texts") or []
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                return self._send(400, {"error": "texts must be string[]"})
            if len(texts) > MAX_TEXTS:
                return self._send(413, {"error": "too_many_texts", "max": MAX_TEXTS})
            if not texts:
                return self._send(200, {"translations": []})
            out = translate(texts, req.get("source") or "vi", req.get("target") or "en")
            # ⛔ Length mismatch is the one thing the caller cannot detect but MUST NOT cache:
            # pairing out[i] with texts[i] after a drift would persist wrong translations
            # forever. Refuse rather than return a misaligned array.
            if len(out) != len(texts):
                return self._send(500, {"error": "length_mismatch"})
            self._send(200, {"translations": out})
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 — a translation failure must not kill the server
            print(f"[mt] error: {e}", flush=True)
            self._send(500, {"error": "translate_failed"})

    def log_message(self, *_):
        pass  # the default logger writes a line per request to stderr


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8088"))
    print(f"[mt] listening on :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
