"""Black-box checks for a RUNNING classroom-speech server (stdlib only, so it also runs inside the image):

  SPEECH_URL=http://127.0.0.1:8090 SPEECH_KEY=... python -I test_server.py [speech.wav]

Without a WAV argument it makes a tone, which proves the plumbing but not the words; pass a real
16 kHz mono clip to check a transcript comes back. Exits non-zero on the first failed check.
"""
import http.client, io, json, math, os, socket, struct, sys, threading, time, urllib.parse, wave

URL = urllib.parse.urlparse(os.environ.get('SPEECH_URL', 'http://127.0.0.1:8090'))
KEY = os.environ['SPEECH_KEY']
failures = []


def conn():
    return http.client.HTTPConnection(URL.hostname, URL.port, timeout=30)


def req(method, path, body=None, headers=None, key=True):
    c = conn()
    h = dict(headers or {})
    if key:
        h['x-speech-key'] = KEY
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, dict(r.getheaders()), data


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))
    if not ok:
        failures.append(name)


def wav(samples, rate=16000, channels=1):
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', s) for s in samples))
    return b.getvalue()


tone = wav([int(6000 * math.sin(2 * math.pi * 220 * i / 16000)) for i in range(16000 * 2)])
silent = wav([0] * 16000 * 2)
# Two seconds of silence, then a quiet half second (-40 dBFS): must NOT be refused as silence.
quiet_late = wav([0] * 32000 + [int(330 * math.sin(2 * math.pi * 300 * i / 16000)) for i in range(8000)])
speech = open(sys.argv[1], 'rb').read() if len(sys.argv) > 1 else None

s, _, d = req('GET', '/health', key=False)
health = json.loads(d)
check('health', s == 200 and health.get('ok') and len(health.get('voices', [])) == 9, d[:200])

s, h, _ = req('POST', '/stt', tone, {'content-type': 'audio/wav'}, key=False)
check('stt without key → 401 + close', s == 401 and h.get('Connection') == 'close', f'{s} {h}')
s, _, _ = req('POST', '/stt', tone, {'content-type': 'audio/wav', 'x-speech-key': 'wrong'}, key=False)
check('stt wrong key → 401', s == 401)
s, _, _ = req('POST', '/stt', tone, {'content-type': 'audio/wav', 'x-speech-key': 'kéy'}, key=False)
check('non-ASCII key → 401, not 500', s == 401)

s, _, d = req('POST', '/stt', silent, {'content-type': 'audio/wav'})
check('silence → silence (level gate)', s == 200 and json.loads(d)['status'] == 'silence' and json.loads(d).get('reason') == 'level', d)
s, _, d = req('POST', '/stt', quiet_late, {'content-type': 'audio/wav'})
check('quiet voice after 2 s of silence is not refused by the gate', s == 200 and json.loads(d)['seconds'] == 2.5 and 'reason' not in json.loads(d), d)
s, _, d = req('POST', '/stt', wav([0] * 8000, rate=44100, channels=2), {'content-type': 'audio/wav'})
check('stereo 44.1 kHz → 400', s == 400, d)
s, _, d = req('POST', '/stt', b'not a wav at all', {'content-type': 'audio/wav'})
check('garbage → 400', s == 400, d)
try:  # refused from the headers alone, so the client may still be sending when the socket closes
    s = req('POST', '/stt', b'x' * 1_700_000, {'content-type': 'audio/wav'})[0]
except (BrokenPipeError, ConnectionResetError):
    s = 400
check('oversize → refused', s == 400, s)
if speech:
    s, _, d = req('POST', '/stt', speech, {'content-type': 'audio/wav'})
    out = json.loads(d)
    check('real clip → words', s == 200 and out['status'] == 'ok' and len(out['text']) > 3, d)
    print('   transcript:', out.get('text'), f'({out.get("ms")} ms)')

# A chunked body (no Content-Length) is refused, and the connection closes.
c = conn()
c.putrequest('POST', '/stt')
c.putheader('x-speech-key', KEY)
c.putheader('Transfer-Encoding', 'chunked')
c.endheaders()
c.send(b'5\r\nhello\r\n0\r\n\r\n')
r = c.getresponse()
check('chunked → 400 + close', r.status == 400 and r.getheader('Connection') == 'close', r.status)
c.close()

j = {'content-type': 'application/json'}
s, h, d = req('POST', '/tts', json.dumps({'text': 'Hello.\nHow was your weekend?', 'voice': 'Harper'}), j)
check('tts → mp3', s == 200 and h.get('Content-Type') == 'audio/mpeg' and (d[:3] == b'ID3' or (d[0] == 0xFF and d[1] & 0xE0 == 0xE0)), f'{s} {d[:8]}')
check('tts reports its length', float(h.get('X-Audio-Seconds', 0)) > 1.0, h)
s, _, _ = req('POST', '/tts', json.dumps({'text': 'Slow please.', 'voice': 'Toby', 'rate': 'slow'}), j)
check('tts slow', s == 200)
for body, name in ((json.dumps({'text': 'hi', 'voice': 'Bob'}), 'unknown voice'),
                   (json.dumps({'text': '', 'voice': 'Harper'}), 'empty text'),
                   (json.dumps({'text': 'x' * 1300, 'voice': 'Harper'}), 'long text'),
                   (json.dumps({'text': 'hi', 'voice': 'Harper', 'rate': 'fast'}), 'unknown rate'),
                   (json.dumps(['a', 'list']), 'non-object JSON'),
                   (json.dumps({'text': 5, 'voice': 'Harper'}), 'non-string text'),
                   ('{"text": ', 'broken JSON')):
    s, _, d = req('POST', '/tts', body, j)
    check(f'tts {name} → 400', s == 400, f'{s} {d[:80]}')

