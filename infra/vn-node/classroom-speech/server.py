"""
eno · classroom speech server — the AI tutor's ears and voice, self-hosted on the VN box.

⛔ WHY THIS EXISTS. eno Classroom's tutor hears the learner and answers out loud. Hosted speech
(Azure: speech-to-text $1/audio-hour plus neural TTS $15/1M characters) was ~$0.57 of every
practice-hour; owner, 2026-10-26: "we need to make it dirt cheap to scale and use" and "use best
for current box to mvp with up to 10 users if works fresh box for this task only". This server
is that: open models with commercial licences, on CPU, $0 a minute. A learner's free-talk audio
is transcribed here, on eno's own server in Vietnam, and goes nowhere else (repeat-after-me
drills may still be scored by Azure — src/lib/classroom/session-turn.ts — and the transcript
goes to Gemini for the reply: this server narrows what leaves the country, it does not end it).

⛔ THE MODELS, AND WHY THESE TWO (measured 2026-10-26 on an i9-9980HK, the same AVX2 class as
the box's Broadwell vCPUs; the box measured ~1.5x slower per core on the same CPU test).

  EARS  NVIDIA Parakeet TDT 0.6B v2, int8 ONNX via sherpa-onnx 2.0.0
        weights CC-BY-4.0 (attribution: NVIDIA) · sherpa-onnx Apache-2.0 (2.0.0 = GPL-free, PR #4055)
        120 clips of speechocean762 (Mandarin-L1 learners READING English; 60 children aged
        6-12, 60 adults):  WER child 12.7% · adult 6.5% · 0.33 s per 4.9 s clip at 4 threads.
        Parakeet TDT 110M:  WER child 20.6% · adult 15.2%  ← twice the errors; not worth the RAM.
        ⚠️ NOT measured against Azure on the same clips, and NOT on Vietnamese learners speaking
        freely — the pilot's own consented clips are the real test. Like every recogniser it
        sometimes "hears" the correct form ("yours tea" → "your tea"), so the tutor's prompt
        must never pin a small-word or word-ending mistake on a learner on the transcript alone.
        ⛔ NOT Whisper (or any LLM-decoder model): it rewrites learners' grammar into correct
        English ("there is the uh stars" → "there are stars", L2-ARCTIC), and correcting that
        grammar is the tutor's whole job.

  VOICE Gradium Phonon 31M (en), ptts 0.4.2 — weights, tokenizer and voices Apache-2.0; runtime
        MIT OR Apache-2.0. ⛔ ONLY phonon-31m-en: the phonon-40m models are CC BY-NC 4.0.
        ~4x real time on 2 threads; both instances (natural + slow) ~0.63 GB together.
        Kokoro-82M (Apache-2.0) is the usual pick and LOST here: 0.4-1.35x real time on this
        CPU class (3-9 s before a sentence could start) — fine on a GPU, too slow for the box.
        The voices are Gradium's catalogue voices (Apache-2.0); none is cloned from anyone.

⚠️ A TENANT ON A PRODUCTION BOX (README: the run line). Capped at 4 CPUs and a hard memory
limit, first in line for the kernel's OOM killer, PAUSED by eno-deploy.sh while it builds the
apps (a build's memory peak is the box's biggest), and it refuses work rather than queue it
(`503 busy`): the classroom says "try again" and the marketplace never waits on it.

⚠️ NEVER LOGS AUDIO OR WORDS. A log line carries the route, its timing and its size — never the
request path as sent, never text. Audio is decoded from memory and dropped; nothing touches disk.
"""
import hmac, io, json, os, queue, re, resource, socket, threading, time, unicodedata, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
import sherpa_onnx
import ptts

STT_DIR = os.environ.get('STT_MODEL_DIR', '/models/parakeet-tdt-0.6b-v2-int8')
# A local checkpoint folder (fetch_models.py builds it): a local path makes ptts download NOTHING.
TTS_DIR = os.environ.get('TTS_MODEL_DIR', '/models/phonon-31m-en')
STT_THREADS = int(os.environ.get('STT_THREADS', '4'))
TTS_THREADS = int(os.environ.get('TTS_THREADS', '2'))
# ⛔ REQUIRED. The app sends it as x-speech-key. The server has no published port (README) — this
# is the second lock: the Docker network it sits on also holds Supabase's containers. Read from a
# mounted file (SPEECH_KEY_FILE) so `docker inspect` shows a path, not the key (opus, commit review).
_key_file = os.environ.get('SPEECH_KEY_FILE', '').strip()
SPEECH_KEY = (open(_key_file).read() if _key_file else os.environ.get('SPEECH_KEY', '')).strip().encode()
if len(SPEECH_KEY) < 24:
    raise SystemExit('SPEECH_KEY must be set (24+ characters)')

MAX_WAV_BYTES = 1_600_000   # the app caps a turn at 45 s of 16 kHz PCM16 (1.44 MB) — this is above it
MAX_JSON_BYTES = 16_000
MAX_TEXT_CHARS = 600        # the app's longest line is ~350 (a 200-character opening + a drill); ~40 s of speech
SLOW_DELTA = 0.3            # Phonon's duration_delta: +0.3 = ~14% slower (measured) — young or A1-A2 learners
# Work admitted at once; the rest get 503 at once. 10 learners' turns rarely overlap, and a
# queue would only turn a busy minute into timeouts the app then retries.
MAX_IN_FLIGHT = int(os.environ.get('MAX_IN_FLIGHT', '4'))
LOCK_WAIT_S = 6.0           # longest a request waits for its model before answering 503
SOCKET_TIMEOUT_S = 15       # a client that stops sending mid-body frees its thread after this
# The app stops waiting for a voice after 10 s (speech-local.ts TTS_BUDGET_MS); past this the server stops reading
# the reply too, instead of holding that voice's lock for a client that has gone (opus, commit review).
TTS_DEADLINE_S = 12.0
# Connections at once, and how long any one may live: a peer trickling bytes can hold a thread no longer than this,
# and no more than this many of them (codex, commit review). ONE request per connection (every answer closes it), so the
# lifetime bounds a request and can never cut a second one on a reused socket (opus, round 2). Requests take ~1-8 s.
MAX_CONNECTIONS = 32
CONNECTION_LIFETIME_S = 60

# ⛔ THE VOICES THE APP MAY ASK FOR — src/lib/classroom/voices.ts holds the same list (a test
# reads both). Names from Gradium's catalogue (gradium/phonon-voices, voices.jsonl: locale and
# gender per voice; the samples' median pitch agrees). Two women and two men per accent, plus
# Zoey, the playful one, for young learners. fetch_models.py copies exactly these into the image.
VOICES = ('Harper', 'Hadley', 'Zoey', 'Trevor', 'Preston',   # en-US
          'Imogen', 'Maeve', 'Spencer', 'Toby')              # en-GB

# ------------------------------------------------------------------------------------------- models
_stt = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=f'{STT_DIR}/encoder.int8.onnx', decoder=f'{STT_DIR}/decoder.int8.onnx',
    joiner=f'{STT_DIR}/joiner.int8.onnx', tokens=f'{STT_DIR}/tokens.txt',
    num_threads=STT_THREADS, sample_rate=16000, feature_dim=80,
    decoding_method='greedy_search', model_type='nemo_transducer')
# One decode at a time: ~0.5 s a turn on the box, and two decodes at 4 threads each on a 4-CPU
# cap would only slow both.
_stt_lock = threading.Lock()

ptts.set_num_threads(TTS_THREADS)
# A small POOL of voice instances per speaking rate (the rate belongs to the INSTANCE — set_conditions is global to it —
# so never a set_conditions race between two requests). Each instance serves ONE request at a time: two parallel synths
# on one instance ran without error, which shows speed, not that ptts promises it is safe. Two at the natural rate, so a
# reply's next sentence, or a second learner, never waits behind the first (one lock per rate did: the local test,
# 2026-10-26, refused a reply after 6 s behind another). ~0.2 GB an instance.
POOL = {'natural': int(os.environ.get('TTS_NATURAL', '2')), 'slow': int(os.environ.get('TTS_SLOW', '1'))}
_tts = {rate: queue.Queue() for rate in POOL}
for _rate, _n in POOL.items():
    for _ in range(max(1, _n)):
        _tts[_rate].put(ptts.TTS(TTS_DIR, lang='en', **({'conditions': {'duration_delta': SLOW_DELTA}} if _rate == 'slow' else {})))