# /tts/stream: the voice as raw PCM16 while it is made — the same voices, rates and refusals as /tts, refused BEFORE a 200.
s, h, d = req('POST', '/tts/stream', json.dumps({'text': 'Hello. How was your weekend?', 'voice': 'Harper'}), j)
check('tts/stream → PCM16 24 kHz', s == 200 and h.get('Content-Type', '').startswith('audio/L16') and h.get('X-Sample-Rate') == '24000', f'{s} {h}')
check('tts/stream body is whole samples, over a second of voice', len(d) % 2 == 0 and len(d) > 48000, len(d))
s, _, _ = req('POST', '/tts/stream', json.dumps({'text': 'Slow please.', 'voice': 'Toby', 'rate': 'slow'}), j)
check('tts/stream slow', s == 200)
s, _, _ = req('POST', '/tts/stream', json.dumps({'text': 'hi', 'voice': 'Bob'}), j)
check('tts/stream unknown voice → 400', s == 400)
s, _, _ = req('POST', '/tts/stream', json.dumps({'text': 'hi', 'voice': 'Harper'}), j, key=False)
check('tts/stream without key → 401', s == 401)
# A client that hangs up mid-voice frees the voice: a request right after is answered.
sk = socket.create_connection((URL.hostname, URL.port))
body = json.dumps({'text': 'One two three four five six seven eight nine ten. ' * 8, 'voice': 'Harper'}).encode()
sk.sendall(f'POST /tts/stream HTTP/1.1\r\nHost: x\r\nx-speech-key: {KEY}\r\ncontent-type: application/json\r\nContent-Length: {len(body)}\r\n\r\n'.encode() + body)
sk.recv(4096)
sk.close()
time.sleep(1.0)
s, _, d = req('POST', '/tts/stream', json.dumps({'text': 'Still here.', 'voice': 'Harper'}), j)
check('tts/stream after a client hung up mid-voice → answered', s == 200 and len(d) > 0, s)

s, _, _ = req('GET', '/stt?text=secret')
check('GET on a POST route → 404', s == 404)
s, _, _ = req('POST', '/nope', b'{}', j)
check('unknown route → 404', s == 404)

# Keep-alive: a refusal followed by a good request on the SAME connection must not desync.
c = conn()
c.request('POST', '/stt', body=tone, headers={'content-type': 'audio/wav'})  # no key → 401, body unread
r1 = c.getresponse(); r1.read()
try:
    c.request('GET', '/health')
    r2 = c.getresponse(); r2.read()
    check('connection after a refusal is closed or clean', r2.status == 200, r2.status)
except (http.client.HTTPException, ConnectionError, socket.error):
    check('connection after a refusal is closed or clean', True)
c.close()

# A stalled body frees its thread: send headers + half a body, then wait past the socket timeout.
sk = socket.create_connection((URL.hostname, URL.port))
sk.sendall(f'POST /stt HTTP/1.1\r\nHost: x\r\nx-speech-key: {KEY}\r\nContent-Length: 1000\r\n\r\n'.encode() + b'x' * 10)
sk.settimeout(25)
t = time.time()
try:
    got = sk.recv(1000)
except socket.timeout:
    got = b''
check('stalled body is cut off (socket timeout)', time.time() - t < 24, f'{time.time() - t:.1f}s {got[:60]}')
sk.close()

# Over the in-flight cap the server answers 503 at once instead of queueing.
results, errors = [], []
def hit():
    try:
        results.append(req('POST', '/tts', json.dumps({'text': 'One two three four five six seven eight nine ten. ' * 6, 'voice': 'Harper'}), j)[0])
    except Exception as e:  # noqa: BLE001 — a client failure is a FAILED check, never a silent pass (codex, commit review)
        errors.append(type(e).__name__)
ths = [threading.Thread(target=hit) for _ in range(12)]
[t.start() for t in ths]
[t.join() for t in ths]
check('12 parallel replies: all 12 answered, each 200 or 503, at least one of each',
      not errors and len(results) == 12 and set(results) <= {200, 503} and 200 in results and 503 in results, f'{sorted(results)} errors={errors}')
print('   parallel statuses:', sorted(results))

s, _, _ = req('POST', '/tts', json.dumps({'text': 'x' * 700, 'voice': 'Harper'}), j)
check('tts over 600 characters → 400', s == 400, s)

# Over the connection cap a connection is closed before it is read; a well-behaved request afterwards still works.
idle = [socket.create_connection((URL.hostname, URL.port)) for _ in range(40)]
time.sleep(0.5)
closed = 0
for sk in idle:
    sk.settimeout(2)
    try:
        if sk.recv(1) == b'':
            closed += 1
    except socket.timeout:
        pass
    except OSError:
        closed += 1
[sk.close() for sk in idle]
check('connections over the cap are closed at once (≥ 8 of 40 idle sockets)', closed >= 8, closed)
time.sleep(0.5)
s, _, _ = req('GET', '/health', key=False)
check('the server answers again once they are gone', s == 200, s)

s, _, d = req('GET', '/health', key=False)
print('   peak RSS MB:', json.loads(d).get('peakRssMb'))
print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASS')
sys.exit(1 if failures else 0)