_probe = _tts['natural'].get()
_missing = [v for v in VOICES if v not in _probe.voices]
SAMPLE_RATE = _probe.sample_rate
_tts['natural'].put(_probe)
if _missing:  # a voice the image lacks would be fetched from the catalogue at request time — refuse to start
    raise SystemExit(f'voices missing from {TTS_DIR}: {_missing}')

_in_flight = threading.BoundedSemaphore(MAX_IN_FLIGHT)


class Busy(Exception):
    """Over MAX_IN_FLIGHT, or a model stayed taken past LOCK_WAIT_S: the app's 'try again'."""


class BadRequest(Exception):
    pass


# ------------------------------------------------------------------------------------------- speech
def read_wav(raw):
    """16 kHz mono PCM16 WAV → float32 in [-1, 1]. Anything else is the client's bug: refused."""
    try:
        with wave.open(io.BytesIO(raw)) as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16000:
                raise BadRequest('wav_format')
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2')
    except (wave.Error, EOFError) as e:
        raise BadRequest('wav') from e
    return pcm.astype(np.float32) / 32768.0


def has_voice(x, sr=16000):
    """Any 20 ms frame above -50 dBFS RMS. Frame by frame, not the whole clip: a quiet child after
    two seconds of silence still counts. Only true silence is refused — noise passes, and the
    recogniser answers it with nothing, which is the same 'silence' to the app."""
    n = sr // 50
    frames = x[: len(x) // n * n].reshape(-1, n)
    return frames.size > 0 and float(np.sqrt((frames * frames).mean(axis=1)).max()) >= 0.003


def recognize(raw):
    x = read_wav(raw)
    seconds = len(x) / 16000
    if seconds < 0.3 or not has_voice(x):
        return {'text': '', 'status': 'silence', 'reason': 'level', 'seconds': round(seconds, 2)}
    if not _stt_lock.acquire(timeout=LOCK_WAIT_S):
        raise Busy()
    try:
        s = _stt.create_stream()
        s.accept_waveform(16000, x)
        _stt.decode_stream(s)
        text = s.result.text.strip()
    finally:
        _stt_lock.release()
    return {'text': text, 'status': 'ok' if text else 'silence', 'seconds': round(seconds, 2)}


_SENTENCE_END = re.compile(r'(?<=[.!?])\s+')


def clean_text(text):
    """What the voice reads: no emoji, symbols or markup (a model's reply may carry them), one line.
    ⚠️ Control characters become a SPACE, not nothing: deleting a newline glued "Hello.\\nHow" into
    "Hello.How" — one misread word and no sentence break (opus, plan review)."""
    out = []
    for c in unicodedata.normalize('NFC', text):
        cat = unicodedata.category(c)
        if cat[0] == 'C' or cat[0] == 'Z':
            out.append(' ')
        elif cat not in ('So', 'Sk', 'Co'):
            out.append(c)
    text = re.sub(r'[*_#`~|<>\[\]{}]', ' ', ''.join(out))
    return re.sub(r'\s+', ' ', text).strip()


def speak(text, voice, rate):
    """MP3 (24 kHz mono, ~7 KB a second) of the whole reply, read a sentence at a time with a short
    breath between — the same format Azure's TTS gave, so the page decodes it the same way."""
    deadline = time.perf_counter() + TTS_DEADLINE_S
    try:
        tts = _tts[rate].get(timeout=LOCK_WAIT_S)
    except queue.Empty:
        raise Busy()
    try:
        gap = np.zeros(int(SAMPLE_RATE * 0.12), dtype=np.float32)
        parts = []
        for sentence in _SENTENCE_END.split(text):
            if not sentence:
                continue
            # Frame by frame, so the deadline stops a sentence in its MIDDLE: leaving the `with` block stops Phonon's
            # generation (ptts docs). One long sentence can no longer outlive the client (codex, round 2).
            with tts.stream(sentence, voice=voice) as audio:
                for chunk in audio:
                    parts.append(chunk)
                    if time.perf_counter() > deadline:
                        raise Busy()  # the client has given up by now; free the voice for the next learner
            parts.append(gap)
    finally:
        _tts[rate].put(tts)
    pcm = np.concatenate(parts[:-1]) if parts else np.zeros(0, dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, pcm, SAMPLE_RATE, format='MP3')
    return buf.getvalue(), len(pcm) / SAMPLE_RATE


def speak_stream(tts, text, voice, write):
    """The same line as raw PCM16 (24 kHz mono, little-endian), handed to `write` FRAME BY FRAME as Phonon makes it —
    the first sound leaves within ~0.1 s instead of after the whole line (/tts/stream; owner, 2026-10-26: "delayless").
    `tts` is a voice instance the CALLER holds for the whole line. Returns the seconds of audio written. A client that
    hangs up stops the synthesis at its next frame."""
    deadline = time.perf_counter() + TTS_DEADLINE_S
    samples = 0
    gap = np.zeros(int(SAMPLE_RATE * 0.12), dtype='<i2').tobytes()
    first = True
    for sentence in _SENTENCE_END.split(text):
        if not sentence:
            continue
        if not first:
            write(gap)
            samples += len(gap) // 2
        first = False
        with tts.stream(sentence, voice=voice) as audio:
            for chunk in audio:
                pcm = (np.clip(chunk, -1.0, 1.0) * 32767).astype('<i2')
                write(pcm.tobytes())
                samples += len(pcm)
                if time.perf_counter() > deadline:
                    raise Busy()
    return samples / SAMPLE_RATE


def peak_rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)  # Linux: KiB


# ------------------------------------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    timeout = SOCKET_TIMEOUT_S

    def log_message(self, fmt, *args):  # the stdlib line carries the raw path — never logged here
        pass

    def _send(self, code, body, ctype='application/json', headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        # Every answer closes its connection: a refusal may leave an unread body on the socket that a kept-alive
        # connection would read as the next request, and CONNECTION_LIFETIME_S must bound one request, never two.
        # A new TCP connection inside the Docker network costs well under a millisecond.
        self.close_connection = True
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self):
        given = self.headers.get('x-speech-key', '').encode('utf-8', 'replace')
        return hmac.compare_digest(given, SPEECH_KEY)

    def _body(self, cap):
        """Exactly Content-Length bytes, or BadRequest. No chunked bodies: the app always sends a length."""
        if self.headers.get('Transfer-Encoding'):
            raise BadRequest('transfer_encoding')
        n = self.headers.get('Content-Length', '')
        if not n.isdigit() or not 0 < int(n) <= cap:
            raise BadRequest('length')
        n = int(n)
        data = self.rfile.read(n)
        if len(data) != n:
            raise BadRequest('short_body')
        return data

    def _stream(self, text, voice, rate, t0):
        """/tts/stream: 200 and the PCM as it is made, the body ending when the connection closes (no length — it is
        not known yet). The voice instance is taken BEFORE the 200 and held to the end, so the only refusal (busy) is a
        503 — never a 200 with no voice; a failure after the 200 simply ends the body short."""
        try:
            tts = _tts[rate].get(timeout=LOCK_WAIT_S)
        except queue.Empty:
            raise Busy()
        try:
            self.close_connection = True
            self.send_response(200)
            self.send_header('Content-Type', f'audio/L16;rate={SAMPLE_RATE};channels=1')
            self.send_header('X-Sample-Rate', str(SAMPLE_RATE))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            first = [None]

            def write(b):
                if first[0] is None:
                    first[0] = round((time.perf_counter() - t0) * 1000)
                self.wfile.write(b)
                self.wfile.flush()

            try:
                seconds = speak_stream(tts, text, voice, write)
                print(f'tts-stream first={first[0]}ms total={round((time.perf_counter() - t0) * 1000)}ms audio={seconds:.1f}s chars={len(text)} rate={rate}', flush=True)
            except (BrokenPipeError, ConnectionResetError):
                print('tts-stream client gone', flush=True)
            except Busy:
                print('tts-stream cut at deadline', flush=True)
            except Exception as e:  # noqa: BLE001 — after the 200 nothing but voice may be written (2026-10-26 review, opus:
                # do_POST's 500 would land INSIDE the PCM body and play as noise): the body just ends short.
                print(f'tts-stream failed {type(e).__name__}', flush=True)
        finally:
            _tts[rate].put(tts)

    def do_GET(self):
        if self.path == '/health':
            return self._send(200, {'ok': True, 'stt': 'parakeet-tdt-0.6b-v2-int8', 'tts': 'phonon-31m-en',
                                    'voices': list(VOICES), 'sampleRate': SAMPLE_RATE, 'peakRssMb': peak_rss_mb()})
        self._send(404, {'error': 'not_found'})

    def do_POST(self):
        route = {'/stt': 'stt', '/tts': 'tts', '/tts/stream': 'tts-stream'}.get(self.path)
        if route is None:
            return self._send(404, {'error': 'not_found'})
        t0 = time.perf_counter()
        # The key BEFORE a slot (opus, commit review): a caller without it must not be able to fill the server.
        if not self._authorised():
            return self._send(401, {'error': 'unauthorised'})
        if not _in_flight.acquire(blocking=False):
            print(f'{route} 503 busy', flush=True)
            return self._send(503, {'error': 'busy'})
        try:
            if route == 'stt':
                out = recognize(self._body(MAX_WAV_BYTES))
                ms = round((time.perf_counter() - t0) * 1000)
                print(f'stt {ms}ms audio={out["seconds"]}s status={out["status"]}', flush=True)
                return self._send(200, {**out, 'ms': ms})
            req = json.loads(self._body(MAX_JSON_BYTES))
            if not isinstance(req, dict):
                raise BadRequest('json')
            voice, rate, text = req.get('voice'), req.get('rate', 'natural'), req.get('text')
            if not isinstance(voice, str) or voice not in VOICES or not isinstance(rate, str) or rate not in _tts:
                return self._send(400, {'error': 'voice'})
            text = clean_text(text) if isinstance(text, str) else ''
            if not text or len(text) > MAX_TEXT_CHARS:
                return self._send(400, {'error': 'text'})
            if route == 'tts-stream':
                return self._stream(text, voice, rate, t0)
            mp3, seconds = speak(text, voice, rate)
            ms = round((time.perf_counter() - t0) * 1000)
            print(f'tts {ms}ms audio={seconds:.1f}s chars={len(text)} rate={rate}', flush=True)
            return self._send(200, mp3, 'audio/mpeg', {'X-Audio-Seconds': f'{seconds:.2f}', 'X-Synth-Ms': str(ms)})
        except Busy:
            print(f'{route} 503 model_busy', flush=True)
            return self._send(503, {'error': 'busy'})
        except TimeoutError:  # the body stopped arriving (SOCKET_TIMEOUT_S)
            print(f'{route} 408 timeout', flush=True)
            return self._send(408, {'error': 'timeout'})
        except (BadRequest, json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f'{route} 400 {type(e).__name__}', flush=True)
            return self._send(400, {'error': 'bad_request'})
        except Exception as e:  # noqa: BLE001 — a failure answers 500 and names its class, never its data
            print(f'{route} 500 {type(e).__name__}', flush=True)
            return self._send(500, {'error': 'internal'})
        finally:
            _in_flight.release()


class Server(ThreadingHTTPServer):
    """One thread per connection (ThreadingHTTPServer) — at most MAX_CONNECTIONS of them, each cut off after
    CONNECTION_LIFETIME_S. Over the cap a connection is closed at once, before a byte of it is read."""
    daemon_threads = True
    request_queue_size = 16
    _slots = threading.BoundedSemaphore(MAX_CONNECTIONS)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        # shutdown() unblocks a recv() another thread is waiting in; close() alone would not.
        cut = threading.Timer(CONNECTION_LIFETIME_S, lambda: _shutdown_quietly(request))
        cut.daemon = True
        cut.start()
        try:
            super().process_request_thread(request, client_address)
        finally:
            cut.cancel()
            self._slots.release()


def _shutdown_quietly(sock):
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8090'))
    # Warm both voices and the recogniser: the first request otherwise pays the graph set-up (~1 s).
    for rate in _tts:
        warm = [_tts[rate].get() for _ in range(_tts[rate].qsize())]
        for t in warm:
            t.synth('Hello.', voice=VOICES[0])
            _tts[rate].put(t)
    warm = _stt.create_stream()
    warm.accept_waveform(16000, np.zeros(16000, dtype=np.float32))  # an EMPTY stream throws (0 feature frames)
    _stt.decode_stream(warm)
    print(f'classroom-speech on :{port} (stt {STT_THREADS} threads, tts {TTS_THREADS}, '
          f'{MAX_IN_FLIGHT} in flight, rss {peak_rss_mb()} MB)', flush=True)
    Server(('0.0.0.0', port), Handler).serve_forever()
